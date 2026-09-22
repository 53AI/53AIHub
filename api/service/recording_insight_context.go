package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	maxInsightContextText       = 16000
	maxInsightConversationItems = 24
	maxInsightConversationText  = 24000
)

var (
	ErrInsightContextForbidden = errors.New("无权修改该文件的洞察背景")
	ErrInsightContextEmpty     = errors.New("补充说明不能为空")
	ErrInsightContextNotSaved  = errors.New("补充背景尚未保存，不能升级为长期记忆")
	ErrInsightGenerationStale  = errors.New("洞察生成版本已更新")
)

// InsightBackground 是一次洞察重生成使用的背景快照。
// MaterialContext 与 HistoricalContext 是运行时只读证据；其余字段可作为用户补充参与本次生成。
type InsightBackground struct {
	PersonalInfo        string `json:"personal_info"`
	CompanyInfo         string `json:"company_info"`
	HistoricalContext   string `json:"historical_context"`
	ExternalConstraints string `json:"external_constraints"`
	// MaterialContext 仅由当前纪要生成，是只读证据而非用户可编辑背景。
	MaterialContext string                       `json:"material_context"`
	Conversation    []InsightConversationMessage `json:"conversation,omitempty"`
	// InsightPerspective 是本次重新生成选择的场景模式；ResolvedInsightPerspective 及后续分类字段是最近一次自动判断的只读结果。
	InsightPerspective         string   `json:"insight_perspective,omitempty"`
	ResolvedInsightPerspective string   `json:"resolved_insight_perspective,omitempty"`
	PerspectiveConfidence      float64  `json:"perspective_confidence,omitempty"`
	PerspectiveReasonCodes     []string `json:"perspective_reason_codes,omitempty"`
	PerspectiveEvidence        []string `json:"perspective_evidence,omitempty"`
	PerspectiveAbstained       bool     `json:"perspective_abstained,omitempty"`
}

type InsightConversationMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type InsightRegenerationRequest struct {
	Background         InsightBackground            `json:"background"`
	Conversation       []InsightConversationMessage `json:"conversation"`
	InsightPerspective string                       `json:"insight_perspective"`
}

type PromoteInsightExternalConstraintsRequest struct {
	ExternalConstraints string `json:"external_constraints" binding:"required"`
}

type InsightWorkshopChatRequest struct {
	Message      string                       `json:"message" binding:"required"`
	Background   InsightBackground            `json:"background"`
	Conversation []InsightConversationMessage `json:"conversation"`
}

type InsightWorkshopChatResponse struct {
	Reply string `json:"reply"`
}

// GetInsightBackground 返回生成洞察时使用的个人、企业、历史和本次纪要背景。
func GetInsightBackground(ctx context.Context, eid, userID, fileID int64) (*InsightBackground, error) {
	file, err := getInsightContextFile(ctx, eid, userID, fileID)
	if err != nil {
		return nil, err
	}

	background := defaultInsightBackground(ctx, eid, userID, file)
	if saved, ok := loadSavedInsightBackground(file.InsightContext); ok {
		mergeInsightBackground(&background, saved)
		background.ResolvedInsightPerspective = saved.ResolvedInsightPerspective
		background.PerspectiveConfidence = saved.PerspectiveConfidence
		background.PerspectiveReasonCodes = saved.PerspectiveReasonCodes
		background.PerspectiveEvidence = saved.PerspectiveEvidence
		background.PerspectiveAbstained = saved.PerspectiveAbstained
	}
	background.InsightPerspective = string(model.NormalizeInsightPerspective(file.InsightPerspective))
	if background.ResolvedInsightPerspective == "" && background.InsightPerspective != string(model.InsightPerspectiveAuto) {
		background.ResolvedInsightPerspective = background.InsightPerspective
	}
	return &background, nil
}

// RegenerateInsightsWithContext 保存用户确认的背景并异步重新生成洞察和页面。
func RegenerateInsightsWithContext(ctx context.Context, eid, userID, fileID int64, req *InsightRegenerationRequest) error {
	file, err := getInsightContextFile(ctx, eid, userID, fileID)
	if err != nil {
		return err
	}

	background := InsightBackground{}
	requestedPerspective := strings.TrimSpace(file.InsightPerspective)
	if req != nil {
		background = req.Background
		background.Conversation = req.Conversation
		if strings.TrimSpace(req.InsightPerspective) != "" {
			requestedPerspective = req.InsightPerspective
		}
	} else if strings.TrimSpace(string(file.InsightContext)) != "" {
		// 兼容原有“无请求体重新生成”接口：不应意外清除用户已经确认的背景。
		_ = json.Unmarshal([]byte(file.InsightContext), &background)
	}
	background.PersonalInfo = loadInsightPersonalContext(ctx, eid, userID, fileID).formatted()
	if err := normalizeInsightBackground(&background); err != nil {
		return err
	}
	if !model.IsValidInsightPerspective(requestedPerspective) {
		return fmt.Errorf("%w: %s", ErrInvalidInsightPerspective, requestedPerspective)
	}
	requestedPerspective = string(model.NormalizeInsightPerspective(requestedPerspective))
	persisted := persistedInsightBackground(background)
	serialized, err := json.Marshal(persisted)
	if err != nil {
		return fmt.Errorf("序列化洞察背景失败: %w", err)
	}

	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var info model.FileCleaningRuleInfo
		if file.CleaningRuleInfo != "" {
			_ = json.Unmarshal([]byte(file.CleaningRuleInfo), &info)
		}
		info.InsightPageFormat = insightPageHTMLFormat
		cleaningRuleInfo, marshalErr := json.Marshal(info)
		if marshalErr != nil {
			return fmt.Errorf("序列化洞察页面格式失败: %w", marshalErr)
		}
		updates := map[string]interface{}{
			"insight_context":     string(serialized),
			"insight_generation":  gorm.Expr("insight_generation + ?", 1),
			"insight_summary":     "",
			"cleaning_rule_info":  string(cleaningRuleInfo),
			"insight_perspective": requestedPerspective,
		}
		// 归属校验已由外层 getInsightContextFile（库 VIEW_ONLY 权限）完成，
		// 事务内不再限定 user_id，否则其他知识库成员重新生成时 RowsAffected=0 → 仍被拒（403）。
		result := tx.Model(&model.File{}).
			Where("id = ? AND eid = ?", fileID, eid).
			Updates(updates)
		if result.Error != nil {
			return fmt.Errorf("保存洞察背景失败: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrInsightContextForbidden
		}
		if err := tx.Where("file_id = ?", fileID).Delete(&model.RecordingFileInsightPage{}).Error; err != nil {
			return fmt.Errorf("清除旧洞察页面失败: %w", err)
		}
		return nil
	}); err != nil {
		return err
	}
	setInsightsStatus(fileID, "pending")
	setInsightPageStatus(fileID, "pending")
	EnqueueRecordingInsights(eid, fileID, userID)
	logger.Infof(ctx, "【洞察】确认背景并触发重新生成(已入队): fileID=%d eid=%d userID=%d", fileID, eid, userID)
	return nil
}

// PromoteInsightExternalConstraints 将已保存的“补充背景”显式升级为跨会议用户确认记忆。
// 普通重新生成不会自动执行此操作。
func PromoteInsightExternalConstraints(ctx context.Context, eid, userID, fileID int64, text string) error {
	file, err := getInsightContextFile(ctx, eid, userID, fileID)
	if err != nil {
		return err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return ErrInsightContextEmpty
	}
	var saved InsightBackground
	if strings.TrimSpace(string(file.InsightContext)) == "" || json.Unmarshal([]byte(file.InsightContext), &saved) != nil {
		return ErrInsightContextNotSaved
	}
	if strings.TrimSpace(saved.ExternalConstraints) != text {
		return ErrInsightContextNotSaved
	}
	return CompileRecordingExternalConstraintsMemory(ctx, eid, fileID, userID, saved)
}

// ChatInsightWorkshop 根据右侧对话内容帮助用户补充背景，不直接生成最终洞察。
func ChatInsightWorkshop(ctx context.Context, eid, userID, fileID int64, req InsightWorkshopChatRequest) (*InsightWorkshopChatResponse, error) {
	file, err := getInsightContextFile(ctx, eid, userID, fileID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message) == "" {
		return nil, ErrInsightContextEmpty
	}
	req.Background.PersonalInfo = loadInsightPersonalContext(ctx, eid, userID, fileID).formatted()
	if err := normalizeInsightBackground(&req.Background); err != nil {
		return nil, err
	}
	conversation := normalizeInsightConversation(req.Conversation)
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil || config.InferenceModelID == 0 || config.InferenceModelName == "" {
		return nil, errors.New("推理模型未配置")
	}

	material := ""
	if loaded, loadErr := loadMinutesText(eid, file.ID); loadErr == nil {
		material = truncateInsightContext(loaded, maxInsightContextText)
	}
	workshopPrompt := `你是企业决策洞察生成前的“背景协同参谋”。
你的任务是帮助用户把个人偏好、公司现状、历史经验和本次纪要中影响判断的事实补充清楚。
不要直接输出最终洞察，不要编造事实；如果信息不足，提出一个最值得回答的澄清问题。
每次回复先给出你理解的补充点，再给出下一步建议或一个简短问题。语言简洁、具体、有经营判断。`
	backgroundPrompt := formatInsightBackgroundPrompt(req.Background, material)
	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		messages := []relaymodel.Message{{Role: "system", Content: workshopPrompt + "\n\n" + backgroundPrompt}}
		for _, item := range conversation {
			messages = append(messages, relaymodel.Message{Role: item.Role, Content: item.Content})
		}
		messages = append(messages, relaymodel.Message{Role: "user", Content: req.Message})
		return &relaymodel.GeneralOpenAIRequest{Model: config.InferenceModelName, Messages: messages}
	}
	reply, err := callLLMWithRetry(ctx, config, buildRequest)
	if err != nil {
		return nil, err
	}
	return &InsightWorkshopChatResponse{Reply: strings.TrimSpace(reply)}, nil
}

// getInsightContextFile 洞察协同研讨系列（背景查看/研讨对话/重新生成）的统一访问边界。
// 与其他安心录查看类接口一致：只要求用户对文件所在知识库有查看权限（VIEW_ONLY 及以上），
// 不再要求文件创建者是当前用户；个人库语义由 GetUserPermission 天然保持（仅创建者可访问）。
func getInsightContextFile(ctx context.Context, eid, userID, fileID int64) (*model.File, error) {
	file, err := GetViewableRecordingFile(ctx, eid, userID, fileID)
	if errors.Is(err, ErrRecordingFileForbidden) {
		return nil, ErrInsightContextForbidden
	}
	if err != nil {
		return nil, err
	}
	if err := requireRecordingOrigin(file); err != nil {
		return nil, ErrInsightContextForbidden
	}
	return file, err
}

type insightPersonalContext struct {
	User         *model.User
	Position     string
	Style        string
	CustomMemory string
}

func loadInsightPersonalContext(ctx context.Context, eid, userID, fileID int64) insightPersonalContext {
	personal := insightPersonalContext{}
	personal.User, _ = model.GetUserByIDAndEid(eid, userID)
	if personal.User != nil {
		if err := personal.User.LoadDepartments(0); err != nil {
			logger.Warnf(ctx, "【洞察-个人背景】加载部门失败 fileID=%d userID=%d err=%v", fileID, userID, err)
		}
	}
	if memory, _ := model.GetUserMemory(eid, userID); memory != nil {
		personal.Position = memory.Position
		personal.Style = memory.Style
		if items, err := memory.GetCustomMemoryItems(); err == nil {
			personal.CustomMemory = formatMemoryFacts(items)
		}
	}
	return personal
}

func (personal insightPersonalContext) formatted() string {
	return formatPersonalBackground(personal.User, personal.Position, personal.Style, personal.CustomMemory)
}

func defaultInsightBackground(ctx context.Context, eid, userID int64, file *model.File) InsightBackground {
	background := InsightBackground{
		MaterialContext: truncateInsightContext(mustLoadMinutesText(eid, file.ID), maxInsightContextText),
	}
	if config, err := model.ValidateOrCreateRecordingConfig(eid); err == nil {
		memoryConfig := config.MemoryExtraction
		if memoryConfig == nil {
			memoryConfig = &model.MemoryExtractionConfig{
				Enabled: true,
				Types:   []string{model.EntityTypePerson, model.EntityTypeMatter, model.EntityTypeRisk, model.EntityTypePrinciple},
			}
		}
		background.HistoricalContext = formatInsightHistory(loadRelatedInsightHistory(ctx, eid, file.ID, userID, memoryConfig))
	}
	background.PersonalInfo = loadInsightPersonalContext(ctx, eid, userID, file.ID).formatted()
	enterprise, _ := model.GetEnterpriseByID(eid)
	background.CompanyInfo = formatCompanyBackground(enterprise)
	return background
}

func mustLoadMinutesText(eid, fileID int64) string {
	content, err := loadMinutesText(eid, fileID)
	if err != nil {
		return ""
	}
	return content
}

func formatPersonalBackground(user *model.User, position, style, customMemory string) string {
	var lines []string
	if user != nil && strings.TrimSpace(user.Nickname) != "" {
		lines = append(lines, "称呼："+user.Nickname)
	}
	if user != nil && len(user.Departments) > 0 && strings.TrimSpace(user.Departments[0].Name) != "" {
		lines = append(lines, "部门："+user.Departments[0].Name)
	}
	if strings.TrimSpace(position) != "" {
		lines = append(lines, "职位："+position)
	}
	if strings.TrimSpace(style) != "" {
		lines = append(lines, "偏好："+style)
	}
	if strings.TrimSpace(customMemory) != "" {
		lines = append(lines, "自定义记忆："+customMemory)
	}
	return strings.Join(lines, "\n")
}

func formatCompanyBackground(enterprise *model.Enterprise) string {
	if enterprise == nil {
		return ""
	}
	var lines []string
	if enterprise.FullName != "" {
		lines = append(lines, "单位名称："+enterprise.FullName)
	}
	if enterprise.DisplayName != "" && enterprise.DisplayName != enterprise.FullName {
		lines = append(lines, "简称："+enterprise.DisplayName)
	}
	if enterprise.Industry != "" {
		lines = append(lines, "所属行业："+enterprise.Industry)
	}
	if enterprise.Description != "" {
		lines = append(lines, "单位介绍："+enterprise.Description)
	}
	if enterprise.Keywords != "" {
		lines = append(lines, "关键词："+enterprise.Keywords)
	}
	return strings.Join(lines, "\n")
}

func mergeInsightBackground(target *InsightBackground, saved InsightBackground) {
	// 个人/企业信息以实时数据为准，文件快照中的旧值仅在实时值为空时兜底，
	// 避免一次确认背景后冻结最新个人/企业资料。
	if strings.TrimSpace(target.PersonalInfo) == "" {
		target.PersonalInfo = saved.PersonalInfo
	}
	if strings.TrimSpace(target.CompanyInfo) == "" {
		target.CompanyInfo = saved.CompanyInfo
	}
	if strings.TrimSpace(saved.ExternalConstraints) != "" {
		target.ExternalConstraints = saved.ExternalConstraints
	}
}

// loadSavedInsightBackground 读取文件级保存的用户补充背景。
// 个人/企业信息属于全局资料，由 defaultInsightBackground 实时提供，不参与文件快照，
// 避免旧快照覆盖最新内容；这里统一剥离后供读取与生成两条链路复用。
func loadSavedInsightBackground(raw model.LongText) (InsightBackground, bool) {
	if strings.TrimSpace(string(raw)) == "" {
		return InsightBackground{}, false
	}
	var saved InsightBackground
	if err := json.Unmarshal([]byte(raw), &saved); err != nil {
		return InsightBackground{}, false
	}
	saved.PersonalInfo = ""
	saved.CompanyInfo = ""
	return saved, true
}

// persistedInsightBackground 只保存用户提供的稳定补充，避免动态历史、陈旧纪要和研讨欢迎语在下次生成时重复注入。
// 个人/企业信息属于全局资料，不写入文件级快照，始终以最新数据为准。
func persistedInsightBackground(background InsightBackground) InsightBackground {
	background.PersonalInfo = ""
	background.CompanyInfo = ""
	background.HistoricalContext = ""
	background.MaterialContext = ""
	background.Conversation = nil
	background.InsightPerspective = ""
	background.ResolvedInsightPerspective = ""
	background.PerspectiveConfidence = 0
	background.PerspectiveReasonCodes = nil
	background.PerspectiveEvidence = nil
	background.PerspectiveAbstained = false
	return background
}

func withResolvedInsightPerspective(raw model.LongText, resolution insightPerspectiveResolution) (string, error) {
	var background InsightBackground
	if strings.TrimSpace(string(raw)) != "" {
		if err := json.Unmarshal([]byte(raw), &background); err != nil {
			return "", err
		}
	}
	background.ResolvedInsightPerspective = string(resolution.Perspective)
	background.PerspectiveConfidence = resolution.Confidence
	background.PerspectiveReasonCodes = resolution.ReasonCodes
	background.PerspectiveEvidence = resolution.Evidence
	background.PerspectiveAbstained = resolution.Abstained
	data, err := json.Marshal(background)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func normalizeInsightBackground(background *InsightBackground) error {
	background.PersonalInfo = truncateInsightContext(background.PersonalInfo, maxInsightContextText)
	background.CompanyInfo = truncateInsightContext(background.CompanyInfo, maxInsightContextText)
	background.HistoricalContext = truncateInsightContext(background.HistoricalContext, maxInsightContextText)
	background.ExternalConstraints = truncateInsightContext(background.ExternalConstraints, maxInsightContextText)
	background.MaterialContext = truncateInsightContext(background.MaterialContext, maxInsightContextText)
	background.Conversation = normalizeInsightConversation(background.Conversation)
	if len(background.Conversation) > 0 && strings.TrimSpace(background.PersonalInfo+background.CompanyInfo+background.HistoricalContext+background.ExternalConstraints+background.MaterialContext) == "" {
		return ErrInsightContextEmpty
	}
	return nil
}

func normalizeInsightConversation(items []InsightConversationMessage) []InsightConversationMessage {
	if len(items) > maxInsightConversationItems {
		items = items[len(items)-maxInsightConversationItems:]
	}
	result := make([]InsightConversationMessage, 0, len(items))
	total := 0
	for _, item := range items {
		role := item.Role
		if role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(truncateInsightContext(item.Content, maxInsightContextText))
		if content == "" {
			continue
		}
		if total+len(content) > maxInsightConversationText {
			break
		}
		result = append(result, InsightConversationMessage{Role: role, Content: content})
		total += len(content)
	}
	return result
}

func truncateInsightContext(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "\n[内容过长，已截断]"
}

func formatInsightBackgroundPrompt(background InsightBackground, material string) string {
	return fmt.Sprintf(`<insight_supplemental_context>
以下内容按来源分层。Personal Profile 与 Company Profile 是跨会议 context_only；用户补充默认只适用于当前文件和当前 regeneration chain。任何 L4 内容都不得作为本次会议 evidence。
<personal_background allowed_usage="context_only">
%s
</personal_background>
<company_background allowed_usage="context_only">
%s
</company_background>
<historical_background allowed_usage="evidence_only_if_source_verified">
%s
</historical_background>
<external_constraints>
%s
</external_constraints>
<current_material>
%s
</current_material>
</insight_supplemental_context>`, background.PersonalInfo, background.CompanyInfo, background.HistoricalContext, background.ExternalConstraints, material)
}

func formatInsightConversation(items []InsightConversationMessage) string {
	var lines []string
	for _, item := range items {
		lines = append(lines, fmt.Sprintf("[%s] %s", item.Role, item.Content))
	}
	return strings.Join(lines, "\n")
}

func isInsightGenerationCurrent(eid, fileID, generation int64) bool {
	var current model.File
	if err := model.DB.Select("insight_generation").Where("id = ? AND eid = ?", fileID, eid).First(&current).Error; err != nil {
		return false
	}
	return current.InsightGeneration == generation
}

func setInsightsStatusIfCurrent(eid, fileID, generation int64, status string) {
	updateInsightStatusIfCurrent(eid, fileID, generation, status, nil)
}

func markInsightPageFormatIfCurrent(ctx context.Context, eid, fileID, generation int64, format string) error {
	err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var file model.File
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("insight_generation, cleaning_rule_info").
			Where("id = ? AND eid = ?", fileID, eid).First(&file).Error; err != nil {
			return err
		}
		if file.InsightGeneration != generation {
			return ErrInsightGenerationStale
		}
		var info model.FileCleaningRuleInfo
		if file.CleaningRuleInfo != "" {
			_ = json.Unmarshal([]byte(file.CleaningRuleInfo), &info)
		}
		// RegenerateInsightsWithContext writes the format marker before starting
		// the asynchronous worker. Treat a repeated marker write as success.
		if info.InsightPageFormat == format {
			return nil
		}
		info.InsightPageFormat = format
		data, err := json.Marshal(info)
		if err != nil {
			return err
		}
		result := tx.Model(&model.File{}).
			Where("id = ? AND eid = ? AND insight_generation = ?", fileID, eid, generation).
			Update("cleaning_rule_info", string(data))
		if result.Error != nil {
			return result.Error
		}
		// The row was locked and its generation was checked above. Some
		// databases report RowsAffected=0 for an idempotent UPDATE; that is
		// not evidence that the generation is stale.
		return nil
	})
	return err
}

// setInsightOutcomeIfCurrent records a normal NO_INSIGHT outcome together
// with its reason. The generation check and JSON update happen in one locked
// transaction so an older regeneration cannot overwrite a newer result.
func setInsightOutcomeIfCurrent(eid, fileID, generation int64, outcome insightGateResult) bool {
	return updateInsightStatusIfCurrent(eid, fileID, generation, "skipped", &outcome)
}

func updateInsightStatusIfCurrent(eid, fileID, generation int64, status string, outcome *insightGateResult) bool {
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var file model.File
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("insight_generation, cleaning_rule_info").
			Where("id = ? AND eid = ?", fileID, eid).First(&file).Error; err != nil {
			return err
		}
		if file.InsightGeneration != generation {
			return ErrInsightGenerationStale
		}

		var info model.FileCleaningRuleInfo
		if file.CleaningRuleInfo != "" {
			_ = json.Unmarshal([]byte(file.CleaningRuleInfo), &info)
		}
		info.InsightsStatus = status
		if outcome != nil {
			info.InsightMode = outcome.Mode
			info.InsightReasonCode = outcome.ReasonCode
			info.InsightSkipReason = outcome.ReasonCode
			info.InsightMessage = outcome.Message
			info.InsightsError = ""
			info.InsightsErrorType = ""
			if status == "skipped" {
				info.InsightPageStatus = "skipped"
			}
		} else if status == "pending" || status == "processing" {
			// A new generation must not expose the previous generation's NO
			// reason while it is running.
			info.InsightMode = ""
			info.InsightReasonCode = ""
			info.InsightSkipReason = ""
			info.InsightMessage = ""
			info.InsightsError = ""
			info.InsightsErrorType = ""
		}
		data, err := json.Marshal(info)
		if err != nil {
			return err
		}
		updates := map[string]interface{}{"cleaning_rule_info": string(data)}
		if status == "skipped" {
			// A NO result is a new terminal result, so stale insight/page content
			// from a previous generation must not remain visible.
			updates["insight_summary"] = ""
		}
		if result := tx.Model(&model.File{}).
			Where("id = ? AND eid = ? AND insight_generation = ?", fileID, eid, generation).
			Updates(updates); result.Error != nil {
			return result.Error
		} else if result.RowsAffected != 1 {
			return ErrInsightGenerationStale
		}
		if status == "skipped" {
			return tx.Where("file_id = ?", fileID).Delete(&model.RecordingFileInsightPage{}).Error
		}
		return nil
	})
	return err == nil
}

func upsertInsightPageIfCurrent(eid, fileID, generation int64, pageJSON string) error {
	return model.DB.Transaction(func(tx *gorm.DB) error {
		var file model.File
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("insight_generation").Where("id = ? AND eid = ?", fileID, eid).First(&file).Error; err != nil {
			return err
		}
		if file.InsightGeneration != generation {
			return ErrInsightGenerationStale
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "file_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"page_json", "updated_time"}),
		}).Create(&model.RecordingFileInsightPage{
			FileID:   fileID,
			PageJSON: model.LongText(pageJSON),
		}).Error
	})
}

func loadRelatedInsightHistory(ctx context.Context, eid, fileID, userID int64, memCfg *model.MemoryExtractionConfig) []historyMeeting {
	return loadRelatedInsightHistoryWithContext(ctx, eid, fileID, userID, memCfg, nil)
}

func loadRelatedInsightHistoryWithContext(ctx context.Context, eid, fileID, userID int64, memCfg *model.MemoryExtractionConfig, currentContext *CurrentMeetingContext) []historyMeeting {
	if memCfg == nil || !memCfg.IsEffectivelyEnabled() {
		logger.Infof(ctx, "【洞察】历史记忆关闭或空类型，跳过历史检索: fileID=%d", fileID)
		return nil
	}

	var currentEntityIDs []int64
	query := model.DB.WithContext(ctx).Model(&model.EntityChunkRelation{}).
		Joins("JOIN entities e ON e.id = entity_chunk_relations.entity_id").
		Where("entity_chunk_relations.eid = ? AND entity_chunk_relations.file_id = ? AND entity_chunk_relations.status = ?",
			eid, fileID, "active").
		Where("entity_chunk_relations.source IN ?", []string{"auto_llm", "auto_meta"}).
		Where("e.type IN ?", memCfg.Types).
		Distinct("entity_chunk_relations.entity_id").
		Pluck("entity_chunk_relations.entity_id", &currentEntityIDs)
	if err := query.Error; err != nil {
		logger.Errorf(ctx, "【洞察】查询实体ID失败: %v", err)
	}
	currentEntityNames := make([]string, 0)
	if len(currentEntityIDs) > 0 && currentContext == nil {
		var genericNames []string
		if err := model.DB.WithContext(ctx).Model(&model.Entity{}).
			Where("eid = ? AND id IN ? AND status = ?", eid, currentEntityIDs, model.EntityRelationStatusActive).
			Pluck("name", &genericNames).Error; err == nil {
			currentEntityNames = appendUniqueStrings(currentEntityNames, genericNames...)
		}
	}
	if currentContext != nil {
		currentEntityNames = appendUniqueStrings(currentEntityNames, currentContext.RecallEntityNames()...)
	}
	currentRecallTerms := appendUniqueStrings(nil, currentEntityNames...)
	if currentContext != nil {
		currentRecallTerms = appendUniqueStrings(currentRecallTerms, currentContext.RecallClaimTerms()...)
	}

	rows := make([]historyMeeting, 0, 8)
	entityOverlapCandidates := 0
	claimCandidates := 0
	entityFactCandidates := 0
	if len(currentEntityIDs) > 0 {
		var historyFileIDs []int64
		if err := model.DB.WithContext(ctx).Table("entity_chunk_relations ecr").
			Joins("JOIN files f ON f.id = ecr.file_id").
			Joins("JOIN entities e ON e.id = ecr.entity_id").
			Where("ecr.eid = ? AND ecr.entity_id IN ? AND ecr.file_id != ? AND ecr.status = ?",
				eid, currentEntityIDs, fileID, "active").
			Where("e.type IN ?", memCfg.Types).
			Where("f.user_id = ? AND f.origin_type IN ? AND f.parsing_status = ? AND f.insight_summary != ''",
				userID, model.RecordingOriginTypes(), "normal").
			Where("f.is_deleted = ?", false).
			Group("ecr.file_id").
			Order("COUNT(DISTINCT ecr.entity_id) DESC").
			Limit(5).
			Pluck("ecr.file_id", &historyFileIDs).Error; err != nil {
			logger.Errorf(ctx, "【洞察】查询历史文件失败: %v", err)
		}

		entityOverlapCandidates = len(historyFileIDs)
		for _, historyFileID := range historyFileIDs {
			var file model.File
			if err := model.DB.WithContext(ctx).Where("id = ?", historyFileID).First(&file).Error; err != nil {
				continue
			}
			minutes, err := loadMinutesText(eid, historyFileID)
			if err != nil {
				logger.Errorf(ctx, "【洞察】读取历史纪要失败 fileID=%d err=%v", historyFileID, err)
				continue
			}
			rows = append(rows, historyMeeting{
				FileID:       historyFileID,
				Title:        file.Path,
				Minutes:      minutes,
				Memories:     loadMeetingMemoryContexts(ctx, eid, userID, historyFileID, file.Path),
				RecallSource: historyRecallEntityOverlap,
			})
		}

	}

	// 第二路召回：使用当前快照中的安全实体名称和结构化 Claim 锚点
	// 匹配已编译的历史记忆。即使通用 Entity 抽取尚未落库，也不会丢失
	// 当前会议的决策、承诺和风险召回。
	if len(currentRecallTerms) > 0 {
		memoryRows := loadMemoryRecallHistoryByTerms(ctx, eid, userID, fileID, currentRecallTerms)
		claimCandidates = len(memoryRows)
		for _, memoryRow := range memoryRows {
			rows = mergeHistoryMeeting(rows, memoryRow, historyRecallClaim)
		}
	}

	// 第三路召回：安心录专属实体事实。它只使用当前会议已确认的实体作为候选，
	// 与通用 entities/RAG 图谱隔离；人工修正会优先以当前有效事实参与洞察。
	entityMemoryRows := loadRecordingEntityMemoryRecallHistory(ctx, eid, userID, fileID)
	entityFactCandidates = len(entityMemoryRows)
	for _, memoryRow := range entityMemoryRows {
		rows = mergeHistoryMeeting(rows, memoryRow, historyRecallEntityFact)
	}
	sortRelatedInsightHistory(rows)
	if len(rows) > 8 {
		rows = rows[:8]
	}
	logger.Infof(ctx, "【洞察-历史召回】fileID=%d generic_entities=%d current_entities=%d current_claims=%d recall_terms=%d entity_overlap_candidates=%d claim_candidates=%d entity_fact_candidates=%d selected=%d", fileID, len(currentEntityIDs), len(currentEntityNames), currentContextClaimCount(currentContext), len(currentRecallTerms), entityOverlapCandidates, claimCandidates, entityFactCandidates, len(rows))
	return rows
}

func currentContextClaimCount(currentContext *CurrentMeetingContext) int {
	if currentContext == nil {
		return 0
	}
	return len(currentContext.Claims)
}

func mergeHistoryMeeting(rows []historyMeeting, incoming historyMeeting, source uint8) []historyMeeting {
	for index := range rows {
		if rows[index].FileID != incoming.FileID {
			continue
		}
		rows[index].Memories = mergeMeetingMemories(rows[index].Memories, incoming.Memories)
		rows[index].RecallSource |= source
		if rows[index].Title == "" {
			rows[index].Title = incoming.Title
		}
		return rows
	}
	incoming.RecallSource |= source
	return append(rows, incoming)
}

func sortRelatedInsightHistory(rows []historyMeeting) {
	sort.SliceStable(rows, func(i, j int) bool {
		left, right := relatedInsightHistoryScore(rows[i]), relatedInsightHistoryScore(rows[j])
		return left > right
	})
}

func relatedInsightHistoryScore(row historyMeeting) int {
	score := 0
	if row.RecallSource&historyRecallEntityFact != 0 {
		score += 100
	}
	if row.RecallSource&historyRecallClaim != 0 {
		score += 80
	}
	if row.RecallSource&historyRecallEntityOverlap != 0 {
		score += 40
	}
	for _, memory := range row.Memories {
		score += 2 + int(memory.SourceConfidence*10)
		if memory.EvidenceAvailable {
			score += 3
		}
		if memory.ReviewState == recordingMemoryReviewConfirmed {
			score += 2
		}
	}
	return score
}

func loadMeetingMemoryContexts(ctx context.Context, eid, ownerID, fileID int64, sourceFile string) []meetingMemoryContext {
	var claims []model.RecordingMemoryClaim
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ? AND file_id = ? AND is_current = ?", eid, ownerID, fileID, true).
		Where("assertion_state NOT IN ?", []string{"rejected"}).
		Where("source_confidence >= ?", recordingMemoryMinSourceConfidence).
		Where("(review_state = ? OR (epistemic_type = ? AND evidence_available = ?))", recordingMemoryReviewConfirmed, "explicit", true).
		Order("source_confidence DESC, updated_time DESC, id DESC").
		Limit(8).Find(&claims).Error; err != nil {
		logger.Warnf(ctx, "【洞察】读取结构化会议记忆失败 fileID=%d err=%v", fileID, err)
		return nil
	}
	claims = selectRecordingMemoryRecallClaims(claims, recordingMemoryDirectRecallLimit, recordingMemoryOneHopRecallLimit)
	result := make([]meetingMemoryContext, 0, len(claims))
	for _, claim := range claims {
		result = append(result, meetingMemoryContext{
			MemoryID:          claim.ID,
			Kind:              claim.ClaimKind,
			Content:           string(claim.Content),
			RecallReason:      "历史结构化会议记忆",
			AssertionState:    claim.AssertionState,
			LifecycleState:    claim.LifecycleState,
			ReviewState:       claim.ReviewState,
			SourceFileID:      claim.FileID,
			SourceFile:        sourceFile,
			SourceConfidence:  claim.SourceConfidence,
			EvidenceAvailable: claim.EvidenceAvailable,
			SourceSegmentIDs:  decodeMemorySourceSegmentIDs(claim.SourceSegmentIDs),
			RecallPath:        recordingMemoryRecallPath(claim.DetailJSON),
			StructuredLinks:   recordingMemoryStructuredLinks(claim.DetailJSON),
		})
	}
	return result
}

func loadMemoryRecallHistory(ctx context.Context, eid, ownerID, currentFileID int64, entityIDs []int64) []historyMeeting {
	var entityNames []string
	if err := model.DB.WithContext(ctx).Model(&model.Entity{}).
		Where("eid = ? AND id IN ? AND status = ?", eid, entityIDs, model.EntityRelationStatusActive).
		Pluck("name", &entityNames).Error; err != nil {
		logger.Warnf(ctx, "【洞察】读取实体名称失败: %v", err)
		return nil
	}
	return loadMemoryRecallHistoryByNames(ctx, eid, ownerID, currentFileID, entityNames)
}

func loadMemoryRecallHistoryByNames(ctx context.Context, eid, ownerID, currentFileID int64, entityNames []string) []historyMeeting {
	return loadMemoryRecallHistoryByTerms(ctx, eid, ownerID, currentFileID, entityNames)
}

func loadMemoryRecallHistoryByTerms(ctx context.Context, eid, ownerID, currentFileID int64, terms []string) []historyMeeting {
	terms = filterInsightRecallEntityNames(terms)
	if len(terms) == 0 {
		return nil
	}

	var claims []model.RecordingMemoryClaim
	query := model.DB.WithContext(ctx).Table("recording_memory_claims AS c").
		Select("c.*").
		Joins("JOIN files f ON f.id = c.file_id AND f.eid = c.eid").
		Where("c.eid = ? AND c.owner_id = ? AND c.file_id != ? AND c.is_current = ?", eid, ownerID, currentFileID, true).
		Where("c.source_item_type NOT IN ?", []string{recordingMemorySourceInsightBackground}).
		Where("c.source_item_type <> ? OR c.assertion_state = ?", recordingMemorySourceUserConfirmed, "user_confirmed").
		Where("c.assertion_state NOT IN ?", []string{"rejected"}).
		Where("c.source_confidence >= ?", recordingMemoryMinSourceConfidence).
		Where("(c.review_state = ? OR (c.epistemic_type = ? AND c.evidence_available = ?))", recordingMemoryReviewConfirmed, "explicit", true).
		Where("f.user_id = ? AND f.origin_type IN ? AND f.parsing_status = ? AND f.is_deleted = ?", ownerID, model.RecordingOriginTypes(), "normal", false)

	pattern := insightRecallLikePattern(terms[0])
	entityMatch := model.DB.Where("c.content LIKE ? ESCAPE '!' OR c.detail_json LIKE ? ESCAPE '!'", pattern, pattern)
	for _, term := range terms[1:] {
		pattern := insightRecallLikePattern(term)
		entityMatch = entityMatch.Or("c.content LIKE ? ESCAPE '!' OR c.detail_json LIKE ? ESCAPE '!'", pattern, pattern)
	}
	if err := query.Where(entityMatch).
		Order("c.source_confidence DESC, c.updated_time DESC, c.id DESC").
		Limit(48).Find(&claims).Error; err != nil {
		logger.Warnf(ctx, "【洞察】结构化记忆召回失败: %v", err)
		return nil
	}
	sort.SliceStable(claims, func(i, j int) bool {
		left, right := insightRecallClaimScore(claims[i], terms), insightRecallClaimScore(claims[j], terms)
		if left != right {
			return left > right
		}
		return claims[i].ID > claims[j].ID
	})
	claims = selectRecordingMemoryRecallClaims(claims, recordingMemoryDirectRecallLimit, recordingMemoryOneHopRecallLimit)
	if len(claims) == 0 {
		return nil
	}

	fileIDs := make([]int64, 0, len(claims))
	seenFileIDs := make(map[int64]struct{}, len(claims))
	for _, claim := range claims {
		if _, exists := seenFileIDs[claim.FileID]; !exists {
			seenFileIDs[claim.FileID] = struct{}{}
			fileIDs = append(fileIDs, claim.FileID)
		}
	}
	var files []model.File
	if err := model.DB.WithContext(ctx).Where("eid = ? AND user_id = ? AND id IN ? AND is_deleted = ?", eid, ownerID, fileIDs, false).Find(&files).Error; err != nil {
		logger.Warnf(ctx, "【洞察】读取结构化记忆来源文件失败: %v", err)
		return nil
	}
	fileTitles := make(map[int64]string, len(files))
	for _, file := range files {
		fileTitles[file.ID] = file.Path
	}

	rowsByFile := make(map[int64]int)
	rows := make([]historyMeeting, 0, len(fileTitles))
	for _, claim := range claims {
		title, ok := fileTitles[claim.FileID]
		if !ok {
			continue
		}
		index, exists := rowsByFile[claim.FileID]
		if !exists {
			index = len(rows)
			rowsByFile[claim.FileID] = index
			rows = append(rows, historyMeeting{FileID: claim.FileID, Title: title})
		}
		rows[index].Memories = append(rows[index].Memories, meetingMemoryContext{
			MemoryID:          claim.ID,
			Kind:              claim.ClaimKind,
			Content:           string(claim.Content),
			RecallReason:      insightRecallReason(claim, terms),
			AssertionState:    claim.AssertionState,
			LifecycleState:    claim.LifecycleState,
			ReviewState:       claim.ReviewState,
			SourceFileID:      claim.FileID,
			SourceFile:        title,
			SourceConfidence:  claim.SourceConfidence,
			EvidenceAvailable: claim.EvidenceAvailable,
			SourceSegmentIDs:  decodeMemorySourceSegmentIDs(claim.SourceSegmentIDs),
			RecallPath:        recordingMemoryRecallPath(claim.DetailJSON),
			StructuredLinks:   recordingMemoryStructuredLinks(claim.DetailJSON),
		})
	}
	return rows
}

func insightRecallClaimScore(claim model.RecordingMemoryClaim, terms []string) int {
	content := strings.ToLower(string(claim.Content))
	text := content + " " + strings.ToLower(string(claim.DetailJSON))
	score := 0
	for _, term := range terms {
		term = strings.ToLower(strings.TrimSpace(term))
		if term == "" || !strings.Contains(text, term) {
			continue
		}
		score += 10
		if strings.Contains(content, term) {
			score += 5
		}
	}
	if claim.ClaimKind == "decision" || claim.ClaimKind == "commitment" || claim.ClaimKind == "risk" {
		score += 2
	}
	if claim.EvidenceAvailable {
		score++
	}
	return score
}

func insightRecallReason(claim model.RecordingMemoryClaim, terms []string) string {
	content := strings.ToLower(string(claim.Content))
	for _, term := range terms {
		term = strings.ToLower(strings.TrimSpace(term))
		if term != "" && strings.Contains(content, term) {
			return "当前会议 Claim/实体与历史记忆匹配"
		}
	}
	return "当前会议 Claim/实体关联的历史记忆"
}

const (
	recordingMemoryDirectRecallLimit = 6
	recordingMemoryOneHopRecallLimit = 2
)

// selectRecordingMemoryRecallClaims enforces the T09 retrieval budget without
// requiring relation tables. Claims carrying a verified binding/relation are
// treated as one-hop candidates; all other claims are direct matches.
func selectRecordingMemoryRecallClaims(claims []model.RecordingMemoryClaim, directLimit, oneHopLimit int) []model.RecordingMemoryClaim {
	if directLimit < 0 {
		directLimit = 0
	}
	if oneHopLimit < 0 {
		oneHopLimit = 0
	}
	selected := make([]model.RecordingMemoryClaim, 0, directLimit+oneHopLimit)
	directCount, oneHopCount := 0, 0
	for _, claim := range claims {
		oneHop := len(recordingMemoryRecallPath(claim.DetailJSON)) > 1
		if oneHop {
			if oneHopCount >= oneHopLimit {
				continue
			}
			oneHopCount++
		} else {
			if directCount >= directLimit {
				continue
			}
			directCount++
		}
		selected = append(selected, claim)
	}
	return selected
}

func mergeMeetingMemories(existing, incoming []meetingMemoryContext) []meetingMemoryContext {
	result := append([]meetingMemoryContext{}, existing...)
	seen := make(map[int64]struct{}, len(result))
	for _, memory := range result {
		seen[memory.MemoryID] = struct{}{}
	}
	for _, memory := range incoming {
		if _, exists := seen[memory.MemoryID]; exists {
			continue
		}
		seen[memory.MemoryID] = struct{}{}
		result = append(result, memory)
	}
	if len(result) > 8 {
		result = result[:8]
	}
	return result
}

func formatInsightHistory(rows []historyMeeting) string {
	if len(rows) == 0 {
		return ""
	}
	return truncateInsightContext(buildHistoricalContext(rows), maxInsightContextText)
}

func filterInsightRecallEntityNames(names []string) []string {
	seen := make(map[string]struct{}, len(names))
	result := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if utf8.RuneCountInString(name) < 2 {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}
	return result
}

func insightRecallLikePattern(name string) string {
	replacer := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_")
	return "%" + replacer.Replace(name) + "%"
}
