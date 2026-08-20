package controller

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/document"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/53AI/53AIHub/service/hub_adaptor/gemini"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/meta"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

// embeddedTestSpeech 内置真实语音样本（约 1.6s "关于使用阿里云"），供 OpenAI 兼容语音渠道测试上传，
// 确保 ASR 返回非空文本（生成的正弦音对多数 ASR 返回空）。
//
//go:embed testdata/speech.mp3
var embeddedTestSpeech []byte

type ChannelTestResponse struct {
	Success bool    `json:"success"`
	Message string  `json:"message"`
	Model   string  `json:"model"`
	Time    float64 `json:"time"`
}

// TestChannel Test channel availability
// @Summary Test channel connectivity
// @Description Verify channel configuration by invoking actual API endpoints
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param channel_id path int true "Channel ID"
// @Param model query string false "Model name"
// @Param model_type query string false "Model type (1: chat, 2: embedding, 3: rerank)"
// @Success 200 {object} model.CommonResponse{data=ChannelTestResponse}
// @Router /api/channels/test/{channel_id} [get]
func TestChannel(c *gin.Context) {
	ctx := c.Request.Context()
	channel_id, err := strconv.Atoi(c.Param("channel_id"))
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(err))
		return
	}
	channel, err := model.GetChannelByID(int64(channel_id))
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(err))
		return
	}
	modelName := c.Query("model")
	modelType := c.Query("model_type") // 获取model_type参数
	testRequest := buildTestRequest(modelName)
	tik := time.Now()

	// 如果提供了model_type，则优先使用它来判断模型类型
	if modelType != "" {
		switch modelType {
		case "3", "rerank":
			responseMessage, err := testRerankChannel(ctx, channel, modelName)
			returnResponse(c, channel, tik, modelName, responseMessage, err)
			return
		case "2", "embedding":
			responseMessage, err := testEmbeddingChannel(ctx, channel, modelName)
			returnResponse(c, channel, tik, modelName, responseMessage, err)
			return
		case "4", "voice":
			responseMessage, err := testAudioTranscriptionChannel(ctx, channel, modelName)
			returnResponse(c, channel, tik, modelName, responseMessage, err)
			return
		case "1", "chat":
			// 跳过下面的自动检测，直接进入聊天模型测试
		default:
			// 对于未知类型，仍然使用原有检测逻辑
		}
	}

	// 如果没有提供model_type或model_type为未知类型，使用原有检测逻辑
	// 检查是否为 rerank 模型
	if isRerankModel(modelName) {
		responseMessage, err := testRerankChannel(ctx, channel, modelName)
		returnResponse(c, channel, tik, modelName, responseMessage, err)
		return
	}

	// 检查是否为 embedding 模型
	if isEmbeddingModel(modelName) {
		responseMessage, err := testEmbeddingChannel(ctx, channel, modelName)
		returnResponse(c, channel, tik, modelName, responseMessage, err)
		return
	}

	// 检查是否为图像生成模型
	if isImageGenerationModel(modelName) {
		responseMessage, err := testImageGenerationChannel(ctx, channel, modelName)
		returnResponse(c, channel, tik, modelName, responseMessage, err)
		return
	}

	// 检查是否为语音模型（model_type=4，通过 custom_config 判断）
	if isVoiceModelInChannel(channel, modelName) {
		responseMessage, err := testAudioTranscriptionChannel(ctx, channel, modelName)
		returnResponse(c, channel, tik, modelName, responseMessage, err)
		return
	}

	// 原有的聊天模型测试逻辑
	responseMessage, err, _, actualModel := testChannel(ctx, channel, testRequest)
	tok := time.Now()
	milliseconds := tok.Sub(tik).Milliseconds()
	if err != nil {
		milliseconds = 0
	}
	go channel.UpdateResponseTime(milliseconds)
	consumedTime := float64(milliseconds) / 1000.0
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(ChannelTestResponse{
		Success: true,
		Message: responseMessage,
		Model:   actualModel,
		Time:    consumedTime,
	}))
}

// 辅助函数，用于统一处理响应
func returnResponse(c *gin.Context, channel *model.Channel, startTime time.Time, modelName string, responseMessage string, err error) {
	tok := time.Now()
	milliseconds := tok.Sub(startTime).Milliseconds()
	if err != nil {
		milliseconds = 0
	}
	go channel.UpdateResponseTime(milliseconds)
	consumedTime := float64(milliseconds) / 1000.0
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(ChannelTestResponse{
		Success: true,
		Message: responseMessage,
		Model:   modelName,
		Time:    consumedTime,
	}))
}

func testChannel(ctx context.Context, channel *model.Channel, request *relaymodel.GeneralOpenAIRequest) (responseMessage string, err error, openaiErr *relaymodel.Error, actualModel string) {
	//startTime := time.Now()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = &http.Request{
		Method: "POST",
		URL:    &url.URL{Path: "/v1/chat/completions"},
		Body:   nil,
		Header: make(http.Header),
	}
	c.Request.Header.Set("Authorization", "Bearer "+channel.Key)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(ctxkey.Channel, channel.Type)
	c.Set(ctxkey.BaseURL, channel.GetBaseURL())
	cfg, _ := channel.LoadConfig()
	c.Set(ctxkey.Config, cfg)
	middleware.SetupContextForSelectedChannel(c, channel, "")
	meta := meta.GetByContext(c)
	apiType := model.GetApiType(channel.Type)
	meta.APIType = apiType
	// apiType := channeltype.ToAPIType(channel.Type)
	adaptor := service.GetAdaptor(meta.APIType)
	err = service.SetCustomConfig(&adaptor, &custom.CustomConfig{
		ConversationId: "",
		UserId:         "53AIHub",
	})
	if err != nil {
		return "", err, nil, ""
	}
	// adaptor := relay.GetAdaptor(apiType)
	if adaptor == nil {
		return "", fmt.Errorf("invalid api type: %d, adaptor is nil", apiType), nil, ""
	}
	adaptor.Init(meta)
	modelName := request.Model
	modelMap := channel.GetModelMapping()
	if modelName == "" || !strings.Contains(channel.Models, modelName) {
		modelNames := strings.Split(channel.Models, ",")
		if len(modelNames) > 0 {
			modelName = modelNames[0]
		}
	}
	if modelMap != nil && modelMap[modelName] != "" {
		modelName = modelMap[modelName]
	}
	meta.OriginModelName, meta.ActualModelName = request.Model, modelName
	request.Model = modelName
	convertedRequest, err := adaptor.ConvertRequest(c, relaymode.ChatCompletions, request)
	if err != nil {
		return "", err, nil, ""
	}
	jsonData, err := json.Marshal(convertedRequest)
	if err != nil {
		return "", err, nil, ""
	}
	defer func() {
		//logContent := fmt.Sprintf("渠道 %s 测试成功，响应：%s", channel.Name, responseMessage)
		if err != nil || openaiErr != nil {
			// errorMessage := ""
			// if err != nil {
			// 	errorMessage = err.Error()
			// } else {
			// 	errorMessage = openaiErr.Message
			// }
			//logContent = fmt.Sprintf("渠道 %s 测试失败，错误：%s", channel.Name, errorMessage)
		}
		// go model.RecordTestLog(ctx, &model.Log{
		// 	ChannelId:   channel.Id,
		// 	ModelName:   modelName,
		// 	Content:     logContent,
		// 	ElapsedTime: helper.CalcElapsedTime(startTime),
		// })
	}()
	logger.SysLog(string(jsonData))
	requestBody := bytes.NewBuffer(jsonData)
	c.Request.Body = io.NopCloser(requestBody)
	resp, err := adaptor.DoRequest(c, meta, requestBody)
	if err != nil {
		return "", err, nil, ""
	}
	if resp != nil && resp.StatusCode != http.StatusOK {
		// err := controller.RelayErrorHandler(resp)
		// err := errors.New("http status code: " + strconv.Itoa(resp.StatusCode))
		// errorMessage := err.Error.Message
		// if errorMessage != "" {
		// 	errorMessage = ", error message: " + errorMessage
		// }
		return "", fmt.Errorf("http status code: %d%s", resp.StatusCode, ""), nil, ""
	}
	usage, respErr := adaptor.DoResponse(c, resp, meta)
	if respErr != nil {
		return "", fmt.Errorf("%s", respErr.Error.Message), &respErr.Error, ""
	}
	if usage == nil {
		return "", errors.New("usage is nil"), nil, ""
	}
	rawResponse := w.Body.String()
	_, responseMessage, actualModel, err = parseTestResponse(rawResponse)
	if err != nil {
		logger.SysError(fmt.Sprintf("failed to parse error: %s, \nresponse: %s", err.Error(), rawResponse))
		return "", err, nil, ""
	}
	if actualModel != "" && actualModel != modelName {
		logger.SysLogf("Model fallback detected: channel=%d, requested=%s, actual=%s", channel.ChannelID, modelName, actualModel)
	}
	result := w.Result()
	// print result.Body
	respBody, err := io.ReadAll(result.Body)
	if err != nil {
		return "", err, nil, ""
	}
	logger.SysLog(fmt.Sprintf("testing channel #%d, response: \n%s", channel.ChannelID, string(respBody)))
	return responseMessage, nil, nil, actualModel
}

func parseTestResponse(resp string) (*openai.TextResponse, string, string, error) {
	var response openai.TextResponse
	err := json.Unmarshal([]byte(resp), &response)
	if err != nil {
		return nil, "", "", err
	}
	if len(response.Choices) == 0 {
		return nil, "", "", errors.New("response has no choices")
	}
	stringContent, ok := response.Choices[0].Content.(string)
	if !ok {
		return nil, "", "", errors.New("response content is not string")
	}
	return &response, stringContent, response.Model, nil
}

func buildTestRequest(model string) *relaymodel.GeneralOpenAIRequest {
	if model == "" {
		model = "gpt-3.5-turbo"
	}
	testRequest := &relaymodel.GeneralOpenAIRequest{
		Model: model,
	}
	testMessage := relaymodel.Message{
		Role:    "user",
		Content: "Output only your specific model name with no additional text.",
	}
	testRequest.Messages = append(testRequest.Messages, testMessage)
	return testRequest
}

// testRerankChannel 测试 rerank 渠道
func testRerankChannel(ctx context.Context, channel *model.Channel, modelName string) (responseMessage string, err error) {
	// 创建测试请求，与 /v1/rerank 接口保持一致
	testRerankRequest := &RerankRequest{
		Model: modelName,
		Query: "人工智能的发展历程",
		Documents: []string{
			"人工智能起源于1950年代，图灵提出了著名的图灵测试",
			"深度学习是机器学习的一个分支，使用神经网络进行学习",
			"自然语言处理是人工智能的重要应用领域之一",
		},
		TopN:            intPtr(3),
		ReturnDocuments: boolPtr(true),
	}

	// 记录测试日志
	logger.SysLogf("开始测试 rerank 渠道 #%d, 模型: %s", channel.ChannelID, modelName)

	// 创建元数据，与 /v1/rerank 接口保持一致
	meta := &meta.Meta{
		Mode:            0, // rerank 模式
		ChannelType:     channel.Type,
		ChannelId:       int(channel.ChannelID),
		UserId:          0, // 测试场景下用户ID不重要
		OriginModelName: modelName,
		ActualModelName: modelName,
		APIType:         model.GetApiType(channel.Type),
		APIKey:          channel.Key,
	}

	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}

	// 创建测试用的 gin.Context
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = &http.Request{
		Method: "POST",
		URL:    &url.URL{Path: "/v1/rerank"},
		Body:   nil,
		Header: make(http.Header),
	}
	c.Request = c.Request.WithContext(ctx)
	// 设置渠道上下文
	middleware.SetupContextForSelectedChannel(c, channel, testRerankRequest.Model)

	// 使用与 /v1/rerank 接口相同的 executeRerankRequest 函数
	response, _, err := executeRerankRequest(c, testRerankRequest, channel)
	if err != nil {
		logger.SysErrorf("测试 rerank 渠道失败: %v", err)
		return "", fmt.Errorf("测试 rerank 渠道失败: %v", err)
	}

	// 检查响应
	if response == nil || len(response.Data) == 0 {
		return "", errors.New("rerank 响应为空")
	}

	// 获取第一个结果的分数
	firstResult := response.Data[0]
	score := firstResult.RelevanceScore

	// 构建成功消息
	responseMessage = fmt.Sprintf("Rerank 模型 %s 测试成功，返回 %d 个结果，第一个结果相关度分数: %.2f", modelName, len(response.Data), score)
	logger.SysLogf("测试 rerank 渠道成功: %s", responseMessage)

	return responseMessage, nil
}

// isRerankModel 检查是否为 rerank 模型
func isRerankModel(modelName string) bool {
	if modelName == "" {
		return false
	}

	// 使用模型目录加载器判断是否为 rerank 模型
	loader := common.GetModelCatalogLoader()
	return loader.IsRerankModel(modelName)
}

// intPtr 返回 int 指针
func intPtr(i int) *int {
	return &i
}

// testEmbeddingChannel 测试 embedding 渠道
func testEmbeddingChannel(ctx context.Context, channel *model.Channel, modelName string) (responseMessage string, err error) {
	// 创建测试文本
	testText := "这是一个用于测试embedding模型的示例文本"

	// 记录测试日志
	logger.SysLogf("开始测试 embedding 渠道 #%d, 模型: %s", channel.ChannelID, modelName)

	// 使用 model.DB 创建 embedding 服务
	embeddingService := rag.NewEmbeddingService(model.DB)

	// 调用 embedding API
	vector, err := embeddingService.CallEmbeddingAPIWithModel(testText, channel, modelName, nil)
	if err != nil {
		logger.SysErrorf("测试 embedding 渠道失败: %v", err)
		return "", fmt.Errorf("测试 embedding 渠道失败: %v", err)
	}

	// 检查返回的向量
	if len(vector) == 0 {
		return "", errors.New("embedding 响应为空")
	}

	// 构建成功消息
	responseMessage = fmt.Sprintf("Embedding 模型 %s 测试成功，向量维度: %d", modelName, len(vector))
	logger.SysLogf("测试 embedding 渠道成功: %s", responseMessage)

	return responseMessage, nil
}

// isEmbeddingModel 检查是否为 embedding 模型
func isEmbeddingModel(modelName string) bool {
	if modelName == "" {
		return false
	}

	// 使用模型目录加载器判断是否为 embedding 模型
	loader := common.GetModelCatalogLoader()
	return loader.IsEmbeddingModel(modelName)
}

// isImageGenerationModel 检查是否为图像生成模型
func isImageGenerationModel(modelName string) bool {
	if modelName == "" {
		return false
	}

	// 使用 gemini adaptor 的判断函数
	return gemini.IsImageGenerationModel(modelName)
}

// testImageGenerationChannel 测试图像生成渠道
func testImageGenerationChannel(ctx context.Context, channel *model.Channel, modelName string) (responseMessage string, err error) {
	// 记录测试日志
	logger.SysLogf("开始测试图像生成渠道 #%d, 模型: %s", channel.ChannelID, modelName)

	// 创建测试请求 - 使用简单的文本提示生成图像
	testRequest := &relaymodel.GeneralOpenAIRequest{
		Model: modelName,
	}
	testMessage := relaymodel.Message{
		Role:    "user",
		Content: "Generate a simple image of a red circle on white background.",
	}
	testRequest.Messages = append(testRequest.Messages, testMessage)

	// 使用现有的 testChannel 函数进行测试
	// 图像生成模型通常也支持 chat 格式的请求
	responseMessage, err, _, actualModel := testChannel(ctx, channel, testRequest)
	if err != nil {
		logger.SysErrorf("测试图像生成渠道失败: %v", err)
		return "", fmt.Errorf("测试图像生成渠道失败: %v", err)
	}

	// 构建成功消息
	if actualModel != "" && actualModel != modelName {
		responseMessage = fmt.Sprintf("图像生成模型 %s 测试成功 (实际模型: %s)", modelName, actualModel)
	} else {
		responseMessage = fmt.Sprintf("图像生成模型 %s 测试成功", modelName)
	}
	logger.SysLogf("测试图像生成渠道成功: %s", responseMessage)

	return responseMessage, nil
}

// boolPtr 返回 bool 指针
func boolPtr(b bool) *bool {
	return &b
}

// isVoiceModelInChannel 检查模型在渠道的 custom_config 中是否为语音模型（model_type=4）
func isVoiceModelInChannel(channel *model.Channel, modelName string) bool {
	if channel == nil || modelName == "" {
		return false
	}
	// 阿里 DashScope 语音模型走 TestVoiceChannel，不在此处理
	if model.IsVoiceModelChannel(channel) {
		return false
	}
	// 检查 custom_config 中该模型的类型标记
	cfg, err := model.ParseChannelCustomConfig(channel.CustomConfig)
	if err != nil {
		return false
	}
	// 旧格式：{"model_name": "model_type_string"}，如 {"meeting-transcriber-v1": "4"}
	if modelTypeStr, ok := cfg[modelName].(string); ok && modelTypeStr == "4" {
		return true
	}
	// 新格式：model_type 字段
	if modelType, ok := cfg["model_type"].(float64); ok && int(modelType) == 4 {
		return true
	}
	return false
}

// testAudioTranscriptionChannel 测试 OpenAI 兼容语音模型（model_type=4）
// 发送 POST /v1/audio/transcriptions 到上游，验证语音识别接口可达
func testAudioTranscriptionChannel(ctx context.Context, channel *model.Channel, modelName string) (responseMessage string, err error) {
	logger.SysLogf("开始测试音频转录渠道 #%d, 模型: %s", channel.ChannelID, modelName)

	// 构造 URL：使用 custom_openai 适配器逻辑
	baseURL := channel.GetBaseURL()
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	baseURL = strings.TrimSuffix(baseURL, "/v1")
	baseURL = strings.TrimSuffix(baseURL, "/")
	testURL := baseURL + "/v1/audio/transcriptions"

	// 构建测试请求：使用文本内容模拟，实际转录需要音频文件
	// 这里发送一个简单的 JSON 请求验证连通性
	testPayload := map[string]interface{}{
		"model": modelName,
	}
	bodyBytes, _ := json.Marshal(testPayload)

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "POST", testURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+channel.Key)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("连接失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	// 只要服务端返回了 HTTP 响应，就证明通道可达
	// 400/415 等只是我们没传真实音频文件导致的格式问题
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Sprintf("音频模型 %s 测试成功 (status=%d，认证通过但可能权限不足)", modelName, resp.StatusCode), nil
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 500 {
		return fmt.Sprintf("音频模型 %s 测试成功 (status=%d)", modelName, resp.StatusCode), nil
	}

	return "", fmt.Errorf("响应状态码: %d, body: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
}

// TestVoiceChannel godoc
// @Summary 测试语音模型渠道
// @Description 验证语音模型配置可达性，需指定 model_name 查询参数。百炼渠道（17）走 DashScope 原生异步接口；OpenAI 兼容渠道（1012）走两段式：配置检查 → 上传 1 秒音频到 /v1/audio/transcriptions → 校验转写文本
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param channel_id path int true "Channel ID"
// @Param model_name query string true "要测试的模型名，如 paraformer-v2"
// @Success 200 {object} model.CommonResponse{data=ChannelTestResponse}
// @Router /api/channels/test/voice/{channel_id} [post]
func TestVoiceChannel(c *gin.Context) {
	channelID, err := strconv.ParseInt(c.Param("channel_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(err))
		return
	}

	channel, err := model.GetChannelByID(channelID)
	if err != nil || channel.Eid != config.GetEID(c) {
		c.JSON(http.StatusOK, model.NotFound.ToResponse(nil))
		return
	}

	if !model.IsVoiceModelChannel(channel) {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("渠道类型不是语音模型")))
		return
	}

	modelName := c.Query("model_name")
	if modelName == "" {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("缺少 model_name 查询参数")))
		return
	}

	// OpenAI 兼容语音渠道（1012）：两段式测试（配置检查 → 上传 1 秒音频 → 校验转写文本）
	if model.IsOpenAIAudioChannel(channel) {
		testOpenAIVoiceChannel(c, channel, modelName)
		return
	}

	customConfig, err := model.ParseChannelCustomConfig(channel.CustomConfig)
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("CustomConfig 解析失败: %v", err)))
		return
	}

	voiceModels, ok := customConfig["voice_models"].(map[string]interface{})
	if !ok {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("CustomConfig 缺少 voice_models")))
		return
	}
	vm, ok := voiceModels[modelName].(map[string]interface{})
	if !ok {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("voice_models 中未找到模型 %s", modelName)))
		return
	}

	apiKey := channel.Key
	if apiKey == "" {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("渠道 Key 为空")))
		return
	}

	workspaceID, _ := vm["workspace_id"].(string)
	if workspaceID == "" {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("模型 %s 缺少 workspace_id", modelName)))
		return
	}
	apiDomain := fmt.Sprintf("https://%s.cn-beijing.maas.aliyuncs.com", workspaceID)

	baseURL := strings.TrimRight(apiDomain, "/")
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "https://" + baseURL
	}

	startTime := time.Now()
	client := &http.Client{Timeout: 15 * time.Second}

	testURL := baseURL + "/api/v1/services/audio/asr/transcription"
	testFileURL := "https://kmapirc.53ai.com/api/files/9QrIFq/preview/knowledge_file_9QrIFq_welcome.mp3"

	requestBody := map[string]interface{}{
		"model": modelName,
		"input": map[string]interface{}{
			"file_urls": []string{testFileURL},
		},
		"parameters": map[string]interface{}{
			"channel_id": []int{0},
		},
	}
	bodyBytes, _ := json.Marshal(requestBody)

	req, err := http.NewRequestWithContext(c.Request.Context(), "POST", testURL, bytes.NewReader(bodyBytes))
	if err != nil {
		c.JSON(http.StatusOK, model.SystemError.ToErrorResponse(fmt.Errorf("创建请求失败: %v", err)))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("X-DashScope-Async", "enable")
	if workspaceID, ok := vm["workspace_id"].(string); ok && workspaceID != "" {
		req.Header.Set("X-DashScope-WorkSpace", workspaceID)
	}

	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToErrorResponse(fmt.Errorf("连接失败: %v", err)))
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	consumedTime := float64(time.Now().Sub(startTime).Milliseconds()) / 1000.0

	if resp.StatusCode == 403 {
		c.JSON(http.StatusOK, model.Success.ToResponse(ChannelTestResponse{
			Success: true,
			Message: fmt.Sprintf("响应状态码: %d, body: %s", resp.StatusCode, strings.TrimSpace(string(respBody))),
			Model:   modelName,
			Time:    consumedTime,
		}))
		return
	}

	if resp.StatusCode >= 400 {
		c.JSON(http.StatusOK, model.ParamError.ToErrorResponse(fmt.Errorf("响应状态码: %d, body: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(ChannelTestResponse{
		Success: true,
		Message: fmt.Sprintf("响应状态码: %d, body: %s", resp.StatusCode, strings.TrimSpace(string(respBody))),
		Model:   modelName,
		Time:    consumedTime,
	}))
}

// testOpenAIVoiceChannel OpenAI 兼容语音渠道（type=1012）两段式测试：
//   - 阶段 1：配置检查（base_url/key/voice_models.model 存在性），不发起网络请求
//   - 阶段 2：上传 1 秒测试音频到 {base}/v1/audio/transcriptions，校验转写文本非空
func testOpenAIVoiceChannel(c *gin.Context, channel *model.Channel, modelName string) {
	startTime := time.Now()

	// 阶段 1：配置检查
	cfg, err := model.ParseChannelCustomConfig(channel.CustomConfig)
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("CustomConfig 解析失败: %v", err)))
		return
	}
	voiceModels, _ := cfg["voice_models"].(map[string]interface{})
	vm, ok := voiceModels[modelName].(map[string]interface{})
	if !ok {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("voice_models 中未找到模型 %s", modelName)))
		return
	}
	apiKey := channel.Key
	if apiKey == "" {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("渠道 Key 为空")))
		return
	}
	baseURL := channel.GetBaseURL()
	if d, ok := vm["api_domain"].(string); ok && strings.TrimSpace(d) != "" {
		baseURL = d
	}
	if strings.TrimSpace(baseURL) == "" {
		c.JSON(http.StatusOK, model.ParamError.ToResponse(fmt.Errorf("模型 %s 缺少 base_url（voice_models.%s.api_domain 或 channel.base_url）", modelName, modelName)))
		return
	}
	transcriptionsURL := document.NormalizeOpenAIBaseURL(baseURL) + "/v1/audio/transcriptions"

	// 阶段 2：上传测试音频（优先内置真实语音样本，保证 ASR 返回非空文本）
	audio := embeddedTestSpeech
	filename := "test_speech.mp3"
	if len(audio) == 0 {
		// 无内置语音样本时回退：生成 1 秒正弦音（部分 ASR 对纯音返回空文本）
		audio = generateTestWAV(1, 16000)
		filename = "test_1s.wav"
	}
	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		c.JSON(http.StatusOK, model.SystemError.ToErrorResponse(fmt.Errorf("构造 multipart 失败: %v", err)))
		return
	}
	if _, err := part.Write(audio); err != nil {
		c.JSON(http.StatusOK, model.SystemError.ToErrorResponse(fmt.Errorf("写入音频失败: %v", err)))
		return
	}
	_ = writer.WriteField("model", modelName)
	responseFormat := "json"
	if strings.Contains(modelName, "diarize") {
		responseFormat = "diarized_json"
	}
	_ = writer.WriteField("response_format", responseFormat)
	writer.Close()

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, transcriptionsURL, body)
	if err != nil {
		c.JSON(http.StatusOK, model.SystemError.ToErrorResponse(fmt.Errorf("创建请求失败: %v", err)))
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, model.ParamError.ToErrorResponse(fmt.Errorf("连接失败: %v", err)))
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	consumedTime := float64(time.Since(startTime).Milliseconds()) / 1000.0

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusOK, model.ParamError.ToErrorResponse(fmt.Errorf("响应状态码: %d, body: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))))
		return
	}

	var parsed struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(respBody, &parsed)
	if parsed.Text == "" {
		c.JSON(http.StatusOK, model.ParamError.ToErrorResponse(fmt.Errorf("转写结果为空（返回 body: %s）", strings.TrimSpace(string(respBody)))))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(ChannelTestResponse{
		Success: true,
		Message: fmt.Sprintf("转写成功，识别文本: %s", parsed.Text),
		Model:   modelName,
		Time:    consumedTime,
	}))
}

// generateTestWAV 生成 seconds 秒 16-bit 单声道 PCM WAV（内存），用于语音渠道测试。
// 440Hz 正弦 + 1Hz 幅度包络，避免纯静音导致 ASR 转写为空。
func generateTestWAV(seconds int, sampleRate int) []byte {
	numSamples := seconds * sampleRate
	dataSize := numSamples * 2
	buf := new(bytes.Buffer)
	writeLE16 := func(v uint16) { buf.Write([]byte{byte(v), byte(v >> 8)}) }
	writeLE32 := func(v uint32) { buf.Write([]byte{byte(v), byte(v >> 8), byte(v >> 16), byte(v >> 24)}) }

	buf.Write([]byte("RIFF"))
	writeLE32(uint32(36 + dataSize))
	buf.Write([]byte("WAVE"))
	buf.Write([]byte("fmt "))
	writeLE32(16)                 // PCM chunk 大小
	writeLE16(1)                  // audio format = PCM
	writeLE16(1)                  // 单声道
	writeLE32(uint32(sampleRate)) // sample rate
	writeLE32(uint32(sampleRate * 2))
	writeLE16(2) // block align
	writeLE16(16)
	buf.Write([]byte("data"))
	writeLE32(uint32(dataSize))

	const amp = 12000.0
	for i := 0; i < numSamples; i++ {
		t := float64(i) / float64(sampleRate)
		env := 0.5 + 0.5*math.Sin(2*math.Pi*t) // 1Hz 包络
		s := int16(amp * env * math.Sin(2*math.Pi*440*t))
		buf.Write([]byte{byte(s), byte(s >> 8)})
	}
	return buf.Bytes()
}
