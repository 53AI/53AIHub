package model

import (
	"fmt"
	"strings"
)

type RecordingStats struct {
	TotalCount    int64 `json:"total_count"`
	TotalFileSize int64 `json:"total_file_size"`
	TotalDuration int64 `json:"total_duration"`
}

func getPersonalLibraryIDsByEid(eid int64) []int64 {
	var ids []int64
	DB.Model(&Library{}).
		Where("eid = ? AND library_kind = ?", eid, LIBRARY_KIND_PERSONAL_USER).
		Pluck("id", &ids)
	return ids
}

func SearchRecordingFilesByEid(eid int64, userIDs []int64, keyword string, startTime, endTime int64, offset, limit int) ([]File, int64, error) {
	var files []File
	var total int64

	keyword = strings.TrimSpace(keyword)

	libraryIDs := getPersonalLibraryIDsByEid(eid)
	if len(libraryIDs) == 0 {
		return files, 0, nil
	}

	query := DB.Model(&File{}).
		Where("eid = ? AND is_deleted = ? AND origin_type IN ? AND library_id IN ?", eid, false, RecordingOriginTypes(), libraryIDs)

	if len(userIDs) > 0 {
		query = query.Where("user_id IN ?", userIDs)
	}

	if keyword != "" {
		query = query.Where("path LIKE ?", "%"+keyword+"%")
	}

	if startTime > 0 {
		query = query.Where("created_time >= ?", startTime)
	}

	if endTime > 0 {
		query = query.Where("created_time <= ?", endTime)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count recording files: %w", err)
	}

	if err := query.Order("created_time DESC").
		Offset(offset).Limit(limit).
		Find(&files).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to query recording files: %w", err)
	}

	if err := attachUploadFiles(files); err != nil {
		return nil, 0, fmt.Errorf("failed to attach upload files: %w", err)
	}

	return files, total, nil
}

func GetRecordingDurationsByFileIDs(fileIDs []int64) (map[int64]int64, error) {
	if len(fileIDs) == 0 {
		return map[int64]int64{}, nil
	}
	var results []struct {
		OutputFileID int64
		Duration     int64
	}
	err := DB.Model(&RecordingJob{}).
		Where("output_file_id IN ?", fileIDs).
		Group("output_file_id").
		Select("output_file_id, COALESCE(SUM(total_recorded_ms), 0) AS duration").
		Scan(&results).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get recording durations: %w", err)
	}
	m := make(map[int64]int64, len(results))
	for _, r := range results {
		m[r.OutputFileID] = r.Duration
	}
	return m, nil
}

func GetRecordingFileStats(eid int64, userIDs []int64, startTime, endTime int64) (*RecordingStats, error) {
	libraryIDs := getPersonalLibraryIDsByEid(eid)
	if len(libraryIDs) == 0 {
		return &RecordingStats{}, nil
	}

	query := DB.Model(&File{}).Where(map[string]interface{}{
		"eid":         eid,
		"is_deleted":  false,
		"origin_type": RecordingOriginTypes(),
		"library_id":  libraryIDs,
	})
	if len(userIDs) > 0 {
		query = query.Where("user_id IN ?", userIDs)
	}
	if startTime > 0 {
		query = query.Where("created_time >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("created_time <= ?", endTime)
	}

	var fileIDs []int64
	if err := query.Pluck("id", &fileIDs).Error; err != nil {
		return nil, fmt.Errorf("failed to get recording file IDs: %w", err)
	}

	stats := &RecordingStats{
		TotalCount: int64(len(fileIDs)),
	}

	if len(fileIDs) == 0 {
		return stats, nil
	}

	if err := DB.Model(&UploadFile{}).
		Where("id IN (SELECT upload_file_id FROM files WHERE id IN ?)", fileIDs).
		Select("COALESCE(SUM(size), 0)").
		Scan(&stats.TotalFileSize).Error; err != nil {
		return nil, fmt.Errorf("failed to get total file size: %w", err)
	}

	var fileDurationSum int64
	if err := DB.Model(&File{}).
		Where("id IN ?", fileIDs).
		Select("COALESCE(SUM(duration_ms), 0)").
		Scan(&fileDurationSum).Error; err != nil {
		return nil, fmt.Errorf("failed to get file duration sum: %w", err)
	}

	var jobDurationSum int64
	if err := DB.Table("recording_jobs rj").
		Joins("LEFT JOIN files f ON f.id = rj.output_file_id AND f.duration_ms > 0").
		Where("rj.output_file_id IN ?", fileIDs).
		Where("f.id IS NULL").
		Select("COALESCE(SUM(rj.total_recorded_ms), 0)").
		Scan(&jobDurationSum).Error; err != nil {
		return nil, fmt.Errorf("failed to get job duration sum: %w", err)
	}

	stats.TotalDuration = fileDurationSum + jobDurationSum

	return stats, nil
}
