package document

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

// dashScopeSemaphore 限制 DashScope 并发调用数，避免瞬间打爆 API
var dashScopeSemaphore = make(chan struct{}, config.DashScopeConcurrency)

// VoiceModelDocumentStrategy 语音模型转写策略。
//
// 当前支持阿里百炼 DashScope API（异步调用 fun-asr/paraformer）。
// 新增其他供应商时：
//   - 新增一个 Strategy 实现 DocumentProcessStrategy 接口
//   - 在 rag-pipeline-v2/steps/document_parsing.go 的路由中增加分支
//   - 如果使用相同的 voice_models 配置结构，可扩展此策略
//
// 配置来源：
//   - channel.Key：API Key
//   - channel.BaseURL：默认 API 域名
//   - channel.Models：可用模型列表（逗号分隔）
//   - custom_config.voice_models[modelName]：模型专属配置（workspace_id、api_domain 等）
type VoiceModelDocumentStrategy struct {
	libraryID int64
}

func NewVoiceModelDocumentStrategy(libraryID int64) *VoiceModelDocumentStrategy {
	return &VoiceModelDocumentStrategy{libraryID: libraryID}
}

func (s *VoiceModelDocumentStrategy) GetStrategyName() string {
	return "voice_model"
}

func (s *VoiceModelDocumentStrategy) Process(content []byte, filename string, fileSize int64, eid, userID int64) (*DocumentProcessResult, error) {
	return nil, fmt.Errorf("VoiceModelDocumentStrategy requires UploadFile, use ProcessWithUploadFile instead")
}

func (s *VoiceModelDocumentStrategy) ProcessWithUploadFile(fileID int64, content []byte, filename string, fileSize int64, eid, userID int64, uploadFile *model.UploadFile, parseType string) (*DocumentProcessResult, error) {
	var channelID int64
	var modelName string
	var err error

	if parseType == "voice_model" {
		recordingConfig, err := model.ValidateOrCreateRecordingConfig(eid)
		if err != nil {
			return nil, fmt.Errorf("获取录音配置失败: %w", err)
		}
		if !recordingConfig.Enabled || recordingConfig.ParserPlatform == "" {
			return nil, fmt.Errorf("录音功能未启用或未配置解析平台，请先在后台配置语音模型")
		}

		channelID = recordingConfig.VoiceModelID
		modelName = recordingConfig.VoiceModelName
		if channelID <= 0 || modelName == "" {
			return nil, fmt.Errorf("录音配置中缺少 voice_model_id 或 voice_model_name")
		}
	} else if strings.HasPrefix(parseType, "voice:") {
		parts := strings.Split(parseType, ":")
		if len(parts) < 2 {
			return nil, fmt.Errorf("无效的 parseType 格式: %s", parseType)
		}
		channelTypeStr := parts[1]
		if _, err := strconv.ParseInt(channelTypeStr, 10, 64); err != nil {
			return nil, fmt.Errorf("无效的 channel_type: %s", channelTypeStr)
		}
		rc, rcErr := model.ValidateOrCreateRecordingConfig(eid)
		if rcErr != nil {
			return nil, fmt.Errorf("获取录音配置失败: %w", rcErr)
		}
		if !rc.Enabled || rc.ParserPlatform == "" {
			return nil, fmt.Errorf("录音功能未启用或未配置解析平台，请先在后台配置语音模型")
		}
		channelID = rc.VoiceModelID
		modelName = rc.VoiceModelName
		if channelID <= 0 || modelName == "" {
			return nil, fmt.Errorf("录音配置中缺少 voice_model_id 或 voice_model_name")
		}
	} else {
		return nil, fmt.Errorf("无效的 parseType: %s", parseType)
	}

	// 从 Channel 读取语音模型配置（channel.Key + voice_models）
	channel, err := model.GetChannelByID(channelID)
	if err != nil || !model.IsVoiceModelChannel(channel) {
		return nil, fmt.Errorf("语音模型渠道不存在: channel_id=%d", channelID)
	}

	apiKey := channel.Key
	if apiKey == "" {
		return nil, fmt.Errorf("Channel 缺少 key（API Key）")
	}

	cfg, parseErr := model.ParseChannelCustomConfig(channel.CustomConfig)
	if parseErr != nil {
		return nil, fmt.Errorf("解析 CustomConfig 失败: %w", parseErr)
	}

	// 校验 model_name 在 channel.models 中存在
	if !model.IsModelInChannelModels(modelName, channel.Models) {
		return nil, fmt.Errorf("模型 %s 不在渠道 models(%s) 中", modelName, channel.Models)
	}

	// 从 voice_models 读取模型专属配置
	voiceModels, _ := cfg["voice_models"].(map[string]interface{})
	vm, _ := voiceModels[modelName].(map[string]interface{})

	apiDomain := ""
	if channel.BaseURL != nil && *channel.BaseURL != "" {
		apiDomain = *channel.BaseURL
	}
	if d, ok := vm["api_domain"].(string); ok && d != "" {
		apiDomain = d
	}

	workspaceID, _ := vm["workspace_id"].(string)

	// fun-asr/paraformer 模型：必填 workspace_id，未显式配置 api_domain 时自动拼接
	if workspaceID == "" {
		return nil, fmt.Errorf("fun-asr/paraformer 模型必须配置 workspace_id")
	}
	if _, hasExplicitDomain := vm["api_domain"]; !hasExplicitDomain || vm["api_domain"].(string) == "" {
		apiDomain = fmt.Sprintf("https://%s.cn-beijing.maas.aliyuncs.com", workspaceID)
	}
	if apiDomain == "" {
		return nil, fmt.Errorf("缺少 api_domain：请在 voice_models.%s.api_domain 或 channel.base_url 中配置", modelName)
	}

	var hotwords []string
	if hw, ok := vm["hotwords"]; ok {
		if hwArr, ok := hw.([]interface{}); ok {
			for _, h := range hwArr {
				if s, ok := h.(string); ok {
					hotwords = append(hotwords, s)
				}
			}
		}
	}

	voiceCfg := voiceModelConfig{
		ModelName:   modelName,
		ApiKey:      apiKey,
		ApiDomain:   apiDomain,
		WorkspaceID: workspaceID,
		Hotwords:    hotwords,
	}

	sourceURL := uploadFile.GetPreviewOrOssDownloadUrl()
	// 本地存储时，预览 URL 可能指向 127.0.0.1，阿里 ASR API 需要公网可达的地址
	if config.StorageType != "aliyun_oss" && strings.Contains(sourceURL, "127.0.0.1") {
		sourceURL = strings.Replace(sourceURL, "http://127.0.0.1:3000", "https://kmapitest.53ai.com", 1)
		logger.Infof(context.Background(), "【语音模型】替换预览 URL: %s", sourceURL)
	}

	return s.callDashScopeNative(context.Background(), fileID, sourceURL, &voiceCfg)
}

// voiceModelConfig 语音模型配置。
//
// 当前支持阿里百炼 DashScope，配置来源：
//   - ModelName：模型名（如 fun-asr），对应 voice_models 的 key
//   - ApiKey：channel.Key
//   - ApiDomain：voice_models[modelName].api_domain 或 channel.BaseURL
//   - WorkspaceID：voice_models[modelName].workspace_id
//
// 新增其他供应商时，在此结构体中增加供应商专属字段（如 Azure 的 region、Google 的 project_id），
// 并在 voice_models[modelName] 中定义对应配置。
type voiceModelConfig struct {
	ModelName   string   `json:"model_name"`
	ApiKey      string   `json:"api_key"`
	ApiDomain   string   `json:"api_domain"`
	WorkspaceID string   `json:"workspace_id"`
	Hotwords    []string `json:"hotwords"`
}

type dashScopeTaskResponse struct {
	RequestID string `json:"request_id"`
	Output    struct {
		TaskID     string `json:"task_id"`
		TaskStatus string `json:"task_status"`
	} `json:"output"`
}

type dashScopeResultResponse struct {
	RequestID string `json:"request_id"`
	Output    struct {
		TaskID     string `json:"task_id"`
		TaskStatus string `json:"task_status"`
		Results    []struct {
			TranscriptionURL string `json:"transcription_url"`
		} `json:"results"`
	} `json:"output"`
}

// updatePollInterval 指数退避，最大 maxInterval
func updatePollInterval(current *time.Duration, maxInterval time.Duration) {
	*current *= 2
	if *current > maxInterval {
		*current = maxInterval
	}
}

// callDashScopeNative 调用阿里百炼 DashScope 异步语音识别 API。
//
// 当前实现针对 DashScope 异步接口（fun-asr/paraformer），使用"提交任务→轮询结果"模式。
// 新增其他供应商时，应新建对应的 callXxx 方法，在此处根据 cfg.ApiDomain 或 channel type 路由。
//
// DashScope 异步接口文档：
//   https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-http-api
func (s *VoiceModelDocumentStrategy) callDashScopeNative(ctx context.Context, fileID int64, sourceURL string, cfg *voiceModelConfig) (*DocumentProcessResult, error) {
	baseURL := strings.TrimRight(cfg.ApiDomain, "/")
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "https://" + baseURL
	}
	taskURL := baseURL + "/api/v1/services/audio/asr/transcription"

	httpClient := &http.Client{Timeout: 30 * time.Second}

	requestBody := map[string]interface{}{
		"model": cfg.ModelName,
		"input": map[string]interface{}{},
	}
	requestBody["input"].(map[string]interface{})["file_urls"] = []string{sourceURL}
	params := map[string]interface{}{
		"channel_id":          []int{0},
		"diarization_enabled": true,
	}
	if len(cfg.Hotwords) > 0 {
		params["hotwords"] = map[string]interface{}{
			"customized_hotwords": cfg.Hotwords,
		}
		logger.Infof(ctx, "【语音模型】启用热词: %v", cfg.Hotwords)
	}
	requestBody["parameters"] = params
	bodyBytes, _ := json.Marshal(requestBody)

	dashScopeSemaphore <- struct{}{}
	defer func() { <-dashScopeSemaphore }()

	req, err := http.NewRequest("POST", taskURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("创建任务提交请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+cfg.ApiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DashScope-Async", "enable")
	if cfg.WorkspaceID != "" {
		req.Header.Set("X-DashScope-WorkSpace", cfg.WorkspaceID)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("提交语音识别任务失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	logger.Infof(ctx, "【诊断-DashScope提交】fileID=%d status=%d body=%s", fileID, resp.StatusCode, string(respBody))

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("语音识别 API 返回错误 status=%d body=%s", resp.StatusCode, string(respBody))
	}

	var taskResp dashScopeTaskResponse
	if err := json.Unmarshal(respBody, &taskResp); err != nil {
		return nil, fmt.Errorf("解析任务响应失败: %w", err)
	}

	if taskResp.Output.TaskID == "" {
		return nil, fmt.Errorf("提交任务未返回 task_id，响应: %s", string(respBody))
	}

	taskID := taskResp.Output.TaskID
	pollInterval := 2 * time.Second
	maxInterval := 30 * time.Second
	maxWait := 30 * time.Minute
	deadline := time.Now().Add(maxWait)
	queryURL := fmt.Sprintf("%s/api/v1/tasks/%s", baseURL, taskID)

	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("语音识别任务取消: %w", ctx.Err())
		default:
		}

		if time.Now().After(deadline) {
			return nil, fmt.Errorf("语音识别任务超时（%v）", maxWait)
		}

		time.Sleep(pollInterval)

		pollReq, pollErr := http.NewRequest("GET", queryURL, nil)
		if pollErr != nil {
			logger.Warnf(ctx, "【语音模型】轮询创建请求失败: fileID=%d err=%v", fileID, pollErr)
			updatePollInterval(&pollInterval, maxInterval)
			continue
		}
		pollReq.Header.Set("Authorization", "Bearer "+cfg.ApiKey)
		if cfg.WorkspaceID != "" {
			pollReq.Header.Set("X-DashScope-WorkSpace", cfg.WorkspaceID)
		}

		pollResp, pollErr := httpClient.Do(pollReq)
		if pollErr != nil {
			logger.Warnf(ctx, "【语音模型】轮询请求失败: fileID=%d taskID=%s err=%v", fileID, taskID, pollErr)
			updatePollInterval(&pollInterval, maxInterval)
			continue
		}

		var resultResp dashScopeResultResponse
		if err := json.NewDecoder(pollResp.Body).Decode(&resultResp); err != nil {
			pollResp.Body.Close()
			logger.Warnf(ctx, "【语音模型】轮询解析响应失败: fileID=%d taskID=%s err=%v", fileID, taskID, err)
			updatePollInterval(&pollInterval, maxInterval)
			continue
		}
		pollResp.Body.Close()

		// 轮询成功，重置间隔为初始值
		pollInterval = 2 * time.Second

		switch resultResp.Output.TaskStatus {
		case "SUCCEEDED":
			if len(resultResp.Output.Results) == 0 {
				return nil, fmt.Errorf("任务完成但无结果")
			}

			transcriptionURL := resultResp.Output.Results[0].TranscriptionURL
			transcriptionResp, err := httpClient.Get(transcriptionURL)
			if err != nil {
				return nil, fmt.Errorf("获取转录结果失败: %w", err)
			}
			defer transcriptionResp.Body.Close()

			rawBytes, err := io.ReadAll(transcriptionResp.Body)
			if err != nil {
				return nil, fmt.Errorf("读取转录结果失败: %w", err)
			}

			// 从原始 JSON 中提取有用信息
			var durationMs int64
			var plainText string
			var rawData map[string]interface{}
			if err := json.Unmarshal(rawBytes, &rawData); err == nil {
				if props, ok := rawData["properties"].(map[string]interface{}); ok {
					if d, ok := props["original_duration_in_milliseconds"].(float64); ok {
						durationMs = int64(d)
					}
				}
				if transcripts, ok := rawData["transcripts"].([]interface{}); ok {
					var texts []string
					for _, t := range transcripts {
						if tMap, ok := t.(map[string]interface{}); ok {
							if text, ok := tMap["text"].(string); ok && text != "" {
								texts = append(texts, text)
							}
							if durationMs == 0 {
								if d, ok := tMap["content_duration_in_milliseconds"].(float64); ok {
									durationMs = int64(d)
								}
							}
						}
					}
					plainText = strings.Join(texts, "\n\n")
				}
			}

			// 保存摘要到 File 表（与听悟策略对齐）
			if fileID > 0 && plainText != "" {
				updates := map[string]interface{}{}
				updates["summary"] = plainText
				if durationMs > 0 {
					updates["duration_ms"] = durationMs
				}
				if err := model.DB.Model(&model.File{}).Where("id = ?", fileID).Updates(updates).Error; err != nil {
					logger.Errorf(ctx, "【语音模型】保存摘要失败 - fileID=%d error=%v", fileID, err)
				} else {
					logger.Infof(ctx, "【语音模型】保存摘要成功 - fileID=%d summary_len=%d duration_ms=%d", fileID, len(plainText), durationMs)
				}
			}

			logger.Infof(ctx, "【语音模型】转录成功 - fileID=%d task_id=%s raw_len=%d duration_ms=%d", fileID, taskID, len(rawBytes), durationMs)

			// 设置转写状态（独立于 parsing_status，避免被后续 RAG 管线失败覆盖）
			if fileID > 0 {
				model.SetFileTranscriptionStatus(fileID, "completed")
			}

			return &DocumentProcessResult{
				ProcessedContent: string(rawBytes),
				FileType:         "json",
				FileName:         fmt.Sprintf("transcription_%d.json", fileID),
				DurationMs:       durationMs,
			}, nil

		case "FAILED":
			return nil, fmt.Errorf("语音识别任务失败: task_id=%s", taskID)

		default:
		}
	}
}
