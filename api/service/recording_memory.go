package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	jsonrepair "github.com/aichy126/json_repair"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	recordingMemoryReviewPending           = "pending"
	recordingMemoryReviewConfirmed         = "confirmed"
	recordingMemoryReviewIgnored           = "ignored"
	recordingMemoryLifecycleOpen           = "open"
	recordingMemoryLifecycleDone           = "fulfilled"
	recordingMemoryLifecycleCancel         = "cancelled"
	recordingMemorySourceInsightBackground = "insight_background"
	recordingMemorySourceUserConfirmed     = "user_confirmed_context"
	recordingMemoryMinSourceConfidence     = 0.6
)

var ErrRecordingMemoryForbidden = errors.New("recording memory is not visible")

// meetingMemoryContext 是 Prompt 4 使用的稳定上下文，不直接把数据库行塞给模型。
type meetingMemoryContext struct {
	MemoryID          int64
	Kind              string
	Content           string
	RecallReason      string
	AssertionState    string
	LifecycleState    string
	ReviewState       string
	SourceFileID      int64
	SourceFile        string
	SourceConfidence  float64
	EvidenceAvailable bool
	SourceSegmentIDs  []string
	RecallPath        []string
	StructuredLinks   string
}

// RecordingMemoryOverview 是安心录首页需要的聚合数据。
type RecordingMemoryOverview struct {
	Stats RecordingMemoryStats       `json:"stats"`
	Items []RecordingMemoryClaimView `json:"items"`
	Kinds []RecordingMemoryKindCount `json:"kinds"`
}

type RecordingMemoryStats struct {
	TotalClaims        int64 `json:"total_claims"`
	SourceMeetings     int64 `json:"source_meetings"`
	ConfirmedDecisions int64 `json:"confirmed_decisions"`
	ActiveCommitments  int64 `json:"active_commitments"`
	ActiveRisks        int64 `json:"active_risks"`
	NeedsConfirmation  int64 `json:"needs_confirmation"`
	EvidenceCoverage   int64 `json:"evidence_coverage"`
	UncompiledMeetings int64 `json:"uncompiled_meetings"`
}

type RecordingMemoryKindCount struct {
	Kind  string `json:"kind"`
	Count int64  `json:"count"`
}

type RecordingMemoryClaimView struct {
	ID                 int64   `json:"id"`
	FileID             int64   `json:"file_id"`
	ClaimKind          string  `json:"claim_kind"`
	Content            string  `json:"content"`
	AssertionState     string  `json:"assertion_state"`
	EpistemicType      string  `json:"epistemic_type"`
	LifecycleState     string  `json:"lifecycle_state"`
	ReviewState        string  `json:"review_state"`
	SourceConfidence   float64 `json:"source_confidence"`
	EvidenceAvailable  bool    `json:"evidence_available"`
	SourceSegmentCount int     `json:"source_segment_count"`
	SourceFile         string  `json:"source_file"`
	UpdatedTime        int64   `json:"updated_time"`
}

type RecordingMemoryService struct {
	eid int64
}

type recordingMemoryReadiness struct {
	Claims   int64
	Entities int64
	Facts    int64
}

func NewRecordingMemoryService(eid int64) *RecordingMemoryService {
	return &RecordingMemoryService{eid: eid}
}

func loadRecordingMemorySourceFile(ctx context.Context, eid, fileID int64) (*model.File, error) {
	var file model.File
	if err := model.DB.WithContext(ctx).Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

func recordingMemoryExtractionEnabled(config *model.RecordingConfig) bool {
	if config == nil {
		return false
	}
	memCfg := config.MemoryExtraction
	if memCfg == nil {
		memCfg = &model.MemoryExtractionConfig{
			Enabled: true,
			Types:   []string{model.EntityTypePerson, model.EntityTypeMatter, model.EntityTypeRisk, model.EntityTypePrinciple},
		}
	}
	return memCfg.IsEffectivelyEnabled()
}

// CompileRecordingMemory 将当前纪要的显式结构化条目编译为 Claim。
// 同一纪要哈希重复编译幂等；纪要重生成时旧版本保留但不再是当前版本。
func CompileRecordingMemory(ctx context.Context, eid, fileID, ownerID int64) (int, error) {
	file, err := loadRecordingMemorySourceFile(ctx, eid, fileID)
	if err != nil {
		return 0, err
	}
	if !file.IsRecordingOriginType() {
		logger.Infof(ctx, "【会议记忆】跳过非录音来源 fileID=%d originType=%s", fileID, file.OriginType)
		return 0, nil
	}
	if !model.IsRecordingMemoryExtractionEnabled(eid) {
		return 0, nil
	}
	return compileRecordingMemory(ctx, eid, fileID, ownerID)
}

func compileRecordingMemory(ctx context.Context, eid, fileID, ownerID int64) (int, error) {
	raw, err := loadRecordingMemorySource(eid, fileID)
	if err != nil {
		return 0, err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}

	var items []recordingMemoryItem
	switch classifyRecordingContent(raw) {
	case recordingContentMinutesJSON:
		// 历史数据：纪要 JSON → 结构化条目编译（决策/行动/风险等）
		minutes, perr := parseRecordingMemoryMinutes(raw)
		if perr != nil {
			return 0, perr
		}
		items = buildRecordingMemoryItems(minutes)
	default:
		// 新布局：转写 Markdown（或转写 JSON 渲染后）→ 陈述型 Claim（D2，与管线同源）
		md := raw
		if classifyRecordingContent(raw) == recordingContentTranscriptJSON {
			if rendered, rerr := RenderTranscriptMarkdown(raw, ""); rerr == nil && rendered != "" {
				md = rendered
			}
		}
		items = buildRecordingStatementClaims(md)
	}

	hashBytes := sha256.Sum256([]byte(raw))
	minutesHash := hex.EncodeToString(hashBytes[:])

	result := 0
	err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing int64
		if err := tx.Model(&model.RecordingMemoryClaim{}).
			Where("eid = ? AND owner_id = ? AND file_id = ? AND minutes_hash = ?", eid, ownerID, fileID, minutesHash).
			Count(&existing).Error; err != nil {
			return err
		}

		if err := tx.Model(&model.RecordingMemoryClaim{}).
			Where("eid = ? AND owner_id = ? AND file_id = ? AND source_item_type NOT IN ?", eid, ownerID, fileID, []string{recordingMemorySourceInsightBackground, recordingMemorySourceUserConfirmed}).
			Updates(map[string]interface{}{"is_current": false}).Error; err != nil {
			return err
		}

		if existing > 0 {
			return tx.Model(&model.RecordingMemoryClaim{}).
				Where("eid = ? AND owner_id = ? AND file_id = ? AND minutes_hash = ?", eid, ownerID, fileID, minutesHash).
				Updates(map[string]interface{}{"is_current": true}).Error
		}

		for _, item := range items {
			claim := &model.RecordingMemoryClaim{
				Eid:                eid,
				OwnerID:            ownerID,
				FileID:             fileID,
				MinutesHash:        minutesHash,
				SourceItemType:     item.sourceItemType,
				SourceItemID:       item.sourceItemID,
				SourceKeyHash:      item.sourceKeyHash,
				ClaimKind:          item.claimKind,
				Content:            model.LongText(item.content),
				DetailJSON:         model.LongText(item.detailJSON),
				AssertionState:     item.assertionState,
				EpistemicType:      item.epistemicType,
				LifecycleState:     item.lifecycleState,
				ReviewState:        item.reviewState,
				SourceConfidence:   item.sourceConfidence,
				EvidenceAvailable:  item.evidenceAvailable,
				SourceSegmentCount: len(item.sourceSegmentIDs),
				SourceSegmentIDs:   model.LongText(item.sourceSegmentJSON),
				DueAt:              item.dueAt,
				IsCurrent:          true,
				Version:            1,
			}
			if err := tx.Create(claim).Error; err != nil {
				return err
			}
			result++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}

	logger.Infof(ctx, "【会议记忆】编译完成 eid=%d fileID=%d claims=%d", eid, fileID, result)
	return result, nil
}

// ensureRecordingMemoryReady 在每次洞察生成前幂等编译纪要 Claim 与实体事实。
// 它不依赖通用 RAG 实体任务，因此手动重跑和自动链路都不会因并发时序丢失会议记忆。
func ensureRecordingMemoryReady(ctx context.Context, eid, fileID, ownerID int64) (recordingMemoryReadiness, error) {
	ready := recordingMemoryReadiness{}
	file, err := loadRecordingMemorySourceFile(ctx, eid, fileID)
	if err != nil {
		return ready, err
	}
	if !file.IsRecordingOriginType() {
		return ready, nil
	}
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		return ready, err
	}
	if !recordingMemoryExtractionEnabled(config) {
		return ready, nil
	}
	if _, err := CompileRecordingMemory(ctx, eid, fileID, ownerID); err != nil {
		return ready, err
	}
	if _, err := CompileRecordingEntityMemory(ctx, eid, fileID, ownerID); err != nil {
		return ready, err
	}
	if _, err := CompileRecordingCognitionCandidates(ctx, eid, fileID, ownerID); err != nil {
		logger.Warnf(ctx, "【老板认知】候选编译失败，继续使用现有会议记忆: fileID=%d err=%v", fileID, err)
	}
	if err := model.DB.WithContext(ctx).Model(&model.RecordingMemoryClaim{}).
		Where("eid = ? AND owner_id = ? AND file_id = ? AND is_current = ?", eid, ownerID, fileID, true).
		Count(&ready.Claims).Error; err != nil {
		return ready, err
	}
	if err := model.DB.WithContext(ctx).Model(&model.RecordingMemoryFact{}).
		Distinct("entity_id").
		Where("eid = ? AND owner_id = ? AND file_id = ? AND is_deleted = ?", eid, ownerID, fileID, false).
		Count(&ready.Entities).Error; err != nil {
		return ready, err
	}
	if err := model.DB.WithContext(ctx).Model(&model.RecordingMemoryFact{}).
		Where("eid = ? AND owner_id = ? AND file_id = ? AND is_deleted = ?", eid, ownerID, fileID, false).
		Count(&ready.Facts).Error; err != nil {
		return ready, err
	}
	logger.Infof(ctx, "【洞察-记忆就绪】fileID=%d ownerID=%d claims=%d entities=%d facts=%d", fileID, ownerID, ready.Claims, ready.Entities, ready.Facts)
	return ready, nil
}

// CompileRecordingExternalConstraintsMemory 将用户显式确认的“补充背景”升级为
// 可追溯的 user_confirmed_context。普通重生成不会调用它；个人、企业和动态历史
// 背景不会通过此入口落为长期记忆。
func CompileRecordingExternalConstraintsMemory(ctx context.Context, eid, fileID, ownerID int64, background InsightBackground) error {
	text := strings.TrimSpace(background.ExternalConstraints)
	if text == "" {
		return nil
	}
	content := "补充背景（用户已确认）：" + text
	hash := sha256.Sum256([]byte(content))
	detail, err := json.Marshal(persistedInsightBackground(background))
	if err != nil {
		return err
	}
	return model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.RecordingMemoryClaim{}).
			Where("eid = ? AND owner_id = ? AND file_id = ? AND source_item_type = ?", eid, ownerID, fileID, recordingMemorySourceUserConfirmed).
			Updates(map[string]interface{}{"is_current": false}).Error; err != nil {
			return err
		}
		claim := &model.RecordingMemoryClaim{
			Eid: eid, OwnerID: ownerID, FileID: fileID,
			MinutesHash: hex.EncodeToString(hash[:]), SourceItemType: recordingMemorySourceUserConfirmed,
			SourceItemID: "external_constraints", SourceKeyHash: hex.EncodeToString(hash[:]),
			ClaimKind: "background", Content: model.LongText(content), DetailJSON: model.LongText(detail),
			AssertionState: "user_confirmed", EpistemicType: "user_context", LifecycleState: recordingMemoryLifecycleOpen,
			ReviewState: recordingMemoryReviewConfirmed, SourceConfidence: 1, EvidenceAvailable: true,
			SourceSegmentIDs: model.LongText("[]"), IsCurrent: true, Version: 1,
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "eid"}, {Name: "owner_id"}, {Name: "file_id"}, {Name: "minutes_hash"}, {Name: "source_key_hash"}},
			DoUpdates: clause.AssignmentColumns([]string{"content", "detail_json", "assertion_state", "epistemic_type", "review_state", "source_confidence", "evidence_available", "is_current", "updated_time"}),
		}).Create(claim).Error
	})
}

type recordingMemoryItem struct {
	sourceItemType    string
	sourceItemID      string
	sourceKeyHash     string
	claimKind         string
	content           string
	detailJSON        string
	assertionState    string
	epistemicType     string
	lifecycleState    string
	reviewState       string
	sourceConfidence  float64
	evidenceAvailable bool
	sourceSegmentIDs  []string
	sourceSegmentJSON string
	dueAt             int64
}

func parseRecordingMemoryMinutes(raw string) (map[string]interface{}, error) {
	cleaned := strings.TrimPrefix(extractJSON(strings.TrimSpace(raw)), "\ufeff")
	var minutes map[string]interface{}
	if err := json.Unmarshal([]byte(cleaned), &minutes); err == nil {
		return minutes, nil
	} else {
		if repaired, repairErr := jsonrepair.RepairJSON(cleaned); repairErr == nil {
			if err := json.Unmarshal([]byte(repaired), &minutes); err == nil {
				return minutes, nil
			}
		}
		return nil, fmt.Errorf("parse meeting minutes: %w", err)
	}
}

func recordingMemoryStructuredLinks(detail model.LongText) string {
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(detail), &payload); err != nil {
		return "{}"
	}
	links, ok := payload["structured_links"]
	if !ok {
		return "{}"
	}
	encoded, err := json.Marshal(links)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func recordingMemoryRecallPath(detail model.LongText) []string {
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(detail), &payload); err != nil {
		return nil
	}
	links, ok := payload["structured_links"].(map[string]interface{})
	if !ok {
		return nil
	}
	path := []string{"claim"}
	if bindings, ok := links["claim_entity_bindings"].([]interface{}); ok && len(bindings) > 0 {
		path = append(path, "claim_entity_binding")
	}
	if relations, ok := links["memory_relations"].([]interface{}); ok && len(relations) > 0 {
		path = append(path, "relation")
	}
	return path
}

func buildRecordingMemoryItems(minutes map[string]interface{}) []recordingMemoryItem {
	definitions := []struct {
		key  string
		kind string
	}{
		{"decisions", "decision"},
		{"commitments", "commitment"},
		{"actions", "action"},
		{"risks", "risk"},
		{"opportunities", "opportunity"},
		{"viewpoints", "viewpoint"},
		{"issues", "issue"},
		{"open_questions", "open_question"},
		{"key_quotes", "quote"},
	}

	items := make([]recordingMemoryItem, 0)
	seenSourceKeys := make(map[string]int)
	for _, definition := range definitions {
		rows, ok := minutes[definition.key].([]interface{})
		if !ok {
			continue
		}
		for _, raw := range rows {
			row, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			content := memoryItemContent(definition.kind, row)
			if content == "" {
				continue
			}
			segmentIDs := memorySourceSegmentIDs(row["source_segment_ids"])
			itemID := recordingMemoryClaimTempID(definition.kind, row)
			sourceKey := definition.key + "|" + itemID
			occurrence := seenSourceKeys[sourceKey]
			seenSourceKeys[sourceKey] = occurrence + 1
			keyHash := sha256.Sum256([]byte(fmt.Sprintf("%s|%d", sourceKey, occurrence)))
			detail, _ := json.Marshal(row)
			rawConfidence, hasConfidence := row["confidence"]
			confidence, _ := rawConfidence.(float64)
			if confidence == 0 {
				if sourceConfidence, ok := row["source_confidence"]; ok {
					rawConfidence, hasConfidence = sourceConfidence, true
					confidence, _ = rawConfidence.(float64)
				}
			}
			if hasConfidence && confidence < recordingMemoryMinSourceConfidence {
				continue
			}
			status := strings.ToLower(strings.TrimSpace(stringValue(row["status"])))
			assertion := memoryAssertionState(definition.kind, status)
			evidence := len(segmentIDs) > 0
			item := recordingMemoryItem{
				sourceItemType:    definition.key,
				sourceItemID:      itemID,
				sourceKeyHash:     hex.EncodeToString(keyHash[:]),
				claimKind:         definition.kind,
				content:           content,
				detailJSON:        string(detail),
				assertionState:    assertion,
				epistemicType:     memoryEpistemicType(assertion, evidence),
				lifecycleState:    memoryLifecycleState(status),
				reviewState:       memoryReviewState(assertion, evidence),
				sourceConfidence:  confidence,
				evidenceAvailable: evidence,
				sourceSegmentIDs:  segmentIDs,
				dueAt:             parseMemoryDueAt(row),
			}
			segmentJSON, _ := json.Marshal(segmentIDs)
			item.sourceSegmentJSON = string(segmentJSON)
			items = append(items, item)
		}
	}
	return attachRecordingMemoryStructuredLinks(items, minutes)
}

func recordingMemoryClaimTempID(kind string, row map[string]interface{}) string {
	if id := strings.TrimSpace(stringValue(row["id"])); id != "" {
		return id
	}
	seed := kind + "|" + memoryItemContent(kind, row)
	hash := sha256.Sum256([]byte(seed))
	return "content-" + hex.EncodeToString(hash[:])[:24]
}

// attachRecordingMemoryStructuredLinks keeps Prompt 2 relations and claim
// bindings inside the existing versioned Claim detail JSON. This is a
// migration-free compatibility layer: T07 can validate and expose the links
// now, while a future schema task may promote them to first-class tables.
func attachRecordingMemoryStructuredLinks(items []recordingMemoryItem, minutes map[string]interface{}) []recordingMemoryItem {
	claimIDs := make(map[string]struct{}, len(items))
	claimSegments := make(map[string][]string, len(items))
	for _, item := range items {
		claimIDs[item.sourceItemID] = struct{}{}
		claimSegments[item.sourceItemID] = item.sourceSegmentIDs
	}
	bindings, relations := validatedRecordingMemoryLinks(minutes, claimIDs, claimSegments)
	if len(bindings) == 0 && len(relations) == 0 {
		return items
	}
	for index := range items {
		var detail map[string]interface{}
		if err := json.Unmarshal([]byte(items[index].detailJSON), &detail); err != nil {
			continue
		}
		links := map[string]interface{}{}
		matchingBindings := make([]interface{}, 0)
		for _, binding := range bindings {
			if strings.TrimSpace(stringValue(binding["claim_temp_id"])) == items[index].sourceItemID {
				matchingBindings = append(matchingBindings, binding)
			}
		}
		if len(matchingBindings) > 0 {
			links["claim_entity_bindings"] = matchingBindings
		}
		matchingRelations := make([]interface{}, 0)
		for _, relation := range relations {
			relationSegments := memorySourceSegmentIDs(relation["source_segment_ids"])
			if len(relationSegments) > 0 && hasAnyString(items[index].sourceSegmentIDs, relationSegments...) {
				matchingRelations = append(matchingRelations, relation)
			}
		}
		if len(matchingRelations) > 0 {
			links["memory_relations"] = matchingRelations
		}
		if len(links) == 0 {
			continue
		}
		detail["structured_links"] = links
		encoded, err := json.Marshal(detail)
		if err == nil {
			items[index].detailJSON = string(encoded)
		}
	}
	return items
}

// validatedRecordingMemoryLinks is the migration-free schema gate for the
// relation/binding arrays emitted by Prompt 2. It rejects guessed IDs and
// dangling evidence before links can enter Claim detail JSON or retrieval.
func validatedRecordingMemoryLinks(minutes map[string]interface{}, claimIDs map[string]struct{}, claimSegments map[string][]string) (bindings, relations []map[string]interface{}) {
	entityIDs := recordingMemoryEntityTempIDs(minutes)
	knownSegments := recordingMemoryKnownSegmentIDs(minutes)

	for _, raw := range interfaceSlice(minutes["claim_entity_bindings"]) {
		binding, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		claimID := strings.TrimSpace(stringValue(binding["claim_temp_id"]))
		entityID := strings.TrimSpace(stringValue(binding["entity_temp_id"]))
		role := strings.TrimSpace(stringValue(binding["role"]))
		segments := memorySourceSegmentIDs(binding["source_segment_ids"])
		if claimID == "" || entityID == "" || role == "" || len(segments) == 0 {
			continue
		}
		if _, ok := claimIDs[claimID]; !ok {
			continue
		}
		if _, ok := entityIDs[entityID]; !ok || !allStringsInSet(segments, knownSegments) {
			continue
		}
		if claimEvidence := claimSegments[claimID]; len(claimEvidence) > 0 && !hasAnyString(claimEvidence, segments...) {
			continue
		}
		bindings = append(bindings, binding)
	}

	for _, raw := range interfaceSlice(minutes["memory_relations"]) {
		relation, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		fromID := firstNonEmptyString(stringValue(relation["from_entity_temp_id"]), stringValue(relation["from_temp_id"]))
		toID := firstNonEmptyString(stringValue(relation["to_entity_temp_id"]), stringValue(relation["to_temp_id"]))
		relationType := strings.TrimSpace(stringValue(relation["relation_type"]))
		segments := memorySourceSegmentIDs(relation["source_segment_ids"])
		if fromID == "" || toID == "" || relationType == "" || len(segments) == 0 {
			continue
		}
		if _, ok := entityIDs[fromID]; !ok {
			continue
		}
		if _, ok := entityIDs[toID]; !ok || !allStringsInSet(segments, knownSegments) {
			continue
		}
		relations = append(relations, relation)
	}
	return bindings, relations
}

func recordingMemoryEntityTempIDs(minutes map[string]interface{}) map[string]struct{} {
	result := make(map[string]struct{})
	for index, raw := range interfaceSlice(minutes["memory_entities"]) {
		row, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		tempID := firstNonEmptyString(stringValue(row["temp_id"]), fmt.Sprintf("entity_%d", index+1))
		result[tempID] = struct{}{}
	}
	return result
}

func recordingMemoryKnownSegmentIDs(minutes map[string]interface{}) map[string]struct{} {
	known := make(map[string]struct{})
	for _, key := range []string{"decisions", "commitments", "actions", "risks", "issues", "viewpoints"} {
		for _, raw := range interfaceSlice(minutes[key]) {
			if row, ok := raw.(map[string]interface{}); ok {
				for _, segmentID := range memorySourceSegmentIDs(row["source_segment_ids"]) {
					known[segmentID] = struct{}{}
				}
			}
		}
	}
	for _, raw := range interfaceSlice(minutes["memory_entities"]) {
		row, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		for _, segmentID := range memorySourceSegmentIDs(row["identity_policy_evidence_segment_ids"]) {
			known[segmentID] = struct{}{}
		}
		for _, rawFact := range interfaceSlice(row["facts"]) {
			if fact, ok := rawFact.(map[string]interface{}); ok {
				for _, segmentID := range memorySourceSegmentIDs(fact["source_segment_ids"]) {
					known[segmentID] = struct{}{}
				}
			}
		}
	}
	return known
}

func allStringsInSet(values []string, set map[string]struct{}) bool {
	for _, value := range values {
		if _, ok := set[value]; !ok {
			return false
		}
	}
	return true
}

func hasAnyString(left []string, right ...string) bool {
	seen := make(map[string]struct{}, len(left))
	for _, value := range left {
		seen[value] = struct{}{}
	}
	for _, value := range right {
		if _, ok := seen[value]; ok {
			return true
		}
	}
	return false
}

func memoryItemContent(kind string, row map[string]interface{}) string {
	if kind == "risk" {
		title := strings.TrimSpace(stringValue(row["title"]))
		description := strings.TrimSpace(stringValue(row["description"]))
		if title == "" {
			return description
		}
		if description == "" {
			return title
		}
		return title + "：" + description
	}
	for _, key := range []string{"content", "quote", "question", "title", "summary"} {
		if value := strings.TrimSpace(stringValue(row[key])); value != "" {
			return value
		}
	}
	return ""
}

func memoryAssertionState(kind, status string) string {
	if status != "" {
		switch status {
		case "confirmed", "proposed", "rejected", "deferred", "uncertain", "inferred":
			return status
		}
	}
	if kind == "commitment" || kind == "action" {
		return "confirmed"
	}
	return "uncertain"
}

func memoryEpistemicType(assertion string, evidence bool) string {
	if assertion == "uncertain" || !evidence {
		return "uncertain"
	}
	return "explicit"
}

func memoryReviewState(assertion string, evidence bool) string {
	if assertion == "confirmed" && evidence {
		return recordingMemoryReviewConfirmed
	}
	return recordingMemoryReviewPending
}

func memoryLifecycleState(status string) string {
	switch status {
	case "fulfilled", "completed", "resolved":
		return recordingMemoryLifecycleDone
	case "rejected", "cancelled":
		return recordingMemoryLifecycleCancel
	default:
		return recordingMemoryLifecycleOpen
	}
}

func memorySourceSegmentIDs(value interface{}) []string {
	rows, ok := value.([]interface{})
	if !ok {
		return nil
	}
	ids := make([]string, 0, len(rows))
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		id := strings.TrimSpace(stringValue(row))
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func stringValue(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return fmt.Sprintf("%.0f", typed)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func parseMemoryDueAt(row map[string]interface{}) int64 {
	if value, ok := row["due_at"].(float64); ok && value > 0 {
		return int64(value)
	}
	// 当前纪要契约允许自然语言 deadline；只解析无歧义的标准日期，其他内容保留在 detail_json。
	deadline := strings.TrimSpace(stringValue(row["deadline"]))
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"} {
		parsed, err := time.ParseInLocation(layout, deadline, time.UTC)
		if err == nil {
			return parsed.UnixMilli()
		}
	}
	return 0
}

func decodeMemorySourceSegmentIDs(raw model.LongText) []string {
	if strings.TrimSpace(string(raw)) == "" {
		return nil
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return nil
	}
	return ids
}

// loadMeetingMinutesJSON 读取当前会议快照所需的纪要 JSON（memory_entities/decisions/commitments 等结构化内容）。
// 新布局：纪要 JSON 存 Summary(template_id=0)（recording_current_context.go 依赖此读取）。
// 旧布局回退：迁移前纪要 JSON 存 FileBody（有转写摘要时），Summary(0) 缺失则兼容读取。
func loadMeetingMinutesJSON(eid, fileID int64) (string, error) {
	if summary, err := model.GetSummaryByTemplateID(fileID, 0); err == nil && summary != nil {
		return string(summary.SummaryContent), nil
	}
	if model.HasTranscriptSummary(fileID) {
		fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
		if err != nil {
			return "", err
		}
		return fileBody.GetContent()
	}
	return "", gorm.ErrRecordNotFound
}

// loadRecordingMemorySource 读取实体/会议记忆编译的内容源。
// 新布局：FileBody=转写 Markdown（与 RAG 管线同源，实体/会议记忆从转写抽取，D2）。
// 历史布局：FileBody=纪要 JSON（已反转），编译函数按内容类型分流兼容。
func loadRecordingMemorySource(eid, fileID int64) (string, error) {
	fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		return "", err
	}
	return fileBody.GetContent()
}

// WarmRecentRecordingMemories 为已有历史录音补建 Claim，限制数量避免首次启用时阻塞太久。
func WarmRecentRecordingMemories(ctx context.Context, eid, ownerID int64, limit int) {
	if limit <= 0 {
		return
	}
	if !model.IsRecordingMemoryExtractionEnabled(eid) {
		return
	}
	var files []model.File
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND user_id = ? AND type = ? AND is_deleted = ? AND origin_type IN ?", eid, ownerID, model.FILE_TYPE_FILE, false, model.RecordingOriginTypes()).
		Order("updated_time DESC, id DESC").Limit(limit).Find(&files).Error; err != nil {
		logger.Warnf(ctx, "【会议记忆】读取历史录音失败 eid=%d err=%v", eid, err)
		return
	}
	for _, file := range files {
		var count int64
		if err := model.DB.WithContext(ctx).Model(&model.RecordingMemoryClaim{}).
			Where("eid = ? AND owner_id = ? AND file_id = ? AND is_current = ?", eid, ownerID, file.ID, true).Count(&count).Error; err != nil || count > 0 {
			continue
		}
		if _, err := compileRecordingMemory(ctx, eid, file.ID, ownerID); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Warnf(ctx, "【会议记忆】历史录音编译失败 fileID=%d err=%v", file.ID, err)
		}
	}
}

func (s *RecordingMemoryService) GetOverview(ctx context.Context, userID int64, kind, keyword string, limit int) (*RecordingMemoryOverview, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	// 先确认个人录音库可见，之后所有 Claim 查询仍以 eid + owner_id + file_id 限定范围。
	library, err := NewPersonalSpaceService(s.eid).GetExistingPersonalLibrary(ctx, userID)
	if err != nil {
		return nil, err
	}
	if library == nil {
		return &RecordingMemoryOverview{Items: []RecordingMemoryClaimView{}, Kinds: []RecordingMemoryKindCount{}}, nil
	}
	permission, err := GetUserPermission(s.eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID)
	if err != nil {
		return nil, err
	}
	if permission < model.PERMISSION_VIEW_ONLY {
		return nil, ErrRecordingMemoryForbidden
	}
	config, err := model.ValidateOrCreateRecordingConfig(s.eid)
	if err != nil {
		return nil, err
	}
	if !recordingMemoryExtractionEnabled(config) {
		return &RecordingMemoryOverview{Items: []RecordingMemoryClaimView{}, Kinds: []RecordingMemoryKindCount{}}, nil
	}

	base := model.DB.WithContext(ctx).Table("recording_memory_claims AS c").
		Joins("JOIN files AS source_file ON source_file.id = c.file_id AND source_file.eid = c.eid").
		Where("c.eid = ? AND c.owner_id = ? AND c.is_current = ? AND source_file.user_id = ? AND source_file.type = ? AND source_file.origin_type IN ? AND source_file.is_deleted = ?", s.eid, userID, true, userID, model.FILE_TYPE_FILE, model.RecordingOriginTypes(), false)
	var stats RecordingMemoryStats
	if err := base.Count(&stats.TotalClaims).Error; err != nil {
		return nil, err
	}
	for _, query := range []struct {
		target *int64
		where  string
		args   []interface{}
	}{
		{&stats.ConfirmedDecisions, "c.claim_kind = ? AND c.assertion_state = ?", []interface{}{"decision", "confirmed"}},
		{&stats.ActiveCommitments, "c.claim_kind = ? AND c.lifecycle_state = ?", []interface{}{"commitment", recordingMemoryLifecycleOpen}},
		{&stats.ActiveRisks, "c.claim_kind = ? AND c.lifecycle_state = ?", []interface{}{"risk", recordingMemoryLifecycleOpen}},
		{&stats.NeedsConfirmation, "c.review_state = ?", []interface{}{recordingMemoryReviewPending}},
		{&stats.EvidenceCoverage, "c.evidence_available = ?", []interface{}{true}},
	} {
		if err := base.Where(query.where, query.args...).Count(query.target).Error; err != nil {
			return nil, err
		}
	}
	if err := base.Distinct("c.file_id").Count(&stats.SourceMeetings).Error; err != nil {
		return nil, err
	}

	var meetingCount int64
	if err := model.DB.WithContext(ctx).Model(&model.File{}).
		Where("eid = ? AND user_id = ? AND type = ? AND is_deleted = ? AND origin_type IN ?", s.eid, userID, model.FILE_TYPE_FILE, false, model.RecordingOriginTypes()).
		Count(&meetingCount).Error; err != nil {
		return nil, err
	}
	stats.UncompiledMeetings = meetingCount - stats.SourceMeetings
	if stats.UncompiledMeetings < 0 {
		stats.UncompiledMeetings = 0
	}

	var kinds []RecordingMemoryKindCount
	if err := base.Select("c.claim_kind AS kind, COUNT(*) AS count").Group("c.claim_kind").Order("count DESC").Scan(&kinds).Error; err != nil {
		return nil, err
	}

	query := model.DB.WithContext(ctx).Table("recording_memory_claims AS c").
		Select("c.id, c.file_id, c.claim_kind, c.content, c.assertion_state, c.epistemic_type, c.lifecycle_state, c.review_state, c.source_confidence, c.evidence_available, c.source_segment_count, c.updated_time, f.path AS source_file").
		Joins("JOIN files AS f ON f.id = c.file_id AND f.eid = c.eid").
		Where("c.eid = ? AND c.owner_id = ? AND c.is_current = ? AND f.user_id = ? AND f.type = ? AND f.origin_type IN ? AND f.is_deleted = ?", s.eid, userID, true, userID, model.FILE_TYPE_FILE, model.RecordingOriginTypes(), false)
	if cleanedKind := strings.TrimSpace(kind); cleanedKind != "" {
		query = query.Where("c.claim_kind = ?", cleanedKind)
	}
	if cleanedKeyword := strings.TrimSpace(keyword); cleanedKeyword != "" {
		like := "%" + cleanedKeyword + "%"
		query = query.Where("(c.content LIKE ? OR f.path LIKE ?)", like, like)
	}
	var items []RecordingMemoryClaimView
	if err := query.Order("c.updated_time DESC, c.id DESC").Limit(limit).Scan(&items).Error; err != nil {
		return nil, err
	}
	if items == nil {
		items = []RecordingMemoryClaimView{}
	}
	if kinds == nil {
		kinds = []RecordingMemoryKindCount{}
	}
	return &RecordingMemoryOverview{Stats: stats, Items: items, Kinds: kinds}, nil
}
