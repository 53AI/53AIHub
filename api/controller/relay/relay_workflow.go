package relay

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	adaptor53AI "github.com/53AI/53AIHub/service/hub_adaptor/53AI"
	"github.com/53AI/53AIHub/service/hub_adaptor/coze"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/53AI/53AIHub/service/hub_adaptor/dify"
	"github.com/53AI/53AIHub/service/hub_adaptor/fastgpt"
	"github.com/53AI/53AIHub/service/hub_adaptor/n8n"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	billing_ratio "github.com/songquanpeng/one-api/relay/billing/ratio"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
)

// @Summary Workflow Run
// @Description 工作流运行接口，返回标准格式的工作流执行结果
// @Tags Workflow
// @Accept json
// @Produce json
// @Param workflowRequest body WorkflowRunRequest true "WorkflowRunRequest"
// @Success 200 {object} model.CommonResponse{data=custom.WorkflowResponseData}
// @Router /v1/workflow/run [post]
// @Security BearerAuth
func WorkflowRun(c *gin.Context) {
	c.Set(ctxkey.Group, "vip")

	// 记录开始时间用于计算执行时长
	startTime := time.Now()
	c.Set("workflow_start_time", startTime)

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, model.ParamError.ToResponse(errors.New("请求体读取失败")))
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewBuffer(body))

	var workflowRequest WorkflowRunRequest
	if err := json.Unmarshal(body, &workflowRequest); err != nil {
		c.JSON(400, model.ParamError.ToResponse(errors.New("请求参数解析失败")))
		return
	}

	// 获取 agent 信息
	agent, err := GetSessionAgent(c)
	if err != nil {
		c.JSON(404, model.NotFound.ToResponse(errors.New("Agent 未找到")))
		return
	}

	// 验证是否为工作流类型的 agent
	if agent.AgentType != model.AgentTypeWorkflow {
		c.JSON(400, model.ParamError.ToResponse(errors.New("该 Agent 不是工作流类型")))
		return
	}

	// 检查流式响应参数
	if workflowRequest.Stream {
		logger.SysLogf("工作流请求设置了 stream=true，但工作流不支持流式响应，将忽略此参数")
	}

	logger.SysLogf("工作流运行请求 - Agent: %s, Stream: %v, Parameters: %+v",
		agent.Model, workflowRequest.Stream, workflowRequest.Parameters)

	// 执行工作流
	response, err := executeWorkflow(c, &workflowRequest, agent)
	if err != nil {
		logger.SysErrorf("工作流执行失败 - Agent: %s, Error: %v", agent.Model, err)

		// 根据错误类型返回不同的状态码
		statusCode := 500
		if strings.Contains(err.Error(), "参数") || strings.Contains(err.Error(), "输入") {
			statusCode = 400
		} else if strings.Contains(err.Error(), "未找到") || strings.Contains(err.Error(), "不存在") {
			statusCode = 404
		}

		// 根据状态码选择合适的响应码
		var responseCode model.ResponseCode
		switch statusCode {
		case 400:
			responseCode = model.ParamError
		case 404:
			responseCode = model.NotFound
		default:
			responseCode = model.SystemError
		}

		c.JSON(statusCode, responseCode.ToResponse(errors.New(err.Error())))
		return
	}

	logger.SysLogf("工作流执行成功 - Agent: %s, ExecuteID: %s",
		agent.Model, response.ExecuteID)

	// 保存工作流消息记录
	if err := saveWorkflowMessage(c, &workflowRequest, agent, response); err != nil {
		logger.SysErrorf("保存工作流消息失败: %v", err)
		// 不影响主流程，继续返回成功响应
	}

	// 使用标准响应格式返回
	c.JSON(200, model.Success.ToResponse(response))
}

// extractWorkflowID 从 agent 配置中提取工作流ID
func extractWorkflowID(modelName, customConfig string) string {
	// 方法1: 如果模型名称已经是工作流ID格式，直接使用
	if strings.HasPrefix(modelName, "workflow-") {
		return strings.TrimPrefix(modelName, "workflow-")
	}

	// 方法2: 从 CustomConfig 中解析工作流ID
	if customConfig != "" {
		var config map[string]interface{}
		if err := json.Unmarshal([]byte(customConfig), &config); err == nil {
			if workflowID, ok := config["workflow_id"].(string); ok && workflowID != "" {
				return workflowID
			}
			// 也可能存储在其他字段中
			if workflowID, ok := config["bot_id"].(string); ok && workflowID != "" {
				return workflowID
			}
		}
	}

	// 方法3: 直接使用模型名称作为工作流ID（假设模型名称就是工作流ID）
	if modelName != "" {
		return modelName
	}

	return ""
}

// executeWorkflow 执行工作流并返回标准响应数据
func executeWorkflow(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent) (*custom.WorkflowResponseData, error) {
	// 允许空参数，归一化为 {}
	if workflowRequest.Parameters == nil || len(workflowRequest.Parameters) == 0 {
		workflowRequest.Parameters = map[string]interface{}{}
	}

	_, _, requestID := prepareDetachedExecutionContext(c, helper.GetRequestID(c.Request.Context()))
	runCtx, runCancel := startAgentRunCancelWatcher(c.Request.Context(), agent.Eid, requestID, time.Second)
	defer runCancel()
	if c != nil && c.Request != nil {
		c.Request = c.Request.WithContext(runCtx)
	}

	logger.SysLogf("工作流执行开始 - Model: %s, ConversationID: %d, Parameters: %+v",
		workflowRequest.Model, workflowRequest.ConversationID, workflowRequest.Parameters)

	modelName := agent.Model
	// 获取渠道并检查/刷新token
	logger.SysLogf("工作流执行 - 开始获取渠道，Eid: %d, ChannelType: %d, Model: %s",
		agent.Eid, agent.ChannelType, modelName)

	// 使用新的服务函数获取渠道并检查/刷新token
	ctx := c.Request.Context()
	channel, err := getAgentSpecificChannel(ctx, agent)
	if err != nil {
		return nil, fmt.Errorf("获取渠道失败，Eid: %d, ChannelType: %d, Model: %s, Error: %v",
			agent.Eid, agent.ChannelType, modelName, err)
	}
	if channel == nil {
		channel, err = service.GetChannelWithTokenRefresh(ctx, agent.Eid, agent.ChannelType, modelName, 0)
		if err != nil {
			providerID := agent.GetProviderID()
			logger.SysLogf("尝试获取平台 ID %d", providerID)
			// 如果是Coze渠道，尝试使用备用方法获取渠道（优先选择有Provider的Channel）
			if agent.ChannelType == channeltype.Coze {
				if providerID == 0 {
					channel, err = model.GetFirstAvailableChannelByEidAndProviderType(agent.Eid, channeltype.Coze)
				} else {
					channel, err = model.GetFirstChannelByEidAndProviderType(agent.Eid, channeltype.Coze, providerID)
				}

				if err != nil || channel == nil {
					return nil, fmt.Errorf("provider channel error")
				}
				channel.Models = channel.GetAddModelString(modelName)
				err := model.DB.Updates(channel).Error
				if err != nil {
					return nil, fmt.Errorf("update channel error")
				}
			} else {
				return nil, fmt.Errorf("获取渠道失败，Eid: %d, ChannelType: %d, Model: %s, Error: %v",
					agent.Eid, agent.ChannelType, modelName, err)
			}
		}
	}

	logger.SysLogf("工作流执行 - 成功获取渠道，ChannelID: %d, BaseURL: %v",
		channel.ChannelID, channel.BaseURL)

	// 设置渠道上下文
	middleware.SetupContextForSelectedChannel(c, channel, modelName)

	// 直接调用工作流适配器执行
	return executeWorkflowDirect(c, workflowRequest, agent, channel, modelName)
}

// executeWorkflowDirect 直接执行工作流，简化参数传递
func executeWorkflowDirect(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent, channel *model.Channel, modelName string) (*custom.WorkflowResponseData, error) {
	// 根据渠道类型选择对应的工作流适配器
	if channel.Type == channeltype.Coze || channel.Type == model.ChannelApiTypeCozeStudio {
		return executeCozeWorkflow(c, workflowRequest, agent, channel, modelName)
	}

	if channel.Type == model.ChannelApiDify {
		return executeDifyWorkflowByMode(c, workflowRequest, agent, channel, modelName)
	}

	if channel.Type == channeltype.FastGPT || channel.Type == model.ChannelApiTypeFastGpt {
		// 这个 fastgpt 是因为 适配器的默认给 0 了，所以这里要手动设置一下，实际上数据库里面不会存 1007
		return executeFastGPTWorkflow(c, workflowRequest, agent, channel, modelName)
	}

	if channel.Type == model.ChannelApi53AI {
		return executeAI53Workflow(c, workflowRequest, agent, channel, modelName)
	}

	if channel.Type == model.ChannelApiTypeN8n {
		return executeN8nWorkflow(c, workflowRequest, agent, channel, modelName)
	}

	return nil, fmt.Errorf("不支持的渠道类型: %d", channel.Type)
}

// handleWorkflowError 处理工作流HTTP错误响应
func handleWorkflowError(resp *http.Response, workflowType string) error {
	// 读取错误响应内容
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	logger.SysErrorf("❌ %s工作流请求失败 - 状态码: %d, 响应: %s",
		workflowType, resp.StatusCode, string(body))

	// 尝试解析错误响应获取详细信息
	var detailMsg string
	if len(body) > 0 {
		// 尝试解析 JSON 错误响应
		var errorResp map[string]interface{}
		if err := json.Unmarshal(body, &errorResp); err == nil {
			// 优先获取 message 字段
			if msg, ok := errorResp["message"].(string); ok && msg != "" {
				detailMsg = msg
			} else if msg, ok := errorResp["error"].(string); ok && msg != "" {
				detailMsg = msg
			} else if msg, ok := errorResp["detail"].(string); ok && msg != "" {
				detailMsg = msg
			}
		}

		// 如果无法解析 JSON，使用原始响应内容
		if detailMsg == "" {
			detailMsg = string(body)
		}
	}

	// 构建错误消息
	var errorMsg string
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		if detailMsg != "" {
			errorMsg = fmt.Sprintf("%s工作流请求参数错误：%s", workflowType, detailMsg)
		} else {
			errorMsg = fmt.Sprintf("%s工作流请求参数错误，状态码: %d", workflowType, resp.StatusCode)
		}
	} else {
		if detailMsg != "" {
			errorMsg = fmt.Sprintf("%s工作流请求失败：%s", workflowType, detailMsg)
		} else {
			errorMsg = fmt.Sprintf("%s工作流请求失败，状态码: %d", workflowType, resp.StatusCode)
		}
	}

	return errors.New(errorMsg)
}

// executeCozeWorkflow 执行 Coze 工作流
func executeCozeWorkflow(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent, channel *model.Channel, modelName string) (*custom.WorkflowResponseData, error) {
	// 获取元数据
	meta := GetByContext(c)
	meta.APIType = model.GetApiType(channel.Type)
	meta.OriginModelName = modelName
	meta.ChannelId = int(channel.ChannelID)
	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}
	meta.APIKey = channel.Key

	// 应用模型映射
	mappedModel, _ := getMappedModelName(modelName, meta.ModelMapping)
	meta.ActualModelName = mappedModel

	logger.SysLogf("Coze工作流执行 - 模型映射，OriginModel: %s, ActualModel: %s",
		meta.OriginModelName, meta.ActualModelName)

	// 创建工作流适配器
	workflowAdaptor := &coze.WorkflowAdaptor{}
	workflowAdaptor.Init(meta)

	// 设置自定义配置
	user_id := config.GetUserId(c)
	conversation, err := GetSessionConversation(c)
	if err == nil {
		customConfig := &custom.CustomConfig{
			UserId:                     "angethub_u" + fmt.Sprintf("%d", user_id),
			ConversationId:             conversation.ChannelConversationID,
			ConversationExpirationTime: conversation.ChannelConversationExpirationTime,
			AIHubConversationId:        conversation.ConversationID,
		}
		workflowAdaptor.CustomConfig = customConfig
	}

	// 构建工作流请求
	workflowID := extractWorkflowID(agent.Model, agent.CustomConfig)
	if workflowID == "" {
		return nil, fmt.Errorf("无法提取工作流ID")
	}

	// 使用简化的方法直接构造请求
	cozeRequest := workflowAdaptor.ConvertWorkflowRequest(workflowID, workflowRequest.Parameters)

	// 序列化请求
	requestBody, err := json.Marshal(cozeRequest)
	if err != nil {
		return nil, fmt.Errorf("序列化工作流请求失败: %v", err)
	}

	// 执行请求
	resp, err := workflowAdaptor.DoRequest(c, meta, bytes.NewReader(requestBody))
	if err != nil {
		return nil, fmt.Errorf("执行工作流请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 检查 HTTP 状态码
	if resp.StatusCode >= 400 {
		return nil, handleWorkflowError(resp, "Coze")
	}

	// 读取响应
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取工作流响应失败: %v", err)
	}

	logger.SysLogf("Coze工作流原始响应 - StatusCode: %d, 响应长度: %d bytes",
		resp.StatusCode, len(responseBody))

	// 转换响应
	workflowResponse, err := workflowAdaptor.ConvertToWorkflowResponseData(responseBody)
	if err != nil {
		return nil, fmt.Errorf("转换工作流响应失败: %v", err)
	}

	// 设置响应信息
	workflowResponse.ChannelID = int(channel.ChannelID)
	workflowResponse.ModelName = agent.Model

	if len(workflowResponse.WorkflowOutputData) == 0 {
		logger.SysLogf("⚠️ Coze工作流执行成功但输出字段为空 - ExecuteID: %s", workflowResponse.ExecuteID)
		logger.SysLogf("🔍 Coze工作流详细输出数据: %+v", workflowResponse)
	} else {
		logger.SysLogf("✅ Coze工作流执行成功 - ExecuteID: %s, 输出字段数: %d",
			workflowResponse.ExecuteID, len(workflowResponse.WorkflowOutputData))
	}

	return workflowResponse, nil
}

// executeDifyWorkflow 执行 DIFY 工作流
func executeDifyWorkflow(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent, channel *model.Channel, modelName string) (*custom.WorkflowResponseData, error) {
	// 获取元数据
	meta := GetByContext(c)
	meta.APIType = model.GetApiType(channel.Type)
	meta.OriginModelName = modelName
	meta.ChannelId = int(channel.ChannelID)
	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}
	meta.APIKey = channel.Key

	// 应用模型映射
	mappedModel, _ := getMappedModelName(modelName, meta.ModelMapping)
	meta.ActualModelName = mappedModel

	logger.SysLogf("DIFY工作流执行 - 模型映射，OriginModel: %s, ActualModel: %s",
		meta.OriginModelName, meta.ActualModelName)

	// 创建工作流适配器
	workflowAdaptor := &dify.DifyWorkflowAdaptor{}
	workflowAdaptor.Init(meta)

	// 设置自定义配置
	user_id := config.GetUserId(c)
	conversation, err := GetSessionConversation(c)
	if err == nil {
		customConfig := &custom.CustomConfig{
			UserId:                     "angethub_u" + fmt.Sprintf("%d", user_id),
			ConversationId:             conversation.ChannelConversationID,
			ConversationExpirationTime: conversation.ChannelConversationExpirationTime,
			AIHubConversationId:        conversation.ConversationID,
		}
		workflowAdaptor.CustomConfig = customConfig
	}

	// 构建工作流请求
	workflowID := extractWorkflowID(agent.Model, agent.CustomConfig)
	if workflowID == "" {
		return nil, fmt.Errorf("无法提取工作流ID")
	}

	// 使用简化的方法直接构造请求
	difyRequest, err := workflowAdaptor.ConvertWorkflowRequest(workflowID, workflowRequest.Parameters)
	if err != nil {
		return nil, fmt.Errorf("构造DIFY工作流请求失败: %v", err)
	}

	// 序列化请求
	requestBody, err := json.Marshal(difyRequest)
	if err != nil {
		return nil, fmt.Errorf("序列化DIFY工作流请求失败: %v", err)
	}

	// 执行请求
	resp, err := workflowAdaptor.DoRequest(c, meta, bytes.NewReader(requestBody))
	if err != nil {
		return nil, fmt.Errorf("执行DIFY工作流请求失败: %v", err)
	}

	// 检查 HTTP 状态码
	if resp.StatusCode >= 400 {
		return nil, handleWorkflowError(resp, "DIFY")
	}

	// 处理流式响应
	workflowResponse, err := workflowAdaptor.ProcessStreamingResponse(resp)
	if err != nil {
		return nil, fmt.Errorf("处理DIFY工作流响应失败: %v", err)
	}

	// 设置响应信息
	workflowResponse.ChannelID = int(channel.ChannelID)
	workflowResponse.ModelName = agent.Model

	if len(workflowResponse.WorkflowOutputData) == 0 {
		logger.SysLogf("⚠️ DIFY工作流执行成功但输出字段为空 - ExecuteID: %s", workflowResponse.ExecuteID)
		logger.SysLogf("🔍 DIFY工作流详细输出数据: %+v", workflowResponse)
	} else {
		logger.SysLogf("✅ DIFY工作流执行成功 - ExecuteID: %s, 输出字段数: %d",
			workflowResponse.ExecuteID, len(workflowResponse.WorkflowOutputData))
	}

	return workflowResponse, nil
}

// executeFastGPTWorkflow 执行 FastGPT 工作流
func executeFastGPTWorkflow(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent, channel *model.Channel, modelName string) (*custom.WorkflowResponseData, error) {
	// 检查 Agent 类型是否为工作流类型
	if agent.AgentType != model.AgentTypeWorkflow {
		return nil, fmt.Errorf("Agent 类型不是工作流类型，当前类型: %d", agent.AgentType)
	}

	// 获取元数据
	meta := GetByContext(c)
	meta.APIType = model.GetApiType(channel.Type)
	meta.OriginModelName = modelName
	meta.ChannelId = int(channel.ChannelID)
	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}
	meta.APIKey = channel.Key

	// 应用模型映射
	mappedModel, _ := getMappedModelName(modelName, meta.ModelMapping)
	meta.ActualModelName = mappedModel

	logger.SysLogf("FastGPT工作流执行 - 模型映射，OriginModel: %s, ActualModel: %s",
		meta.OriginModelName, meta.ActualModelName)

	// 创建工作流适配器
	workflowAdaptor := &fastgpt.FastGPTWorkflowAdaptor{}
	workflowAdaptor.Init(meta)

	// 设置自定义配置
	user_id := config.GetUserId(c)
	conversation, err := GetSessionConversation(c)
	if err == nil {
		customConfig := &custom.CustomConfig{
			UserId:                     "angethub_u" + fmt.Sprintf("%d", user_id),
			ConversationId:             conversation.ChannelConversationID,
			ConversationExpirationTime: conversation.ChannelConversationExpirationTime,
			AIHubConversationId:        conversation.ConversationID,
		}
		workflowAdaptor.CustomConfig = customConfig
	}

	// 转换工作流请求为 FastGPT 工作流请求
	fastgptRequest, err := workflowAdaptor.ConvertWorkflowToWorkflowRequest(workflowRequest.Parameters)
	if err != nil {
		return nil, fmt.Errorf("转换FastGPT工作流请求失败: %v", err)
	}

	// 序列化请求
	requestBody, err := json.Marshal(fastgptRequest)
	if err != nil {
		return nil, fmt.Errorf("序列化FastGPT工作流请求失败: %v", err)
	}

	// 执行请求
	resp, err := workflowAdaptor.DoRequest(c, meta, bytes.NewReader(requestBody))
	if err != nil {
		return nil, fmt.Errorf("执行FastGPT工作流请求失败: %v", err)
	}

	// 检查 HTTP 状态码
	if resp.StatusCode >= 400 {
		return nil, handleWorkflowError(resp, "FastGPT")
	}

	// 处理响应
	workflowResponse, err := workflowAdaptor.ProcessWorkflowResponse(resp)
	if err != nil {
		return nil, fmt.Errorf("处理FastGPT工作流响应失败: %v", err)
	}

	// 设置响应信息
	workflowResponse.ChannelID = int(channel.ChannelID)
	workflowResponse.ModelName = agent.Model

	if len(workflowResponse.WorkflowOutputData) == 0 {
		logger.SysLogf("⚠️ FastGPT工作流执行成功但输出字段为空 - ExecuteID: %s", workflowResponse.ExecuteID)
		logger.SysLogf("🔍 FastGPT工作流详细输出数据: %+v", workflowResponse)
	} else {
		logger.SysLogf("✅ FastGPT工作流执行成功 - ExecuteID: %s, 输出字段数: %d",
			workflowResponse.ExecuteID, len(workflowResponse.WorkflowOutputData))
	}

	return workflowResponse, nil
}

// executeAI53Workflow 执行 53AI 工作流
func executeAI53Workflow(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent, channel *model.Channel, modelName string) (*custom.WorkflowResponseData, error) {
	// 检查 Agent 类型是否为工作流类型
	if agent.AgentType != model.AgentTypeWorkflow {
		return nil, fmt.Errorf("Agent 类型不是工作流类型，当前类型: %d", agent.AgentType)
	}

	// 获取元数据
	meta := GetByContext(c)
	meta.APIType = model.GetApiType(channel.Type)
	meta.OriginModelName = modelName
	meta.ChannelId = int(channel.ChannelID)
	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}
	meta.APIKey = channel.Key

	// 应用模型映射
	mappedModel, _ := getMappedModelName(modelName, meta.ModelMapping)
	meta.ActualModelName = mappedModel

	logger.SysLogf("53AI工作流执行 - 模型映射，OriginModel: %s, ActualModel: %s",
		meta.OriginModelName, meta.ActualModelName)

	// 创建工作流适配器
	workflowAdaptor := &adaptor53AI.AI53WorkflowAdaptor{}
	workflowAdaptor.Init(meta)

	// 设置自定义配置
	user_id := config.GetUserId(c)
	conversation, err := GetSessionConversation(c)
	if err == nil {
		customConfig := &custom.CustomConfig{
			UserId:                     "angethub_u" + fmt.Sprintf("%d", user_id),
			ConversationId:             conversation.ChannelConversationID,
			ConversationExpirationTime: conversation.ChannelConversationExpirationTime,
			AIHubConversationId:        conversation.ConversationID,
		}
		workflowAdaptor.CustomConfig = customConfig
	}

	// 转换工作流请求为 53AI 工作流请求
	ai53Request, err := workflowAdaptor.ConvertWorkflowToAI53Request(workflowRequest.Parameters)
	if err != nil {
		return nil, fmt.Errorf("转换53AI工作流请求失败: %v", err)
	}

	// 序列化请求
	requestBody, err := json.Marshal(ai53Request)
	if err != nil {
		return nil, fmt.Errorf("序列化53AI工作流请求失败: %v", err)
	}

	// 执行请求
	resp, err := workflowAdaptor.DoRequest(c, meta, bytes.NewReader(requestBody))
	if err != nil {
		return nil, fmt.Errorf("执行53AI工作流请求失败: %v", err)
	}

	// 检查 HTTP 状态码
	if resp.StatusCode >= 400 {
		return nil, handleWorkflowError(resp, "53AI")
	}

	// 处理响应
	workflowResponse, err := workflowAdaptor.ProcessAI53WorkflowResponse(resp)
	if err != nil {
		return nil, fmt.Errorf("处理53AI工作流响应失败: %v", err)
	}

	// 设置响应信息
	workflowResponse.ChannelID = int(channel.ChannelID)
	workflowResponse.ModelName = agent.Model

	if len(workflowResponse.WorkflowOutputData) == 0 {
		logger.SysLogf("⚠️ 53AI工作流执行成功但输出字段为空 - TaskID: %s", workflowResponse.ExecuteID)
		logger.SysLogf("🔍 53AI工作流详细输出数据: %+v", workflowResponse)
	} else {
		logger.SysLogf("✅ 53AI工作流执行成功 - TaskID: %s, 输出字段数: %d",
			workflowResponse.ExecuteID, len(workflowResponse.WorkflowOutputData))
	}

	return workflowResponse, nil
}

// saveWorkflowMessage 保存工作流消息记录
func saveWorkflowMessage(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent, response *custom.WorkflowResponseData) error {
	ctx := c.Request.Context()

	// 获取用户信息
	userId := config.GetUserId(c)
	if userId == 0 {
		return errors.New("用户ID获取失败")
	}

	// 获取会话ID
	conversationId := workflowRequest.ConversationID
	if conversationId == 0 {
		conversationId = c.GetInt64(session.SESSION_CONVERSATION_ID)
	}

	// 序列化工作流参数作为 message 内容
	parametersJSON, err := json.Marshal(workflowRequest.Parameters)
	if err != nil {
		logger.SysErrorf("序列化工作流参数失败: %v", err)
		parametersJSON = []byte("{}")
	}

	// 序列化工作流输出数据作为 answer 内容
	outputDataJSON, err := json.Marshal(response.WorkflowOutputData)
	if err != nil {
		logger.SysErrorf("序列化工作流输出数据失败: %v", err)
		outputDataJSON = []byte("{}")
	}

	// 获取请求ID
	requestId := helper.GetRequestID(ctx)
	if requestId == "" {
		requestId = response.ExecuteID // 使用 execute_id 作为 request_id
	}

	// 计算执行时间（如果有开始时间记录）
	var elapsedTime int64 = 0
	if startTimeValue, exists := c.Get("workflow_start_time"); exists {
		if startTime, ok := startTimeValue.(time.Time); ok {
			elapsedTime = helper.CalcElapsedTime(startTime)
		}
	}

	// 计算 token 消耗
	promptTokens, completionTokens, totalTokens := calculateWorkflowTokens(workflowRequest, response)

	// 获取费率信息（复用 chat 的费率计算逻辑）
	channelType := getWorkflowChannelType(response)
	modelRatio := billing_ratio.GetModelRatio(workflowRequest.Model, channelType)
	groupRatio := 1.0 // 与 chat 保持一致
	completionRatio := billing_ratio.GetCompletionRatio(workflowRequest.Model, channelType)
	ratio := modelRatio * groupRatio

	// 计算配额（复用 chat 的配额计算公式）
	quota := int64(math.Ceil((float64(promptTokens) + float64(completionTokens)*completionRatio) * ratio))
	if ratio != 0 && quota <= 0 {
		quota = 1 // 边界情况处理，与 chat 保持一致
	}

	// 生成配额内容记录（复用 chat 的格式）
	quotaContent := fmt.Sprintf("倍率：%.2f × %.2f × %.2f", modelRatio, groupRatio, completionRatio)

	// 创建消息记录
	message := &model.Message{
		Eid:               agent.Eid,
		UserID:            userId,
		ConversationID:    conversationId,
		AgentID:           agent.AgentID,
		Message:           string(parametersJSON), // 存储 parameters 的 JSON
		Answer:            string(outputDataJSON), // 存储 workflow_output_data 的 JSON
		ReasoningContent:  "",                     // 工作流暂不支持推理内容
		ModelName:         response.ModelName,
		Quota:             int(quota),
		PromptTokens:      promptTokens,
		CompletionTokens:  completionTokens,
		TotalTokens:       totalTokens,
		ChannelId:         response.ChannelID,
		RequestId:         requestId,
		ElapsedTime:       elapsedTime,
		IsStream:          false, // 工作流不支持流式
		QuotaContent:      quotaContent,
		AgentCustomConfig: agent.CustomConfig, // 历史记录
		RequestSource:     normalizeRequestSource(workflowRequest.Source),
	}
	applyVisitorIdentityToMessage(c, message)

	// 保存消息到数据库
	if err := model.CreateMessage(message); err != nil {
		return fmt.Errorf("创建消息记录失败: %v", err)
	}

	logger.SysLogf("工作流消息保存成功 - MessageID: %d, ExecuteID: %s", message.ID, response.ExecuteID)

	// 更新会话的最后消息（如果有会话ID）
	if conversationId != 0 {
		if err := updateConversationLastMessage(agent.Eid, conversationId, userId, string(parametersJSON), string(outputDataJSON), int(quota), totalTokens); err != nil {
			logger.SysErrorf("更新会话最后消息失败: %v", err)
			// 不返回错误，不影响主流程
		}
	}

	// 自动添加快捷 Agent，记录工作流输出
	if err := model.AddOrUpdateUserAgentShortcut(agent.Eid, userId, agent.AgentID, string(outputDataJSON)); err != nil {
		logger.SysErrorf("【快捷Agent】添加快捷失败: eid=%d user_id=%d agent_id=%d err=%v", agent.Eid, userId, agent.AgentID, err)
	}

	return nil
}

// updateConversationLastMessage 更新会话的最后消息和配额统计
func updateConversationLastMessage(eid, conversationId, userId int64, question, answer string, quota, totalTokens int) error {
	conversation, err := model.GetConversationByIdAndUserId(eid, conversationId, userId)
	if err != nil {
		return fmt.Errorf("获取会话失败: %v", err)
	}

	// 构造最后消息的 JSON 格式（与 chat 类型保持一致）
	lastMessage, err := json.Marshal(map[string]string{
		"question": question,
		"answer":   answer,
	})
	if err != nil {
		return fmt.Errorf("序列化最后消息失败: %v", err)
	}

	// 更新会话（复用 chat 的会话统计逻辑）
	conversation.LastMessage = string(lastMessage)
	conversation.Quota += quota
	conversation.TotalTokens += totalTokens
	if err := model.UpdateConversation(conversation); err != nil {
		return fmt.Errorf("更新会话失败: %v", err)
	}

	return nil
}

// calculateWorkflowTokens 计算工作流的 token 消耗
func calculateWorkflowTokens(workflowRequest *WorkflowRunRequest, response *custom.WorkflowResponseData) (promptTokens, completionTokens, totalTokens int) {
	// 计算输入 token（基于 parameters）
	parametersText := ""
	for key, value := range workflowRequest.Parameters {
		if strValue, ok := value.(string); ok {
			parametersText += key + ":" + strValue + " "
		} else {
			// 对于非字符串类型，序列化为 JSON
			if jsonBytes, err := json.Marshal(value); err == nil {
				parametersText += key + ":" + string(jsonBytes) + " "
			}
		}
	}

	// 使用现有的 token 计算逻辑
	promptTokens = openai.CountTokenText(parametersText, workflowRequest.Model)

	// 计算输出 token（基于 workflow_output_data）
	outputText := ""
	for key, value := range response.WorkflowOutputData {
		if strValue, ok := value.(string); ok {
			outputText += key + ":" + strValue + " "
		} else {
			// 对于非字符串类型，序列化为 JSON
			if jsonBytes, err := json.Marshal(value); err == nil {
				outputText += key + ":" + string(jsonBytes) + " "
			}
		}
	}

	completionTokens = openai.CountTokenText(outputText, workflowRequest.Model)
	totalTokens = promptTokens + completionTokens

	logger.SysLogf("工作流 Token 计算 - Model: %s, PromptTokens: %d, CompletionTokens: %d, TotalTokens: %d",
		workflowRequest.Model, promptTokens, completionTokens, totalTokens)

	return promptTokens, completionTokens, totalTokens
}

// executeN8nWorkflow 执行 n8n 工作流
func executeN8nWorkflow(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent, channel *model.Channel, modelName string) (*custom.WorkflowResponseData, error) {
	// 检查 Agent 类型是否为工作流类型
	if agent.AgentType != model.AgentTypeWorkflow {
		return nil, fmt.Errorf("Agent 类型不是工作流类型，当前类型: %d", agent.AgentType)
	}

	// 获取元数据
	meta := GetByContext(c)
	meta.APIType = model.GetApiType(channel.Type)
	meta.OriginModelName = modelName
	meta.ChannelId = int(channel.ChannelID)
	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}
	meta.APIKey = channel.Key

	// 应用模型映射
	mappedModel, _ := getMappedModelName(modelName, meta.ModelMapping)
	meta.ActualModelName = mappedModel

	logger.SysLogf("n8n工作流执行 - 模型映射，OriginModel: %s, ActualModel: %s",
		meta.OriginModelName, meta.ActualModelName)

	// 创建工作流适配器
	workflowAdaptor := &n8n.N8nWorkflowAdaptor{}
	workflowAdaptor.Init(meta)

	// 设置自定义配置
	user_id := config.GetUserId(c)
	conversation, err := GetSessionConversation(c)
	if err == nil {
		customConfig := &custom.CustomConfig{
			UserId:                     "angethub_u" + fmt.Sprintf("%d", user_id),
			ConversationId:             conversation.ChannelConversationID,
			ConversationExpirationTime: conversation.ChannelConversationExpirationTime,
			AIHubConversationId:        conversation.ConversationID,
		}
		workflowAdaptor.CustomConfig = customConfig
	}

	// 构建工作流请求
	workflowID := extractWorkflowID(agent.Model, agent.CustomConfig)
	if workflowID == "" {
		return nil, fmt.Errorf("无法提取工作流ID")
	}

	// 转换工作流请求为 n8n 工作流请求
	n8nRequest, err := workflowAdaptor.ConvertWorkflowRequest(workflowID, workflowRequest.Parameters)
	if err != nil {
		return nil, fmt.Errorf("转换n8n工作流请求失败: %v", err)
	}

	// 序列化请求
	requestBody, err := json.Marshal(n8nRequest)
	if err != nil {
		return nil, fmt.Errorf("序列化n8n工作流请求失败: %v", err)
	}

	// 执行请求
	resp, err := workflowAdaptor.DoRequest(c, meta, bytes.NewReader(requestBody))
	if err != nil {
		return nil, fmt.Errorf("执行n8n工作流请求失败: %v", err)
	}

	// 检查 HTTP 状态码
	if resp.StatusCode >= 400 {
		return nil, handleWorkflowError(resp, "n8n")
	}

	// 处理响应
	workflowResponse, err := workflowAdaptor.ProcessResponse(resp)
	if err != nil {
		return nil, fmt.Errorf("处理n8n工作流响应失败: %v", err)
	}

	// 设置响应信息
	workflowResponse.ChannelID = int(channel.ChannelID)
	workflowResponse.ModelName = agent.Model

	if len(workflowResponse.WorkflowOutputData) == 0 {
		logger.SysLogf("⚠️ n8n工作流执行成功但输出字段为空 - ExecuteID: %s", workflowResponse.ExecuteID)
		logger.SysLogf("🔍 n8n工作流详细输出数据: %+v", workflowResponse)
	} else {
		logger.SysLogf("✅ n8n工作流执行成功 - ExecuteID: %s, 输出字段数: %d",
			workflowResponse.ExecuteID, len(workflowResponse.WorkflowOutputData))
	}

	return workflowResponse, nil
}

// getWorkflowChannelType 获取工作流的渠道类型
func getWorkflowChannelType(response *custom.WorkflowResponseData) int {
	// 从响应中获取渠道ID，然后查询渠道类型
	if response.ChannelID > 0 {
		if channel, err := model.GetChannelByID(int64(response.ChannelID)); err == nil {
			return channel.Type
		}
	}

	// 默认返回 Coze 类型（当前主要支持的工作流类型）
	return channeltype.Coze
}

// fetchDifyAppMode 从DIFY API获取应用的mode信息
func fetchDifyAppMode(channel *model.Channel) (string, error) {
	// 构建元数据用于API调用
	meta := &meta.Meta{
		ChannelId: int(channel.ChannelID),
		APIKey:    channel.Key,
	}
	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}

	// 创建适配器并获取应用信息
	adaptor := &dify.DifyInfoAdaptor{}
	appInfo, err := adaptor.GetAppInfo(meta)
	if err != nil {
		return "", fmt.Errorf("获取DIFY应用信息失败: %v", err)
	}

	return appInfo.Mode, nil
}

// executeDifyWorkflowByMode 根据mode选择适当的DIFY执行方式
func executeDifyWorkflowByMode(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent, channel *model.Channel, modelName string) (*custom.WorkflowResponseData, error) {
	// 检查模型名称是否包含 "workflow-"
	if !strings.Contains(modelName, "workflow-") {
		return executeDifyWorkflow(c, workflowRequest, agent, channel, modelName)
	}

	// 解析配置获取 mode
	var config map[string]interface{}
	if channel.Config != "" {
		if err := json.Unmarshal([]byte(channel.Config), &config); err != nil {
			logger.SysLogf("解析渠道配置失败: %v", err)
			// 如果解析失败，默认使用工作流模式
			return executeDifyWorkflow(c, workflowRequest, agent, channel, modelName)
		}
	} else {
		config = make(map[string]interface{})
	}

	// 检查 mode 值是否存在
	mode, exists := config["mode"]
	if !exists {
		// 如果不存在mode字段，则动态获取
		fetchedMode, err := fetchDifyAppMode(channel)
		if err != nil {
			logger.SysLogf("获取DIFY应用mode失败: %v，使用默认工作流模式", err)
			return executeDifyWorkflow(c, workflowRequest, agent, channel, modelName)
		}

		// 将获取到的mode信息更新到数据库中，以便后续请求使用
		config["mode"] = fetchedMode
		if err := model.UpdateChannelConfigOnly(channel.ChannelID, config); err != nil {
			logger.SysLogf("更新渠道配置失败: %v", err)
			// 即使更新失败，仍然使用当前获取到的mode值
		}

		// 直接使用获取到的mode值
		if fetchedMode == "completion" {
			return executeDifyCompletionMessages(c, workflowRequest, agent, channel, modelName)
		}
		return executeDifyWorkflow(c, workflowRequest, agent, channel, modelName)
	}

	// 检查 mode 值
	if mode == "completion" {
		return executeDifyCompletionMessages(c, workflowRequest, agent, channel, modelName)
	}

	return executeDifyWorkflow(c, workflowRequest, agent, channel, modelName)
}

// executeDifyCompletionMessages 执行 DIFY Completion Messages
func executeDifyCompletionMessages(c *gin.Context, workflowRequest *WorkflowRunRequest, agent *model.Agent, channel *model.Channel, modelName string) (*custom.WorkflowResponseData, error) {
	// 获取元数据
	meta := GetByContext(c)
	meta.APIType = model.GetApiType(channel.Type)
	meta.OriginModelName = modelName
	meta.ChannelId = int(channel.ChannelID)
	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}
	meta.APIKey = channel.Key

	// 应用模型映射
	mappedModel, _ := getMappedModelName(modelName, meta.ModelMapping)
	meta.ActualModelName = mappedModel

	logger.SysLogf("DIFY补全消息执行 - 模型映射，OriginModel: %s, ActualModel: %s",
		meta.OriginModelName, meta.ActualModelName)

	// 构建 completion request
	workflowID := extractWorkflowID(agent.Model, agent.CustomConfig)
	if workflowID == "" {
		return nil, fmt.Errorf("无法提取工作流ID")
	}

	// 构建请求体，符合 DIFY /completion-messages API 规范
	var inputs map[string]interface{}

	// 检查参数中是否包含 query，如果没有则默认添加
	queryExists := false
	for key := range workflowRequest.Parameters {
		if key == "query" {
			queryExists = true
			break
		}
	}

	if !queryExists {
		// 如果没有query参数，从参数中提取第一个值作为query，或者使用默认值
		if len(workflowRequest.Parameters) > 0 {
			for _, value := range workflowRequest.Parameters {
				if strValue, ok := value.(string); ok && strValue != "" {
					workflowRequest.Parameters["query"] = strValue
					queryExists = true
					break
				}
			}
		}

		if !queryExists {
			workflowRequest.Parameters["query"] = "请处理请求"
		}
	}

	inputs = workflowRequest.Parameters

	// 创建 completion request 对象
	completionRequest := map[string]interface{}{
		"inputs":        inputs,
		"response_mode": "blocking", // 使用阻塞模式，因为我们需要等待完整结果
		"user":          fmt.Sprintf("agenthub_u%d", config.GetUserId(c)),
	}

	// 序列化请求
	requestBody, err := json.Marshal(completionRequest)
	if err != nil {
		return nil, fmt.Errorf("序列化DIFY补全请求失败: %v", err)
	}

	// 获取基础URL
	baseURL := meta.BaseURL
	baseURL = strings.TrimSuffix(baseURL, "/v1")
	baseURL = strings.TrimSuffix(baseURL, "/")

	url := baseURL + "/v1/completion-messages"

	logger.SysLogf("🚀 DIFY补全消息请求开始")
	logger.SysLogf("┌─────────────────────────────────────────────────────────────")
	logger.SysLogf("│ 📡 请求URL: %s", url)
	logger.SysLogf("│ 🔑 API Key: %s", helper.MaskAPIKey(meta.APIKey))
	logger.SysLogf("│ 📝 请求方法: POST")
	logger.SysLogf("│ 📋 Content-Type: application/json")
	logger.SysLogf("├─────────────────────────────────────────────────────────────")
	logger.SysLogf("│ 📦 请求参数:")
	logger.SysLogf("│   %s", string(requestBody))
	logger.SysLogf("└─────────────────────────────────────────────────────────────")

	// 创建HTTP请求
	req, err := http.NewRequest("POST", url, bytes.NewReader(requestBody))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	// 设置请求头
	req.Header.Set("Authorization", "Bearer "+meta.APIKey)
	req.Header.Set("Content-Type", "application/json")

	// 执行请求
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("执行DIFY补全请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 检查 HTTP 状态码
	if resp.StatusCode >= 400 {
		return nil, handleWorkflowError(resp, "DIFY")
	}

	// 读取响应体
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取DIFY响应失败: %v", err)
	}

	logger.SysLogf("✅ DIFY补全消息请求成功 - 状态码: %d, 响应长度: %d bytes",
		resp.StatusCode, len(responseBody))

	// 解析响应
	var difyResponse map[string]interface{}
	if err := json.Unmarshal(responseBody, &difyResponse); err != nil {
		return nil, fmt.Errorf("解析DIFY响应失败: %v", err)
	}

	// 提取 answer 字段
	answer, ok := difyResponse["answer"].(string)
	if !ok {
		answer = "未能从响应中提取到答案"
	}

	// 提取 message_id
	messageID, _ := difyResponse["message_id"].(string)
	if messageID == "" {
		messageID = fmt.Sprintf("dify_msg_%d", time.Now().Unix())
	}

	// 返回响应数据
	logger.SysLogf("✅ DIFY补全消息执行成功 - ChannelID: %d, Model: %s, Answer Length: %d",
		channel.ChannelID, agent.Model, len(answer))

	return &custom.WorkflowResponseData{
		WorkflowOutputData: map[string]interface{}{
			"text":       answer,
			"message_id": messageID,
			"created_at": difyResponse["created_at"],
			"mode":       difyResponse["mode"],
		},
		ExecuteID: fmt.Sprintf("dify_completion_%d_%d", channel.ChannelID, time.Now().Unix()),
		ChannelID: int(channel.ChannelID),
		ModelName: agent.Model,
	}, nil
}
