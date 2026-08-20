package document

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

// maxAudioDownloadBytes 下载/读取音频的最大字节数（与本地文件一致，防超大）。
const maxAudioDownloadBytes = 500 << 20

// AudioFileSource 提供给语音转写策略的音频来源。
type AudioFileSource struct {
	Data []byte // 音频字节（multipart 上传或转存用）
	Size int64
}

// ResolveAudioFile 按环境解析音频文件：
//   - SaaS 版：从 UploadFile 的可访问 URL 下载（公网可达，供 URL 型供应商如 DashScope 使用，也供下载后 multipart）
//   - 本地版：从本地存储读取字节（本地无公网 URL，必须本地上传字节给支持 multipart 的供应商）
//
// 返回字节数据；调用方负责释放/清理（Data 由本函数分配）。
func ResolveAudioFile(ctx context.Context, uploadFile *model.UploadFile) (*AudioFileSource, error) {
	if uploadFile == nil {
		return nil, fmt.Errorf("uploadFile is nil")
	}
	if config.IS_SAAS {
		return downloadAudioFromURL(ctx, uploadFile.GetPreviewOrOssDownloadUrl())
	}
	// 本地版：从存储读取（UploadFile.Key 指向存储对象，LocalStorage/OSS 均可 Load）
	data, err := storage.StorageInstance.Load(uploadFile.Key)
	if err != nil {
		return nil, fmt.Errorf("读取本地音频文件失败 key=%s: %w", uploadFile.Key, err)
	}
	if int64(len(data)) > maxAudioDownloadBytes {
		return nil, fmt.Errorf("音频超过下载上限 %d 字节", maxAudioDownloadBytes)
	}
	logger.Infof(ctx, "ResolveAudioFile: 本地读取音频 key=%s size=%d", uploadFile.Key, len(data))
	return &AudioFileSource{Data: data, Size: int64(len(data))}, nil
}

// downloadAudioFromURL 从 URL 下载音频到内存（SaaS 版）。
func downloadAudioFromURL(ctx context.Context, url string) (*AudioFileSource, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载音频 URL 失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载音频 URL 返回 HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxAudioDownloadBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxAudioDownloadBytes {
		return nil, fmt.Errorf("音频超过下载上限 %d 字节", maxAudioDownloadBytes)
	}
	logger.Infof(ctx, "ResolveAudioFile: URL 下载音频 size=%d url=%s", len(data), url)
	return &AudioFileSource{Data: data, Size: int64(len(data))}, nil
}
