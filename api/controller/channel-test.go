package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/53AI/53AIHub/service/hub_adaptor/gemini"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/meta"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

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
