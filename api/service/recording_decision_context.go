package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const recordingMemoryV2ProjectionVersion = "graphiti-compatible-v1"

const recordingMemoryV2ShadowEnabledEnv = "RECORDING_MEMORY_V2_SHADOW_ENABLED"

// recordingMemoryV2ShadowEnabled 是部署级灰度开关。
// 未设置时默认开启以保持本迭代的观察能力；关闭只停止新调度，不删除已有 shadow/evaluation。
func recordingMemoryV2ShadowEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(recordingMemoryV2ShadowEnabledEnv))) {
	case "0", "false", "off", "disabled", "no":
		return false
	default:
		return true
	}
}

// RecordingDecisionContextPackage 是当前会议洞察使用的统一上下文契约。
// 它把当前事实、已确认认知和历史业务记忆放在同一份可审计包中，但不改变
// 现有 Prompt 4 的主召回策略；Memory V2 只通过 ShadowEvaluation 观察。
type RecordingDecisionContextPackage struct {
	CurrentContext RecordingDecisionCurrentContext   `json:"current_context"`
	Cognitions     *RecordingCognitionContextPackage `json:"cognitions"`
	BusinessMemory RecordingDecisionBusinessMemory   `json:"business_memory"`
	EvidencePolicy RecordingDecisionEvidencePolicy   `json:"evidence_policy"`
	OmittedReasons []string                          `json:"omitted_reasons"`
	QueryPlan      RecordingDecisionQueryPlan        `json:"query_plan"`
	RuntimeContext *RecordingDecisionRuntimeContext  `json:"runtime_context,omitempty"`
	BuiltAtUnix    int64                             `json:"built_at_unix"`
}

type RecordingDecisionCurrentContext struct {
	FileID              int64                    `json:"file_id"`
	Generation          int64                    `json:"generation"`
	MinutesHash         string                   `json:"minutes_hash"`
	PrimaryScene        string                   `json:"primary_scene,omitempty"`
	SecondaryDomains    []string                 `json:"secondary_domains,omitempty"`
	Topics              []string                 `json:"topics,omitempty"`
	SegmentIDs          []string                 `json:"segment_ids"`
	Claims              []CurrentMeetingClaim    `json:"claims"`
	Entities            []CurrentMeetingEntity   `json:"entities"`
	Relations           []CurrentMeetingRelation `json:"relations"`
	ClaimEntityBindings []CurrentMeetingBinding  `json:"claim_entity_bindings"`
}

type RecordingDecisionBusinessMemory struct {
	Items []RecordingDecisionMemoryItem `json:"items"`
}

type RecordingDecisionMemoryItem struct {
	MemoryID          int64    `json:"memory_id"`
	Kind              string   `json:"kind"`
	Content           string   `json:"content"`
	AssertionState    string   `json:"assertion_state"`
	LifecycleState    string   `json:"lifecycle_state"`
	ReviewState       string   `json:"review_state"`
	SourceFileID      int64    `json:"source_file_id"`
	SourceFile        string   `json:"source_file"`
	SourceConfidence  float64  `json:"source_confidence"`
	EvidenceAvailable bool     `json:"evidence_available"`
	SourceSegmentIDs  []string `json:"source_segment_ids"`
	RecallPath        []string `json:"recall_path"`
	StructuredLinks   string   `json:"structured_links,omitempty"`
}

type RecordingDecisionEvidencePolicy struct {
	CurrentFactsFirst     bool `json:"current_facts_first"`
	RequireSourceSegments bool `json:"require_source_segments"`
	MaxRelationHops       int  `json:"max_relation_hops"`
	MemoryV2ShadowOnly    bool `json:"memory_v2_shadow_only"`
}

// RecordingMemoryV2EvaluationView 是灰度观察接口的稳定返回契约。
// 它只暴露召回对照指标，不暴露 shadow 内部投影或跨文件内容。
type RecordingMemoryV2EvaluationView struct {
	InsightGeneration     int64  `json:"insight_generation"`
	ProjectionVersion     string `json:"projection_version"`
	BaselineCount         int    `json:"baseline_count"`
	V2Count               int    `json:"v2_count"`
	OverlapCount          int    `json:"overlap_count"`
	BaselineOnlyCount     int    `json:"baseline_only_count"`
	V2OnlyCount           int    `json:"v2_only_count"`
	BaselineEvidenceCount int    `json:"baseline_evidence_count"`
	V2EvidenceCount       int    `json:"v2_evidence_count"`
	DurationMs            int64  `json:"duration_ms"`
	Status                string `json:"status"`
	CreatedAtUnix         int64  `json:"created_at_unix"`
}

// RecordingDecisionContextResult 同时保留内部对象，供现有洞察链路继续使用；
// Public 是默认可供调试接口返回的脱敏/稳定契约。
type RecordingDecisionContextResult struct {
	Public         *RecordingDecisionContextPackage
	Current        *CurrentMeetingContext
	Cognitions     *RecordingCognitionContextPackage
	History        []historyMeeting
	OmittedReasons []string
}

// BuildRecordingDecisionContext 统一组装当前事实、认知和历史业务记忆。
// currentContext 可复用生成流程已验证过的快照；传 nil 时由 builder 读取纪要构建。
func BuildRecordingDecisionContext(ctx context.Context, eid, userID, fileID, generation int64, memCfg *model.MemoryExtractionConfig, currentContext *CurrentMeetingContext) (*RecordingDecisionContextResult, error) {
	if _, err := GetAccessibleRecordingFile(ctx, eid, userID, fileID, false); err != nil {
		return nil, err
	}
	if currentContext == nil {
		var err error
		currentContext, err = buildCurrentMeetingContext(ctx, eid, fileID, generation)
		if err != nil {
			return nil, err
		}
	} else if err := currentContext.VerifyCurrentMinutes(eid, fileID); err != nil {
		return nil, err
	}

	cognitions, err := LoadApplicableRecordingCognition(ctx, eid, userID, currentContext)
	if err != nil {
		return nil, err
	}
	history := loadRelatedInsightHistoryWithContext(ctx, eid, fileID, userID, memCfg, currentContext)
	omittedReasons := make([]string, 0, 3)
	if len(history) >= 8 {
		omittedReasons = append(omittedReasons, "历史业务记忆达到当前上下文上限，仅保留高相关项")
	}
	var pendingCandidates int64
	if err := model.DB.WithContext(ctx).Model(&model.RecordingCognitionCandidate{}).
		Where("eid = ? AND owner_id = ? AND file_id = ? AND status = ?", eid, userID, fileID, recordingCognitionCandidateStatusPending).
		Count(&pendingCandidates).Error; err == nil && pendingCandidates > 0 {
		omittedReasons = append(omittedReasons, "本次会议仍有未确认的认知候选，未进入正式认知上下文")
	}
	public := &RecordingDecisionContextPackage{
		CurrentContext: RecordingDecisionCurrentContext{
			FileID: fileID, Generation: generation, MinutesHash: currentContext.MinutesHash,
			PrimaryScene: currentContext.PrimaryScene, SecondaryDomains: append([]string{}, currentContext.SecondaryDomains...), Topics: append([]string{}, currentContext.Topics...),
			SegmentIDs: append([]string{}, currentContext.SegmentIDs...), Claims: append([]CurrentMeetingClaim{}, currentContext.Claims...),
			Entities: append([]CurrentMeetingEntity{}, currentContext.Entities...), Relations: append([]CurrentMeetingRelation{}, currentContext.Relations...),
			ClaimEntityBindings: append([]CurrentMeetingBinding{}, currentContext.ClaimEntityBindings...),
		},
		Cognitions:     cognitions,
		BusinessMemory: RecordingDecisionBusinessMemory{Items: flattenDecisionMemory(history)},
		EvidencePolicy: RecordingDecisionEvidencePolicy{
			CurrentFactsFirst: true, RequireSourceSegments: true, MaxRelationHops: 1, MemoryV2ShadowOnly: true,
		},
		OmittedReasons: omittedReasons,
		BuiltAtUnix:    time.Now().UnixMilli(),
	}
	public.QueryPlan = BuildRecordingDecisionQueryPlan(RecordingDecisionQueryPlanInput{UserID: userID, Current: currentContext})
	if audit, auditErr := BuildRecordingDecisionContextAuditPackage(eid, userID, fileID, &RecordingDecisionContextResult{Public: public, OmittedReasons: omittedReasons}); auditErr == nil {
		if runtime, runtimeErr := CompileRecordingDecisionRuntimeContext(audit); runtimeErr == nil {
			public.RuntimeContext = runtime
		}
	}
	return &RecordingDecisionContextResult{Public: public, Current: currentContext, Cognitions: cognitions, History: history, OmittedReasons: omittedReasons}, nil
}

func flattenDecisionMemory(history []historyMeeting) []RecordingDecisionMemoryItem {
	items := make([]RecordingDecisionMemoryItem, 0)
	for _, meeting := range history {
		for _, memory := range meeting.Memories {
			items = append(items, RecordingDecisionMemoryItem{
				MemoryID: memory.MemoryID, Kind: memory.Kind, Content: memory.Content, AssertionState: memory.AssertionState,
				LifecycleState: memory.LifecycleState, ReviewState: memory.ReviewState, SourceFileID: memory.SourceFileID,
				SourceFile: memory.SourceFile, SourceConfidence: memory.SourceConfidence, EvidenceAvailable: memory.EvidenceAvailable,
				SourceSegmentIDs: append([]string{}, memory.SourceSegmentIDs...), RecallPath: append([]string{}, memory.RecallPath...), StructuredLinks: memory.StructuredLinks,
			})
		}
	}
	return items
}

func FormatRecordingDecisionContext(result *RecordingDecisionContextResult) string {
	if result == nil || result.Public == nil {
		return ""
	}
	encoded, err := json.Marshal(result.Public)
	if err != nil {
		return ""
	}
	return "<decision_context>\n" + string(encoded) + "\n</decision_context>"
}

// GetLatestRecordingMemoryV2Evaluation 返回当前文件最近一次 shadow 对照结果。
// 没有生成过评估时返回 nil,nil，调用方可以把它解释为“尚未观察”，而不是失败。
func GetLatestRecordingMemoryV2Evaluation(ctx context.Context, eid, userID, fileID int64) (*RecordingMemoryV2EvaluationView, error) {
	if _, err := GetAccessibleRecordingFile(ctx, eid, userID, fileID, false); err != nil {
		return nil, err
	}
	var row model.RecordingMemoryV2Evaluation
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ? AND file_id = ?", eid, userID, fileID).
		Order("insight_generation desc, id desc").First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &RecordingMemoryV2EvaluationView{
		InsightGeneration:     row.InsightGeneration,
		ProjectionVersion:     row.ProjectionVersion,
		BaselineCount:         row.BaselineCount,
		V2Count:               row.V2Count,
		OverlapCount:          row.OverlapCount,
		BaselineOnlyCount:     row.BaselineOnlyCount,
		V2OnlyCount:           row.V2OnlyCount,
		BaselineEvidenceCount: row.BaselineEvidenceCount,
		V2EvidenceCount:       row.V2EvidenceCount,
		DurationMs:            row.DurationMs,
		Status:                row.Status,
		CreatedAtUnix:         row.CreatedTime,
	}, nil
}

type recordingMemoryV2Node struct {
	ID               string   `json:"id"`
	NodeType         string   `json:"node_type"`
	Content          string   `json:"content"`
	ValidFrom        int64    `json:"valid_from"`
	ValidUntil       int64    `json:"valid_until"`
	SourceFileID     int64    `json:"source_file_id"`
	SourceSegmentIDs []string `json:"source_segment_ids"`
}

type recordingMemoryV2Edge struct {
	From             string   `json:"from"`
	To               string   `json:"to"`
	RelationType     string   `json:"relation_type"`
	SourceFileID     int64    `json:"source_file_id"`
	SourceSegmentIDs []string `json:"source_segment_ids"`
}

type recordingMemoryV2Projection struct {
	Version         string                           `json:"version"`
	Eid             int64                            `json:"eid"`
	OwnerID         int64                            `json:"owner_id"`
	FileID          int64                            `json:"file_id"`
	Nodes           []recordingMemoryV2Node          `json:"nodes"`
	Edges           []recordingMemoryV2Edge          `json:"edges"`
	PermissionScope recordingMemoryV2PermissionScope `json:"permission_scope"`
}

type recordingMemoryV2PermissionScope struct {
	Eid       int64  `json:"eid"`
	OwnerID   int64  `json:"owner_id"`
	FileID    int64  `json:"file_id"`
	SourceACL string `json:"source_acl"`
}

// BuildRecordingMemoryV2Shadow 将当前结构化记忆投影为时序图兼容形态。
// 所有节点都保留来源片段和 owner/eid/file 范围，避免 shadow 变成越权事实库。
func BuildRecordingMemoryV2Shadow(ctx context.Context, eid, userID, fileID int64) (*model.RecordingMemoryV2Shadow, error) {
	if _, err := GetAccessibleRecordingFile(ctx, eid, userID, fileID, false); err != nil {
		return nil, err
	}
	var claims []model.RecordingMemoryClaim
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND file_id = ? AND is_current = ?", eid, userID, fileID, true).Find(&claims).Error; err != nil {
		return nil, err
	}
	var facts []model.RecordingMemoryFact
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND file_id = ? AND is_deleted = ?", eid, userID, fileID, false).Find(&facts).Error; err != nil {
		return nil, err
	}
	entityIDs := make([]int64, 0, len(facts))
	for _, fact := range facts {
		if fact.EntityID > 0 {
			entityIDs = append(entityIDs, fact.EntityID)
		}
	}
	var entities []model.RecordingMemoryEntity
	if len(entityIDs) > 0 {
		if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND id IN ? AND is_deleted = ?", eid, userID, entityIDs, false).Find(&entities).Error; err != nil {
			return nil, err
		}
	}
	nodes := make([]recordingMemoryV2Node, 0, len(claims)+len(facts))
	edges := make([]recordingMemoryV2Edge, 0)
	hashInput := strings.Builder{}
	for _, claim := range claims {
		segments := decodeMemorySourceSegmentIDs(claim.SourceSegmentIDs)
		nodeID := fmt.Sprintf("claim:%d", claim.ID)
		nodes = append(nodes, recordingMemoryV2Node{ID: nodeID, NodeType: "claim", Content: string(claim.Content), ValidFrom: claim.CreatedTime, ValidUntil: claim.DueAt, SourceFileID: fileID, SourceSegmentIDs: segments})
		hashInput.WriteString(fmt.Sprintf("%s\x00%s\x00%s\n", nodeID, claim.Content, strings.Join(segments, ",")))
	}
	for _, fact := range facts {
		segments := decodeMemorySourceSegmentIDs(fact.SourceSegmentIDs)
		nodeID := fmt.Sprintf("fact:%d", fact.ID)
		nodes = append(nodes, recordingMemoryV2Node{ID: nodeID, NodeType: "fact", Content: string(fact.Content), ValidFrom: fact.OccurredAt, SourceFileID: fileID, SourceSegmentIDs: segments})
		edges = append(edges, recordingMemoryV2Edge{From: fmt.Sprintf("entity:%d", fact.EntityID), To: nodeID, RelationType: "has_fact", SourceFileID: fileID, SourceSegmentIDs: segments})
		hashInput.WriteString(fmt.Sprintf("%s\x00%s\x00%s\n", nodeID, fact.Content, strings.Join(segments, ",")))
	}
	for _, entity := range entities {
		nodeID := fmt.Sprintf("entity:%d", entity.ID)
		nodes = append(nodes, recordingMemoryV2Node{ID: nodeID, NodeType: entity.EntityType, Content: entity.CanonicalName, ValidFrom: entity.FirstMentionedAt, ValidUntil: entity.LastFactAt, SourceFileID: fileID})
		hashInput.WriteString(fmt.Sprintf("%s\x00%s\n", nodeID, entity.CanonicalName))
	}
	projection := recordingMemoryV2Projection{
		Version: recordingMemoryV2ProjectionVersion, Eid: eid, OwnerID: userID, FileID: fileID, Nodes: nodes, Edges: edges,
		PermissionScope: recordingMemoryV2PermissionScope{Eid: eid, OwnerID: userID, FileID: fileID, SourceACL: "recording_file_owner_and_library_permission"},
	}
	encoded, err := json.Marshal(projection)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(hashInput.String()))
	sourceHash := hex.EncodeToString(hash[:])
	row := &model.RecordingMemoryV2Shadow{}
	query := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND file_id = ? AND source_hash = ?", eid, userID, fileID, sourceHash)
	if err := query.First(row).Error; err == nil {
		return row, nil
	} else if err != gorm.ErrRecordNotFound {
		return nil, err
	}
	row = &model.RecordingMemoryV2Shadow{Eid: eid, OwnerID: userID, FileID: fileID, SourceHash: sourceHash, ProjectionVersion: recordingMemoryV2ProjectionVersion, ProjectionJSON: model.LongText(encoded), PermissionScopeJSON: model.LongText(jsonMustMarshal(projection.PermissionScope)), NodeCount: len(nodes), EdgeCount: len(edges), Status: "shadow"}
	if err := model.DB.WithContext(ctx).Create(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

// RunRecordingMemoryV2ShadowEvaluation 只记录 baseline 与 shadow 的召回差异，
// 不参与本次洞察 Prompt，也不改变现有结构化记忆的主召回结果。
func RunRecordingMemoryV2ShadowEvaluation(ctx context.Context, eid, userID, fileID, generation int64, memCfg *model.MemoryExtractionConfig, currentContext *CurrentMeetingContext) (*model.RecordingMemoryV2Evaluation, error) {
	started := time.Now()
	contextResult, err := BuildRecordingDecisionContext(ctx, eid, userID, fileID, generation, memCfg, currentContext)
	if err != nil {
		return nil, err
	}
	baseline := flattenDecisionMemory(contextResult.History)
	baselineIDs := make(map[int64]struct{}, len(baseline))
	for _, item := range baseline {
		baselineIDs[item.MemoryID] = struct{}{}
	}
	shadowIDs := make(map[int64]struct{})
	v2Evidence := 0
	for _, meeting := range contextResult.History {
		shadow, shadowErr := BuildRecordingMemoryV2Shadow(ctx, eid, userID, meeting.FileID)
		if shadowErr != nil {
			continue
		}
		var projection recordingMemoryV2Projection
		if json.Unmarshal([]byte(shadow.ProjectionJSON), &projection) != nil {
			continue
		}
		for _, node := range projection.Nodes {
			for _, entityName := range contextResult.Current.RecallEntityNames() {
				if strings.Contains(strings.ToLower(node.Content), strings.ToLower(entityName)) {
					if strings.HasPrefix(node.ID, "claim:") {
						var id int64
						_, _ = fmt.Sscanf(node.ID, "claim:%d", &id)
						if id > 0 {
							shadowIDs[id] = struct{}{}
						}
					}
					if len(node.SourceSegmentIDs) > 0 {
						v2Evidence++
					}
					break
				}
			}
		}
	}
	overlap := 0
	baselineEvidence := 0
	for _, item := range baseline {
		if _, ok := shadowIDs[item.MemoryID]; ok {
			overlap++
		}
		if item.EvidenceAvailable && len(item.SourceSegmentIDs) > 0 {
			baselineEvidence++
		}
	}
	resultJSON := jsonMustMarshal(map[string]interface{}{"baseline_memory_ids": sortedInt64Keys(baselineIDs), "v2_memory_ids": sortedInt64Keys(shadowIDs), "evidence_policy": contextResult.Public.EvidencePolicy, "omitted_reasons": contextResult.OmittedReasons})
	evaluation := &model.RecordingMemoryV2Evaluation{Eid: eid, OwnerID: userID, FileID: fileID, InsightGeneration: generation, QueryHash: contextResult.Current.MinutesHash, ProjectionVersion: recordingMemoryV2ProjectionVersion, BaselineCount: len(baselineIDs), V2Count: len(shadowIDs), OverlapCount: overlap, BaselineOnlyCount: len(baselineIDs) - overlap, V2OnlyCount: len(shadowIDs) - overlap, BaselineEvidenceCount: baselineEvidence, V2EvidenceCount: v2Evidence, DurationMs: time.Since(started).Milliseconds(), ResultJSON: model.LongText(resultJSON), Status: "shadow"}
	if err := model.DB.WithContext(ctx).Create(evaluation).Error; err != nil {
		return nil, err
	}
	logger.Infof(ctx, "【Memory V2 shadow】评估完成 fileID=%d baseline=%d v2=%d overlap=%d", fileID, evaluation.BaselineCount, evaluation.V2Count, evaluation.OverlapCount)
	return evaluation, nil
}

func jsonMustMarshal(value interface{}) []byte { encoded, _ := json.Marshal(value); return encoded }

func sortedInt64Keys(values map[int64]struct{}) []int64 {
	result := make([]int64, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	for i := 0; i < len(result); i++ {
		for j := i + 1; j < len(result); j++ {
			if result[j] < result[i] {
				result[i], result[j] = result[j], result[i]
			}
		}
	}
	return result
}
