package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2steps "github.com/53AI/53AIHub/rag-pipeline-v2/steps"
	"github.com/53AI/53AIHub/service/rag"
)

// GenerateQuestionsAndSummaryDirect 直接异步生成文件摘要、常见问法和实体。
// 该方法不创建 RAG Job，也不经过 RAG Pipeline。
func GenerateQuestionsAndSummaryDirect(ctx context.Context, eid, fileID int64) error {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件失败: %v", err)
	}

	body, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件内容失败: %v", err)
	}
	if body == nil {
		return fmt.Errorf("文件内容为空，无法生成摘要")
	}
	content, err := body.GetContent()
	if err != nil {
		return fmt.Errorf("读取文件内容失败: %v", err)
	}
	if strings.TrimSpace(content) == "" {
		return fmt.Errorf("文件内容为空，无法生成摘要")
	}

	chunkConfig, err := rag.NewChunkConfigService(model.DB).GetConfigWithFileID(eid, &file.LibraryID, &fileID)
	if err != nil {
		return fmt.Errorf("获取分块配置失败: %v", err)
	}
	if chunkConfig == nil {
		return fmt.Errorf("未找到分块配置")
	}

	contentForLLM := content
	if file.IsRecordingOriginType() && v2steps.NormalizeRecordingContentForLLMFn != nil {
		contentForLLM = v2steps.NormalizeRecordingContentForLLMFn(content)
	}

	if err := model.UpdateFileAIGenerateSQStatus(fileID, model.AIGenerateSQStatusPending); err != nil {
		return fmt.Errorf("更新文件生成状态失败: %v", err)
	}

	// 请求结束后仍需继续执行异步任务，不能直接复用请求 context。
	runDirectSummaryGenerationTasks(context.Background(),
		func(taskBaseCtx context.Context) {
			taskCtx, cancel := context.WithTimeout(taskBaseCtx, 10*time.Minute)
			defer cancel()
			if _, _, err := v2steps.GenerateFileSummaryAndFAQForced(taskCtx, model.DB, eid, fileID, contentForLLM, chunkConfig); err != nil {
				logger.Errorf(taskCtx, "直接生成文件摘要和问法失败: file_id=%d, err=%v", fileID, err)
				_ = model.UpdateFileAIGenerateSQStatus(fileID, model.AIGenerateSQStatusFail)
			}
		},
		func(taskBaseCtx context.Context) {
			taskCtx, cancel := context.WithTimeout(taskBaseCtx, 10*time.Minute)
			defer cancel()
			if err := v2steps.ExtractFileEntities(taskCtx, model.DB, eid, fileID, contentForLLM); err != nil {
				logger.Errorf(taskCtx, "直接抽取文件实体失败: file_id=%d, err=%v", fileID, err)
			}
		},
	)
	return nil
}

func runDirectSummaryGenerationTasks(ctx context.Context, summaryTask, entityTask func(context.Context)) {
	go summaryTask(ctx)
	go entityTask(ctx)
}
