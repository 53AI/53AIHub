package service

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/keystone"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	rag "github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

type RecordingAdminService struct {
	eid int64
}

func NewRecordingAdminService(eid int64) *RecordingAdminService {
	return &RecordingAdminService{eid: eid}
}

type RecordingConfigResult struct {
	Enabled                 bool                          `json:"enabled"`
	ParserPlatform          string                        `json:"parser_platform"`
	VoiceModelID            int64                         `json:"voice_model_id"`
	VoiceModelName          string                        `json:"voice_model_name"`
	InferenceModelID        int64                         `json:"inference_model_id"`
	InferenceModelName      string                        `json:"inference_model_name"`
	RecordingAgentEnabled   bool                          `json:"recording_agent_enabled"`
	MultiPerspectiveEnabled bool                          `json:"multi_perspective_enabled"`
	MemoryExtraction        *model.MemoryExtractionConfig `json:"memory_extraction,omitempty"`
	// InsightRegenerateEnabled 企业级开关：是否允许重新生成洞察（未配置时视为允许）。
	InsightRegenerateEnabled bool `json:"insight_regenerate_enabled"`
}

func (s *RecordingAdminService) GetRecordingConfig(ctx context.Context) (*RecordingConfigResult, error) {
	config, err := model.ValidateOrCreateRecordingConfig(s.eid)
	if err != nil {
		return nil, fmt.Errorf("获取录音配置失败: %w", err)
	}
	return &RecordingConfigResult{
		Enabled:                  config.Enabled,
		ParserPlatform:           config.ParserPlatform,
		VoiceModelID:             config.VoiceModelID,
		VoiceModelName:           config.VoiceModelName,
		InferenceModelID:         config.InferenceModelID,
		InferenceModelName:       config.InferenceModelName,
		RecordingAgentEnabled:    config.RecordingAgentEnabled,
		MultiPerspectiveEnabled:  config.MultiPerspectiveEnabled,
		MemoryExtraction:         config.MemoryExtraction,
		InsightRegenerateEnabled: model.IsInsightRegenerateEnabled(s.eid),
	}, nil
}

func (s *RecordingAdminService) UpdateRecordingConfig(ctx context.Context, enabled *bool, parserPlatform *string, voiceModelID *int64, voiceModelName *string, inferenceModelID *int64, inferenceModelName *string, recordingAgentEnabled *bool, multiPerspectiveEnabled *bool, memoryExtraction *model.MemoryExtractionConfig, insightRegenerateEnabled *bool) error {
	if parserPlatform != nil && *parserPlatform != "" && !IsValidParserPlatform(*parserPlatform) {
		return fmt.Errorf("不支持的解析平台: %s", *parserPlatform)
	}

	if voiceModelID != nil && *voiceModelID > 0 && (parserPlatform == nil || *parserPlatform == "") {
		parserPlatformValue := ""
		if ch, chErr := model.GetChannelByID(*voiceModelID); chErr == nil && model.IsVoiceModelChannel(ch) {
			if model.IsOpenAIAudioChannel(ch) {
				parserPlatformValue = fmt.Sprintf("openai:%d", ch.Type)
			} else {
				parserPlatformValue = fmt.Sprintf("voice:%d", ch.Type)
			}
			if cfg, parseErr := model.ParseChannelCustomConfig(ch.CustomConfig); parseErr == nil {
				if vms, ok := cfg["voice_models"].(map[string]interface{}); ok && len(vms) > 0 {
					for mn := range vms {
						if model.IsModelInChannelModels(mn, ch.Models) {
							if model.IsOpenAIAudioChannel(ch) {
								parserPlatformValue = fmt.Sprintf("openai:%d:%s", ch.Type, mn)
							} else {
								parserPlatformValue = fmt.Sprintf("voice:%d:%s", ch.Type, mn)
							}
							if voiceModelName == nil {
								voiceModelName = &mn
							}
						}
						break
					}
				}
			}
		}
		parserPlatform = &parserPlatformValue
	}

	if err := model.PatchRecordingConfig(s.eid, enabled, parserPlatform, voiceModelID, voiceModelName, inferenceModelID, inferenceModelName, recordingAgentEnabled, multiPerspectiveEnabled, memoryExtraction, insightRegenerateEnabled); err != nil {
		return fmt.Errorf("更新录音配置失败: %w", err)
	}

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
		if err := TriggerPendingRecordingParsings(ctx, s.eid, finalPlatform); err != nil {
			logger.SysErrorf("【录音配置】触发待解析录音失败（不阻塞主流程）: eid=%d err=%v", s.eid, err)
		}
	}

	return nil
}

func IsValidParserPlatform(platform string) bool {
	if strings.HasPrefix(platform, "voice:") || strings.HasPrefix(platform, "openai:") {
		parts := strings.Split(platform, ":")
		if len(parts) < 2 {
			return false
		}
		channelTypeStr := parts[1]
		if channelType, err := strconv.ParseInt(channelTypeStr, 10, 64); err == nil && channelType > 0 {
			return true
		}
		return false
	}
	_, ok := model.GetDefaultPlatformSettingDisplayMeta(platform)
	return ok
}

type RecordingItem struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	CreatorID   int64  `json:"creator_id"`
	CreatorName string `json:"creator_name"`
	FileSize    int64  `json:"file_size"`
	Duration    int64  `json:"duration"`
	CreatedTime int64  `json:"created_time"`
	UpdatedTime int64  `json:"updated_time"`
	Status      string `json:"status"`
	GroupID     int64  `json:"group_id"`
}

type RecordingListResult struct {
	Items  []RecordingItem `json:"items"`
	Total  int64           `json:"total"`
	Offset int             `json:"offset"`
	Limit  int             `json:"limit"`
}

func (s *RecordingAdminService) ListRecordings(ctx context.Context, userIDs []int64, keyword string, startTime, endTime int64, offset, limit int, groupID int64, sortBy, order string) (*RecordingListResult, error) {
	files, total, err := model.SearchRecordingFilesByEid(s.eid, userIDs, keyword, startTime, endTime, offset, limit, groupID, sortBy, order)
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
			UpdatedTime: f.UpdatedTime,
			Status:      f.ConversionStatus,
			GroupID:     f.GroupID,
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

// ListSummaryTemplates returns summary templates for the enterprise, optionally filtered by group.
func (s *RecordingAdminService) ListSummaryTemplates(ctx context.Context, groupID int64) ([]model.RecordingSummaryTemplate, error) {
	templates, err := model.GetRecordingSummaryTemplatesByEid(s.eid, groupID)
	if err != nil {
		return nil, fmt.Errorf("获取总结模板列表失败: %w", err)
	}
	return templates, nil
}

// CreateSummaryTemplate creates a new summary template.
func (s *RecordingAdminService) CreateSummaryTemplate(ctx context.Context, name, description, prompt string, groupID int64) (*model.RecordingSummaryTemplate, error) {
	t := &model.RecordingSummaryTemplate{
		Eid:         s.eid,
		Name:        name,
		Description: description,
		Prompt:      prompt,
		GroupID:     groupID,
	}
	if err := model.CreateRecordingSummaryTemplate(t); err != nil {
		return nil, fmt.Errorf("创建总结模板失败: %w", err)
	}
	return t, nil
}

// UpdateSummaryTemplate updates an existing summary template.
func (s *RecordingAdminService) UpdateSummaryTemplate(ctx context.Context, id int64, name, description, prompt string, groupID int64) error {
	t, err := model.GetRecordingSummaryTemplateByID(id)
	if err != nil {
		return fmt.Errorf("总结模板不存在: %w", err)
	}
	if t.Eid != s.eid {
		return fmt.Errorf("无权操作该模板")
	}
	t.Name = name
	t.Description = description
	t.Prompt = prompt
	t.GroupID = groupID
	return model.UpdateRecordingSummaryTemplate(t)
}

// DeleteSummaryTemplate deletes a summary template.
func (s *RecordingAdminService) DeleteSummaryTemplate(ctx context.Context, id int64) error {
	t, err := model.GetRecordingSummaryTemplateByID(id)
	if err != nil {
		return fmt.Errorf("总结模板不存在: %w", err)
	}
	if t.Eid != s.eid {
		return fmt.Errorf("无权操作该模板")
	}
	return model.DeleteRecordingSummaryTemplate(id)
}

// CreateFileSummary generates a summary for a file using the configured inference model.
func (s *RecordingAdminService) CreateFileSummary(ctx context.Context, fileID, templateID int64) (*model.RecordingFileSummary, error) {
	config, err := model.ValidateOrCreateRecordingConfig(s.eid)
	if err != nil {
		return nil, fmt.Errorf("获取录音配置失败: %w", err)
	}
	if config.InferenceModelID == 0 {
		return nil, fmt.Errorf("未配置推理模型，请先在录音配置中选择推理模型")
	}

	template, err := model.GetRecordingSummaryTemplateByID(templateID)
	if err != nil {
		return nil, fmt.Errorf("总结模板不存在: %w", err)
	}
	if template.Eid != s.eid {
		return nil, fmt.Errorf("无权使用该模板")
	}

	// 先创建记录，前端立刻可见
	summary := &model.RecordingFileSummary{
		FileID:           fileID,
		TemplateID:       templateID,
		TemplateName:     template.Name,
		InferenceModelID: config.InferenceModelID,
		SummaryContent:   "",
		Status:           "processing",
	}
	if err := model.CreateRecordingFileSummary(summary); err != nil {
		return nil, fmt.Errorf("创建总结记录失败: %w", err)
	}

	// 异步生成总结内容，回填数据
	go s.fillSummaryContent(context.Background(), summary, config, template)

	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskCreated(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-summary-%d-%d", fileID, templateID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "custom_template_summary",
			ServiceKey:     "recording-pipeline",
			StartedAt:      time.Now().UTC(),
			Metadata: map[string]string{
				"fileId":     strconv.FormatInt(fileID, 10),
				"templateId": strconv.FormatInt(templateID, 10),
			},
		})
	}
	return summary, nil
}

func (s *RecordingAdminService) fillSummaryContent(ctx context.Context, summary *model.RecordingFileSummary, config *model.RecordingConfig, template *model.RecordingSummaryTemplate) {
	prepared, err := getOrCompressTranscript(ctx, TranscriptPrepareRequest{
		EID:                s.eid,
		FileID:             summary.FileID,
		Consumer:           "template_summary",
		ContextLength:      getRecordingContextBudget(ctx, config),
		FixedInputTokens:   estimateTokens(template.Prompt),
		MaxOutputTokens:    4096,
		SafetyMargin:       500,
		Mode:               "balanced",
		InferenceModelID:   config.InferenceModelID,
		InferenceModelName: config.InferenceModelName,
	})
	if err != nil {
		logger.Errorf(ctx, "【总结】转写压缩失败 summaryID=%d err=%v", summary.ID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-summary-%d-%d", summary.FileID, summary.TemplateID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "custom_template_summary",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "TEMPLATE_SUMMARY_FAILED",
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		summary.Status = "failed"
		model.UpdateRecordingFileSummary(summary)
		return
	}

	channel, err := model.GetChannelByID(config.InferenceModelID)
	if err != nil {
		logger.Errorf(ctx, "【总结】推理模型渠道不存在 summaryID=%d err=%v", summary.ID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-summary-%d-%d", summary.FileID, summary.TemplateID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "custom_template_summary",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "TEMPLATE_SUMMARY_FAILED",
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		summary.Status = "failed"
		model.UpdateRecordingFileSummary(summary)
		return
	}

	request := &relaymodel.GeneralOpenAIRequest{
		Model: config.InferenceModelName,
		Messages: []relaymodel.Message{
			{
				Role:    "system",
				Content: template.Prompt + "\n\n直接输出结果，不要添加任何开场白或说明性文字。",
			},
			{
				Role:    "user",
				Content: prepared.Text,
			},
		},
	}

	ctxTimeout, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()

	generator := rag.NewContentGeneratorService(model.DB)
	summaryResult, err, _ := generator.TestChannel(ctxTimeout, channel, request)
	if err != nil {
		logger.Errorf(ctx, "【总结】调用推理模型生成失败 summaryID=%d err=%v", summary.ID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-summary-%d-%d", summary.FileID, summary.TemplateID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "custom_template_summary",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "TEMPLATE_SUMMARY_FAILED",
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		summary.Status = "failed"
		model.UpdateRecordingFileSummary(summary)
		return
	}

	summary.SummaryContent = model.LongText(summaryResult)
	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskStageCompleted(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-summary-%d-%d", summary.FileID, summary.TemplateID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "custom_template_summary",
			StageStatus:    keystone.TaskStatusSucceeded,
			ServiceKey:     "recording-pipeline",
			FinishedAt:     time.Now().UTC(),
		})
	}
	summary.Status = "completed"
	if err := model.UpdateRecordingFileSummary(summary); err != nil {
		logger.Errorf(ctx, "【总结】保存结果失败 summaryID=%d err=%v", summary.ID, err)
	}
}

// ListFileSummaries returns all summaries for a file.
// 反转后 Summary(0) 被删除，从 FileBody 合成虚拟纪要返回给前端。
func (s *RecordingAdminService) ListFileSummaries(ctx context.Context, fileID int64) ([]model.RecordingFileSummary, error) {
	file, err := model.GetFileByID(s.eid, fileID)
	if err != nil {
		return nil, fmt.Errorf("文件不存在: %w", err)
	}
	_ = file
	summaries, err := model.GetRecordingFileSummariesByFileID(fileID)
	if err != nil {
		return nil, fmt.Errorf("获取文件总结列表失败: %w", err)
	}

	var result []model.RecordingFileSummary
	hasMinutes := false

	for _, summary := range summaries {
		if summary.TemplateID == -1 || summary.TemplateID == -2 {
			continue
		}
		if summary.TemplateID == 0 {
			hasMinutes = true
			// 旧数据：Summary(template_id=0) 仍存于 DB，渲染为 Markdown
			summary.SummaryContent = model.LongText(BuildMinutesMarkdown(string(summary.SummaryContent)))
		}
		result = append(result, summary)
	}

	if !hasMinutes && model.HasTranscriptSummary(fileID) {
		fileBody, err := model.GetLastFileBodyByFileID(s.eid, fileID)
		if err == nil && fileBody != nil {
			content, err := fileBody.GetContent()
			if err == nil && content != "" {
				markdown := BuildMinutesMarkdown(content)
				result = append(result, model.RecordingFileSummary{
					FileID:         fileID,
					TemplateID:     0,
					TemplateName:   "纪要",
					SummaryContent: model.LongText(markdown),
					BaseModel: model.BaseModel{
						CreatedTime: fileBody.CreatedTime,
						UpdatedTime: fileBody.UpdatedTime,
					},
				})
			}
		}
	}

	return result, nil
}

// DeleteFileSummary deletes a file summary.
func (s *RecordingAdminService) DeleteFileSummary(ctx context.Context, summaryID int64) error {
	summary, err := model.GetRecordingFileSummaryByID(summaryID)
	if err != nil {
		return fmt.Errorf("总结记录不存在: %w", err)
	}

	file, err := model.GetFileByID(s.eid, summary.FileID)
	if err != nil {
		return fmt.Errorf("文件不存在或无权操作: %w", err)
	}
	_ = file

	return model.DeleteRecordingFileSummary(summaryID)
}

// CountParsingStats returns parsing count by user IDs.
func (s *RecordingAdminService) CountParsingStats(ctx context.Context, userIDs []int64) (map[int64]int64, error) {
	type parsingCountRow struct {
		UserID int64 `gorm:"column:user_id"`
		Count  int64 `gorm:"column:parsing_count"`
	}
	var rows []parsingCountRow

	query := model.DB.Model(&model.File{}).
		Select("user_id, COUNT(*) AS parsing_count").
		Where("eid = ? AND origin_type IN ? AND parsing_status = ?",
			s.eid,
			model.RecordingOriginTypes(),
			model.FileParsingStatusPending)

	if len(userIDs) > 0 {
		query = query.Where("user_id IN ?", userIDs)
	}

	if err := query.Group("user_id").Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("查询解析统计失败: %w", err)
	}

	result := make(map[int64]int64, len(rows))
	for _, r := range rows {
		result[r.UserID] = r.Count
	}
	return result, nil
}

// ListAvailableSummaryTemplates returns available templates for the current enterprise (user-facing).
func (s *RecordingAdminService) ListAvailableSummaryTemplates(ctx context.Context) ([]model.RecordingSummaryTemplate, error) {
	return model.GetRecordingSummaryTemplatesByEid(s.eid, 0)
}

// GetQueueDepth 查询 RAG 管线各步骤的队列排队深度。
func GetQueueDepth(ctx context.Context) map[string]int64 {
	result := map[string]int64{
		"document_parsing":  0,
		"meeting_minutes":   0,
		"insights":          0,
		"document_chunking": 0,
		"vector_indexing":   0,
		"graph_generation":  0,
	}
	if !common.IsRedisEnabled() || common.RDB == nil {
		return result
	}
	for key := range result {
		len, err := common.RDB.LLen(ctx, fmt.Sprintf("rag:job:queue:%s", key)).Result()
		if err == nil {
			result[key] = len
		}
	}
	return result
}
