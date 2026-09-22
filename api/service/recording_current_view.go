package service

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
)

const recordingCurrentViewRecentUpdateLimit = 20

var ErrRecordingCurrentViewNotFound = errors.New("recording current view entity not found")

// RecordingCurrentView 是针对一个安心录实体的只读当前最佳理解。
// 它在查询时由现有 Entity、Fact、Claim 和 Evidence 编译，不持久化。
type RecordingCurrentView struct {
	Entity      RecordingCurrentViewEntity     `json:"entity"`
	CurrentView RecordingCurrentViewFacets     `json:"current_view"`
	Conflicts   []RecordingCurrentViewConflict `json:"conflicts"`
	CompiledAt  time.Time                      `json:"compiled_at"`
}

type RecordingCurrentViewEntity struct {
	ID            int64                      `json:"id"`
	EntityType    string                     `json:"entity_type"`
	CanonicalName string                     `json:"canonical_name"`
	MatterKind    *RecordingCurrentViewValue `json:"matter_kind,omitempty"`
}

type RecordingCurrentViewFacets struct {
	CurrentStatus        RecordingCurrentViewValue      `json:"current_status"`
	CurrentPosition      RecordingCurrentViewValue      `json:"current_position"`
	CurrentDemands       RecordingCurrentViewList       `json:"current_demands"`
	CurrentRisks         RecordingCurrentViewRisk       `json:"current_risks"`
	CurrentOpportunities RecordingCurrentViewList       `json:"current_opportunities"`
	OpenLoops            RecordingCurrentViewList       `json:"open_loops"`
	RecentUpdates        RecordingCurrentViewList       `json:"recent_updates"`
	RecentChanges        RecordingCurrentViewList       `json:"recent_changes"`
	EvidenceRefs         []RecordingCurrentViewEvidence `json:"evidence_refs"`
}

type RecordingCurrentViewValue struct {
	State         string                         `json:"state"`
	Support       string                         `json:"support"`
	Value         string                         `json:"value,omitempty"`
	CandidateRefs []string                       `json:"candidate_refs,omitempty"`
	EvidenceRefs  []RecordingCurrentViewEvidence `json:"evidence_refs,omitempty"`
}

type RecordingCurrentViewList struct {
	State          string                         `json:"state"`
	Support        string                         `json:"support"`
	Items          []RecordingCurrentViewItem     `json:"items,omitempty"`
	UncertainItems []RecordingCurrentViewItem     `json:"uncertain_items,omitempty"`
	CandidateRefs  []string                       `json:"candidate_refs,omitempty"`
	EvidenceRefs   []RecordingCurrentViewEvidence `json:"evidence_refs,omitempty"`
}

type RecordingCurrentViewRisk struct {
	State          string                         `json:"state"`
	Support        string                         `json:"support"`
	Items          []RecordingCurrentViewItem     `json:"items,omitempty"`
	UncertainItems []RecordingCurrentViewItem     `json:"uncertain_items,omitempty"`
	CandidateRefs  []string                       `json:"candidate_refs,omitempty"`
	EvidenceRefs   []RecordingCurrentViewEvidence `json:"evidence_refs,omitempty"`
}

type RecordingCurrentViewItem struct {
	ID              int64                          `json:"id"`
	Kind            string                         `json:"kind"`
	Content         string                         `json:"content"`
	Status          string                         `json:"status,omitempty"`
	SourceType      string                         `json:"source_type,omitempty"`
	Confidence      *float64                       `json:"confidence,omitempty"`
	EvidenceRefs    []RecordingCurrentViewEvidence `json:"evidence_refs,omitempty"`
	SourceFile      string                         `json:"source_file,omitempty"`
	SourceSegments  []string                       `json:"source_segments,omitempty"`
	Timestamp       int64                          `json:"timestamp,omitempty"`
	CurrentValidity string                         `json:"current_validity,omitempty"`
	Lifecycle       string                         `json:"lifecycle,omitempty"`
}

type RecordingCurrentViewEvidence struct {
	FileID         int64    `json:"file_id,omitempty"`
	SourceFile     string   `json:"source_file,omitempty"`
	SourceSegments []string `json:"source_segments,omitempty"`
	SourceType     string   `json:"source_type,omitempty"`
	Confidence     *float64 `json:"confidence,omitempty"`
}

type RecordingCurrentViewConflict struct {
	Facet      string                     `json:"facet"`
	Reason     string                     `json:"reason"`
	Candidates []RecordingCurrentViewItem `json:"candidates"`
}

// RecordingMemoryTimeline 是实体记忆的不可覆盖历史时间线。
// 它和 Current View 一样查询时编译，但不会写回任何记忆表。
type RecordingMemoryTimeline struct {
	Entity     RecordingCurrentViewEntity    `json:"entity"`
	Items      []RecordingMemoryTimelineItem `json:"items"`
	Total      int                           `json:"total"`
	Offset     int                           `json:"offset"`
	Limit      int                           `json:"limit"`
	HasMore    bool                          `json:"has_more"`
	CompiledAt time.Time                     `json:"compiled_at"`
}

type RecordingMemoryTimelineItem struct {
	ID              int64                          `json:"id"`
	Timestamp       int64                          `json:"timestamp"`
	Entity          RecordingCurrentViewEntity     `json:"entity"`
	RecordType      string                         `json:"record_type"`
	FactKind        string                         `json:"fact_kind,omitempty"`
	ClaimKind       string                         `json:"claim_kind,omitempty"`
	EventType       string                         `json:"event_type"`
	Content         string                         `json:"content"`
	PreviousValue   *string                        `json:"previous_value,omitempty"`
	NewValue        *string                        `json:"new_value,omitempty"`
	SourceFile      string                         `json:"source_file,omitempty"`
	SourceSegments  []string                       `json:"source_segments,omitempty"`
	SourceType      string                         `json:"source_type,omitempty"`
	EpistemicType   string                         `json:"epistemic_type,omitempty"`
	Confidence      *float64                       `json:"confidence,omitempty"`
	CurrentValidity string                         `json:"current_validity"`
	Lifecycle       string                         `json:"lifecycle,omitempty"`
	Status          string                         `json:"status,omitempty"`
	DueAt           int64                          `json:"due_at,omitempty"`
	EvidenceRefs    []RecordingCurrentViewEvidence `json:"evidence_refs,omitempty"`
}

type recordingCurrentViewRow struct {
	ID              int64
	FileID          int64
	Kind            string
	Content         string
	DetailJSON      string
	SourceType      string
	Confidence      *float64
	Evidence        bool
	Segments        []string
	SourceFile      string
	Timestamp       int64
	DueAt           int64
	Lifecycle       string
	ReviewState     string
	AssertionState  string
	EpistemicType   string
	IsCurrent       bool
	Deleted         bool
	RelatedEntityID int64
	Attributes      map[string]string
	FactKind        string
	Bound           bool
}

// CompileRecordingCurrentView 编译指定实体的只读 Current View。它只读现有记忆表。
func CompileRecordingCurrentView(ctx context.Context, eid, ownerID, entityID int64) (*RecordingCurrentView, error) {
	if err := ensureRecordingCurrentViewAccess(ctx, eid, ownerID); err != nil {
		return nil, err
	}
	entityService := NewRecordingMemoryEntityService(eid)
	entity, err := entityService.findActiveEntity(ctx, ownerID, entityID)
	if err != nil {
		if errors.Is(err, ErrRecordingEntityMemoryNotFound) {
			return nil, ErrRecordingCurrentViewNotFound
		}
		return nil, err
	}
	return compileRecordingCurrentView(ctx, eid, ownerID, entity, time.Now().UTC())
}

func ensureRecordingCurrentViewAccess(ctx context.Context, eid, userID int64) error {
	library, err := NewPersonalSpaceService(eid).GetExistingPersonalLibrary(ctx, userID)
	if err != nil {
		return err
	}
	if library == nil {
		return ErrRecordingMemoryForbidden
	}
	permission, err := GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID)
	if err != nil {
		return err
	}
	if permission < model.PERMISSION_VIEW_ONLY {
		return ErrRecordingMemoryForbidden
	}
	return nil
}

func compileRecordingCurrentView(ctx context.Context, eid, ownerID int64, entity *model.RecordingMemoryEntity, now time.Time) (*RecordingCurrentView, error) {
	rows, allFacts, err := loadRecordingCurrentViewRows(ctx, eid, ownerID, entity)
	if err != nil {
		return nil, err
	}
	return buildRecordingCurrentView(entity, rows, allFacts, now), nil
}

func loadRecordingCurrentViewRows(ctx context.Context, eid, ownerID int64, entity *model.RecordingMemoryEntity) ([]recordingCurrentViewRow, []model.RecordingMemoryFact, error) {
	var allFacts []model.RecordingMemoryFact
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ?", eid, ownerID).
		Order("occurred_at DESC, id DESC").Find(&allFacts).Error; err != nil {
		return nil, nil, err
	}
	facts := make([]model.RecordingMemoryFact, 0)
	for _, fact := range allFacts {
		if fact.EntityID == entity.ID {
			facts = append(facts, fact)
		}
	}
	var claims []model.RecordingMemoryClaim
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ?", eid, ownerID).
		Order("created_time DESC, id DESC").Find(&claims).Error; err != nil {
		return nil, nil, err
	}
	fileNames := recordingCurrentViewFileNames(ctx, eid, ownerID, facts, claims)
	rows := make([]recordingCurrentViewRow, 0, len(facts)+len(claims))
	for _, fact := range facts {
		rows = append(rows, recordingCurrentViewFactRow(fact, fileNames[fact.FileID]))
	}
	for _, claim := range claims {
		if !recordingCurrentViewClaimBindsEntity(string(claim.DetailJSON), entity.ID, claim.FileID, allFacts) {
			continue
		}
		rows = append(rows, recordingCurrentViewClaimRow(claim, fileNames[claim.FileID]))
	}
	return rows, allFacts, nil
}

// CompileRecordingMemoryTimeline 返回指定实体的分页历史窗口，保留被替换和已删除记录。
func CompileRecordingMemoryTimeline(ctx context.Context, eid, ownerID, entityID int64, offset, limit int) (*RecordingMemoryTimeline, error) {
	if err := ensureRecordingCurrentViewAccess(ctx, eid, ownerID); err != nil {
		return nil, err
	}
	entityService := NewRecordingMemoryEntityService(eid)
	entity, err := entityService.findActiveEntity(ctx, ownerID, entityID)
	if err != nil {
		if errors.Is(err, ErrRecordingEntityMemoryNotFound) {
			return nil, ErrRecordingCurrentViewNotFound
		}
		return nil, err
	}
	rows, _, err := loadRecordingCurrentViewRows(ctx, eid, ownerID, entity)
	if err != nil {
		return nil, err
	}
	return buildRecordingMemoryTimeline(entity, rows, time.Now().UTC(), offset, limit), nil
}

func buildRecordingMemoryTimeline(entity *model.RecordingMemoryEntity, rows []recordingCurrentViewRow, now time.Time, offset, limit int) *RecordingMemoryTimeline {
	historyRows := append([]recordingCurrentViewRow(nil), rows...)
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	sort.SliceStable(historyRows, func(i, j int) bool {
		if historyRows[i].Timestamp != historyRows[j].Timestamp {
			return historyRows[i].Timestamp > historyRows[j].Timestamp
		}
		return historyRows[i].ID > historyRows[j].ID
	})
	if offset > len(historyRows) {
		offset = len(historyRows)
	}
	end := offset + limit
	if end > len(historyRows) {
		end = len(historyRows)
	}
	pageRows := historyRows[offset:end]
	timeline := &RecordingMemoryTimeline{
		Entity:     RecordingCurrentViewEntity{ID: entity.ID, EntityType: entity.EntityType, CanonicalName: entity.CanonicalName},
		Items:      make([]RecordingMemoryTimelineItem, 0, len(pageRows)),
		Total:      len(historyRows),
		Offset:     offset,
		Limit:      limit,
		HasMore:    end < len(historyRows),
		CompiledAt: now,
	}
	timeline.Entity.MatterKind = recordingCurrentViewMatterKind(entity)
	for _, row := range pageRows {
		previous, next := recordingCurrentViewPreviousNew(row.DetailJSON)
		recordType := "claim"
		if row.FactKind != "" {
			recordType = "fact"
		}
		item := RecordingMemoryTimelineItem{
			ID: row.ID, Timestamp: row.Timestamp, Entity: timeline.Entity, RecordType: recordType,
			EventType: row.Kind,
			Content:   row.Content, SourceFile: row.SourceFile, SourceSegments: row.Segments,
			SourceType: row.SourceType, EpistemicType: row.EpistemicType, Confidence: row.Confidence,
			CurrentValidity: recordingCurrentViewHistoryValidity(row, historyRows), Lifecycle: row.Lifecycle,
			Status: recordingCurrentViewTimelineStatus(row, now), DueAt: row.DueAt,
		}
		if recordType == "fact" {
			item.FactKind = row.FactKind
		} else {
			item.ClaimKind = row.Kind
		}
		if previous != "" {
			item.PreviousValue = &previous
		}
		if next != "" {
			item.NewValue = &next
		}
		if recordingCurrentViewHasEvidence(row) {
			item.EvidenceRefs = []RecordingCurrentViewEvidence{rowEvidence(row)}
		}
		timeline.Items = append(timeline.Items, item)
	}
	return timeline
}

func recordingCurrentViewTimelineStatus(row recordingCurrentViewRow, now time.Time) string {
	if row.Kind == "commitment" || row.Kind == "action" || row.Kind == "open_question" {
		status := row.Lifecycle
		if status == recordingMemoryLifecycleOpen && row.DueAt > 0 && row.DueAt < now.UnixMilli() {
			return "overdue"
		}
		return status
	}
	if status := strings.TrimSpace(row.Attributes["current_status"]); status != "" {
		return status
	}
	return strings.TrimSpace(row.Attributes["status"])
}

func recordingCurrentViewFactRow(fact model.RecordingMemoryFact, sourceFile string) recordingCurrentViewRow {
	attrs := decodeStringMap(fact.AttributesJSON)
	return recordingCurrentViewRow{
		ID: fact.ID, FileID: fact.FileID, Kind: fact.FactKind, FactKind: fact.FactKind, Content: string(fact.Content),
		SourceType: fact.SourceType, Segments: decodeStringSlice(fact.SourceSegmentIDs), SourceFile: sourceFile,
		Timestamp: fact.OccurredAt, Attributes: attrs, Deleted: fact.IsDeleted, IsCurrent: !fact.IsDeleted, RelatedEntityID: fact.RelatedEntityID,
	}
}

func recordingCurrentViewClaimRow(claim model.RecordingMemoryClaim, sourceFile string) recordingCurrentViewRow {
	var confidence *float64
	if claim.SourceConfidence > 0 {
		value := claim.SourceConfidence
		confidence = &value
	}
	return recordingCurrentViewRow{
		ID: claim.ID, FileID: claim.FileID, Kind: claim.ClaimKind, Content: string(claim.Content), DetailJSON: string(claim.DetailJSON),
		SourceType: claim.SourceItemType, Confidence: confidence, Evidence: claim.EvidenceAvailable,
		Segments: decodeStringSlice(claim.SourceSegmentIDs), SourceFile: sourceFile, Timestamp: claim.CreatedTime,
		DueAt: claim.DueAt, Lifecycle: claim.LifecycleState, ReviewState: claim.ReviewState,
		AssertionState: claim.AssertionState, EpistemicType: claim.EpistemicType, IsCurrent: claim.IsCurrent,
		Attributes: recordingCurrentViewDetailAttributes(string(claim.DetailJSON)),
		Bound:      true,
	}
}

func recordingCurrentViewDetailAttributes(detail string) map[string]string {
	var payload map[string]interface{}
	if json.Unmarshal([]byte(detail), &payload) != nil {
		return map[string]string{}
	}
	attrs := make(map[string]string)
	for _, key := range []string{"status", "current_status", "continuation_evidence", "demand", "role", "previous_status", "new_status"} {
		if value, ok := payload[key]; ok {
			if boolean, ok := value.(bool); ok {
				attrs[key] = strconv.FormatBool(boolean)
				continue
			}
			if text := strings.TrimSpace(stringValue(value)); text != "" {
				attrs[key] = text
			}
		}
	}
	return attrs
}

func recordingCurrentViewFileNames(ctx context.Context, eid, ownerID int64, facts []model.RecordingMemoryFact, claims []model.RecordingMemoryClaim) map[int64]string {
	ids := make([]int64, 0, len(facts)+len(claims))
	seen := map[int64]struct{}{}
	for _, fact := range facts {
		if fact.FileID > 0 {
			seen[fact.FileID] = struct{}{}
		}
	}
	for _, claim := range claims {
		if claim.FileID > 0 {
			seen[claim.FileID] = struct{}{}
		}
	}
	for id := range seen {
		ids = append(ids, id)
	}
	result := map[int64]string{}
	if len(ids) == 0 {
		return result
	}
	var files []model.File
	if err := model.DB.WithContext(ctx).Where("eid = ? AND user_id = ? AND id IN ?", eid, ownerID, ids).Find(&files).Error; err != nil {
		return result
	}
	for _, file := range files {
		result[file.ID] = file.Path
	}
	return result
}

func recordingCurrentViewClaimBindsEntity(detail string, entityID, claimFileID int64, facts []model.RecordingMemoryFact) bool {
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(detail), &payload); err != nil {
		return false
	}
	links, ok := payload["structured_links"].(map[string]interface{})
	if !ok {
		return false
	}
	bindings, ok := links["claim_entity_bindings"].([]interface{})
	if !ok {
		return false
	}
	for _, raw := range bindings {
		binding, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		if recordingCurrentViewBindingTargetsEntity(binding, entityID, claimFileID, facts) {
			return true
		}
	}
	return false
}

func recordingCurrentViewBindingTargetsEntity(binding map[string]interface{}, entityID, claimFileID int64, facts []model.RecordingMemoryFact) bool {
	if id, ok := binding["entity_id"].(float64); ok && int64(id) == entityID {
		return true
	}
	if id := strings.TrimSpace(stringValue(binding["entity_id"])); id != "" && id == strconv.FormatInt(entityID, 10) {
		return true
	}
	tempID := strings.TrimSpace(stringValue(binding["entity_temp_id"]))
	segments := memorySourceSegmentIDs(binding["source_segment_ids"])
	if tempID == "" || len(segments) == 0 || claimFileID <= 0 {
		return false
	}
	matched := map[int64]struct{}{}
	for _, fact := range facts {
		if fact.FileID != claimFileID || fact.IsDeleted || fact.RelatedEntityID > 0 {
			continue
		}
		if hasAnyString(segments, decodeStringSlice(fact.SourceSegmentIDs)...) {
			matched[fact.EntityID] = struct{}{}
		}
	}
	if len(matched) != 1 {
		return false
	}
	_, ok := matched[entityID]
	return ok
}

func buildRecordingCurrentView(entity *model.RecordingMemoryEntity, rows []recordingCurrentViewRow, facts []model.RecordingMemoryFact, now time.Time) *RecordingCurrentView {
	currentRows := make([]recordingCurrentViewRow, 0, len(rows))
	allRows := append([]recordingCurrentViewRow(nil), rows...)
	for _, row := range rows {
		if row.Deleted || row.RelatedEntityID > 0 {
			continue
		}
		if row.Kind != "" && (row.IsCurrent || row.FactKind != "") {
			currentRows = append(currentRows, row)
		}
	}
	view := &RecordingCurrentView{
		Entity: RecordingCurrentViewEntity{ID: entity.ID, EntityType: entity.EntityType, CanonicalName: entity.CanonicalName},
		CurrentView: RecordingCurrentViewFacets{
			CurrentStatus: unknownCurrentViewValue("degraded"), CurrentPosition: unknownCurrentViewValue("degraded"),
			CurrentDemands: unknownCurrentViewList("degraded"), CurrentRisks: unknownCurrentViewRisk("degraded"),
			CurrentOpportunities: unknownCurrentViewList("degraded"), OpenLoops: unknownCurrentViewList("supported"),
			RecentUpdates: unknownCurrentViewList("supported"), RecentChanges: unknownCurrentViewList("degraded"),
		},
		Conflicts: []RecordingCurrentViewConflict{}, CompiledAt: now,
	}
	view.Entity.MatterKind = recordingCurrentViewMatterKind(entity)
	compileCurrentStatus(&view.CurrentView.CurrentStatus, &view.Conflicts, currentRows, entity.EntityType)
	compileCurrentPosition(&view.CurrentView.CurrentPosition, &view.Conflicts, currentRows, entity.ID, facts)
	compileCurrentDemands(&view.CurrentView.CurrentDemands, currentRows)
	compileCurrentRisks(&view.CurrentView.CurrentRisks, currentRows, entity.EntityType)
	compileOpenLoops(&view.CurrentView.OpenLoops, currentRows, now)
	compileRecentUpdates(&view.CurrentView.RecentUpdates, allRows)
	compileRecentChanges(&view.CurrentView.RecentChanges, allRows)
	view.CurrentView.EvidenceRefs = collectEvidenceRefs(currentRows)
	return view
}

func unknownCurrentViewValue(support string) RecordingCurrentViewValue {
	return RecordingCurrentViewValue{State: "unknown", Support: support}
}
func unknownCurrentViewList(support string) RecordingCurrentViewList {
	return RecordingCurrentViewList{State: "unknown", Support: support, Items: []RecordingCurrentViewItem{}, UncertainItems: []RecordingCurrentViewItem{}}
}
func unknownCurrentViewRisk(support string) RecordingCurrentViewRisk {
	return RecordingCurrentViewRisk{State: "unknown", Support: support, Items: []RecordingCurrentViewItem{}, UncertainItems: []RecordingCurrentViewItem{}}
}

func recordingCurrentViewMatterKind(entity *model.RecordingMemoryEntity) *RecordingCurrentViewValue {
	if entity.EntityType != "matter" {
		return nil
	}
	attrs := decodeStringMap(entity.AttributesJSON)
	if value := strings.TrimSpace(attrs["matter_kind"]); value != "" {
		return &RecordingCurrentViewValue{State: "resolved", Support: "supported", Value: value}
	}
	value := unknownCurrentViewValue("degraded")
	return &value
}

func compileCurrentStatus(out *RecordingCurrentViewValue, conflicts *[]RecordingCurrentViewConflict, rows []recordingCurrentViewRow, entityType string) {
	if entityType != "matter" {
		out.Support = "unsupported"
		return
	}
	values := make([]recordingCurrentViewRow, 0)
	for _, row := range rows {
		isStructuredStatus := row.Attributes["status"] != "" && (row.FactKind != "" || row.Kind == "status")
		if isStructuredStatus && recordingCurrentViewHasEvidence(row) {
			values = append(values, row)
		}
	}
	if len(values) == 0 {
		return
	}
	recordingCurrentViewSortRows(values)
	unique := map[string][]recordingCurrentViewRow{}
	for _, row := range values {
		value := row.Attributes["status"]
		unique[value] = append(unique[value], row)
	}
	keys := make([]string, 0, len(unique))
	for value := range unique {
		keys = append(keys, value)
	}
	sort.Strings(keys)
	for _, value := range keys {
		candidates := unique[value]
		recordingCurrentViewSortRows(candidates)
		for _, candidate := range candidates {
			out.CandidateRefs = append(out.CandidateRefs, recordingCurrentViewIDRef(candidate.ID))
			out.EvidenceRefs = append(out.EvidenceRefs, rowEvidence(candidate))
		}
		if out.Value == "" {
			out.Value = value
		}
	}
	if len(unique) > 1 {
		out.Value = ""
		out.State = "conflicted"
		out.Support = "degraded"
		*conflicts = append(*conflicts, currentViewConflict("current_status", "possible_change", values))
	} else {
		out.State = "resolved"
		out.Support = "supported"
	}
}

func compileCurrentPosition(out *RecordingCurrentViewValue, conflicts *[]RecordingCurrentViewConflict, rows []recordingCurrentViewRow, entityID int64, facts []model.RecordingMemoryFact) {
	values := make([]recordingCurrentViewRow, 0)
	for _, row := range rows {
		if (row.Kind != "viewpoint" && row.Kind != "decision") || !recordingCurrentViewClaimSubjectRole(row.DetailJSON, entityID, row.FileID, facts) || !recordingCurrentViewHasEvidence(row) {
			continue
		}
		values = append(values, row)
	}
	compileSingleValue(out, conflicts, "current_position", values)
}

func compileSingleValue(out *RecordingCurrentViewValue, conflicts *[]RecordingCurrentViewConflict, facet string, rows []recordingCurrentViewRow) {
	if len(rows) == 0 {
		return
	}
	recordingCurrentViewSortRows(rows)
	unique := map[string][]recordingCurrentViewRow{}
	for _, row := range rows {
		value := strings.TrimSpace(row.Content)
		unique[value] = append(unique[value], row)
	}
	keys := make([]string, 0, len(unique))
	for value := range unique {
		keys = append(keys, value)
	}
	sort.Strings(keys)
	for _, value := range keys {
		candidates := unique[value]
		recordingCurrentViewSortRows(candidates)
		if out.Value == "" {
			out.Value = value
		}
		for _, candidate := range candidates {
			out.CandidateRefs = append(out.CandidateRefs, recordingCurrentViewIDRef(candidate.ID))
			out.EvidenceRefs = append(out.EvidenceRefs, rowEvidence(candidate))
		}
	}
	if len(unique) > 1 {
		out.Value = ""
		out.State = "conflicted"
		out.Support = "degraded"
		*conflicts = append(*conflicts, currentViewConflict(facet, "possible_change", rows))
	} else {
		out.State = "resolved"
		out.Support = "supported"
	}
}

func recordingCurrentViewSubjectRole(detail string) bool {
	return recordingCurrentViewClaimSubjectRole(detail, 0, 0, nil)
}

func recordingCurrentViewClaimSubjectRole(detail string, entityID, claimFileID int64, facts []model.RecordingMemoryFact) bool {
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(detail), &payload); err != nil {
		return false
	}
	links, ok := payload["structured_links"].(map[string]interface{})
	if !ok {
		return false
	}
	bindings, ok := links["claim_entity_bindings"].([]interface{})
	if !ok {
		return false
	}
	for _, raw := range bindings {
		binding, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		if entityID > 0 && !recordingCurrentViewBindingTargetsEntity(binding, entityID, claimFileID, facts) {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(stringValue(binding["role"])))
		if role == "subject" || role == "holder" || role == "speaker" || role == "owner" {
			return true
		}
	}
	return false
}

func compileCurrentDemands(out *RecordingCurrentViewList, rows []recordingCurrentViewRow) {
	selected := make([]recordingCurrentViewRow, 0)
	for _, row := range rows {
		demand := strings.TrimSpace(row.Attributes["demand"])
		if demand == "" && row.FactKind != "demand" {
			continue
		}
		if !recordingCurrentViewFactSubjectRole(row.Attributes) {
			continue
		}
		if !recordingCurrentViewHasEvidence(row) {
			continue
		}
		if demand == "" {
			demand = row.Content
		}
		out.Items = append(out.Items, currentViewItem(row, demand, ""))
		selected = append(selected, row)
	}
	if len(out.Items) > 0 {
		out.State = "resolved"
		out.Support = "supported"
		out.EvidenceRefs = collectEvidenceRefs(selected)
	}
}

func recordingCurrentViewFactSubjectRole(attributes map[string]string) bool {
	role := strings.ToLower(strings.TrimSpace(attributes["subject_role"]))
	if role == "" {
		role = strings.ToLower(strings.TrimSpace(attributes["role"]))
	}
	return role == "subject" || role == "holder" || role == "speaker" || role == "owner"
}

func recordingCurrentViewHasEvidence(row recordingCurrentViewRow) bool {
	return row.Evidence || len(row.Segments) > 0
}

func recordingCurrentViewAuthority(row recordingCurrentViewRow) int {
	if row.ReviewState == recordingMemoryReviewConfirmed || row.AssertionState == "user_confirmed" || row.SourceType == recordingMemorySourceUserConfirmed || row.SourceType == recordingEntityMemorySourceManual {
		return 4
	}
	if row.EpistemicType == "explicit" || row.AssertionState == "confirmed" {
		return 3
	}
	if row.FactKind != "" && recordingCurrentViewHasEvidence(row) {
		return 2
	}
	return 1
}

func recordingCurrentViewSortRows(rows []recordingCurrentViewRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		left, right := rows[i], rows[j]
		if recordingCurrentViewAuthority(left) != recordingCurrentViewAuthority(right) {
			return recordingCurrentViewAuthority(left) > recordingCurrentViewAuthority(right)
		}
		if left.Timestamp != right.Timestamp {
			return left.Timestamp > right.Timestamp
		}
		if left.Confidence != nil && right.Confidence != nil && *left.Confidence != *right.Confidence {
			return *left.Confidence > *right.Confidence
		}
		return left.ID > right.ID
	})
}

func compileCurrentRisks(out *RecordingCurrentViewRisk, rows []recordingCurrentViewRow, entityType string) {
	selected := make([]recordingCurrentViewRow, 0)
	for _, row := range rows {
		if row.FactKind != "risk" && row.Kind != "risk" && entityType != "risk" {
			continue
		}
		selected = append(selected, row)
		item := currentViewItem(row, row.Content, "")
		status := strings.ToLower(strings.TrimSpace(row.Attributes["current_status"]))
		continuation := strings.EqualFold(row.Attributes["continuation_evidence"], "true")
		if status == "active" || status == "ongoing" || continuation {
			if !recordingCurrentViewHasEvidence(row) {
				item.Status = "uncertain"
				out.UncertainItems = append(out.UncertainItems, item)
				continue
			}
			item.Status = "active"
			out.Items = append(out.Items, item)
		} else if row.Lifecycle == recordingMemoryLifecycleCancel || row.Deleted || status == "resolved" || status == "cancelled" || status == "closed" || status == "inactive" {
			continue
		} else {
			item.Status = "uncertain"
			out.UncertainItems = append(out.UncertainItems, item)
		}
	}
	if len(out.Items) > 0 {
		out.State = "resolved"
		out.Support = "supported"
	} else if len(out.UncertainItems) > 0 {
		out.State = "unknown"
		out.Support = "degraded"
	}
	out.EvidenceRefs = append(out.EvidenceRefs, collectEvidenceRefs(selected)...)
}

func compileOpenLoops(out *RecordingCurrentViewList, rows []recordingCurrentViewRow, now time.Time) {
	completedKeys := map[string]struct{}{}
	for _, row := range rows {
		if row.Kind != "commitment" && row.Kind != "action" && row.Kind != "open_question" {
			continue
		}
		if row.Lifecycle == recordingMemoryLifecycleDone || strings.EqualFold(row.Lifecycle, "completed") || strings.EqualFold(row.Attributes["status"], "completed") {
			if key := recordingCurrentViewLoopKey(row.DetailJSON); key != "" {
				previous, next := recordingCurrentViewPreviousNew(row.DetailJSON)
				if previous == recordingMemoryLifecycleOpen && (next == recordingMemoryLifecycleDone || strings.EqualFold(next, "completed")) {
					completedKeys[key] = struct{}{}
				}
			}
		}
	}
	for _, row := range rows {
		if row.Kind != "commitment" && row.Kind != "action" && row.Kind != "open_question" {
			continue
		}
		if row.Kind == "open_question" && !row.Bound {
			continue
		}
		if key := recordingCurrentViewLoopKey(row.DetailJSON); key != "" {
			if _, completed := completedKeys[key]; completed {
				continue
			}
		}
		status := row.Lifecycle
		if status == recordingMemoryLifecycleDone || status == recordingMemoryLifecycleCancel || strings.EqualFold(status, "completed") || strings.EqualFold(status, "cancelled") {
			continue
		}
		if status == "" {
			status = "unknown"
		}
		if status == recordingMemoryLifecycleOpen && row.DueAt > 0 && row.DueAt < now.UnixMilli() {
			status = "overdue"
		}
		item := currentViewItem(row, row.Content, status)
		item.Lifecycle = status
		if status == "unknown" {
			out.UncertainItems = append(out.UncertainItems, item)
		} else {
			out.Items = append(out.Items, item)
		}
	}
	if len(out.Items) > 0 {
		out.State = "resolved"
	} else if len(out.UncertainItems) > 0 {
		out.State = "unknown"
		out.Support = "degraded"
	}
	if out.Items == nil {
		out.Items = []RecordingCurrentViewItem{}
	}
	if out.UncertainItems == nil {
		out.UncertainItems = []RecordingCurrentViewItem{}
	}
}

func recordingCurrentViewLoopKey(detail string) string {
	var payload map[string]interface{}
	if json.Unmarshal([]byte(detail), &payload) != nil {
		return ""
	}
	return strings.TrimSpace(stringValue(payload["loop_key"]))
}

func compileRecentUpdates(out *RecordingCurrentViewList, rows []recordingCurrentViewRow) {
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Timestamp > rows[j].Timestamp })
	allRows := rows
	if len(rows) > recordingCurrentViewRecentUpdateLimit {
		rows = rows[:recordingCurrentViewRecentUpdateLimit]
	}
	for _, row := range rows {
		item := currentViewItem(row, row.Content, row.Lifecycle)
		item.CurrentValidity = recordingCurrentViewHistoryValidity(row, allRows)
		out.Items = append(out.Items, item)
	}
	if len(out.Items) > 0 {
		out.State = "resolved"
	}
}

func compileRecentChanges(out *RecordingCurrentViewList, rows []recordingCurrentViewRow) {
	for _, row := range rows {
		previous, next := recordingCurrentViewPreviousNew(row.DetailJSON)
		if previous == "" || next == "" {
			continue
		}
		item := currentViewItem(row, row.Content, "")
		item.Content = previous + " → " + next
		out.Items = append(out.Items, item)
	}
	if len(out.Items) > 0 {
		out.State = "resolved"
		out.Support = "supported"
	} else {
		out.State = "unsupported"
		out.Support = "degraded"
	}
}

func recordingCurrentViewPreviousNew(detail string) (string, string) {
	var payload map[string]interface{}
	if json.Unmarshal([]byte(detail), &payload) != nil {
		return "", ""
	}
	for _, pair := range [][2]string{{"previous_status", "new_status"}, {"previous_value", "new_value"}} {
		previous := strings.TrimSpace(stringValue(payload[pair[0]]))
		next := strings.TrimSpace(stringValue(payload[pair[1]]))
		if previous != "" && next != "" {
			return previous, next
		}
	}
	return "", ""
}

func currentViewItem(row recordingCurrentViewRow, content, status string) RecordingCurrentViewItem {
	item := RecordingCurrentViewItem{ID: row.ID, Kind: row.Kind, Content: content, Status: status, SourceType: row.SourceType, Confidence: row.Confidence, SourceFile: row.SourceFile, SourceSegments: row.Segments, Timestamp: row.Timestamp, Lifecycle: row.Lifecycle, CurrentValidity: recordingCurrentViewValidity(row)}
	if recordingCurrentViewHasEvidence(row) {
		item.EvidenceRefs = []RecordingCurrentViewEvidence{rowEvidence(row)}
	}
	return item
}

func recordingCurrentViewIDRef(id int64) string {
	if id <= 0 {
		return ""
	}
	encoded, err := hashids.Encode(id)
	if err != nil {
		return ""
	}
	return encoded
}

func rowEvidence(row recordingCurrentViewRow) RecordingCurrentViewEvidence {
	return RecordingCurrentViewEvidence{FileID: row.FileID, SourceFile: row.SourceFile, SourceSegments: row.Segments, SourceType: row.SourceType, Confidence: row.Confidence}
}

func collectEvidenceRefs(rows []recordingCurrentViewRow) []RecordingCurrentViewEvidence {
	result := make([]RecordingCurrentViewEvidence, 0, len(rows))
	for _, row := range rows {
		if len(row.Segments) == 0 && row.SourceFile == "" {
			continue
		}
		result = append(result, rowEvidence(row))
	}
	return result
}

func currentViewConflict(facet, reason string, rows []recordingCurrentViewRow) RecordingCurrentViewConflict {
	candidates := make([]RecordingCurrentViewItem, 0, len(rows))
	for _, row := range rows {
		candidates = append(candidates, currentViewItem(row, row.Content, ""))
	}
	return RecordingCurrentViewConflict{Facet: facet, Reason: reason, Candidates: candidates}
}

func recordingCurrentViewValidity(row recordingCurrentViewRow) string {
	if row.Deleted {
		return "invalid"
	}
	if !row.IsCurrent && row.Kind != "" {
		return "compiler_replaced"
	}
	return "active"
}

func recordingCurrentViewHistoryValidity(row recordingCurrentViewRow, rows []recordingCurrentViewRow) string {
	if row.Deleted && row.SourceType == recordingEntityMemorySourceAutomatic {
		for _, candidate := range rows {
			if candidate.Deleted || candidate.FileID != row.FileID || candidate.FactKind != row.FactKind {
				continue
			}
			return "compiler_replaced"
		}
	}
	return recordingCurrentViewValidity(row)
}
