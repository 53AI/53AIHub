package service

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

type RecordingAdminService struct {
	eid int64
}

func NewRecordingAdminService(eid int64) *RecordingAdminService {
	return &RecordingAdminService{eid: eid}
}

type RecordingConfigResult struct {
	Enabled        bool   `json:"enabled"`
	ParserPlatform string `json:"parser_platform"`
}

func (s *RecordingAdminService) GetRecordingConfig(ctx context.Context) (*RecordingConfigResult, error) {
	config, err := model.ValidateOrCreateRecordingConfig(s.eid)
	if err != nil {
		return nil, fmt.Errorf("获取录音配置失败: %w", err)
	}
	return &RecordingConfigResult{
		Enabled:        config.Enabled,
		ParserPlatform: config.ParserPlatform,
	}, nil
}

func (s *RecordingAdminService) UpdateRecordingConfig(ctx context.Context, enabled *bool, parserPlatform *string) error {
	if parserPlatform != nil && *parserPlatform != "" && !isValidParserPlatform(*parserPlatform) {
		return fmt.Errorf("不支持的解析平台: %s", *parserPlatform)
	}

	// 部分更新：合并到当前配置后保存
	if err := model.PatchRecordingConfig(s.eid, enabled, parserPlatform); err != nil {
		return fmt.Errorf("更新录音配置失败: %w", err)
	}

	// 判断最终生效的 enabled 和 parserPlatform，决定是否初始化管线
	finalEnabled := false
	if enabled != nil {
		finalEnabled = *enabled
	} else {
		if cfg, err := model.ValidateOrCreateRecordingConfig(s.eid); err == nil {
			finalEnabled = cfg.Enabled
		}
	}

	finalPlatform := ""
	if parserPlatform != nil {
		finalPlatform = *parserPlatform
	} else {
		if cfg, err := model.ValidateOrCreateRecordingConfig(s.eid); err == nil {
			finalPlatform = cfg.ParserPlatform
		}
	}

	if finalPlatform != "" && finalEnabled {
		if err := InitializeRecordingPipelineForPersonalLibrary(ctx, s.eid, finalPlatform); err != nil {
			logger.SysErrorf("【录音配置】初始化解析管线失败（不阻塞主流程）: eid=%d platform=%s err=%v", s.eid, finalPlatform, err)
		}
	}

	return nil
}

func isValidParserPlatform(platform string) bool {
	_, ok := model.GetDefaultPlatformSettingDisplayMeta(platform)
	return ok
}

type ParserPlatformResult struct {
	PlatformKey string `json:"platform_key"`
	DisplayName string `json:"display_name"`
	Configured  bool   `json:"configured"`
	Status      string `json:"status"`
}

func (s *RecordingAdminService) ListParserPlatforms(ctx context.Context) ([]ParserPlatformResult, error) {
	platformMetas := model.ListDefaultPlatformSettingDisplayMetas()

	allSettings, err := model.GetPlatformSettingsByEid(s.eid)
	if err != nil {
		logger.SysErrorf("【录音管理】批量查询平台配置失败: eid=%d err=%v", s.eid, err)
		allSettings = nil
	}
	settingMap := make(map[string]*model.PlatformSetting, len(allSettings))
	for i := range allSettings {
		settingMap[allSettings[i].PlatformKey] = &allSettings[i]
	}

	platforms := make([]ParserPlatformResult, 0, len(platformMetas))
	for _, meta := range platformMetas {
		configured := false
		status := model.PLATFORM_STATUS_DISABLED

		if ps, ok := settingMap[meta.PlatformKey]; ok && ps.Setting != "" {
			configured = true
			status = ps.Status
		}

		platforms = append(platforms, ParserPlatformResult{
			PlatformKey: meta.PlatformKey,
			DisplayName: meta.DisplayName,
			Configured:  configured,
			Status:      status,
		})
	}

	return platforms, nil
}

type RecordingItem struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	CreatorID   int64  `json:"creator_id"`
	CreatorName string `json:"creator_name"`
	FileSize    int64  `json:"file_size"`
	Duration    int64  `json:"duration"`
	CreatedTime int64  `json:"created_time"`
	Status      string `json:"status"`
}

type RecordingListResult struct {
	Items    []RecordingItem `json:"items"`
	Total    int64           `json:"total"`
	Offset   int             `json:"offset"`
	Limit    int             `json:"limit"`
}

func (s *RecordingAdminService) ListRecordings(ctx context.Context, userIDs []int64, keyword string, startTime, endTime int64, offset, limit int) (*RecordingListResult, error) {
	files, total, err := model.SearchRecordingFilesByEid(s.eid, userIDs, keyword, startTime, endTime, offset, limit)
	if err != nil {
		return nil, fmt.Errorf("查询录音列表失败: %w", err)
	}

	creatorIDs := make([]int64, 0, len(files))
	fileIDs := make([]int64, 0, len(files))
	for _, f := range files {
		if f.UserID > 0 {
			creatorIDs = append(creatorIDs, f.UserID)
		}
		fileIDs = append(fileIDs, f.ID)
	}

	userEntityMap, err := model.GetUserMapByIDs(creatorIDs)
	if err != nil {
		logger.SysErrorf("【录音列表】批量查询用户信息失败: eid=%d err=%v", s.eid, err)
		userEntityMap = make(map[int64]*model.User)
	}

	var missingDurationIDs []int64
	for _, f := range files {
		if f.DurationMs <= 0 {
			missingDurationIDs = append(missingDurationIDs, f.ID)
		}
	}

	durationMap := make(map[int64]int64)
	if len(missingDurationIDs) > 0 {
		durationMap, err = model.GetRecordingDurationsByFileIDs(missingDurationIDs)
		if err != nil {
			logger.SysErrorf("【录音列表】批量查询录音时长失败: eid=%d err=%v", s.eid, err)
			durationMap = make(map[int64]int64)
		}
	}

	items := make([]RecordingItem, 0, len(files))
	for _, f := range files {
		creatorName := ""
		if user, ok := userEntityMap[f.UserID]; ok && user != nil {
			creatorName = user.Nickname
			if creatorName == "" {
				creatorName = user.Username
			}
		}
		if creatorName == "" {
			creatorName = fmt.Sprintf("%d", f.UserID)
		}

		fileName := extractRecordingFileName(f.Path)
		fileSize := int64(0)
		if f.UploadFile != nil {
			fileSize = f.UploadFile.Size
		}

		duration := f.DurationMs
		if duration <= 0 {
			duration = durationMap[f.ID]
		}

		items = append(items, RecordingItem{
			ID:          f.ID,
			Name:        fileName,
			CreatorID:   f.UserID,
			CreatorName: creatorName,
			FileSize:    fileSize,
			Duration:    duration,
			CreatedTime: f.CreatedTime,
			Status:      f.ConversionStatus,
		})
	}

	return &RecordingListResult{
		Items:  items,
		Total:  total,
		Offset: offset,
		Limit:  limit,
	}, nil
}

type RecordingStatsResult struct {
	TotalCount    int64 `json:"total_count"`
	TotalFileSize int64 `json:"total_file_size"`
	TotalDuration int64 `json:"total_duration"`
}

func (s *RecordingAdminService) GetRecordingStats(ctx context.Context, userIDs []int64, startTime, endTime int64) (*RecordingStatsResult, error) {
	stats, err := model.GetRecordingFileStats(s.eid, userIDs, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("查询录音统计失败: %w", err)
	}
	return &RecordingStatsResult{
		TotalCount:    stats.TotalCount,
		TotalFileSize: stats.TotalFileSize,
		TotalDuration: stats.TotalDuration,
	}, nil
}

func extractRecordingFileName(filePath string) string {
	return filepath.Base(filePath)
}
