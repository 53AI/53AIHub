package service

import (
	"context"
	"errors"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const wikiIndexIntroSlugForRead = "index/main"

func firstNonEmptyWikiHelper(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func normalizeWikiPageAliasesForRead(aliases []string) []string {
	if len(aliases) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(aliases))
	normalized := make([]string, 0, len(aliases))
	for _, alias := range aliases {
		alias = strings.TrimSpace(alias)
		if alias == "" {
			continue
		}
		if _, ok := seen[alias]; ok {
			continue
		}
		seen[alias] = struct{}{}
		normalized = append(normalized, alias)
	}
	return normalized
}

func getLatestRunJobsWithStepsByRelatedIDForWikiProgress(ctx context.Context, db *gorm.DB, eid int64, relatedID int64) (string, []model.RagJob, map[int64][]model.RagJobStep, error) {
	if db == nil {
		return "", nil, map[int64][]model.RagJobStep{}, nil
	}
	query := db.WithContext(ctx).Model(&model.RagJob{})
	if eid > 0 {
		query = query.Where("eid = ?", eid)
	}

	var latestJob model.RagJob
	if err := query.Where("related_id = ?", relatedID).Order("created_time DESC").First(&latestJob).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, map[int64][]model.RagJobStep{}, nil
		}
		return "", nil, nil, err
	}

	runID := latestJob.RunID
	jobQuery := db.WithContext(ctx).Model(&model.RagJob{})
	if eid > 0 {
		jobQuery = jobQuery.Where("eid = ?", eid)
	}
	if runID != "" {
		jobQuery = jobQuery.Where("run_id = ?", runID)
	} else {
		jobQuery = jobQuery.Where("job_id = ?", latestJob.JobID)
	}
	jobQuery = jobQuery.Where("related_id = ?", relatedID).Order("created_time ASC")

	var jobs []model.RagJob
	if err := jobQuery.Find(&jobs).Error; err != nil {
		return "", nil, nil, err
	}
	if len(jobs) == 0 {
		return runID, jobs, map[int64][]model.RagJobStep{}, nil
	}

	jobIDs := make([]int64, 0, len(jobs))
	for _, job := range jobs {
		jobIDs = append(jobIDs, job.JobID)
	}

	var steps []model.RagJobStep
	if err := db.WithContext(ctx).
		Where("job_id IN ?", jobIDs).
		Order("job_id ASC, step_order ASC").
		Find(&steps).Error; err != nil {
		return runID, jobs, nil, err
	}

	stepMap := make(map[int64][]model.RagJobStep, len(jobIDs))
	for _, step := range steps {
		stepMap[step.JobID] = append(stepMap[step.JobID], step)
	}

	return runID, jobs, stepMap, nil
}

func getWikiSpaceReadPermission(eid int64, resourceType int, resourceID int64, userID int64) (int, error) {
	var permission model.Permission
	if err := model.DB.Where(
		"eid = ? AND resource_type = ? AND resource_id = ? AND subject_type = ? AND subject_id = ?",
		eid, resourceType, resourceID, model.SUBJECT_TYPE_USER, userID,
	).First(&permission).Error; err == nil {
		return permission.Permission, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return model.PERMISSION_NONE, err
	}

	if err := model.DB.Where(
		"eid = ? AND resource_type = ? AND resource_id = ? AND subject_type = ?",
		eid, resourceType, resourceID, model.SUBJECT_TYPE_COMPANY_ALL,
	).First(&permission).Error; err == nil {
		return permission.Permission, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return model.PERMISSION_NONE, err
	}

	return model.PERMISSION_NONE, nil
}
