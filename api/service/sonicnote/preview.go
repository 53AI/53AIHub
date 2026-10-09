package sonicnote

import (
	"context"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// PreviewRecordings 预览指定 Key 账号的远端录音列表（只读，SonicNote 原生分页）。
// size 上限 50（远端限制）；用于前端勾选后走"选中同步"。
func (s *SyncService) PreviewRecordings(ctx context.Context, eid, userID int64, apiKey string, page, size int) (*model.DeviceRecordingPreviewPage, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("设备未填写 Key")
	}
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 50 {
		size = 20
	}
	token, err := s.client.Login(ctx, apiKey)
	if err != nil {
		return nil, err
	}
	items, total, err := s.client.ListRecordings(ctx, token, page, size)
	if err != nil {
		return nil, err
	}
	states, err := model.GetExistingSyncSourceStates(ctx, eid, userID, SonicNoteProvider, remoteIDsOf(items))
	if err != nil {
		return nil, err
	}
	out := make([]model.DeviceRecordingPreviewItem, 0, len(items))
	for _, item := range items {
		id, _ := item["audioId"].(string)
		if id == "" {
			continue
		}
		title, _ := item["recordNickName"].(string)
		if title == "" {
			title, _ = item["recordName"].(string)
		}
		out = append(out, model.DeviceRecordingPreviewItem{
			RemoteID:   id,
			Title:      title,
			DurationMs: extractDurationMs(item),
			SyncStatus: states[id].PreviewStatus(),
		})
	}
	// 用除法判断是否还有下一页，避免 page*size 在极大 page 下 int 溢出
	return &model.DeviceRecordingPreviewPage{Items: out, Page: page, Size: size, Total: total, HasMore: total > 0 && page < (total+size-1)/size}, nil
}
