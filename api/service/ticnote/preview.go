package ticnote

import (
	"context"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// PreviewRecordings 预览指定 AppKey 账号的远端录音列表（只读）。
// TicNote 无远端分页：一次拉全量文件树，再标注状态、过滤/分页。
func (s *SyncService) PreviewRecordings(ctx context.Context, eid, userID int64, apiKey, syncStatus string, page, size int, full bool) (*model.DeviceRecordingPreviewPage, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("设备未填写 Key")
	}
	client := s.clientFor(ctx, apiKey)
	token, err := client.Login(ctx, apiKey)
	if err != nil {
		return nil, err
	}
	recordings, err := client.ListRecordings(ctx, token)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(recordings))
	for _, r := range recordings {
		ids = append(ids, r.RecordID)
	}
	states, err := model.GetExistingSyncSourceStates(ctx, eid, userID, TicNoteProvider, ids)
	if err != nil {
		return nil, err
	}
	all := make([]model.DeviceRecordingPreviewItem, 0, len(recordings))
	for _, r := range recordings {
		// 远端文件名为空（设备直录常见）时用 录音_<recordID> 兜底，与同步落库命名一致，
		// 前端列表不再出现空标题。
		title := r.FileName
		if strings.TrimSpace(title) == "" {
			title = "录音_" + r.RecordID
		}
		all = append(all, model.DeviceRecordingPreviewItem{
			RemoteID:           r.RecordID,
			Title:              title,
			DurationMs:         r.DurationMs,
			RecordingStartTime: r.RecordTimeMs,
			SyncStatus:         states[r.RecordID].PreviewStatus(),
		})
	}
	resp := model.FilterAndPaginatePreview(all, syncStatus, page, size, full)
	return &resp, nil
}
