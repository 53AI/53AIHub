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
	if err := rdb.LPush(ctx, "rag:job:queue:"+wikiPageVectorizationJobType, wrapper).Err(); err != nil {
		return nil, err
	}
	return job, nil
}

// EnqueueWikiPageVectorizationJob 创建并投递一个 Wiki 页面版本的独立向量化任务。
func EnqueueWikiPageVectorizationJob(ctx context.Context, eid, pageID, versionID int64, force bool, reason string) (*model.RagJob, error) {
	return createWikiPageVectorizationJob(ctx, model.DB, common.RDB, eid, pageID, versionID, force, reason)
}

func enqueueWikiPageVectorizationJobs(ctx context.Context, db *gorm.DB, rdb redis.Cmdable, eid, libraryID int64, slugs []string, reason string) error {
	if db == nil || eid <= 0 || libraryID <= 0 || len(slugs) == 0 {
		return nil
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
			logger.Errorf(ctx, "【Wiki向量化】自动创建任务失败: eid=%d page_id=%d version_id=%d err=%v", eid, page.ID, page.CurrentVersionID, err)
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
