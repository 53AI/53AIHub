package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/model"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

const (
	wikiGenerationQueueKey    = "rag:job:queue:wiki_page_generation"
	wikiVectorizationQueueKey = "rag:job:queue:wiki_page_vectorization"
)

// WikiQueueCount describes the queued and currently running jobs of one Wiki pipeline.
type WikiQueueCount struct {
	Queued  int64 `json:"queued"`
	Running int64 `json:"running"`
	Total   int64 `json:"total"`
}

// WikiQueueStatusResponse is the tenant-scoped status of both independent Wiki queues.
type WikiQueueStatusResponse struct {
	Generation    WikiQueueCount `json:"generation"`
	Vectorization WikiQueueCount `json:"vectorization"`
}

type WikiQueueStatusService interface {
	// GetStatus 返回企业 Wiki 两条流水线的队列状态；spaceID > 0 时仅统计该空间下的任务。
	GetStatus(ctx context.Context, eid, spaceID int64) (*WikiQueueStatusResponse, error)
}

type wikiQueueStatusService struct {
	db  *gorm.DB
	rdb redis.Cmdable
}

func NewWikiQueueStatusService(db *gorm.DB, rdb redis.Cmdable) WikiQueueStatusService {
	return &wikiQueueStatusService{db: db, rdb: rdb}
}

func (s *wikiQueueStatusService) GetStatus(ctx context.Context, eid, spaceID int64) (*WikiQueueStatusResponse, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki queue status database is required")
	}
	if s.rdb == nil {
		return nil, fmt.Errorf("wiki queue status redis is required")
	}
	if eid <= 0 {
		return nil, fmt.Errorf("eid is required")
	}

	generation, err := s.countQueue(ctx, wikiGenerationQueueKey, "wiki_page_generation", eid, spaceID)
	if err != nil {
		return nil, err
	}
	vectorization, err := s.countQueue(ctx, wikiVectorizationQueueKey, "wiki_page_vectorization", eid, spaceID)
	if err != nil {
		return nil, err
	}

	if err := s.countRunning(ctx, eid, "wiki_page_generation", spaceID, &generation); err != nil {
		return nil, err
	}
	if err := s.countRunning(ctx, eid, "wiki_page_vectorization", spaceID, &vectorization); err != nil {
		return nil, err
	}

	return &WikiQueueStatusResponse{Generation: generation, Vectorization: vectorization}, nil
}

func (s *wikiQueueStatusService) countQueue(ctx context.Context, key, jobType string, eid, spaceID int64) (WikiQueueCount, error) {
	payloads, err := s.rdb.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		return WikiQueueCount{}, fmt.Errorf("count wiki %s queue: %w", jobType, err)
	}

	var count int64
	var jobIDs []int64
	for _, payload := range payloads {
		var wrapper model.JobWrapper
		if err := json.Unmarshal([]byte(payload), &wrapper); err != nil {
			continue
		}
		if wrapper.Eid != eid {
			continue
		}
		count++
		if spaceID > 0 {
			jobIDs = append(jobIDs, wrapper.JobID)
		}
	}

	if spaceID > 0 {
		relatedIDs, err := s.jobRelatedIDs(ctx, eid, jobType, jobIDs)
		if err != nil {
			return WikiQueueCount{}, err
		}
		matched, err := s.countSpaceRelatedIDs(ctx, eid, jobType, relatedIDs, spaceID)
		if err != nil {
			return WikiQueueCount{}, err
		}
		count = matched
	}
	return WikiQueueCount{Queued: count, Total: count}, nil
}

func (s *wikiQueueStatusService) countRunning(ctx context.Context, eid int64, jobType string, spaceID int64, count *WikiQueueCount) error {
	var running int64
	if spaceID > 0 {
		var jobs []model.RagJob
		if err := s.db.WithContext(ctx).
			Select("related_id").
			Where("eid = ? AND type = ? AND status = ?", eid, jobType, model.RagJobStatusProcessing).
			Find(&jobs).Error; err != nil {
			return fmt.Errorf("load running wiki %s jobs: %w", jobType, err)
		}
		matched, err := s.countSpaceRelatedIDs(ctx, eid, jobType, extractRelatedIDs(jobs), spaceID)
		if err != nil {
			return err
		}
		running = matched
	} else {
		if err := s.db.WithContext(ctx).Model(&model.RagJob{}).
			Where("eid = ? AND type = ? AND status = ?", eid, jobType, model.RagJobStatusProcessing).
			Count(&running).Error; err != nil {
			return fmt.Errorf("count running wiki %s jobs: %w", jobType, err)
		}
	}
	count.Running = running
	count.Total = count.Queued + count.Running
	return nil
}

// jobRelatedIDs 返回队列中指定任务 ID 关联的文件/页面 ID（related_id）。
func (s *wikiQueueStatusService) jobRelatedIDs(ctx context.Context, eid int64, jobType string, jobIDs []int64) ([]int64, error) {
	if len(jobIDs) == 0 {
		return nil, nil
	}
	var jobs []model.RagJob
	if err := s.db.WithContext(ctx).
		Select("related_id").
		Where("eid = ? AND type = ? AND job_id IN ?", eid, jobType, jobIDs).
		Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("load wiki %s queued jobs: %w", jobType, err)
	}
	return extractRelatedIDs(jobs), nil
}

// extractRelatedIDs 收集任务关联的文件/页面 ID，忽略未设置关联（related_id=0）的任务。
func extractRelatedIDs(jobs []model.RagJob) []int64 {
	relatedIDs := make([]int64, 0, len(jobs))
	for _, job := range jobs {
		if job.RelatedId > 0 {
			relatedIDs = append(relatedIDs, job.RelatedId)
		}
	}
	return relatedIDs
}

// countSpaceRelatedIDs 统计关联 ID 中属于指定空间的数量：
// wiki_page_generation 的 related_id 是文件 ID，经 files -> libraries 归属空间；
// wiki_page_vectorization 的 related_id 是页面 ID，经 wiki_pages.space_id 归属空间。
func (s *wikiQueueStatusService) countSpaceRelatedIDs(ctx context.Context, eid int64, jobType string, relatedIDs []int64, spaceID int64) (int64, error) {
	if len(relatedIDs) == 0 {
		return 0, nil
	}
	var count int64
	db := s.db.WithContext(ctx)
	var err error
	switch jobType {
	case "wiki_page_generation":
		err = db.Model(&model.File{}).
			Joins("JOIN libraries ON libraries.id = files.library_id AND libraries.space_id = ? AND libraries.eid = files.eid", spaceID).
			Where("files.id IN ? AND files.is_deleted = ? AND files.eid = ?", relatedIDs, false, eid).
			Count(&count).Error
	case "wiki_page_vectorization":
		err = db.Model(&model.WikiPage{}).
			Where("id IN ? AND space_id = ? AND eid = ?", relatedIDs, spaceID, eid).
			Count(&count).Error
	default:
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("count wiki %s jobs in space %d: %w", jobType, spaceID, err)
	}
	return count, nil
}
