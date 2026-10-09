package ticnote

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
)

// PreviewRecordings 预览指定 AppKey 账号的远端录音列表（只读）。
// TicNote 无远端分页：全量文件树 + 内存分页；列表无时长，duration_ms 恒为 0。
func (s *SyncService) PreviewRecordings(ctx context.Context, eid, userID int64, apiKey string, page, size int) (*model.DeviceRecordingPreviewPage, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("设备未填写 Key")
	}
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	client := s.clientFor(apiKey)
	all, ok := s.cachedPreviewRecordings(eid, userID, apiKey)
	if !ok {
		token, err := client.Login(ctx, apiKey)
		if err != nil {
			return nil, err
		}
		all, err = client.ListRecordings(ctx, token)
		if err != nil {
			return nil, err
		}
		s.cachePreviewRecordings(eid, userID, apiKey, all)
	}
	// 溢出安全：页起点超出总数直接返回空页，避免 (page-1)*size 溢出成负数导致切片 panic。
	total := len(all)
	if int64(page-1) > int64(total)/int64(size) {
		return &model.DeviceRecordingPreviewPage{Items: []model.DeviceRecordingPreviewItem{}, Page: page, Size: size, Total: total, HasMore: false}, nil
	}
	start := (page - 1) * size
	end := start + size
	if end > total {
		end = total
	}
	rows := all[start:end]
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.RecordID)
	}
	states, err := model.GetExistingSyncSourceStates(ctx, eid, userID, TicNoteProvider, ids)
	if err != nil {
		return nil, err
	}
	out := make([]model.DeviceRecordingPreviewItem, 0, len(rows))
	for _, r := range rows {
		out = append(out, model.DeviceRecordingPreviewItem{
			RemoteID:   r.RecordID,
			Title:      r.FileName,
			SyncStatus: states[r.RecordID].PreviewStatus(),
		})
	}
	return &model.DeviceRecordingPreviewPage{Items: out, Page: page, Size: size, Total: total, HasMore: end < total}, nil
}

const previewListTTL = 45 * time.Second

type ticnotePreviewEntry struct {
	list    []Recording
	expires time.Time
}

// previewListCacheKey 列表缓存 key 含 apiKey 指纹：改 AppKey 后不会命中旧账号缓存。
func previewListCacheKey(eid, userID int64, apiKey string) string {
	sum := sha256.Sum256([]byte(apiKey))
	return fmt.Sprintf("%d/%d/%x", eid, userID, sum[:8])
}

// cachedPreviewRecordings 取进程内缓存的远端录音列表（未命中或过期返回 false）。
func (s *SyncService) cachedPreviewRecordings(eid, userID int64, apiKey string) ([]Recording, bool) {
	key := previewListCacheKey(eid, userID, apiKey)
	s.previewMu.Lock()
	defer s.previewMu.Unlock()
	e, ok := s.previewList[key]
	if !ok || time.Now().After(e.expires) {
		return nil, false
	}
	return e.list, true
}

// cachePreviewRecordings 写入列表缓存，并顺手清理过期项避免 map 只增不减。
func (s *SyncService) cachePreviewRecordings(eid, userID int64, apiKey string, list []Recording) {
	key := previewListCacheKey(eid, userID, apiKey)
	now := time.Now()
	s.previewMu.Lock()
	defer s.previewMu.Unlock()
	if s.previewList == nil { // 防御：直接构造 SyncService 时 map 可能为 nil，写入会 panic
		s.previewList = make(map[string]ticnotePreviewEntry)
	}
	for k, e := range s.previewList {
		if now.After(e.expires) {
			delete(s.previewList, k)
		}
	}
	s.previewList[key] = ticnotePreviewEntry{list: list, expires: now.Add(previewListTTL)}
}
