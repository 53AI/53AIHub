package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

// CurrentMeetingContext is the immutable, generation-scoped view shared by
// memory compilation and immediate insight retrieval. It intentionally stays
// in memory in v1.1; the minutes hash is the compatibility boundary until a
// future schema task persists a first-class context snapshot.
type CurrentMeetingContext struct {
	EID                 int64                    `json:"eid"`
	FileID              int64                    `json:"file_id"`
	Generation          int64                    `json:"generation"`
	MinutesHash         string                   `json:"minutes_hash"`
	SegmentVersion      string                   `json:"segment_version"`
	ExtractionVersion   string                   `json:"extraction_version"`
	PrimaryScene        string                   `json:"primary_scene"`
	SecondaryDomains    []string                 `json:"secondary_domains"`
	Topics              []string                 `json:"topics"`
	SegmentIDs          []string                 `json:"segment_ids"`
	Entities            []CurrentMeetingEntity   `json:"entities"`
	Claims              []CurrentMeetingClaim    `json:"claims"`
	Relations           []CurrentMeetingRelation `json:"relations"`
	ClaimEntityBindings []CurrentMeetingBinding  `json:"claim_entity_bindings"`
}

type CurrentMeetingEntity struct {
	TempID              string   `json:"temp_id"`
	EntityType          string   `json:"entity_type"`
	Mention             string   `json:"mention"`
	CanonicalName       string   `json:"canonical_name"`
	IdentityStatus      string   `json:"identity_status"`
	IdentityPolicyClass string   `json:"identity_policy_class"`
	Confidence          float64  `json:"confidence"`
	EvidenceSegmentIDs  []string `json:"evidence_segment_ids"`
	Discriminator       string   `json:"discriminator"`
}

type CurrentMeetingClaim struct {
	TempID             string   `json:"temp_id"`
	Kind               string   `json:"kind"`
	Content            string   `json:"content"`
	EvidenceSegmentIDs []string `json:"evidence_segment_ids"`
}

type CurrentMeetingRelation struct {
	FromTempID         string   `json:"from_temp_id"`
	RelationType       string   `json:"relation_type"`
	ToTempID           string   `json:"to_temp_id"`
	Confidence         float64  `json:"confidence"`
	EvidenceSegmentIDs []string `json:"evidence_segment_ids"`
}

type CurrentMeetingBinding struct {
	ClaimTempID        string   `json:"claim_temp_id"`
	EntityTempID       string   `json:"entity_temp_id"`
	Role               string   `json:"role"`
	EvidenceSegmentIDs []string `json:"evidence_segment_ids"`
}

func buildCurrentMeetingContext(ctx context.Context, eid, fileID, generation int64) (*CurrentMeetingContext, error) {
	raw, err := loadMeetingMinutesJSON(eid, fileID)
	if err != nil {
		return nil, err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("当前纪要为空")
	}
	minutes, err := parseRecordingMemoryMinutes(raw)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(raw))
	current := &CurrentMeetingContext{
		EID:               eid,
		FileID:            fileID,
		Generation:        generation,
		MinutesHash:       hex.EncodeToString(hash[:]),
		SegmentVersion:    firstNonEmptyString(stringValue(minutes["segment_version"]), stringValue(minutes["transcript_version"]), "legacy_text"),
		ExtractionVersion: firstNonEmptyString(stringValue(minutes["extraction_version"]), "recording-memory-v1"),
		PrimaryScene:      firstNonEmptyString(stringValue(minutes["primary_scene"]), stringValue(minutes["scene"])),
		SecondaryDomains:  stringSliceValue(minutes["secondary_domains"]),
		Topics:            stringSliceValue(minutes["topics"]),
	}

	if rows, ok := minutes["memory_entities"].([]interface{}); ok {
		for index, rawEntity := range rows {
			row, ok := rawEntity.(map[string]interface{})
			if !ok {
				continue
			}
			tempID := strings.TrimSpace(stringValue(row["temp_id"]))
			if tempID == "" {
				tempID = fmt.Sprintf("entity_%d", index+1)
			}
			entity := CurrentMeetingEntity{
				TempID:              tempID,
				EntityType:          strings.ToLower(strings.TrimSpace(stringValue(row["entity_type"]))),
				Mention:             strings.TrimSpace(stringValue(row["mention"])),
				CanonicalName:       strings.TrimSpace(stringValue(row["canonical_name"])),
				IdentityStatus:      strings.ToLower(strings.TrimSpace(stringValue(row["identity_status"]))),
				IdentityPolicyClass: normalizeRecordingIdentityPolicyClass(stringValue(row["identity_policy_class"])),
				Confidence:          floatValue(row["identity_policy_confidence"]),
				EvidenceSegmentIDs:  memorySourceSegmentIDs(row["identity_policy_evidence_segment_ids"]),
				Discriminator:       strings.TrimSpace(stringValue(row["identity_subject"])),
			}
			if entity.Discriminator == "" {
				entity.Discriminator = strings.TrimSpace(stringValue(row["identity_binding"]))
			}
			for _, rawFact := range interfaceSlice(row["facts"]) {
				fact, ok := rawFact.(map[string]interface{})
				if !ok {
					continue
				}
				entity.EvidenceSegmentIDs = appendUniqueStrings(entity.EvidenceSegmentIDs, memorySourceSegmentIDs(fact["source_segment_ids"])...)
			}
			current.Entities = append(current.Entities, entity)
			current.SegmentIDs = appendUniqueStrings(current.SegmentIDs, entity.EvidenceSegmentIDs...)
		}
	}

	for _, definition := range []struct {
		Key  string
		Kind string
	}{
		{Key: "decisions", Kind: "decision"},
		{Key: "commitments", Kind: "commitment"},
		{Key: "actions", Kind: "action"},
		{Key: "risks", Kind: "risk"},
		{Key: "issues", Kind: "issue"},
		{Key: "viewpoints", Kind: "viewpoint"},
	} {
		for _, rawClaim := range interfaceSlice(minutes[definition.Key]) {
			row, ok := rawClaim.(map[string]interface{})
			if !ok {
				continue
			}
			segments := memorySourceSegmentIDs(row["source_segment_ids"])
			claim := CurrentMeetingClaim{
				TempID:             recordingMemoryClaimTempID(definition.Kind, row),
				Kind:               definition.Kind,
				Content:            memoryItemContent(definition.Kind, row),
				EvidenceSegmentIDs: segments,
			}
			if claim.Content == "" {
				continue
			}
			current.Claims = append(current.Claims, claim)
			current.SegmentIDs = appendUniqueStrings(current.SegmentIDs, segments...)
		}
	}

	claimIDs := make(map[string]struct{}, len(current.Claims))
	claimSegments := make(map[string][]string, len(current.Claims))
	for _, claim := range current.Claims {
		claimIDs[claim.TempID] = struct{}{}
		claimSegments[claim.TempID] = claim.EvidenceSegmentIDs
	}
	bindings, relations := validatedRecordingMemoryLinks(minutes, claimIDs, claimSegments)
	for _, row := range relations {
		relation := CurrentMeetingRelation{
			FromTempID:         firstNonEmptyString(stringValue(row["from_entity_temp_id"]), stringValue(row["from_temp_id"])),
			RelationType:       strings.TrimSpace(stringValue(row["relation_type"])),
			ToTempID:           firstNonEmptyString(stringValue(row["to_entity_temp_id"]), stringValue(row["to_temp_id"])),
			Confidence:         floatValue(row["confidence"]),
			EvidenceSegmentIDs: memorySourceSegmentIDs(row["source_segment_ids"]),
		}
		if relation.FromTempID == "" || relation.ToTempID == "" || relation.RelationType == "" {
			continue
		}
		current.Relations = append(current.Relations, relation)
		current.SegmentIDs = appendUniqueStrings(current.SegmentIDs, relation.EvidenceSegmentIDs...)
	}
	for _, row := range bindings {
		binding := CurrentMeetingBinding{
			ClaimTempID:        strings.TrimSpace(stringValue(row["claim_temp_id"])),
			EntityTempID:       strings.TrimSpace(stringValue(row["entity_temp_id"])),
			Role:               strings.TrimSpace(stringValue(row["role"])),
			EvidenceSegmentIDs: memorySourceSegmentIDs(row["source_segment_ids"]),
		}
		if binding.ClaimTempID == "" || binding.EntityTempID == "" || binding.Role == "" {
			continue
		}
		current.ClaimEntityBindings = append(current.ClaimEntityBindings, binding)
		current.SegmentIDs = appendUniqueStrings(current.SegmentIDs, binding.EvidenceSegmentIDs...)
	}
	sort.Strings(current.SegmentIDs)
	return current, nil
}

// RecallEntityNames returns only entities that are safe to use as historical
// lookup keys. It mirrors the storage-side policy and never promotes unknown
// or unresolved objects merely because a name is present.
func (c *CurrentMeetingContext) RecallEntityNames() []string {
	if c == nil {
		return nil
	}
	names := make([]string, 0, len(c.Entities))
	for _, entity := range c.Entities {
		allowed := false
		switch entity.IdentityPolicyClass {
		case "named_object":
			allowed = true
		case "person":
			allowed = entity.IdentityStatus == "confirmed" || entity.IdentityStatus == "manual_confirmed"
		case "conceptual_object":
			allowed = entity.Discriminator != ""
		}
		if !allowed || len(entity.EvidenceSegmentIDs) == 0 {
			continue
		}
		name := entity.CanonicalName
		if name == "" {
			name = entity.Mention
		}
		if name != "" {
			names = appendUniqueStrings(names, name)
		}
	}
	return filterInsightRecallEntityNames(names)
}

// RecallClaimTerms returns bounded, searchable anchors from current structured
// claims. Exact claim text preserves strong matches; extracted keywords make
// differently worded historical decisions discoverable as well.
func (c *CurrentMeetingContext) RecallClaimTerms() []string {
	if c == nil {
		return nil
	}
	terms := make([]string, 0, len(c.Claims)*3)
	for _, claim := range c.Claims {
		content := strings.TrimSpace(claim.Content)
		if utf8.RuneCountInString(content) >= 4 {
			terms = appendUniqueStrings(terms, content)
		}
		for _, keyword := range extractKeywords(content) {
			terms = appendUniqueStrings(terms, keyword)
			if !isChinese(keyword) {
				continue
			}
			runes := []rune(keyword)
			for index := 0; index+4 <= len(runes); index++ {
				terms = appendUniqueStrings(terms, string(runes[index:index+4]))
			}
		}
	}
	terms = filterInsightRecallEntityNames(terms)
	if len(terms) > 24 {
		terms = terms[:24]
	}
	return terms
}

func (c *CurrentMeetingContext) VerifyCurrentMinutes(eid, fileID int64) error {
	if c == nil {
		return fmt.Errorf("当前会议快照为空")
	}
	raw, err := loadMeetingMinutesJSON(eid, fileID)
	if err != nil {
		return err
	}
	hash := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	if hex.EncodeToString(hash[:]) != c.MinutesHash {
		return fmt.Errorf("当前纪要 hash 已变化")
	}
	return nil
}

func interfaceSlice(value interface{}) []interface{} {
	rows, _ := value.([]interface{})
	return rows
}

func floatValue(value interface{}) float64 {
	if number, ok := value.(float64); ok {
		return number
	}
	return 0
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func appendUniqueStrings(values []string, additions ...string) []string {
	seen := make(map[string]struct{}, len(values)+len(additions))
	for _, value := range values {
		if value != "" {
			seen[value] = struct{}{}
		}
	}
	for _, value := range additions {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	return values
}
