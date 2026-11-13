package model

// DeviceRecordingPreviewItem 录音设备远端录音预览项（只读）。
type DeviceRecordingPreviewItem struct {
	RemoteID   string `json:"remote_id"`
	Title      string `json:"title"`
	DurationMs int64  `json:"duration_ms"`
	// RecordingStartTime 远端录音的開始录音时间（毫秒，0 表示远端未提供）
	RecordingStartTime int64 `json:"recording_start_time"`
	SyncStatus         string `json:"sync_status"` // synced | file_deleted | not_synced
	// AudioAvailable 列表层是否带音频 URL（SonicNote）；TicNote 音频 URL 仅在 detail，恒 false，见对接文档。
	AudioAvailable bool `json:"audio_available"`
}

// DeviceRecordingPreviewPage 远端录音预览结果：分页与全量共用同一结构，
// SyncStatus 为本次筛选状态；分页模式下 Items 仅当前页，full=true 时为筛选后全部。
type DeviceRecordingPreviewPage struct {
	Items      []DeviceRecordingPreviewItem
	SyncStatus string
	Page       int
	Size       int
	Total      int
	HasMore    bool
	Summary    DeviceRecordingPreviewSummary
}

// DeviceRecordingPreviewSummary 全量口径统计（不随分页变化，精确到该设备）。
type DeviceRecordingPreviewSummary struct {
	Total       int64 `json:"total"`        // 远端录音总数
	Synced      int64 `json:"synced"`       // 已同步且文件有效
	FileDeleted int64 `json:"file_deleted"` // 已同步但文件被软删（需重同步）
	NotSynced   int64 `json:"not_synced"`   // 未同步（远端有、本地无同步记录）
	Unsynced    int64 `json:"unsynced"`     // 未同步合计 = not_synced + file_deleted
}

// PreviewStatus 把本地同步状态映射为预览展示值。
func (s SyncSourceState) PreviewStatus() string {
	switch {
	case s.HasSource && s.FileActive:
		return "synced"
	case s.HasSource:
		return "file_deleted"
	default:
		return "not_synced"
	}
}

// BuildPreviewSummaryFromItems 由全量已标注 items 统计 summary（与分页无关）。
func BuildPreviewSummaryFromItems(items []DeviceRecordingPreviewItem) DeviceRecordingPreviewSummary {
	s := DeviceRecordingPreviewSummary{Total: int64(len(items))}
	for _, it := range items {
		switch it.SyncStatus {
		case "synced":
			s.Synced++
		case "file_deleted":
			s.FileDeleted++
		default:
			s.NotSynced++
		}
	}
	s.Unsynced = s.NotSynced + s.FileDeleted
	return s
}

// FilterAndPaginatePreview 由全量已标注 items 生成预览结果：
// summary 恒为全量口径；按 syncStatus（all|synced|unsynced，unsynced = not_synced + file_deleted）
// 过滤后分页；full=true 时返回筛选后全部（page=1、size=total、has_more=false）。
func FilterAndPaginatePreview(all []DeviceRecordingPreviewItem, syncStatus string, page, size int, full bool) DeviceRecordingPreviewPage {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 1
	}
	filtered := make([]DeviceRecordingPreviewItem, 0, len(all))
	for _, it := range all {
		if previewStatusMatches(it.SyncStatus, syncStatus) {
			filtered = append(filtered, it)
		}
	}
	resp := DeviceRecordingPreviewPage{
		SyncStatus: syncStatus,
		Page:       page,
		Size:       size,
		Total:      len(filtered),
		Summary:    BuildPreviewSummaryFromItems(all),
	}
	if full {
		resp.Items = filtered
		resp.Page = 1
		resp.Size = resp.Total
		resp.HasMore = false
		return resp
	}
	start := (page - 1) * size
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + size
	if end > len(filtered) {
		end = len(filtered)
	}
	resp.Items = filtered[start:end]
	resp.HasMore = end < len(filtered)
	return resp
}

// previewStatusMatches 判断单条状态是否属于目标筛选。
func previewStatusMatches(status, want string) bool {
	switch want {
	case "synced":
		return status == "synced"
	case "unsynced":
		return status == "not_synced" || status == "file_deleted"
	default: // all
		return true
	}
}
