package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
)

// RecordingContextAuditManifest 是 Phase 6A 只读审计产物，
// 记录 V2.1 一次洞察调用实际拿到的全部经营上下文。
type RecordingContextAuditManifest struct {
	CaseID              string                                  `json:"case_id,omitempty"`
	FileID              int64                                   `json:"file_id"`
	Generation          int64                                   `json:"generation"`
	Perspective         string                                  `json:"perspective"`
	Model               string                                  `json:"model"`
	RequestedAt         string                                  `json:"requested_at"`
	FeatureFlags        RecordingContextAuditFlags              `json:"feature_flags"`
	Meeting             RecordingContextAuditMeeting            `json:"meeting"`
	PersonalContext     string                                  `json:"personal_context"`
	CompanyContext      string                                  `json:"company_context"`
	Cognitions          RecordingContextAuditCognitions         `json:"cognitions"`
	Memories            RecordingContextAuditMemories           `json:"memories"`
	History             RecordingContextAuditHistory            `json:"history"`
	EnterpriseKnowledge RecordingContextAuditEnterpriseKnowledge `json:"enterprise_knowledge"`
	MeetingContext      RecordingContextAuditMeetingContext     `json:"meeting_context"`
	PromptBudget        RecordingContextAuditBudget             `json:"prompt_budget"`
	OmittedReasons      []string                                `json:"omitted_reasons,omitempty"`
	Errors              []string                                `json:"errors,omitempty"`
}

type RecordingContextAuditFlags struct {
	MemoryExtractionEnabled        bool     `json:"memory_extraction_enabled"`
	MemoryExtractionTypes          []string `json:"memory_extraction_types,omitempty"`
	DecisionRuntimeContextEnabled  bool     `json:"decision_runtime_context_enabled"`
	EnterpriseKnowledgeEnabled     bool     `json:"enterprise_knowledge_enabled"`
	EnterpriseKnowledgeLibraryIDs  []string `json:"enterprise_knowledge_library_ids,omitempty"`
	EnterpriseKnowledgeScopeValid  bool     `json:"enterprise_knowledge_scope_valid"`
	SecondBrainV2ShadowEnabled     bool     `json:"second_brain_v2_shadow_enabled"`
	RecordingMemoryV2ShadowEnabled bool     `json:"recording_memory_v2_shadow_enabled"`
	TaxonomyPromptInjection        string   `json:"taxonomy_prompt_injection"`
}

type RecordingContextAuditMeeting struct {
	Source              string   `json:"source"`
	PrimaryMaterialChars int     `json:"primary_material_chars"`
	TranscriptChars      int     `json:"transcript_chars"`
	MinutesRawJSON       string   `json:"minutes_raw_json,omitempty"`
	TopicsRawType        string   `json:"topics_raw_type"`
	TopicsRawSample      string   `json:"topics_raw_sample,omitempty"`
	EntityCount          int      `json:"entity_count"`
	ClaimCount           int      `json:"claim_count"`
}

type RecordingContextAuditCognitions struct {
	CandidateCount int                           `json:"candidate_count"`
	SelectedCount  int                           `json:"selected_count"`
	CoreCount      int                           `json:"core_count"`
	SituationalCount int                         `json:"situational_count"`
	ConflictCount  int                           `json:"conflict_count"`
	Items          []RecordingContextAuditCognitionItem `json:"items,omitempty"`
}

type RecordingContextAuditCognitionItem struct {
	ID             int64   `json:"id"`
	Type           string  `json:"type"`
	Layer          string  `json:"layer"`
	Domain         string  `json:"domain,omitempty"`
	Scope          []string `json:"scope,omitempty"`
	Confidence     float64 `json:"confidence"`
	MatchReason    string  `json:"match_reason"`
	Chars          int     `json:"chars"`
	Statement      string  `json:"statement,omitempty"`
}

type RecordingContextAuditMemories struct {
	CandidateCount int                          `json:"candidate_count"`
	SelectedCount  int                          `json:"selected_count"`
	DirectCount    int                          `json:"direct_count"`
	OneHopCount    int                          `json:"one_hop_count"`
	Items          []RecordingContextAuditMemoryItem `json:"items,omitempty"`
}

type RecordingContextAuditMemoryItem struct {
	MemoryID         int64    `json:"memory_id"`
	Kind             string   `json:"kind"`
	Content          string   `json:"content"`
	SourceFileID     int64    `json:"source_file_id"`
	SourceFile       string   `json:"source_file"`
	AssertionState   string   `json:"assertion_state"`
	LifecycleState   string   `json:"lifecycle_state"`
	ReviewState      string   `json:"review_state"`
	SourceConfidence float64  `json:"source_confidence"`
	EvidenceAvailable bool    `json:"evidence_available"`
	RecallReason     string   `json:"recall_reason"`
	RecallSource     []string `json:"recall_source"`
	Chars            int      `json:"chars"`
}

type RecordingContextAuditHistory struct {
	CandidateCount int                           `json:"candidate_count"`
	SelectedCount  int                           `json:"selected_count"`
	Items          []RecordingContextAuditHistoryItem `json:"items,omitempty"`
}

type RecordingContextAuditHistoryItem struct {
	FileID       int64    `json:"file_id"`
	Title        string   `json:"title"`
	RecallSource []string `json:"recall_source"`
	MemoryCount  int      `json:"memory_count"`
}

type RecordingContextAuditEnterpriseKnowledge struct {
	Query           string   `json:"query"`
	AnchorEmpty     bool     `json:"anchor_empty"`
	CandidateCount  int      `json:"candidate_count"`
	SelectedCount   int      `json:"selected_count"`
	OmittedReasons  []string `json:"omitted_reasons,omitempty"`
	Items           []RecordingContextAuditEnterpriseKnowledgeItem `json:"items,omitempty"`
}

type RecordingContextAuditEnterpriseKnowledgeItem struct {
	ChunkID         string   `json:"chunk_id"`
	Content         string   `json:"content"`
	PermissionScope string   `json:"permission_scope"`
	RetrievalReason string   `json:"retrieval_reason"`
	Chars           int      `json:"chars"`
}

type RecordingContextAuditMeetingContext struct {
	PrimaryScene      string   `json:"primary_scene"`
	SecondaryDomains  []string `json:"secondary_domains,omitempty"`
	Topics            []string `json:"topics,omitempty"`
	HasScene          bool     `json:"has_scene"`
	HasDomains        bool     `json:"has_domains"`
	HasTopics         bool     `json:"has_topics"`
}

type RecordingContextAuditBudget struct {
	TotalChars          int            `json:"total_chars"`
	SystemPromptChars   int            `json:"system_prompt_chars"`
	UserPromptChars     int            `json:"user_prompt_chars"`
	MeetingChars        int            `json:"meeting_chars"`
	HistoryChars        int            `json:"history_chars"`
	CognitionChars      int            `json:"cognition_chars"`
	MemoryChars         int            `json:"memory_chars"`
	EnterpriseChars     int            `json:"enterprise_chars"`
	PersonalChars       int            `json:"personal_chars"`
	CompanyChars        int            `json:"company_chars"`
	CitationChars       int            `json:"citation_chars"`
	RuntimeContextChars int            `json:"runtime_context_chars"`
	ContextBudgetTokens int            `json:"context_budget_tokens"`
	EstimatedTokens     int            `json:"estimated_tokens"`
	Breakdown           map[string]float64 `json:"breakdown"`
}

// BuildRecordingContextAuditManifest 只读地复现 GenerateInsights 的上下文装配过程，
// 不调用 LLM、不写任何业务表。
func BuildRecordingContextAuditManifest(ctx context.Context, eid, userID, fileID int64) (*RecordingContextAuditManifest, error) {
	started := time.Now()
	manifest := &RecordingContextAuditManifest{
		FileID:      fileID,
		RequestedAt: started.Format(time.RFC3339),
		FeatureFlags: RecordingContextAuditFlags{
			TaxonomyPromptInjection: "PROHIBITED",
		},
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return nil, fmt.Errorf("读取文件信息失败: %w", err)
	}
	if file.UserID > 0 && userID != file.UserID {
		userID = file.UserID
	}
	manifest.Generation = file.InsightGeneration
	manifest.Perspective = string(model.NormalizeInsightPerspective(file.InsightPerspective))

	config, configErr := model.ValidateOrCreateRecordingConfig(eid)
	if configErr != nil || config == nil {
		manifest.Errors = append(manifest.Errors, fmt.Sprintf("config load error: %v", configErr))
		config = &model.RecordingConfig{}
	}
	manifest.Model = config.InferenceModelName

	memCfg := config.MemoryExtraction
	if memCfg == nil {
		memCfg = &model.MemoryExtractionConfig{Enabled: true, Types: []string{model.EntityTypePerson, model.EntityTypeMatter, model.EntityTypeCommitment}}
	}
	manifest.FeatureFlags.MemoryExtractionEnabled = memCfg.IsEffectivelyEnabled()
	manifest.FeatureFlags.MemoryExtractionTypes = append([]string{}, memCfg.Types...)
	manifest.FeatureFlags.DecisionRuntimeContextEnabled = recordingDecisionRuntimeContextEnabled()
	manifest.FeatureFlags.EnterpriseKnowledgeEnabled = recordingEnterpriseKnowledgeEnabled()
	manifest.FeatureFlags.SecondBrainV2ShadowEnabled = recordingSecondBrainV2ShadowEnabled()
	manifest.FeatureFlags.RecordingMemoryV2ShadowEnabled = recordingMemoryV2ShadowEnabled()

	libIDs, scopeErr := recordingEnterpriseKnowledgeLibraryIDsFromEnv()
	manifest.FeatureFlags.EnterpriseKnowledgeScopeValid = scopeErr == nil && len(normalizePositiveInt64s(libIDs)) > 0
	for _, id := range normalizePositiveInt64s(libIDs) {
		if encoded, err := hashids.Encode(id); err == nil {
			manifest.FeatureFlags.EnterpriseKnowledgeLibraryIDs = append(manifest.FeatureFlags.EnterpriseKnowledgeLibraryIDs, encoded)
		}
	}

	// 1. 当前会议快照
	currentContext, contextErr := buildCurrentMeetingContext(ctx, eid, fileID, manifest.Generation)
	if contextErr != nil {
		manifest.Errors = append(manifest.Errors, fmt.Sprintf("current context build error: %v", contextErr))
	}
	if currentContext != nil {
		if verifyErr := currentContext.VerifyCurrentMinutes(eid, fileID); verifyErr != nil {
			manifest.Errors = append(manifest.Errors, fmt.Sprintf("current context verify error: %v", verifyErr))
			currentContext = nil
		}
	}

	// 2. 决策上下文（包含认知、历史业务记忆）
	decisionCtx, decisionErr := BuildRecordingDecisionContext(ctx, eid, userID, fileID, manifest.Generation, memCfg, currentContext)
	if decisionErr != nil {
		manifest.Errors = append(manifest.Errors, fmt.Sprintf("decision context build error: %v", decisionErr))
	}

	var cognitionCtx *RecordingCognitionContextPackage
	var historyRows []historyMeeting
	if decisionCtx != nil {
		currentContext = decisionCtx.Current
		cognitionCtx = decisionCtx.Cognitions
		historyRows = decisionCtx.History
		manifest.OmittedReasons = append(manifest.OmittedReasons, decisionCtx.OmittedReasons...)
	} else {
		if currentContext != nil {
			cognitionCtx, _ = LoadApplicableRecordingCognition(ctx, eid, userID, currentContext)
		}
		historyRows = loadRelatedInsightHistoryWithContext(ctx, eid, fileID, userID, memCfg, currentContext)
	}

	// 3. 个人/企业上下文
	personal := loadInsightPersonalContext(ctx, eid, userID, fileID)
	enterprise, _ := model.GetEnterpriseByID(eid)
	manifest.PersonalContext = personal.formatted()
	manifest.CompanyContext = formatCompanyBackground(enterprise)

	// 4. 会议材料与转写
	perspective := model.NormalizeInsightPerspective(file.InsightPerspective)
	profile := insightPromptProfileFor(perspective)
	primaryMaterial, primaryErr := loadInsightPrimaryMaterial(ctx, eid, fileID, profile)
	if primaryErr != nil {
		manifest.Errors = append(manifest.Errors, fmt.Sprintf("primary material load error: %v", primaryErr))
	}
	transcriptText, transcriptErr := loadTranscriptText(ctx, eid, fileID)
	if transcriptErr != nil {
		manifest.Errors = append(manifest.Errors, fmt.Sprintf("transcript load error: %v", transcriptErr))
	}

	// 5. 质量门控（只用于判断输出指令）
	gateMaterial, _ := loadMeetingMinutesText(ctx, eid, fileID)
	if strings.TrimSpace(gateMaterial) == "" {
		gateMaterial, _ = loadTranscriptText(ctx, eid, fileID)
	}
	gateResult := evaluateInsightGate(gateMaterial)

	// 6. 装配 System Prompt 并计算 ContextTail
	baseEnrichedPrompt := buildEnrichedPrompt(enterprise, personal.User, personal.Position, personal.Style, personal.CustomMemory, buildInsightSystemPrompt(perspective))
	enrichedPrompt := baseEnrichedPrompt

	var runtimeCtxText string
	var cognitionPromptText string
	var enterpriseCandidates []RecordingDecisionEnterpriseKnowledgeCandidate
	var enterpriseOmitted []string

	if recordingDecisionRuntimeContextEnabled() && decisionCtx != nil {
		auditPkg, auditErr := BuildRecordingDecisionContextAuditPackage(eid, userID, fileID, decisionCtx)
		if auditErr == nil {
			query := recordingEnterpriseKnowledgeQuery(currentContext)
			if reason := enterpriseKnowledgeDegradationReason(recordingEnterpriseKnowledgeEnabled(), libIDs, scopeErr, query); reason != "" {
				auditPkg.OmittedReasons = appendUniqueStrings(auditPkg.OmittedReasons, reason)
				enterpriseOmitted = append(enterpriseOmitted, reason)
			} else {
				candidates, omitted, searchErr := SearchRecordingEnterpriseKnowledge(ctx, RecordingEnterpriseKnowledgeSearchRequest{
					EID: eid, UserID: userID, Query: query, LibraryIDs: libIDs, TopK: 5,
				})
				enterpriseCandidates = candidates
				enterpriseOmitted = append(enterpriseOmitted, omitted...)
				auditPkg.OmittedReasons = appendUniqueStrings(auditPkg.OmittedReasons, omitted...)
				if searchErr != nil {
					auditPkg.OmittedReasons = appendUniqueStrings(auditPkg.OmittedReasons, "enterprise_knowledge_search_failed")
					enterpriseOmitted = append(enterpriseOmitted, "enterprise_knowledge_search_failed")
				} else {
					if appendErr := AppendEnterpriseKnowledgeCandidates(auditPkg, candidates); appendErr != nil {
						auditPkg.OmittedReasons = appendUniqueStrings(auditPkg.OmittedReasons, "enterprise_knowledge_adapt_failed")
						enterpriseOmitted = append(enterpriseOmitted, "enterprise_knowledge_adapt_failed")
					}
				}
			}
			if runtime, runtimeErr := CompileRecordingDecisionRuntimeContext(auditPkg); runtimeErr == nil {
				runtimeCtxText = FormatRecordingDecisionRuntimeContext(runtime)
				enrichedPrompt += "\n\n" + runtimeCtxText
			} else {
				manifest.Errors = append(manifest.Errors, fmt.Sprintf("runtime context compile error: %v", runtimeErr))
			}
		} else {
			manifest.Errors = append(manifest.Errors, fmt.Sprintf("decision audit package build error: %v", auditErr))
		}
	} else {
		cognitionPromptText = FormatRecordingCognitionContext(cognitionCtx)
		if cognitionPromptText != "" {
			enrichedPrompt += "\n\n" + cognitionPromptText
		}
	}

	if saved, ok := loadSavedInsightBackground(file.InsightContext); ok {
		enrichedPrompt += "\n\n" + formatInsightBackgroundPrompt(saved, mustLoadMinutesText(eid, fileID))
	}
	if outputInstruction := insightGateOutputInstruction(gateResult.Mode); outputInstruction != "" {
		enrichedPrompt += "\n\n" + outputInstruction
	}

	historyStr := buildHistoricalContext(historyRows)
	citationText := buildInsightCitationContext(historyRows, cognitionCtx)
	enrichedPrompt += "\n\n<citation_index>\n" + citationText + "\n</citation_index>\n引用标记只使用 citation_index 中与实际判断相关的 ref。"
	contextTail := enrichedPrompt[len(baseEnrichedPrompt):]

	userPrompt := buildInsightUserPrompt(perspective, insightSourceTitle(file.Path), historyStr, primaryMaterial, transcriptText)

	// 7. 填充 MeetingContext
	if currentContext != nil {
		manifest.MeetingContext = RecordingContextAuditMeetingContext{
			PrimaryScene:     currentContext.PrimaryScene,
			SecondaryDomains: append([]string{}, currentContext.SecondaryDomains...),
			Topics:           append([]string{}, currentContext.Topics...),
			HasScene:         strings.TrimSpace(currentContext.PrimaryScene) != "",
			HasDomains:       len(currentContext.SecondaryDomains) > 0,
			HasTopics:        len(currentContext.Topics) > 0,
		}
	}

	// 8. 填充 Meeting 原始信息
	manifest.Meeting.Source = "summary"
	if profile.SourceIsPrimaryText {
		manifest.Meeting.Source = "filebody"
	}
	manifest.Meeting.PrimaryMaterialChars = len([]rune(primaryMaterial))
	manifest.Meeting.TranscriptChars = len([]rune(transcriptText))
	if currentContext != nil {
		manifest.Meeting.EntityCount = len(currentContext.Entities)
		manifest.Meeting.ClaimCount = len(currentContext.Claims)
	}
	if raw, err := loadMeetingMinutesJSON(eid, fileID); err == nil && raw != "" {
		manifest.Meeting.MinutesRawJSON = raw
		manifest.Meeting.TopicsRawType, manifest.Meeting.TopicsRawSample = detectTopicsRawType(raw)
	}

	// 9. Cognition 明细
	manifest.Cognitions = auditCognitionPackage(cognitionCtx)

	// 10. Memory / History 明细
	manifest.Memories = auditMemoryHistory(historyRows)
	manifest.History = auditHistoryOverview(historyRows)
	if candidateCounts, err := countHistoryCandidates(ctx, eid, userID, fileID, memCfg, currentContext); err == nil {
		manifest.History.CandidateCount = candidateCounts.EntityOverlap + candidateCounts.Claim + candidateCounts.EntityFact
		manifest.Memories.CandidateCount = candidateCounts.TotalClaims
	}

	// 11. Enterprise Knowledge
	manifest.EnterpriseKnowledge = auditEnterpriseKnowledge(currentContext, enterpriseCandidates, enterpriseOmitted)

	// 12. Budget
	manifest.PromptBudget = computeContextBudget(enrichedPrompt, userPrompt, baseEnrichedPrompt, contextTail, primaryMaterial, transcriptText, historyStr, cognitionPromptText, runtimeCtxText, manifest.PersonalContext, manifest.CompanyContext, citationText, config)

	return manifest, nil
}

func detectTopicsRawType(raw string) (string, string) {
	minutes, err := parseRecordingMemoryMinutes(raw)
	if err != nil {
		return "parse_error", ""
	}
	value := minutes["topics"]
	rows, ok := value.([]interface{})
	if !ok || len(rows) == 0 {
		return "missing_or_not_array", ""
	}
	first := rows[0]
	switch first.(type) {
	case string:
		var sample []string
		for _, r := range rows {
			if s, ok := r.(string); ok {
				sample = append(sample, s)
				if len(sample) >= 3 {
					break
				}
			}
		}
		return "string_array", strings.Join(sample, ", ")
	case map[string]interface{}:
		payload, _ := json.Marshal(first)
		return "object_array", string(payload)
	default:
		return fmt.Sprintf("other:%T", first), ""
	}
}

func auditCognitionPackage(pkg *RecordingCognitionContextPackage) RecordingContextAuditCognitions {
	result := RecordingContextAuditCognitions{}
	if pkg == nil {
		return result
	}
	result.CoreCount = len(pkg.Core)
	result.SituationalCount = len(pkg.Situational)
	result.ConflictCount = len(pkg.Conflicts)
	result.SelectedCount = result.CoreCount + result.SituationalCount + result.ConflictCount
	for _, item := range pkg.Core {
		result.Items = append(result.Items, auditCognitionItem(item))
	}
	for _, item := range pkg.Situational {
		result.Items = append(result.Items, auditCognitionItem(item))
	}
	for _, item := range pkg.Conflicts {
		result.Items = append(result.Items, auditCognitionItem(item))
	}
	return result
}

func auditCognitionItem(item RecordingCognitionContextItem) RecordingContextAuditCognitionItem {
	return RecordingContextAuditCognitionItem{
		ID: item.ID, Type: item.CognitionType, Layer: item.Layer, Domain: item.DomainName,
		Scope: item.Scope, Confidence: item.Confidence, MatchReason: item.RetrievalReason,
		Chars: len([]rune(item.Statement)), Statement: truncateAuditString(item.Statement, 200),
	}
}

func auditMemoryHistory(rows []historyMeeting) RecordingContextAuditMemories {
	result := RecordingContextAuditMemories{}
	for _, meeting := range rows {
		for _, mem := range meeting.Memories {
			item := RecordingContextAuditMemoryItem{
				MemoryID: mem.MemoryID, Kind: mem.Kind, Content: mem.Content,
				SourceFileID: mem.SourceFileID, SourceFile: mem.SourceFile,
				AssertionState: mem.AssertionState, LifecycleState: mem.LifecycleState,
				ReviewState: mem.ReviewState, SourceConfidence: mem.SourceConfidence,
				EvidenceAvailable: mem.EvidenceAvailable, RecallReason: mem.RecallReason,
				RecallSource: decodeHistoryRecallSource(meeting.RecallSource),
				Chars: len([]rune(mem.Content)),
			}
			if len(mem.RecallPath) > 1 {
				result.OneHopCount++
			} else {
				result.DirectCount++
			}
			result.Items = append(result.Items, item)
		}
	}
	result.SelectedCount = len(result.Items)
	return result
}

func auditHistoryOverview(rows []historyMeeting) RecordingContextAuditHistory {
	result := RecordingContextAuditHistory{SelectedCount: len(rows)}
	for _, meeting := range rows {
		result.Items = append(result.Items, RecordingContextAuditHistoryItem{
			FileID:       meeting.FileID,
			Title:        meeting.Title,
			RecallSource: decodeHistoryRecallSource(meeting.RecallSource),
			MemoryCount:  len(meeting.Memories),
		})
	}
	return result
}

func decodeHistoryRecallSource(source uint8) []string {
	var reasons []string
	if source&historyRecallEntityOverlap != 0 {
		reasons = append(reasons, "entity_overlap")
	}
	if source&historyRecallClaim != 0 {
		reasons = append(reasons, "claim_match")
	}
	if source&historyRecallEntityFact != 0 {
		reasons = append(reasons, "entity_fact")
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "unknown")
	}
	return reasons
}

type historyCandidateCounts struct {
	EntityOverlap int
	Claim         int
	EntityFact    int
	TotalClaims   int
}

func countHistoryCandidates(ctx context.Context, eid, userID, fileID int64, memCfg *model.MemoryExtractionConfig, currentContext *CurrentMeetingContext) (historyCandidateCounts, error) {
	result := historyCandidateCounts{}
	if memCfg == nil || !memCfg.IsEffectivelyEnabled() {
		return result, nil
	}

	var currentEntityIDs []int64
	if err := model.DB.WithContext(ctx).Model(&model.EntityChunkRelation{}).
		Joins("JOIN entities e ON e.id = entity_chunk_relations.entity_id").
		Where("entity_chunk_relations.eid = ? AND entity_chunk_relations.file_id = ? AND entity_chunk_relations.status = ?", eid, fileID, "active").
		Where("entity_chunk_relations.source IN ?", []string{"auto_llm", "auto_meta"}).
		Where("e.type IN ?", memCfg.Types).
		Distinct("entity_chunk_relations.entity_id").
		Pluck("entity_chunk_relations.entity_id", &currentEntityIDs).Error; err != nil {
		return result, err
	}

	if len(currentEntityIDs) > 0 {
		var historyFileIDs []int64
		if err := model.DB.WithContext(ctx).Table("entity_chunk_relations ecr").
			Joins("JOIN files f ON f.id = ecr.file_id").
			Joins("JOIN entities e ON e.id = ecr.entity_id").
			Where("ecr.eid = ? AND ecr.entity_id IN ? AND ecr.file_id != ? AND ecr.status = ?", eid, currentEntityIDs, fileID, "active").
			Where("e.type IN ?", memCfg.Types).
			Where("f.user_id = ? AND f.origin_type IN ? AND f.parsing_status = ? AND f.insight_summary != ''", userID, model.RecordingOriginTypes(), "normal").
			Where("f.is_deleted = ?", false).
			Group("ecr.file_id").
			Pluck("ecr.file_id", &historyFileIDs).Error; err == nil {
			result.EntityOverlap = len(historyFileIDs)
		}
	}

	currentEntityNames := []string{}
	if len(currentEntityIDs) > 0 && currentContext == nil {
		var genericNames []string
		_ = model.DB.WithContext(ctx).Model(&model.Entity{}).
			Where("eid = ? AND id IN ? AND status = ?", eid, currentEntityIDs, model.EntityRelationStatusActive).
			Pluck("name", &genericNames)
		currentEntityNames = appendUniqueStrings(currentEntityNames, genericNames...)
	}
	if currentContext != nil {
		currentEntityNames = appendUniqueStrings(currentEntityNames, currentContext.RecallEntityNames()...)
	}
	currentRecallTerms := appendUniqueStrings(nil, currentEntityNames...)
	if currentContext != nil {
		currentRecallTerms = appendUniqueStrings(currentRecallTerms, currentContext.RecallClaimTerms()...)
	}
	if len(currentRecallTerms) > 0 {
		var count int64
		query := model.DB.WithContext(ctx).Table("recording_memory_claims AS c").
			Joins("JOIN files f ON f.id = c.file_id AND f.eid = c.eid").
			Where("c.eid = ? AND c.owner_id = ? AND c.file_id != ? AND c.is_current = ?", eid, userID, fileID, true).
			Where("c.source_item_type NOT IN ?", []string{recordingMemorySourceInsightBackground}).
			Where("c.source_item_type <> ? OR c.assertion_state = ?", recordingMemorySourceUserConfirmed, "user_confirmed").
			Where("c.assertion_state NOT IN ?", []string{"rejected"}).
			Where("c.source_confidence >= ?", recordingMemoryMinSourceConfidence).
			Where("(c.review_state = ? OR (c.epistemic_type = ? AND c.evidence_available = ?))", recordingMemoryReviewConfirmed, "explicit", true).
			Where("f.user_id = ? AND f.origin_type IN ? AND f.parsing_status = ? AND f.is_deleted = ?", userID, model.RecordingOriginTypes(), "normal", false)
		pattern := insightRecallLikePattern(currentRecallTerms[0])
		entityMatch := model.DB.Where("c.content LIKE ? ESCAPE '!' OR c.detail_json LIKE ? ESCAPE '!'", pattern, pattern)
		for _, term := range currentRecallTerms[1:] {
			p := insightRecallLikePattern(term)
			entityMatch = entityMatch.Or("c.content LIKE ? ESCAPE '!' OR c.detail_json LIKE ? ESCAPE '!'", p, p)
		}
		if err := query.Where(entityMatch).Count(&count).Error; err == nil {
			result.Claim = int(count)
		}
	}

	var currentRecordingEntityIDs []int64
	if err := model.DB.WithContext(ctx).Model(&model.RecordingMemoryFact{}).
		Where("eid = ? AND owner_id = ? AND file_id = ? AND is_deleted = ?", eid, userID, fileID, false).
		Distinct("entity_id").Pluck("entity_id", &currentRecordingEntityIDs).Error; err == nil && len(currentRecordingEntityIDs) > 0 {
		var factCount int64
		_ = model.DB.WithContext(ctx).Model(&model.RecordingMemoryFact{}).
			Where("eid = ? AND owner_id = ? AND entity_id IN ? AND file_id != ? AND is_deleted = ?", eid, userID, currentRecordingEntityIDs, fileID, false).
			Count(&factCount)
		result.EntityFact = int(factCount)
	}

	result.TotalClaims = result.EntityOverlap + result.Claim + result.EntityFact
	return result, nil
}

func auditEnterpriseKnowledge(currentContext *CurrentMeetingContext, candidates []RecordingDecisionEnterpriseKnowledgeCandidate, omitted []string) RecordingContextAuditEnterpriseKnowledge {
	query := recordingEnterpriseKnowledgeQuery(currentContext)
	result := RecordingContextAuditEnterpriseKnowledge{
		Query:          query,
		AnchorEmpty:    strings.TrimSpace(query) == "",
		CandidateCount: len(candidates),
		SelectedCount:  0,
		OmittedReasons: append([]string{}, omitted...),
	}
	for _, c := range candidates {
		if !c.Authorized {
			continue
		}
		result.SelectedCount++
		result.Items = append(result.Items, RecordingContextAuditEnterpriseKnowledgeItem{
			ChunkID: c.ChunkID, Content: truncateAuditString(c.Content, 300),
			PermissionScope: c.PermissionScope, RetrievalReason: c.RetrievalReason,
			Chars: len([]rune(c.Content)),
		})
	}
	return result
}

func computeContextBudget(enrichedPrompt, userPrompt, baseEnrichedPrompt, contextTail, primaryMaterial, transcriptText, historyStr, cognitionPromptText, runtimeCtxText, personalCtx, companyCtx, citationText string, config *model.RecordingConfig) RecordingContextAuditBudget {
	budget := RecordingContextAuditBudget{
		TotalChars:        len([]rune(enrichedPrompt + userPrompt)),
		SystemPromptChars: len([]rune(enrichedPrompt)),
		UserPromptChars:   len([]rune(userPrompt)),
		MeetingChars:      len([]rune(primaryMaterial)),
		HistoryChars:      len([]rune(historyStr)),
		CitationChars:     len([]rune(citationText)),
		PersonalChars:     len([]rune(personalCtx)),
		CompanyChars:      len([]rune(companyCtx)),
		ContextBudgetTokens: getRecordingContextBudget(context.Background(), config),
	}
	if runtimeCtxText != "" {
		budget.RuntimeContextChars = len([]rune(runtimeCtxText))
	} else if cognitionPromptText != "" {
		budget.CognitionChars = len([]rune(cognitionPromptText))
	}
	// Memory chars are embedded inside historyStr (historical_context JSON) or runtime context;
	// approximate by summing memory contents.
	budget.EstimatedTokens = estimateTokens(enrichedPrompt)
	budget.Breakdown = map[string]float64{
		"system_prompt":   roundPercent(budget.SystemPromptChars, budget.TotalChars),
		"meeting":         roundPercent(budget.MeetingChars, budget.TotalChars),
		"history":         roundPercent(budget.HistoryChars, budget.TotalChars),
		"cognition":       roundPercent(budget.CognitionChars, budget.TotalChars),
		"runtime_context": roundPercent(budget.RuntimeContextChars, budget.TotalChars),
		"personal":        roundPercent(budget.PersonalChars, budget.TotalChars),
		"company":         roundPercent(budget.CompanyChars, budget.TotalChars),
		"citation":        roundPercent(budget.CitationChars, budget.TotalChars),
	}
	return budget
}

func roundPercent(part, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(int(float64(part)*1000.0/float64(total))) / 10.0
}

func truncateAuditString(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "..."
}

// DiscoverRecordingContextAuditContinuityCases 在指定企业下寻找与已选 case 存在
// 共同实体/Claim 的连续性会议，用于补充 Phase 6A 的 >=16 case 要求。
func DiscoverRecordingContextAuditContinuityCases(ctx context.Context, eid, userID int64, excludeFileIDs []int64, minGroupSize int, topGroups int) ([][]int64, error) {
	excluded := make(map[int64]bool, len(excludeFileIDs))
	for _, id := range excludeFileIDs {
		excluded[id] = true
	}

	var files []model.File
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND user_id = ? AND type = ? AND is_deleted = ? AND origin_type IN ? AND parsing_status = ? AND insight_summary != ''",
			eid, userID, model.FILE_TYPE_FILE, false, model.RecordingOriginTypes(), "normal").
		Order("created_time DESC").
		Limit(200).
		Find(&files).Error; err != nil {
		return nil, err
	}

	type fileEntities struct {
		fileID   int64
		entities []string
	}
	var entries []fileEntities
	for _, file := range files {
		if excluded[file.ID] {
			continue
		}
		current, err := buildCurrentMeetingContext(ctx, eid, file.ID, file.InsightGeneration)
		if err != nil {
			continue
		}
		names := current.RecallEntityNames()
		if len(names) == 0 {
			continue
		}
		entries = append(entries, fileEntities{fileID: file.ID, entities: names})
	}

	entityToFiles := map[string][]int64{}
	for _, entry := range entries {
		for _, name := range entry.entities {
			entityToFiles[name] = append(entityToFiles[name], entry.fileID)
		}
	}

	fileToEntities := map[int64]map[string]bool{}
	for _, entry := range entries {
		if fileToEntities[entry.fileID] == nil {
			fileToEntities[entry.fileID] = map[string]bool{}
		}
		for _, name := range entry.entities {
			fileToEntities[entry.fileID][name] = true
		}
	}

	seenGroups := map[string]bool{}
	var groups [][]int64
	for _, entry := range entries {
		for _, name := range entry.entities {
			candidates := entityToFiles[name]
			if len(candidates) < minGroupSize {
				continue
			}
			groupSet := map[int64]bool{}
			for _, fid := range candidates {
				groupSet[fid] = true
			}
			for otherName := range fileToEntities[entry.fileID] {
				for _, fid := range entityToFiles[otherName] {
					groupSet[fid] = true
				}
			}
			var group []int64
			for fid := range groupSet {
				group = append(group, fid)
			}
			if len(group) < minGroupSize {
				continue
			}
			key := groupKey(group)
			if seenGroups[key] {
				continue
			}
			seenGroups[key] = true
			groups = append(groups, group)
			if len(groups) >= topGroups {
				return groups, nil
			}
		}
	}
	return groups, nil
}

func groupKey(group []int64) string {
	ids := append([]int64{}, group...)
	sortInt64s(ids)
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = fmt.Sprintf("%d", id)
	}
	return strings.Join(parts, ",")
}

func sortInt64s(values []int64) {
	for i := 0; i < len(values); i++ {
		for j := i + 1; j < len(values); j++ {
			if values[i] > values[j] {
				values[i], values[j] = values[j], values[i]
			}
		}
	}
}

// LogRecordingContextAuditDiscoverySummary 将发现结果写入日志，便于审计追踪。
// DiscoverRecentRecordingContextAuditCases 回退发现：取最近有洞察结果的非主 case 录音。
func DiscoverRecentRecordingContextAuditCases(ctx context.Context, eid, userID int64, excludeFileIDs []int64, limit int) ([]int64, error) {
	excluded := make(map[int64]bool, len(excludeFileIDs))
	for _, id := range excludeFileIDs {
		excluded[id] = true
	}
	var files []model.File
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND type = ? AND is_deleted = ? AND origin_type IN ? AND parsing_status = ? AND insight_summary != ''",
			eid, model.FILE_TYPE_FILE, false, model.RecordingOriginTypes(), "normal").
		Order("created_time DESC").
		Limit(200).
		Find(&files).Error; err != nil {
		return nil, err
	}
	var result []int64
	for _, file := range files {
		if excluded[file.ID] {
			continue
		}
		result = append(result, file.ID)
		if len(result) >= limit {
			break
		}
	}
	return result, nil
}

func LogRecordingContextAuditDiscoverySummary(ctx context.Context, groups [][]int64) {
	logger.Infof(ctx, "【ContextAudit】发现连续性会议组 %d 个", len(groups))
	for i, group := range groups {
		logger.Infof(ctx, "【ContextAudit】group-%d: %v", i+1, group)
	}
}
