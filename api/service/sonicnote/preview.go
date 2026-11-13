package sonicnote

import (
	"context"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// PreviewRecordings 预览指定 Key 账号的远端录音列表（只读）。
// 为给出"精确到该设备"的 summary，必须拉全该账号远端录音（远端分页，循环翻页、无上限），
// 标注本地状态后由 FilterAndPaginatePreview 过滤/分页。
func (s *SyncService) PreviewRecordings(ctx context.Context, eid, userID int64, apiKey, syncStatus string, page, size int, full bool) (*model.DeviceRecordingPreviewPage, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("设备未填写 Key")
	}
	token, err := s.client.Login(ctx, apiKey)
	if err != nil {
		return nil, err
	}
	raw, err := s.client.ListAllRecordings(ctx, token)
	if err != nil {
		return nil, err
	}
	states, err := model.GetExistingSyncSourceStates(ctx, eid, userID, SonicNoteProvider, remoteIDsOf(raw))
	if err != nil {
		return nil, err
	}
	all := make([]model.DeviceRecordingPreviewItem, 0, len(raw))
	for _, item := range raw {
		id, _ := item["audioId"].(string)
		if id == "" {
			continue
		}
		title, _ := item["recordNickName"].(string)
		if title == "" {
			title, _ = item["recordName"].(string)
		}
		// audio_available：列表层是否带 audioUrl（"音频 URL 可获取"的充分条件；列表无 URL 不代表 detail 一定没有）
		au, _ := item["audioUrl"].(string)
		all = append(all, model.DeviceRecordingPreviewItem{
			RemoteID:           id,
			Title:              title,
			DurationMs:         extractDurationMs(item),
			RecordingStartTime: ExtractRecordingStartTime(item),
			SyncStatus:         states[id].PreviewStatus(),
			AudioAvailable:     au != "",
		})
	}
	resp := model.FilterAndPaginatePreview(all, syncStatus, page, size, full)
	return &resp, nil
}
