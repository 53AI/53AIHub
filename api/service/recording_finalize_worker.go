package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

type RecordingFinalizeWorker struct {
	eid int64
	svc *RecordingService
}

var recordingFinalizeWorkerCompleteFinalize = func(svc *RecordingService, ctx context.Context, userID, jobID int64) (*model.File, error) {
	return svc.CompleteFinalize(ctx, userID, jobID)
}

// finalizeNotify 用于 RequestFinalize 通知 Worker 立即处理
var finalizeNotify = make(chan struct{}, 1)

// NotifyFinalizeWorker 通知 Worker 立即扫描 finalizing 任务（非阻塞）
func NotifyFinalizeWorker() {
	select {
	case finalizeNotify <- struct{}{}:
	default: // 已有信号待处理，跳过
	}
}

func NewRecordingFinalizeWorker(eid int64) *RecordingFinalizeWorker {
	return &RecordingFinalizeWorker{
		eid: eid,
		svc: NewRecordingService(eid),
	}
}

func (w *RecordingFinalizeWorker) ProcessOnce(ctx context.Context) error {
	var jobs []model.RecordingJob
	if err := model.DB.Where("eid = ? AND owner_instance = ? AND status IN ?", w.eid, config.GetRecordingInstanceID(), []string{
		model.RecordingJobStatusFinalizing,
		model.RecordingJobStatusFinalizingProcessing,
	}).
		Order("id asc").
		Find(&jobs).Error; err != nil {
		return err
	}

	lockSvc := NewRecordingLockService()
	var errs []error
	for i := range jobs {
		job := jobs[i]

		if !lockSvc.TryLockFinalize(job.ID) {
			logger.Infof(ctx, "【录音】任务已被其他实例处理，跳过: job_id=%d", job.ID)
			continue
		}

		claimed, err := w.svc.claimRecoveringFinalizingJob(job.ID, time.Now().UTC().UnixMilli())
		if err != nil {
			lockSvc.UnlockFinalize(job.ID)
			errs = append(errs, fmt.Errorf("claim job_id=%d failed: %w", job.ID, err))
			continue
		}
		if !claimed {
			lockSvc.UnlockFinalize(job.ID)
			continue
		}

		_, err = recordingFinalizeWorkerCompleteFinalize(w.svc, ctx, job.UserID, job.ID)
		lockSvc.UnlockFinalize(job.ID)

		if err != nil {
			errs = append(errs, fmt.Errorf("complete job_id=%d failed: %w", job.ID, err))
			continue
		}
	}
	return errors.Join(errs...)
}

func StartRecordingFinalizeWorker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-finalizeNotify:
				if err := processPendingRecordingFinalizeWorkers(ctx); err != nil {
					logger.SysErrorf("【录音】信号触发处理失败: err=%v", err)
				}
			case <-ticker.C:
				if err := processPendingRecordingFinalizeWorkers(ctx); err != nil {
					logger.SysErrorf("【录音】扫描待完成任务失败: err=%v", err)
				}
			}
		}
	}()
}

func processPendingRecordingFinalizeWorkers(ctx context.Context) error {
	var eids []int64
	if err := model.DB.Model(&model.RecordingJob{}).
		Where("owner_instance = ? AND status IN ?", config.GetRecordingInstanceID(), []string{model.RecordingJobStatusFinalizing, model.RecordingJobStatusFinalizingProcessing}).
		Distinct().
		Pluck("eid", &eids).Error; err != nil {
		return err
	}
	var errs []error
	for _, eid := range eids {
		if err := NewRecordingFinalizeWorker(eid).ProcessOnce(ctx); err != nil {
			errs = append(errs, fmt.Errorf("eid=%d: %w", eid, err))
		}
	}
	return errors.Join(errs...)
}
