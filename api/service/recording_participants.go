package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
)

// RecordingParticipant 是录音的参会人员（仅包含已关联人员的发言人）。
// 姓名与头像「实时优先、快照兜底」：先按 ContactID 查人员库最新值，查不到回退关联时刻的快照。
type RecordingParticipant struct {
	Name      string `json:"name"`
	Avatar    string `json:"avatar,omitempty"`
	ContactID string `json:"contact_id"`
}

// BuildSpeakerSnapshotsFromMarkdown 从转写 Markdown 中抽取已绑定人员的发言人快照。
// 名称取转写中当时的展示名，头像留空（由读取侧实时补齐）；按人员 ID 去重。
func BuildSpeakerSnapshotsFromMarkdown(md string) []model.FileSpeakerSnapshot {
	if strings.TrimSpace(md) == "" {
		return nil
	}
	seen := make(map[string]struct{})
	snapshots := make([]model.FileSpeakerSnapshot, 0, 4)
	for _, rawLine := range strings.Split(md, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		match := contactIDExtractPattern.FindStringSubmatch(line)
		if len(match) <= 1 {
			continue
		}
		contactID := strings.TrimSpace(match[1])
		if contactID == "" {
			continue
		}
		speakerRaw := ""
		if m := transcriptLineWithTimeRE.FindStringSubmatch(line); m != nil {
			speakerRaw = m[2]
			if speakerRaw == "" {
				speakerRaw = m[3]
			}
		} else if m := transcriptLineNoTimeRE.FindStringSubmatch(line); m != nil {
			speakerRaw = m[1]
			if speakerRaw == "" {
				speakerRaw = m[2]
			}
		}
		speaker := cleanSpeakerName(speakerRaw)
		// 按人员去重：不同发言人被替换为同一人可能是有意为之，参会人员按人去重展示
		if _, ok := seen[contactID]; ok {
			continue
		}
		seen[contactID] = struct{}{}
		snapshots = append(snapshots, model.FileSpeakerSnapshot{
			Name:      speaker,
			ContactID: contactID,
		})
	}
	return snapshots
}

// liveContactProfiles 按 HashID 批量取人员最新姓名/头像。
func liveContactProfiles(ctx context.Context, eid int64, contactHashIDs []string) map[string]model.FileSpeakerSnapshot {
	if len(contactHashIDs) == 0 {
		return nil
	}
	numericIDs := make([]int64, 0, len(contactHashIDs))
	hashByID := make(map[int64]string, len(contactHashIDs))
	for _, hashID := range contactHashIDs {
		id, err := hashids.TryParseID(hashID)
		if err != nil || id <= 0 {
			continue
		}
		numericIDs = append(numericIDs, id)
		hashByID[id] = hashID
	}
	if len(numericIDs) == 0 {
		return nil
	}
	var entities []model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND id IN ? AND is_deleted = false AND merged_into_id = 0 AND entity_type = 'person'", eid, numericIDs).
		Find(&entities).Error; err != nil {
		return nil
	}
	profiles := make(map[string]model.FileSpeakerSnapshot, len(entities))
	for _, entity := range entities {
		avatar := ""
		if strings.TrimSpace(string(entity.AttributesJSON)) != "" {
			var attrs map[string]interface{}
			if json.Unmarshal([]byte(entity.AttributesJSON), &attrs) == nil {
				if a, ok := attrs["avatar"].(string); ok {
					avatar = strings.TrimSpace(a)
				}
			}
		}
		profiles[hashByID[entity.ID]] = model.FileSpeakerSnapshot{
			Name:   strings.TrimSpace(entity.CanonicalName),
			Avatar: avatar,
		}
	}
	return profiles
}

// SyncFileSpeakerSnapshots 依据最新转写重建并落库某录音的发言人快照（绑定/换绑后与懒回填共用）。
func SyncFileSpeakerSnapshots(ctx context.Context, eid, fileID int64, markdown string) error {
	snapshots := BuildSpeakerSnapshotsFromMarkdown(markdown)
	if len(snapshots) > 0 {
		hashIDs := make([]string, 0, len(snapshots))
		for _, snapshot := range snapshots {
			hashIDs = append(hashIDs, snapshot.ContactID)
		}
		profiles := liveContactProfiles(ctx, eid, hashIDs)
		for i := range snapshots {
			if profile, ok := profiles[snapshots[i].ContactID]; ok {
				if profile.Name != "" {
					snapshots[i].Name = profile.Name
				}
				snapshots[i].Avatar = profile.Avatar
			}
		}
	}
	return model.SetFileSpeakerSnapshots(fileID, snapshots)
}

// ListFileParticipants 批量返回每条录音「已关联人员」的发言人（列表与详情共用，保证两处绝对一致）。
// 快照缺失时按转写回填一次并标记，覆盖「本能力上线前已绑定」的少量历史数据。
func ListFileParticipants(ctx context.Context, eid int64, files []model.File) (map[int64][]RecordingParticipant, error) {
	result := make(map[int64][]RecordingParticipant, len(files))
	if len(files) == 0 {
		return result, nil
	}

	fileSnapshots := make(map[int64][]model.FileSpeakerSnapshot, len(files))
	allHashIDs := make([]string, 0, len(files)*2)
	seenHashID := make(map[string]struct{}, len(files)*2)

	for _, file := range files {
		snapshots, healed := model.ParseFileSpeakerSnapshots(file.CleaningRuleInfo)
		if !healed {
			// 回填：仅对尚未回填过且有转写的文件读一次正文；回填后落库并标记，后续不再扫描。
			// 读不到正文时不写标记，避免把已有快照误清空。
			if body, err := model.GetLastFileBodyByFileID(eid, file.ID); err == nil && body != nil {
				markdown, contentErr := body.GetContent()
				if contentErr == nil {
					snapshots = BuildSpeakerSnapshotsFromMarkdown(markdown)
					if syncErr := model.SetFileSpeakerSnapshots(file.ID, snapshots); syncErr != nil {
						logger.Warnf(ctx, "【参会人员】发言人快照回填失败，本次按转写即时返回: fileID=%d err=%v", file.ID, syncErr)
					}
				}
			}
		}
		fileSnapshots[file.ID] = snapshots
		for _, snapshot := range snapshots {
			if _, ok := seenHashID[snapshot.ContactID]; ok {
				continue
			}
			seenHashID[snapshot.ContactID] = struct{}{}
			allHashIDs = append(allHashIDs, snapshot.ContactID)
		}
	}

	// 一条 SQL 批量取最新人员档案，命中则以最新为准，未命中回退快照
	profiles := liveContactProfiles(ctx, eid, allHashIDs)
	for fileID, snapshots := range fileSnapshots {
		participants := make([]RecordingParticipant, 0, len(snapshots))
		for _, snapshot := range snapshots {
			name := snapshot.Name
			avatar := snapshot.Avatar
			if profile, ok := profiles[snapshot.ContactID]; ok {
				if profile.Name != "" {
					name = profile.Name
				}
				avatar = profile.Avatar
			}
			if name == "" {
				continue
			}
			participants = append(participants, RecordingParticipant{
				Name:      name,
				Avatar:    avatar,
				ContactID: snapshot.ContactID,
			})
		}
		result[fileID] = participants
	}
	return result, nil
}
