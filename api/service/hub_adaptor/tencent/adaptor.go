package tencent

import (
	"fmt"
	"io"
	"net/http"

	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/gin-gonic/gin"
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
	// 腾讯云API端点
	baseURL := meta.BaseURL
	if baseURL == "" {
		baseURL = "https://wss.lke.cloud.tencent.com"
	}
	return baseURL + "/v1/qbot/chat/sse", nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Request, meta *meta.Meta) error {
	// 设置请求头
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+meta.APIKey)
	return nil
}

func (a *Adaptor) ConvertRequest(c *gin.Context, relayMode int, request *model.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, fmt.Errorf("request is nil")
	}

	// 转换请求格式，使用meta中的APIKey作为botAppKey
	conversationID := a.CustomConfig.AIHubConversationId
	UserId := a.CustomConfig.UserId
	tencentReq := ConvertRequest(*request, conversationID, UserId, a.meta.APIKey)
	return tencentReq, nil
}

func (a *Adaptor) ConvertImageRequest(request *model.ImageRequest) (any, error) {
	// 腾讯云暂不支持图像生成
	return nil, fmt.Errorf("image generation not supported")
}

func (a *Adaptor) DoRequest(c *gin.Context, meta *meta.Meta, requestBody io.Reader) (*http.Response, error) {
	return custom.DoRequestHelper(a, c, meta, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, meta *meta.Meta) (usage *model.Usage, err *model.ErrorWithStatusCode) {
	var responseText *string
	var channelConversationId string
	if meta.IsStream {
		err, responseText, channelConversationId = StreamHandler(c, meta, resp)
	} else {
		err, responseText, channelConversationId = Handler(c, resp)
	}

	// 设置响应内容到上下文，以便GetResponseContent函数可以获取
	if responseText != nil {
		c.Set("tencent_response_content", *responseText)
	}

	if a.CustomConfig != nil {
		a.CustomConfig.ConversationId = channelConversationId
	}

	if responseText != nil {
		usage = &model.Usage{
			PromptTokens:     meta.PromptTokens,
			CompletionTokens: len(*responseText) / 4, // 简单估算
			TotalTokens:      meta.PromptTokens + len(*responseText)/4,
		}
	} else {
		usage = &model.Usage{}
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return "tencent"
}
