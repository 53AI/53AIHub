package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrWikiRebuildAlreadyRunning = errors.New("wiki rebuild is already being enqueued")
	ErrWikiRebuildInvalidRequest = errors.New("wiki rebuild request is invalid")
)

const wikiRebuildLockTTL = 5 * time.Minute

type WikiRebuildRequest struct {
	Eid       int64
	LibraryID int64
	FileID    int64
	Language  string
}

type WikiRebuildEnqueueResult struct {
	BatchID      string `json:"batch_id"`
	TotalFiles   int    `json:"total_files"`
	QueuedFiles  int    `json:"queued_files"`
	SkippedFiles int    `json:"skipped_files"`
	FailedFiles  int    `json:"failed_files"`
}

type WikiRebuildService struct {
	db *gorm.DB
}

func NewWikiRebuildService(db *gorm.DB) *WikiRebuildService {
	return &WikiRebuildService{db: db}
}

func (s *WikiRebuildService) Enqueue(ctx context.Context, req WikiRebuildRequest) (*WikiRebuildEnqueueResult, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki rebuild db is required")
	}
	if req.Eid <= 0 || req.LibraryID <= 0 || req.FileID < 0 {
		return nil, ErrWikiRebuildInvalidRequest
	}
	if !common.IsRedisEnabled() || common.RDB == nil {
		return nil, fmt.Errorf("redis is disabled")
	}

	lockKey := fmt.Sprintf("Lock:wiki:rebuild:%d:%d", req.Eid, req.LibraryID)
	lockToken := uuid.NewString()
	locked, err := common.RDB.SetNX(ctx, lockKey, lockToken, wikiRebuildLockTTL).Result()
	if err != nil {
		return nil, fmt.Errorf("acquire wiki rebuild lock: %w", err)
	}
	if !locked {
		return nil, ErrWikiRebuildAlreadyRunning
	}
	defer func() {
		_, err := common.RDB.Eval(context.Background(), "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", []string{lockKey}, lockToken).Result()
		if err != nil {
			logger.Warnf(ctx, "【Wiki重建】 释放入队锁失败 lock=%s err=%v", lockKey, err)
		}
	}()

	var files []model.File
	query := s.db.WithContext(ctx).Where("eid = ? AND library_id = ? AND is_deleted = ?", req.Eid, req.LibraryID, false)
	if req.FileID > 0 {
		query = query.Where("id = ?", req.FileID)
	}
	if err := query.Find(&files).Error; err != nil {
		return nil, err
	}
	if req.FileID > 0 && len(files) == 0 {
		return nil, gorm.ErrRecordNotFound
	}

	result := &WikiRebuildEnqueueResult{
		BatchID:    uuid.New().String(),
		TotalFiles: len(files),
	}
	autoTrigger := NewWikiAutoTriggerService(s.db)
	for _, file := range files {
		var running int64
		if err := s.db.WithContext(ctx).Model(&model.RagJob{}).
			Where("eid = ? AND related_id = ? AND type = ? AND status IN ?", req.Eid, file.ID, wikiAutoTriggerJobType, []string{model.RagJobStatusPending, model.RagJobStatusProcessing}).
			Count(&running).Error; err != nil {
			return nil, err
		}
		if running > 0 {
			result.SkippedFiles++
			continue
		}

		job, err := autoTrigger.createWikiGenerationJob(ctx, req.Eid, file.ID, req.LibraryID, req.Language, "manual_rebuild", result.BatchID)
		if err != nil {
			result.FailedFiles++
			logger.Warnf(ctx, "【Wiki重建】 创建文件任务失败 file_id=%d err=%v", file.ID, err)
			continue
		}
		if job == nil {
			result.SkippedFiles++
			continue
		}
		if err := autoTrigger.enqueueWikiJob(ctx, job); err != nil {
			result.FailedFiles++
			logger.Warnf(ctx, "【Wiki重建】 文件任务入队失败 file_id=%d job_id=%d err=%v", file.ID, job.JobID, err)
			s.removeUnqueuedWikiJob(ctx, job)
			continue
		}
		result.QueuedFiles++
	}

	return result, nil
}

func (s *WikiRebuildService) removeUnqueuedWikiJob(ctx context.Context, job *model.RagJob) {
	if job == nil {
		return
	}
	if err := s.db.WithContext(ctx).Delete(&model.RagJob{}, "job_id = ?", job.JobID).Error; err != nil {
		logger.Warnf(ctx, "【Wiki重建】 清理未入队任务失败 job_id=%d err=%v", job.JobID, err)
	}
}
