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
	MaterialContext string `json:"material_context"`
	// SupplementalContext 是用户直接补充、用于本次及后续重生成判断的上下文。
	SupplementalContext string                       `json:"supplemental_context"`
	Conversation        []InsightConversationMessage `json:"conversation,omitempty"`
}

type InsightConversationMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type InsightRegenerationRequest struct {
	Background   InsightBackground            `json:"background"`
	Conversation []InsightConversationMessage `json:"conversation"`
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
	if req != nil {
		background = req.Background
		background.Conversation = req.Conversation
	} else if strings.TrimSpace(string(file.InsightContext)) != "" {
		// 兼容原有“无请求体重新生成”接口：不应意外清除用户已经确认的背景。
		_ = json.Unmarshal([]byte(file.InsightContext), &background)
	}
	if err := normalizeInsightBackground(&background); err != nil {
		return err
	}
	persisted := persistedInsightBackground(background)
	serialized, err := json.Marshal(persisted)
	if err != nil {
		return fmt.Errorf("序列化洞察背景失败: %w", err)
	}

	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		updates := map[string]interface{}{
			"insight_context":    string(serialized),
			"insight_generation": gorm.Expr("insight_generation + ?", 1),
			"insight_summary":    "",
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
	if err := CompileRecordingInsightBackgroundMemory(ctx, eid, fileID, userID, persisted); err != nil {
		logger.Warnf(ctx, "【会议记忆】保存洞察背景记忆失败 fileID=%d err=%v", fileID, err)
	}

	setInsightsStatus(fileID, "pending")
	setInsightPageStatus(fileID, "pending")
	go GenerateInsights(context.Background(), eid, fileID, userID)
	logger.Infof(ctx, "【洞察】确认背景并触发重新生成: fileID=%d eid=%d userID=%d", fileID, eid, userID)
	return nil
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
	return file, err
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
	user, _ := model.GetUserByIDAndEid(eid, userID)
	if user != nil {
		_ = user.LoadDepartments(0)
	}
	position, style, smartMemory, customMemory := "", "", "", ""
	if memory, _ := model.GetUserMemory(eid, userID); memory != nil {
		position, style = memory.Position, memory.Style
		if items, err := memory.GetSmartMemoryItems(); err == nil {
			smartMemory = formatMemoryFacts(items)
		}
		if items, err := memory.GetCustomMemoryItems(); err == nil {
			customMemory = formatMemoryFacts(items)
		}
	}
	background.PersonalInfo = formatPersonalBackground(user, position, style, smartMemory, customMemory)
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

func formatPersonalBackground(user *model.User, position, style, smartMemory, customMemory string) string {
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
	if strings.TrimSpace(smartMemory) != "" {
		lines = append(lines, "系统记忆："+smartMemory)
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
	if strings.TrimSpace(saved.SupplementalContext) != "" {
		target.SupplementalContext = saved.SupplementalContext
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
	return background
}

func normalizeInsightBackground(background *InsightBackground) error {
	background.PersonalInfo = truncateInsightContext(background.PersonalInfo, maxInsightContextText)
	background.CompanyInfo = truncateInsightContext(background.CompanyInfo, maxInsightContextText)
	background.HistoricalContext = truncateInsightContext(background.HistoricalContext, maxInsightContextText)
	background.ExternalConstraints = truncateInsightContext(background.ExternalConstraints, maxInsightContextText)
	background.MaterialContext = truncateInsightContext(background.MaterialContext, maxInsightContextText)
	background.SupplementalContext = truncateInsightContext(background.SupplementalContext, maxInsightContextText)
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
以下是用户在本次重新生成前确认或补充的背景。它只用于校准判断，不得替代纪要和转写中的明确事实；若与原始背景冲突，以本次确认内容为准，并在洞察中标记冲突。
<personal_background>
%s
</personal_background>
<company_background>
%s
</company_background>
<historical_background>
%s
</historical_background>
<external_constraints>
%s
</external_constraints>
<supplemental_background>
%s
</supplemental_background>
<current_material>
%s
</current_material>
</insight_supplemental_context>`, background.PersonalInfo, background.CompanyInfo, background.HistoricalContext, background.ExternalConstraints, background.SupplementalContext, material)
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
	if isInsightGenerationCurrent(eid, fileID, generation) {
		setInsightsStatus(fileID, status)
	}
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

		// 第二路召回：使用当前会议实体名称匹配已编译的结构化记忆。
		// 这一路不再读取整篇历史纪要，只把高置信、可追溯的 Claim 加入上下文。
		memoryRows := loadMemoryRecallHistory(ctx, eid, userID, fileID, currentEntityIDs)
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
	logger.Infof(ctx, "【洞察-历史召回】fileID=%d generic_entities=%d entity_overlap_candidates=%d claim_candidates=%d entity_fact_candidates=%d selected=%d", fileID, len(currentEntityIDs), entityOverlapCandidates, claimCandidates, entityFactCandidates, len(rows))
	return rows
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
		Where("(review_state = ? OR (epistemic_type = ? AND evidence_available = ?))", recordingMemoryReviewConfirmed, "explicit", true).
		Order("source_confidence DESC, updated_time DESC, id DESC").
		Limit(8).Find(&claims).Error; err != nil {
		logger.Warnf(ctx, "【洞察】读取结构化会议记忆失败 fileID=%d err=%v", fileID, err)
		return nil
	}
	result := make([]meetingMemoryContext, 0, len(claims))
	for _, claim := range claims {
		result = append(result, meetingMemoryContext{
			MemoryID:          claim.ID,
			Kind:              claim.ClaimKind,
			Content:           string(claim.Content),
			AssertionState:    claim.AssertionState,
			LifecycleState:    claim.LifecycleState,
			ReviewState:       claim.ReviewState,
			SourceFileID:      claim.FileID,
			SourceFile:        sourceFile,
			SourceConfidence:  claim.SourceConfidence,
			EvidenceAvailable: claim.EvidenceAvailable,
			SourceSegmentIDs:  decodeMemorySourceSegmentIDs(claim.SourceSegmentIDs),
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
	entityNames = filterInsightRecallEntityNames(entityNames)
	if len(entityNames) == 0 {
		return nil
	}

	var claims []model.RecordingMemoryClaim
	query := model.DB.WithContext(ctx).Table("recording_memory_claims AS c").
		Select("c.*").
		Joins("JOIN files f ON f.id = c.file_id AND f.eid = c.eid").
		Where("c.eid = ? AND c.owner_id = ? AND c.file_id != ? AND c.is_current = ?", eid, ownerID, currentFileID, true).
		Where("c.assertion_state NOT IN ?", []string{"rejected"}).
		Where("(c.review_state = ? OR (c.epistemic_type = ? AND c.evidence_available = ?))", recordingMemoryReviewConfirmed, "explicit", true).
		Where("f.user_id = ? AND f.origin_type IN ? AND f.parsing_status = ? AND f.is_deleted = ?", ownerID, model.RecordingOriginTypes(), "normal", false)

	pattern := insightRecallLikePattern(entityNames[0])
	entityMatch := model.DB.Where("c.content LIKE ? ESCAPE '!' OR c.detail_json LIKE ? ESCAPE '!'", pattern, pattern)
	for _, name := range entityNames[1:] {
		pattern := insightRecallLikePattern(name)
		entityMatch = entityMatch.Or("c.content LIKE ? ESCAPE '!' OR c.detail_json LIKE ? ESCAPE '!'", pattern, pattern)
	}
	if err := query.Where(entityMatch).
		Order("c.source_confidence DESC, c.updated_time DESC, c.id DESC").
		Limit(24).Find(&claims).Error; err != nil {
		logger.Warnf(ctx, "【洞察】结构化记忆召回失败: %v", err)
		return nil
	}
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
			AssertionState:    claim.AssertionState,
			LifecycleState:    claim.LifecycleState,
			ReviewState:       claim.ReviewState,
			SourceFileID:      claim.FileID,
			SourceFile:        title,
			SourceConfidence:  claim.SourceConfidence,
			EvidenceAvailable: claim.EvidenceAvailable,
			SourceSegmentIDs:  decodeMemorySourceSegmentIDs(claim.SourceSegmentIDs),
		})
	}
	return rows
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
