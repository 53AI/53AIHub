package docconv

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// Service 文档转换服务
type Service struct {
	client        *Client
	queueManager  *QueueManager
	configService *DocumentConfigService
	ConfigId      int64
}

// NewService 创建文档转换服务
func NewService(libraryId int64) *Service {
	return &Service{
		client:        NewClient(),
		queueManager:  NewQueueManager(),
		configService: NewDocumentConfigService(libraryId),
	}
}

// ConvertSync 同步转换文档
func (s *Service) ConvertSync(ctx context.Context, sourceURL, parserType string, libraryID, fileID int64) (string, error) {
	logger.Infof(ctx, "starting sync conversion for URL: %s", sourceURL)

	req := &ConvertRequest{
		SourceURL:    sourceURL,
		OutputFormat: "md",
		ParserType:   parserType,
		FileID:       fileID, // 添加FileID
	}

	// 提交任务
	jobResp, err := s.client.SubmitJob(ctx, req)
	if err != nil {
		// 特别处理 mineru.net token 错误
		if convertErr, ok := err.(*ConvertError); ok {
			if convertErr.Message == "mineru_config requires token" {
				logger.Errorf(ctx, "🚨 CRITICAL ERROR: MinerU.net token is missing! Please configure platform setting for mineru.net with valid api_key")
				// 创建一个更明确的错误消息
				return "", &ConvertError{
					Op:      "submit",
					Code:    "mineru_token_missing",
					Message: "create mineru.net converter: mineru.net token is required in job_params",
				}
			}
		}
		return "", err
	}

	// 轮询并下载
	return s.queueManager.pollAndDownload(ctx, jobResp.JobID, libraryID, fileID)
}

// ConvertAsync 异步转换文档（入队）
func (s *Service) ConvertAsync(ctx context.Context, sourceURL, parserType string) (string, error) {
	logger.Infof(ctx, "starting async conversion for URL: %s", sourceURL)
	return s.queueManager.Enqueue(ctx, sourceURL, parserType)
}

// ConvertSyncWithConfig 根据配置同步转换文档
func (s *Service) ConvertSyncWithConfig(ctx context.Context, sourceURL string, eid int64, filename, theParseType string, libraryID, fileID int64) (string, error) {
	logger.Infof(ctx, "🚀 [DOC_SERVICE] 开始配置化文档转换 - URL: %s, eid: %d, filename: %s", sourceURL, eid, filename)

	// 获取解析器类型和配置
	parserType, textinConfig, mineruConfig, mineruLocalConfig, paddleConfig, tingwuConfig, err := s.configService.GetParserForFile(ctx, eid, filename, theParseType)
	s.ConfigId = s.configService.ConfigId
	if err != nil {
		logger.Errorf(ctx, "❌ [DOC_SERVICE] 配置查询失败 - eid: %d, filename: %s, error: %v", eid, filename, err)
		return "", err
	}

	logger.Infof(ctx, "🎯 [DOC_SERVICE] 最终选择解析器 - parser: %s, filename: %s", parserType, filename)

	// 构建请求
	var req *ConvertRequest
	if parserType == model.PLATFORM_KEY_TEXTIN && textinConfig != nil {
		// 使用 textin 配置
		config := s.configService.ConvertToTextinConfig(textinConfig)
		req = &ConvertRequest{
			SourceURL:    sourceURL,
			OutputFormat: "md",
			JobParams: &JobParams{
				ParserType:   "textin",
				TextinConfig: config,
			},
		}
		logger.Infof(ctx, "📋 [DOC_SERVICE] 构建 textin 请求 - app_id: %s, parse_mode: %s, dpi: %d, get_image: %s",
			config.AppID, config.ParseMode, config.DPI, config.GetImage)
	} else if parserType == model.PLATFORM_KEY_MINERU_NET && mineruConfig != nil {
		// 使用 mineru 配置
		config := s.configService.ConvertToMinerUConfig(mineruConfig)
		req = &ConvertRequest{
			SourceURL:    sourceURL,
			OutputFormat: "md",
			JobParams: &JobParams{
				ParserType:   model.PLATFORM_KEY_MINERU_NET,
				MinerUConfig: config,
			},
		}
		logger.Infof(ctx, "⛏️ [DOC_SERVICE] 构建 mineru 请求 - base_url: %s, language: %s", config.BaseURL, config.Language)
	} else if parserType == model.PLATFORM_KEY_MINERU_LOCAL && mineruLocalConfig != nil {
		// 使用 mineru.local 配置
		config := s.configService.ConvertToMinerULocalConfig(mineruLocalConfig)
		req = &ConvertRequest{
			SourceURL:    sourceURL,
			OutputFormat: "md",
			JobParams: &JobParams{
				ParserType:        model.PLATFORM_KEY_MINERU_LOCAL,
				MinerULocalConfig: config,
			},
		}
		logger.Infof(ctx, "⛏️ [DOC_SERVICE] 构建 mineru.local 请求 - base_url: %s", config.BaseURL)
	} else if (parserType == model.PLATFORM_KEY_PADDLEPADDLE_PP_OCR_V5 ||
		parserType == model.PLATFORM_KEY_PADDLEPADDLE_PP_STRUCTURE_V3 ||
		parserType == model.PLATFORM_KEY_PADDLEPADDLE_PADDLEOCR_VL) && paddleConfig != nil {
		config := s.configService.ConvertToPaddlePaddleConfig(paddleConfig)
		req = &ConvertRequest{
			SourceURL:    sourceURL,
			OutputFormat: "md",
			JobParams: &JobParams{
				ParserType:         "paddlepaddle",
				PaddlePaddleConfig: config,
			},
		}
		logger.Infof(ctx, "🧾 [DOC_SERVICE] 构建 PaddlePaddle 请求 - api_type: %s, api_url: %s", config.APIType, config.APIURL)
	} else if parserType == model.PLATFORM_KEY_TINGWU && tingwuConfig != nil {
		// 使用通义听悟配置
		config := s.configService.ConvertToTingWuConfig(tingwuConfig)
		req = &ConvertRequest{
			SourceURL:    sourceURL,
			OutputFormat: "md",
			FileID:       fileID, // 传递fileID
			JobParams: &JobParams{
				ParserType:   model.PLATFORM_KEY_TINGWU,
				TingWuConfig: config,
			},
		}
		logger.Infof(ctx, "👂 [DOC_SERVICE] 构建 通义听悟 请求 - endpoint: %s", config.Endpoint)
	} else {
		// 使用默认解析器
		req = &ConvertRequest{
			SourceURL:    sourceURL,
			OutputFormat: "md",
			ParserType:   parserType,
		}
		logger.Infof(ctx, "📄 [DOC_SERVICE] 构建默认请求 - parser_type: %s", parserType)
	}

	logger.Infof(ctx, "📤 [DOC_SERVICE] 提交转换任务 - source_url: %s", sourceURL)

	// 提交任务
	jobResp, err := s.client.SubmitJob(ctx, req)
	if err != nil {
		logger.Errorf(ctx, "❌ [DOC_SERVICE] 任务提交失败 - error: %v", err)
		return "", fmt.Errorf("job submission failed: %w", err)
	}

	// 检查任务状态直到完成
	result, err := s.waitForJobCompletion(ctx, jobResp.JobID, libraryID, fileID)
	if err != nil {
		logger.Errorf(ctx, "❌ [DOC_SERVICE] 结果下载失败 - job_id: %s, error: %v", jobResp.JobID, err)
		return "", fmt.Errorf("job execution failed: %w", err)
	}

	logger.Infof(ctx, "🎉 [DOC_SERVICE] 转换完成 - job_id: %s, result_size: %d bytes", jobResp.JobID, len(result))
	return result, nil
}

// ProcessQueue 处理队列中的任务
func (s *Service) ProcessQueue(ctx context.Context) error {
	task, err := s.queueManager.Dequeue(ctx)
	if err != nil {
		return err
	}

	if task == nil {
		return nil // 队列为空
	}

	// 对于队列任务，暂时传递 0 作为 libraryID 和 fileID
	// 队列模式主要用于异步处理，暂时不支持停止信号检查
	_, err = s.queueManager.ProcessTask(ctx, task, 0, 0)
	return err
}

// CancelTask 取消任务
func (s *Service) CancelTask(ctx context.Context, taskID string) error {
	return s.queueManager.CancelTask(ctx, taskID)
}

// GetQueueSize 获取队列大小
func (s *Service) GetQueueSize(ctx context.Context) (int64, error) {
	return s.queueManager.GetQueueSize(ctx)
}

// waitForJobCompletion 等待作业完成
func (s *Service) waitForJobCompletion(ctx context.Context, jobID string, libraryID, fileID int64) (string, error) {
	// 这里复用 queueManager 的轮询逻辑来等待任务完成
	return s.queueManager.pollAndDownload(ctx, jobID, libraryID, fileID)
}

// Health 健康检查
func (s *Service) Health(ctx context.Context) error {
	return s.client.Health(ctx)
}

// StartWorker 启动队列消费者
func (s *Service) StartWorker(ctx context.Context, concurrency int) {
	if concurrency <= 0 {
		concurrency = 1
	}

	logger.Infof(ctx, "starting docconv worker with concurrency: %d", concurrency)

	for i := 0; i < concurrency; i++ {
		go s.worker(ctx, i)
	}
}

// worker 队列消费者
func (s *Service) worker(ctx context.Context, workerID int) {
	logger.Infof(ctx, "docconv worker %d started", workerID)
	defer logger.Infof(ctx, "docconv worker %d stopped", workerID)

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.ProcessQueue(ctx); err != nil {
				if convertErr, ok := err.(*ConvertError); ok {
					if convertErr.Code == "redis_disabled" {
						// Redis未启用，停止worker
						logger.Warnf(ctx, "worker %d stopped: Redis not enabled", workerID)
						return
					}

					// 对于 ConvertError，记录更详细的错误信息
					logger.Errorf(ctx, "worker %d process queue error: %v (code: %s, op: %s, http_status: %d)",
						workerID, err, convertErr.Code, convertErr.Op, convertErr.HTTPStatus)

					// 如果是 mineru.net token 错误，特别强调
					if strings.Contains(convertErr.Message, "mineru.net token is required") {
						logger.Errorf(ctx, "🚨 CRITICAL ERROR: MinerU.net token is missing! Please configure platform setting for mineru.net with valid api_key")
					}
				} else {
					logger.Errorf(ctx, "worker %d process queue error: %v", workerID, err)
				}
			}
		}
	}
}
