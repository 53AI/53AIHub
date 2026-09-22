package service

import (
	"context"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/actionsystem"
)

// ActionSourceLinkView 是 Action 的原始会议来源入口：把来源身份解析成可导航的
// 录音链接（recording_id 可直接用于 /recording/detail/:id）。availability 决定
// 客户端是否可点击：
//   - available   → recording_id 可导航，点击进会议详情；
//   - deleted     → 原始录音已被删除，只展示「原始会议已删除」，不可点；
//   - unavailable → 来源无法解析为可导航录音（身份缺失 / 非录音来源 / 读取失败），
//     只展示「原始来源暂不可用」，不可点。
//
// recording_id 只在 available 时下发（omitempty）：不可导航的 id 不下发，客户端
// 无死链可点。不可解析的来源不猜 id（PLAN 7.3「不可解析不猜」）。
type ActionSourceLinkView struct {
	SourceType   string `json:"source_type"`
	RecordingID  string `json:"recording_id,omitempty"`
	Title        string `json:"title,omitempty"`
	OccurredAt   int64  `json:"occurred_at,omitempty"`
	Availability string `json:"availability"`
}

const (
	ActionSourceLinkAvailable   = "available"
	ActionSourceLinkDeleted     = "deleted"
	ActionSourceLinkUnavailable = "unavailable"
)

// collectActionMeetingSourceIDs 按首次关联顺序收集会议 canonical id：
// 先机会自身的 source_meeting_id，再 SourceRef（primary → related），最后
// EvidenceRef（sort_order 升序）；同一 id 只保留首次出现。
func collectActionMeetingSourceIDs(sourceMeetingID string, sourceRefs []actionsystem.SourceRef, evidenceRefs []actionsystem.EvidenceRef) []string {
	result := make([]string, 0, 1+len(sourceRefs)+len(evidenceRefs))
	seen := make(map[string]struct{})
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	add(sourceMeetingID)
	for _, ref := range sourceRefs {
		if ref.SourceType == model.SourceTypeMeeting {
			add(ref.CanonicalID)
		}
	}
	for _, ref := range evidenceRefs {
		if ref.SourceType == model.SourceTypeMeeting {
			add(ref.SourceID)
		}
	}
	return result
}

// resolveActionSourceLinks 把会议 canonical id 解析为来源链接：常量次批量查询
// （身份映射 1 次 + 录音文件 1 次），按可导航 recording_id 去重、按首次关联顺序输出。
func (s *ActionRuntimeService) resolveActionSourceLinks(ctx context.Context, eid int64, meetingSourceIDs []string) ([]*ActionSourceLinkView, error) {
	if len(meetingSourceIDs) == 0 {
		return nil, nil
	}
	ids := make([]string, 0, len(meetingSourceIDs))
	seen := make(map[string]struct{}, len(meetingSourceIDs))
	for _, id := range meetingSourceIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	identities, err := model.GetCanonicalSourceIdentitiesByCanonicalIDs(ctx, eid, ids)
	if err != nil {
		return nil, err
	}
	fileIDs := make([]int64, 0, len(ids))
	fileIDSet := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		identity := identities[id]
		if identity == nil || identity.LegacySourceType != model.LegacySourceTypeRecordingFile {
			continue
		}
		fileID, parseErr := strconv.ParseInt(identity.LegacySourceID, 10, 64)
		if parseErr != nil || fileID <= 0 {
			continue
		}
		if _, ok := fileIDSet[fileID]; ok {
			continue
		}
		fileIDSet[fileID] = struct{}{}
		fileIDs = append(fileIDs, fileID)
	}
	files, err := model.GetFilesByIDs(eid, fileIDs)
	if err != nil {
		return nil, err
	}
	fileByID := make(map[int64]model.File, len(files))
	for _, file := range files {
		fileByID[file.ID] = file
	}
	links := make([]*ActionSourceLinkView, 0, len(ids))
	linkSeen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		identity := identities[id]
		if identity == nil || identity.LegacySourceType != model.LegacySourceTypeRecordingFile {
			if _, ok := linkSeen["unresolved:"+id]; ok {
				continue
			}
			linkSeen["unresolved:"+id] = struct{}{}
			links = append(links, &ActionSourceLinkView{SourceType: model.SourceTypeMeeting, Availability: ActionSourceLinkUnavailable})
			continue
		}
		fileID, parseErr := strconv.ParseInt(identity.LegacySourceID, 10, 64)
		if parseErr != nil || fileID <= 0 {
			if _, ok := linkSeen["unresolved:"+id]; ok {
				continue
			}
			linkSeen["unresolved:"+id] = struct{}{}
			links = append(links, &ActionSourceLinkView{SourceType: model.SourceTypeMeeting, Availability: ActionSourceLinkUnavailable})
			continue
		}
		file, ok := fileByID[fileID]
		if !ok || file.IsDeleted || file.IsActiveDeleted {
			if _, ok := linkSeen["deleted:"+id]; ok {
				continue
			}
			linkSeen["deleted:"+id] = struct{}{}
			links = append(links, &ActionSourceLinkView{SourceType: model.SourceTypeMeeting, Availability: ActionSourceLinkDeleted})
			continue
		}
		// 多段/多来源指向同一录音时只保留首次出现的可导航链接。
		if _, ok := linkSeen["available:"+identity.LegacySourceID]; ok {
			continue
		}
		linkSeen["available:"+identity.LegacySourceID] = struct{}{}
		links = append(links, &ActionSourceLinkView{
			SourceType:   model.SourceTypeMeeting,
			RecordingID:  identity.LegacySourceID,
			Title:        recordingSourceTitle(file.Path),
			OccurredAt:   file.CreatedTime,
			Availability: ActionSourceLinkAvailable,
		})
	}
	return links, nil
}

// recordingSourceTitle 从录音文件路径推导展示名：basename 去掉最后一层扩展名，
// 与客户端 _deriveTitle 口径一致；推导不出时返回空串，由客户端兜底文案。
func recordingSourceTitle(path string) string {
	base := strings.TrimSpace(path)
	if idx := strings.LastIndex(base, "/"); idx >= 0 {
		base = base[idx+1:]
	}
	if dot := strings.LastIndex(base, "."); dot > 0 {
		base = base[:dot]
	}
	return strings.TrimSpace(base)
}
