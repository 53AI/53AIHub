package model

// DeviceRecordingPreviewItem 录音设备远端录音预览项（只读）。
type DeviceRecordingPreviewItem struct {
	RemoteID   string `json:"remote_id"`
	Title      string `json:"title"`
	DurationMs int64  `json:"duration_ms"`
	SyncStatus string `json:"sync_status"` // synced | file_deleted | not_synced
}

// DeviceRecordingPreviewPage 远端录音预览分页。
type DeviceRecordingPreviewPage struct {
	Items   []DeviceRecordingPreviewItem
	Page    int
	Size    int
	Total   int
	HasMore bool
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
