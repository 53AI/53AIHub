package tools

import (
	"context"
	"net/url"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	sandboxclient "github.com/53AI/53AIHub/service/sandbox"
)

// BuildFileDownloadsFromUploadFiles 将 UploadFile 列表转换为下载信息
func BuildFileDownloadsFromUploadFiles(ctx context.Context, uploadFiles []*model.UploadFile) []sandboxclient.FileDownloadInfo {
	var downloads []sandboxclient.FileDownloadInfo

	for _, file := range uploadFiles {
		url := encodeSandboxDownloadURL(file.GetPreviewOrOssDownloadUrl())
		if url == "" {
			logger.Warnf(ctx, "Empty download URL for file ID=%d", file.ID)
			continue
		}

		downloads = append(downloads, sandboxclient.FileDownloadInfo{
			FileName: file.FileName,
			URL:      url,
			MimeType: file.MimeType,
			Size:     file.Size,
		})

		logger.Infof(ctx, "【沙盒】download_files 项: file_id=%d file_name=%s url=%s mime=%s size=%d", file.ID, file.FileName, url, file.MimeType, file.Size)
	}

	return downloads
}

func encodeSandboxDownloadURL(rawURL string) string {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return ""
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return trimmed
	}
	return parsed.String()
}
