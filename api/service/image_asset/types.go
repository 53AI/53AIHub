package image_asset

import "time"

// ImageDownloadTask 图片下载任务
type ImageDownloadTask struct {
	BatchID     string `json:"batch_id"`
	FileBodyID  int64  `json:"file_body_id"`
	Eid         int64  `json:"eid"`
	UserID      int64  `json:"user_id"`
	StaticPath  string `json:"static_path"`   // 原始 /static/... 路径
	AbsoluteURL string `json:"absolute_url"` // 完整下载URL
	PreviewKey  string `json:"preview_key"`  // 预览键
	StorageKey  string `json:"storage_key"`  // 存储键
	MimeType    string `json:"mime_type"`    // MIME类型
	Retry       int    `json:"retry"`        // 重试次数
	EnqueueTs   int64  `json:"enqueue_ts"`   // 入队时间戳
}

// BatchMeta 批次元数据
type BatchMeta struct {
	BatchID       string            `json:"batch_id"`
	FileBodyID    int64             `json:"file_body_id"`
	Eid           int64             `json:"eid"`
	UserID        int64             `json:"user_id"`
	TotalTasks    int               `json:"total_tasks"`
	PendingTasks  int               `json:"pending_tasks"`
	Mapping       map[string]string `json:"mapping"`        // staticPath -> previewURL
	CreatedAt     time.Time         `json:"created_at"`
	CompletedAt   *time.Time        `json:"completed_at"`
}

// UploadFileMeta 上传文件元数据
type UploadFileMeta struct {
	StaticPath  string
	AbsoluteURL string
	HashStr     string
	PreviewKey  string
	StorageKey  string
	Extension   string
	MimeType    string
	FileName    string
}

// Redis 键常量
const (
	QueueKey       = "imgdl:queue"
	BatchKeyPrefix = "imgdl:batch:"
	PendingPrefix  = "imgdl:pending:"
)

// 下载配置常量
const (
	MaxRetries      = 3
	DefaultTimeout  = 30 * time.Second
	RetryBaseDelay  = 300 * time.Millisecond
)