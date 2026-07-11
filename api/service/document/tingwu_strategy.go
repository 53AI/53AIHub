package document

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/docconv"
)

type TingwuDocumentStrategy struct {
	libraryId int64
}

func NewTingwuDocumentStrategy(libraryId int64) *TingwuDocumentStrategy {
	return &TingwuDocumentStrategy{libraryId: libraryId}
}

func (s *TingwuDocumentStrategy) Process(content []byte, filename string, fileSize int64, eid, userID int64) (*DocumentProcessResult, error) {
	return nil, fmt.Errorf("TingwuDocumentStrategy requires UploadFile, use ProcessWithUploadFile instead")
}

func (s *TingwuDocumentStrategy) ProcessWithUploadFile(fileID int64, content []byte, filename string, fileSize int64, eid, userID int64, uploadFile *model.UploadFile, parseType string) (*DocumentProcessResult, error) {
	ctx := context.Background()

	platformSetting, err := model.GetPlatformSettingByEidAndPlatformKey(eid, model.PLATFORM_KEY_TINGWU)
	if err != nil {
		return nil, fmt.Errorf("获取听悟配置失败: %w", err)
	}
	if platformSetting == nil || platformSetting.Setting == "" {
		return nil, fmt.Errorf("听悟平台配置未找到")
	}

	var platformConfig docconv.TingWuConfig
	if err := json.Unmarshal([]byte(platformSetting.Setting), &platformConfig); err != nil {
		return nil, fmt.Errorf("解析听悟配置失败: %w", err)
	}

	client, err := docconv.NewTingWuClient(&platformConfig)
	if err != nil {
		return nil, fmt.Errorf("创建听悟客户端失败: %w", err)
	}

	sourceURL := uploadFile.GetPreviewOrOssDownloadUrl()
	logger.Infof(ctx, "【听悟直连】开始转换 - fileID=%d filename=%s eid=%d", fileID, filename, eid)

	resp, err := client.ConvertSync(ctx, sourceURL)
	if err != nil {
		logger.Errorf(ctx, "【听悟直连】转换失败 - fileID=%d error=%v", fileID, err)
		return nil, fmt.Errorf("听悟转换失败: %w", err)
	}

	logger.Infof(ctx, "【听悟直连】转换成功 - fileID=%d content_len=%d summary_len=%d insight_len=%d",
		fileID, len(resp.Content), len(resp.Summary), len(resp.InsightSummary))

	// 保存 summary、insight_summary 到 file 表（与 docconv queue.go 逻辑对齐）
	if fileID > 0 {
		updates := map[string]interface{}{}
		if resp.Summary != "" {
			updates["summary"] = resp.Summary
		}
		if resp.InsightSummary != "" {
			updates["insight_summary"] = resp.InsightSummary
		}

		if common.IsMediaFile(filename) {
			mediaURL := uploadFile.GetPreviewOrOssDownloadUrl()
			probeCtx, probeCancel := context.WithTimeout(ctx, 30*time.Second)
			if d := common.ProbeDurationMs(probeCtx, mediaURL); d > 0 {
				updates["duration_ms"] = d
			}
			probeCancel()
		}

		if len(updates) > 0 {
			if err := model.DB.Model(&model.File{}).Where("id = ?", fileID).Updates(updates).Error; err != nil {
				logger.Errorf(ctx, "【听悟直连】保存 summary 失败 - fileID=%d error=%v", fileID, err)
			} else {
				logger.Infof(ctx, "【听悟直连】保存 summary 成功 - fileID=%d summary_len=%d insight_len=%d",
					fileID, len(resp.Summary), len(resp.InsightSummary))
			}
		}
	}

	return &DocumentProcessResult{
		OriginalContent:  "",
		ProcessedContent: resp.Content,
		StorageKey:       "",
		StorageType:      "",
		FileType:         "audio",
		FileName:         filename,
		FileSize:         fileSize,
		NeedsConversion:  false,
		DeleteOriginal:   false,
	}, nil
}

func (s *TingwuDocumentStrategy) GetStrategyName() string {
	return model.PLATFORM_KEY_TINGWU
}
