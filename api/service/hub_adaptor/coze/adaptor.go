package coze

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
)

type Adaptor struct {
	meta         *meta.Meta
	CustomConfig *custom.CustomConfig
}

func (a *Adaptor) Init(meta *meta.Meta) {
	a.meta = meta
}

func (a *Adaptor) GetRequestURL(meta *meta.Meta) (string, error) {
	baseUrl, err := custom.GetBaseURL(meta.BaseURL)
	if err != nil {
		return "", err
	}

	// 检查是否为工作流请求
	if strings.HasPrefix(meta.ActualModelName, "workflow-") {
		// 使用工作流适配器处理
		workflowAdaptor := &WorkflowAdaptor{
			meta:         meta,
			CustomConfig: a.CustomConfig,
		}
		return workflowAdaptor.GetRequestURL(meta)
	}

	// 默认使用Bot模式
	url := fmt.Sprintf("%s/v3/chat", baseUrl)
	if a.CustomConfig.ConversationId != "" {
		url = fmt.Sprintf("%s?conversation_id=%s", url, a.CustomConfig.ConversationId)
	}
	return url, nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Request, meta *meta.Meta) error {
	custom.SetupCommonRequestHeader(c, req, meta)
	req.Header.Set("Authorization", "Bearer "+meta.APIKey)
	return nil
}

func (a *Adaptor) ConvertRequest(c *gin.Context, relayMode int, request *model.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}

	// 检查是否为工作流请求
	if strings.HasPrefix(a.meta.ActualModelName, "workflow-") {
		// 使用工作流适配器处理
		workflowAdaptor := &WorkflowAdaptor{
			meta:         a.meta,
			CustomConfig: a.CustomConfig,
		}
		return workflowAdaptor.ConvertRequest(c, relayMode, request)
	}

	// 默认使用Bot模式
	request.User = a.meta.Config.UserID
	return ConvertRequest(*request, a.meta, a.CustomConfig), nil
}

func (a *Adaptor) ConvertImageRequest(request *model.ImageRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

func (a *Adaptor) DoRequest(c *gin.Context, meta *meta.Meta, requestBody io.Reader) (*http.Response, error) {
	return custom.DoRequestHelper(a, c, meta, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, meta *meta.Meta) (usage *model.Usage, err *model.ErrorWithStatusCode) {
	// 默认使用Bot模式
	var responseText *string
	conversationId := ""
	if meta.IsStream {
		err, responseText, conversationId = StreamHandler(c, resp)
	} else {
		err, responseText, conversationId = Handler(c, resp, meta.PromptTokens, meta.ActualModelName)
	}

	if err != nil {
		logger.SysErrorf("【Coze】DoResponse 返回错误: code=%d, msg=%s, conversationId=%s",
			err.Error.Code, err.Error.Message, conversationId)
	}

	if responseText != nil && *responseText != "" {
		usage = openai.ResponseText2Usage(*responseText, meta.ActualModelName, meta.PromptTokens)
	} else {
		usage = &model.Usage{}
		if err == nil {
			// responseText 为空（nil 或空字符串）且没有错误，说明 Coze 返回了空响应
			logger.SysError("【Coze】响应为空，conversation可能处于异常状态，将清理conversation_id")
			conversationId = "" // 清理 conversation_id，下次请求创建新对话
		}
	}
	usage.PromptTokens = meta.PromptTokens
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	a.CustomConfig.ConversationId = conversationId
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return "coze"
}
