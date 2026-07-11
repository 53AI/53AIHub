package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

func (s *RecordingAssemblyService) FlushPending(ctx context.Context, job *model.RecordingJob) (*model.RecordingJobSegment, error) {
	if job == nil {
		return nil, errors.New("recording job is nil")
	}

	unlock := assemblyLockRegistry.lock(job.ID)
	defer unlock()
	return s.flushPendingAssemblyLocked(ctx, job)
}

func (s *RecordingAssemblyService) flushPendingAssemblyLocked(ctx context.Context, job *model.RecordingJob) (*model.RecordingJobSegment, error) {
	if job == nil {
		return nil, errors.New("recording job is nil")
	}
	assembly, err := model.GetRecordingJobAssemblyByJobID(job.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if strings.TrimSpace(assembly.BufferKey) == "" || assembly.BufferSize <= 0 {
		return nil, nil
	}
	if !assembly.CanEnterFlushing() {
		return nil, fmt.Errorf("当前聚合状态不支持收口: %s", assembly.Status)
	}

	if err := s.ensureAssemblyRecoverable(ctx, job, assembly); err != nil {
		return nil, err
	}

	return s.flushAssembly(ctx, job, assembly, assembly.LastInputIndex, 0)
}

func (s *RecordingAssemblyService) RecoverAssembly(ctx context.Context, jobID int64) (*model.RecordingJobAssembly, error) {
	unlock := assemblyLockRegistry.lock(jobID)
	defer unlock()

	assembly, err := model.GetRecordingJobAssemblyByJobID(jobID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}

	job, err := model.GetRecordingJobByID(s.eid, jobID)
	if err != nil {
		return nil, err
	}

	if err := s.ensureAssemblyRecoverable(ctx, job, assembly); err != nil {
		if errors.Is(err, ErrRecordingAssemblyBufferMissing) {
			logger.SysWarnf("【录音】本地聚合缓冲缺失，跳过恢复处理: job_id=%d status=%s", job.ID, assembly.Status)
			return nil, nil
		}
		return nil, err
	}
	return model.GetRecordingJobAssemblyByJobID(jobID)
}

func (s *RecordingAssemblyService) RecoverPendingAssemblies(ctx context.Context) (int, error) {
	var assemblies []model.RecordingJobAssembly
	if err := model.DB.Where("eid = ? AND owner_instance = ? AND status IN ?", s.eid, config.GetRecordingInstanceID(), []string{
		model.RecordingJobAssemblyStatusActive,
		model.RecordingJobAssemblyStatusFlushing,
	}).Order("job_id asc, segment_index asc").Find(&assemblies).Error; err != nil {
		return 0, err
	}

	recovered := 0
	for i := range assemblies {
		recoveredAssembly, err := s.RecoverAssembly(ctx, assemblies[i].JobID)
		if err != nil {
			return recovered, err
		}
		if recoveredAssembly != nil {
			recovered++
		}
	}
	return recovered, nil
}

func RecoverPendingRecordingAssemblies(ctx context.Context) (int, error) {
	var eids []int64
	if err := model.DB.Model(&model.RecordingJobAssembly{}).
		Where("owner_instance = ? AND status IN ?", config.GetRecordingInstanceID(), []string{
			model.RecordingJobAssemblyStatusActive,
			model.RecordingJobAssemblyStatusFlushing,
		}).
		Distinct().
		Pluck("eid", &eids).Error; err != nil {
		return 0, err
	}

	total := 0
	for _, eid := range eids {
		recovered, err := NewRecordingAssemblyService(eid).RecoverPendingAssemblies(ctx)
		if err != nil {
			return total, err
		}
		total += recovered
	}
	return total, nil
}
