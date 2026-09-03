package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2engines "github.com/53AI/53AIHub/rag-pipeline-v2/engines"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const wikiPageVectorizationJobType = "wiki_page_vectorization"
const wikiPageVectorizationPendingOpKind = "wiki_page_vectorization"

const WikiPageVectorizationJobType = wikiPageVectorizationJobType

type wikiPageVectorizationParameters struct {
	PageID              int64  `json:"page_id"`
	VersionID           int64  `json:"version_id"`
	Force               bool   `json:"force"`
	Reason              string `json:"reason,omitempty"`
	ProfileStepIndex    int    `json:"__profile_step_index"`
	SingleStepExecution bool   `json:"__single_step_execution"`
}

func buildWikiPageVectorizationStartParameters(pageID, versionID int64, force bool, reason string) ([]byte, error) {
	if pageID <= 0 || versionID <= 0 {
		return nil, fmt.Errorf("page_id and version_id are required")
	}
	return json.Marshal(wikiPageVectorizationParameters{
		PageID:              pageID,
		VersionID:           versionID,
		Force:               force,
		Reason:              strings.TrimSpace(reason),
		ProfileStepIndex:    0,
		SingleStepExecution: true,
	})
}

func createWikiPageVectorizationJob(ctx context.Context, db *gorm.DB, rdb redis.Cmdable, eid, pageID, versionID int64, force bool, reason string) (*model.RagJob, error) {
	if db == nil {
		return nil, fmt.Errorf("database is required")
	}
	if eid <= 0 || pageID <= 0 || versionID <= 0 {
		return nil, fmt.Errorf("eid, page_id and version_id are required")
	}
	if rdb == nil || !common.IsRedisEnabled() {
		return nil, fmt.Errorf("redis is disabled")
	}

	if existing, err := findRunningWikiPageVectorizationJob(ctx, db, eid, pageID, versionID); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}

	startParams, err := buildWikiPageVectorizationStartParameters(pageID, versionID, force, reason)
	if err != nil {
		return nil, err
	}
	factory := model.NewRagJobFactory(db, rdb)
	job, err := factory.CreateJobWithoutQueue(ctx, eid, wikiPageVectorizationJobType, string(startParams))
	if err != nil {
		return nil, err
	}

	profileBytes, err := json.Marshal(v2model.RuntimeProfile{
		Steps: []v2model.ProfileStep{{
			Enabled: true,
			RunMode: v2model.RunModeAuto,
			StepKey: wikiPageVectorizationJobType,
		}},
	})
	if err != nil {
		return nil, err
	}
	updates := map[string]interface{}{
		"related_id":           pageID,
		"runtime_profile_json": string(profileBytes),
		"run_id":               uuid.New().String(),
		"pipeline_id":          0,
	}
	if err := db.WithContext(ctx).Model(job).Updates(updates).Error; err != nil {
		return nil, err
	}
	for key, value := range updates {
		switch key {
		case "related_id":
			job.RelatedId = value.(int64)
		case "runtime_profile_json":
			job.RuntimeProfile = value.(string)
		case "run_id":
			job.RunID = value.(string)
		}
	}

	wrapper, err := json.Marshal(v2engines.JobWrapper{
		JobID:      job.JobID,
		Eid:        job.Eid,
		Type:       job.Type,
		EnqueuedAt: time.Now(),
	})
	if err != nil {
		return nil, err
	}
	if err := enqueueWikiPageVectorizationJob(ctx, rdb, job, wrapper); err != nil {
		return nil, err
	}
	return job, nil
}

func enqueueWikiPageVectorizationJob(ctx context.Context, rdb redis.Cmdable, job *model.RagJob, wrapper []byte) error {
	if job == nil || rdb == nil {
		return fmt.Errorf("vectorization job queue is unavailable")
	}
	return rdb.LPush(ctx, "rag:job:queue:"+wikiPageVectorizationJobType, wrapper).Err()
}

// EnqueueWikiPageVectorizationJob 创建并投递一个 Wiki 页面版本的独立向量化任务。
func EnqueueWikiPageVectorizationJob(ctx context.Context, eid, pageID, versionID int64, force bool, reason string) (*model.RagJob, error) {
	return createWikiPageVectorizationJob(ctx, model.DB, common.RDB, eid, pageID, versionID, force, reason)
}

func enqueueWikiPageVectorizationJobs(ctx context.Context, db *gorm.DB, rdb redis.Cmdable, eid, libraryID int64, slugs []string, reason string) error {
	if db == nil || eid <= 0 || libraryID <= 0 || len(slugs) == 0 {
		return nil
	}
	if err := retryWikiVectorizationPendingOps(ctx, db, rdb, eid); err != nil {
		logger.Warnf(ctx, "【Wiki生成】 补偿任务重试失败，继续处理本轮页面: eid=%d err=%v", eid, err)
	}
	var pages []model.WikiPage
	if err := db.WithContext(ctx).Where("eid = ? AND library_id = ? AND slug IN ? AND status = ?", eid, libraryID, slugs, model.WikiPageStatusActive).Find(&pages).Error; err != nil {
		return err
	}
	for _, page := range pages {
		if page.CurrentVersionID <= 0 {
			continue
		}
		if _, err := createWikiPageVectorizationJob(ctx, db, rdb, eid, page.ID, page.CurrentVersionID, false, reason); err != nil {
			logger.Errorf(ctx, "【Wiki生成】 自动创建任务失败: eid=%d page_id=%d version_id=%d err=%v", eid, page.ID, page.CurrentVersionID, err)
			if pendingErr := recordWikiVectorizationPendingOp(ctx, db, eid, page.ID, page.CurrentVersionID, reason, err); pendingErr != nil {
				logger.Errorf(ctx, "【Wiki生成】 保存补偿任务失败: eid=%d page_id=%d err=%v", eid, page.ID, pendingErr)
			}
		}
	}
	return nil
}

type wikiVectorizationPendingPayload struct {
	VersionID int64  `json:"version_id"`
	Force     bool   `json:"force"`
	Reason    string `json:"reason,omitempty"`
}

func recordWikiVectorizationPendingOp(ctx context.Context, db *gorm.DB, eid, pageID, versionID int64, reason string, cause error) error {
	payload, err := json.Marshal(wikiVectorizationPendingPayload{VersionID: versionID, Reason: reason})
	if err != nil {
		return err
	}
	var op model.WikiPendingOp
	query := db.WithContext(ctx).Where("eid = ? AND page_id = ? AND op_kind = ? AND status IN ?", eid, pageID, wikiPageVectorizationPendingOpKind, []string{model.WikiPendingOpStatusQueued, model.WikiPendingOpStatusFailed}).Order("id DESC").First(&op)
	if query.Error == nil {
		return db.WithContext(ctx).Model(&op).Updates(map[string]any{
			"status":     model.WikiPendingOpStatusQueued,
			"payload":    string(payload),
			"last_error": cause.Error(),
		}).Error
	}
	if !errors.Is(query.Error, gorm.ErrRecordNotFound) {
		return query.Error
	}
	return db.WithContext(ctx).Create(&model.WikiPendingOp{
		Eid:         eid,
		PageID:      pageID,
		OpKind:      wikiPageVectorizationPendingOpKind,
		Status:      model.WikiPendingOpStatusQueued,
		Payload:     string(payload),
		MaxAttempts: 0,
		LastError:   cause.Error(),
	}).Error
}

func retryWikiVectorizationPendingOps(ctx context.Context, db *gorm.DB, rdb redis.Cmdable, eid int64) error {
	var ops []model.WikiPendingOp
	if err := db.WithContext(ctx).Where("eid = ? AND op_kind = ? AND status = ?", eid, wikiPageVectorizationPendingOpKind, model.WikiPendingOpStatusQueued).Order("id ASC").Limit(50).Find(&ops).Error; err != nil {
		return err
	}
	for i := range ops {
		var payload wikiVectorizationPendingPayload
		if err := json.Unmarshal([]byte(ops[i].Payload), &payload); err != nil {
			_ = db.WithContext(ctx).Model(&ops[i]).Updates(map[string]any{"status": model.WikiPendingOpStatusFailed, "last_error": err.Error(), "attempt_count": gorm.Expr("attempt_count + ?", 1)}).Error
			continue
		}
		existing, findErr := findRunningWikiPageVectorizationJob(ctx, db, eid, ops[i].PageID, payload.VersionID)
		if findErr != nil {
			findErr = fmt.Errorf("find pending vectorization job: %w", findErr)
		}
		var err error
		if findErr != nil {
			err = findErr
		} else if existing != nil {
			wrapper, marshalErr := json.Marshal(v2engines.JobWrapper{
				JobID: existing.JobID, Eid: existing.Eid, Type: existing.Type, EnqueuedAt: time.Now(),
			})
			if marshalErr != nil {
				err = marshalErr
			} else {
				err = enqueueWikiPageVectorizationJob(ctx, rdb, existing, wrapper)
			}
		} else {
			_, err = createWikiPageVectorizationJob(ctx, db, rdb, eid, ops[i].PageID, payload.VersionID, payload.Force, payload.Reason)
		}
		updates := map[string]any{"attempt_count": gorm.Expr("attempt_count + ?", 1)}
		if err != nil {
			updates["status"] = model.WikiPendingOpStatusFailed
			updates["last_error"] = err.Error()
		} else {
			updates["status"] = model.WikiPendingOpStatusDone
		}
		if updateErr := db.WithContext(ctx).Model(&ops[i]).Updates(updates).Error; updateErr != nil {
			return updateErr
		}
	}
	return nil
}

func findRunningWikiPageVectorizationJob(ctx context.Context, db *gorm.DB, eid, pageID, versionID int64) (*model.RagJob, error) {
	var jobs []model.RagJob
	if err := db.WithContext(ctx).
		Where("eid = ? AND type = ? AND related_id = ? AND status IN ?", eid, wikiPageVectorizationJobType, pageID, []string{model.RagJobStatusPending, model.RagJobStatusProcessing}).
		Order("job_id DESC").Find(&jobs).Error; err != nil {
		return nil, err
	}
	for i := range jobs {
		var params wikiPageVectorizationParameters
		if err := json.Unmarshal([]byte(jobs[i].StartParameters), &params); err != nil {
			continue
		}
		if params.VersionID == versionID {
			return &jobs[i], nil
		}
	}
	return nil, nil
}

func parseWikiPageVectorizationParameters(job *model.RagJob) (wikiPageVectorizationParameters, error) {
	if job == nil || job.Type != wikiPageVectorizationJobType {
		return wikiPageVectorizationParameters{}, errors.New("invalid wiki page vectorization job")
	}
	var params wikiPageVectorizationParameters
	if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
		return params, fmt.Errorf("parse wiki vectorization parameters: %w", err)
	}
	if params.PageID <= 0 || params.VersionID <= 0 {
		return params, fmt.Errorf("page_id and version_id are required")
	}
	return params, nil
}
