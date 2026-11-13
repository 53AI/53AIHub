package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
)

type recordingSpeakerCompany struct {
	Name       string            `json:"name"`
	Summary    string            `json:"summary,omitempty"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

type recordingSpeakerProfile struct {
	Name       string                   `json:"name"`
	Aliases    []string                 `json:"aliases,omitempty"`
	Summary    string                   `json:"summary,omitempty"`
	Attributes map[string]string        `json:"attributes,omitempty"`
	Company    *recordingSpeakerCompany `json:"company,omitempty"`
}

// 控制档案字段长度，避免人物档案挤占本次会议材料的模型上下文。
func speakerProfileExcerpt(text string, limit int) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) > limit {
		return string(runes[:limit]) + "…"
	}
	return string(runes)
}

func speakerProfileBusinessAttributes(attrs map[string]string, keys ...string) map[string]string {
	business := make(map[string]string)
	for _, key := range keys {
		if value := speakerProfileExcerpt(attrs[key], 160); value != "" {
			business[key] = value
		}
	}
	return business
}

// boundRecordingSpeakerIDs 只提取转写中显式绑定的人员，不能通过姓名猜测身份。
func boundRecordingSpeakerIDs(raw string) []int64 {
	ids := make([]int64, 0)
	seen := make(map[int64]bool)
	add := func(hashID string) {
		id, err := hashids.TryParseID(strings.TrimSpace(hashID))
		if err == nil && id > 0 && !seen[id] && len(ids) < 12 {
			seen[id] = true
			ids = append(ids, id)
		}
	}

	switch {
	case strings.HasPrefix(strings.TrimSpace(raw), "{"):
		var parsed dashScopeTranscriptJSON
		if json.Unmarshal([]byte(raw), &parsed) == nil {
			for _, block := range parsed.Transcripts {
				for _, sentence := range block.Sentences {
					if sentence.Contact != nil {
						add(sentence.Contact.ID)
					}
				}
			}
		}
	case strings.HasPrefix(strings.TrimSpace(raw), "["):
		var items []sonicNoteTranscriptItem
		if json.Unmarshal([]byte(raw), &items) == nil {
			for _, item := range items {
				if item.Contact != nil {
					add(item.Contact.ID)
				}
			}
		}
	}
	// 仅非 JSON 的 Markdown 解析隐藏注释；不能把 JSON 发言正文里的伪注释认作绑定。
	if !json.Valid([]byte(raw)) {
		for _, match := range contactIDExtractPattern.FindAllStringSubmatch(raw, -1) {
			add(match[1])
		}
	}
	return ids
}

// buildRecordingSpeakerProfiles 仅按当前企业及显式绑定的人员 ID 取档案，不召回历史会议事实。
func buildRecordingSpeakerProfiles(ctx context.Context, eid, fileID int64, raw string) string {
	ids := boundRecordingSpeakerIDs(raw)
	if len(ids) == 0 {
		return "{}"
	}
	var entities []model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).
		Where("id IN ? AND eid = ? AND entity_type = ? AND is_deleted = ? AND merged_into_id = ?",
			ids, eid, "person", false, 0).Find(&entities).Error; err != nil {
		logger.Warnf(ctx, "【会议人物档案】读取人物失败 fileID=%d err=%v", fileID, err)
		return "{}"
	}
	if len(entities) == 0 {
		return "{}"
	}

	byID := make(map[int64]model.RecordingMemoryEntity, len(entities))
	byOwner := make(map[int64][]model.RecordingMemoryEntity)
	for _, entity := range entities {
		byID[entity.ID] = entity
		byOwner[entity.OwnerID] = append(byOwner[entity.OwnerID], entity)
	}
	// 人物可跨 owner 关联，所属企业关系仍按各档案原有 owner 查询。
	companies := make(map[int64]RecordingMemoryEntityRelationView)
	for ownerID, group := range byOwner {
		related, _, err := recordingMemoryEntityRelationSummaries(ctx, eid, ownerID, group)
		if err != nil {
			logger.Warnf(ctx, "【会议人物档案】查询企业关系失败 fileID=%d err=%v", fileID, err)
			continue
		}
		for id, company := range related {
			companies[id] = company
		}
	}
	profiles := make([]recordingSpeakerProfile, 0, len(entities))
	for _, id := range ids {
		entity, found := byID[id]
		if !found {
			continue
		}
		person := recordingSpeakerProfile{
			Name:       entity.CanonicalName,
			Aliases:    decodeStringSlice(entity.AliasesJSON),
			Summary:    speakerProfileExcerpt(string(entity.Summary), 800),
			Attributes: speakerProfileBusinessAttributes(decodeStringMap(entity.AttributesJSON), "position", "demand", "relationship"),
		}
		if company, ok := companies[id]; ok {
			person.Company = &recordingSpeakerCompany{
				Name:       company.RelatedName,
				Summary:    speakerProfileExcerpt(company.Summary, 500),
				Attributes: speakerProfileBusinessAttributes(company.Attributes, "industry", "region"),
			}
		}
		profiles = append(profiles, person)
	}
	if len(profiles) == 0 {
		return "{}"
	}
	data, err := json.Marshal(map[string]interface{}{"people": profiles})
	if err != nil {
		return "{}"
	}
	return string(data)
}

// loadRecordingSpeakerProfiles 复用纪要/洞察现有转写来源，无关联人员时不额外引入上下文。
func loadRecordingSpeakerProfiles(ctx context.Context, eid, fileID int64) string {
	if file, err := model.GetFileByID(eid, fileID); err != nil || file == nil {
		return "{}"
	}
	raw, err := loadTranscriptTextRaw(ctx, eid, fileID)
	if err != nil {
		return "{}"
	}
	return buildRecordingSpeakerProfiles(ctx, eid, fileID, raw)
}
