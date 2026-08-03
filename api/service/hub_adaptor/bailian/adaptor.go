package bailian

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	db_model "github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/53AI/53AIHub/service/hub_adaptor/openai"
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
	botID := strings.TrimPrefix(a.meta.ActualModelName, "bot-")
	baseUrl, err := custom.GetBaseURL(meta.BaseURL)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/api/v1/apps/%s/completion", baseUrl, botID), nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Request, meta *meta.Meta) error {
	custom.SetupCommonRequestHeader(c, req, meta)
	req.Header.Set("Authorization", "Bearer "+meta.APIKey)
	req.Header.Set("Content-Type", "application/json")
	if meta.IsStream {
		req.Header.Set("X-DashScope-SSE", "enable")
	}

	if req.Body != nil {
		bodyBytes, err := io.ReadAll(req.Body)
		if err != nil {
			return err
		}
		req.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		req.ContentLength = int64(len(bodyBytes))
		req.Header.Set("Content-Length", strconv.Itoa(len(bodyBytes)))
	}

	// logger.SysLogf("request detail start")
	// logger.SysLogf("request url: %s", req.URL.String())
	// logger.SysLogf("request method: %s", req.Method)
	// logger.SysLogf("request header: %v", req.Header)
	// logger.SysLogf("request body: %s", req.Body)
	// logger.SysLogf("request detail end")

	return nil
}

func (a *Adaptor) ConvertRequest(c *gin.Context, relayMode int, request *model.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}

	// 检查是否为 rerank 请求
	if a.IsRerankRequest(c, request) {
		// 解析 rerank 请求
		rerankRequest, err := ParseRerankRequest(c)
		if err != nil {
			return nil, fmt.Errorf("failed to parse rerank request: %v", err)
		}

		// 直接处理 rerank 请求
		err = a.HandleRerankRequest(c, rerankRequest)
		if err != nil {
			return nil, err
		}

		// 返回空值，因为响应已经在 HandleRerankRequest 中处理
		return nil, nil
	}

	// 原有的 chat 转换逻辑
	request.User = a.meta.Config.UserID
	bailianRequest := ConvertRequest(*request, a.meta, a.CustomConfig)
	if a.meta.IsStream {
		bailianRequest.Parameters.IncrementalOutput = true
	}
	return bailianRequest, nil
}

// IsRerankRequest 检查是否为 rerank 请求
func (a *Adaptor) IsRerankRequest(c *gin.Context, request *model.GeneralOpenAIRequest) bool {
	// 通过 URL 路径检测
	if strings.Contains(c.Request.URL.Path, "rerank") {
		return true
	}

	// 通过模型名称检测
	if a.IsRerankModel(request.Model) {
		return true
	}

	return false
}

func ConvertRequest(textRequest model.GeneralOpenAIRequest, meta *meta.Meta, customConfig *custom.CustomConfig) *Request {
	var Prompt string
	var ImageList []string
	// var SessionFileIds []string
	conversationID := customConfig.ConversationId
	// modelName := "bot-" + strings.TrimPrefix(meta.ActualModelName, "bot-")
	// channelID := meta.ChannelId
	for i, message := range textRequest.Messages {
		if i == len(textRequest.Messages)-1 {
			Prompt = message.StringContent()
			continue
		}
	}

	var contentObjs []db_model.ObjectStringContent
	if err := json.Unmarshal([]byte(Prompt), &contentObjs); err == nil {
		if len(contentObjs) > 0 {
			targetStr := ""
			for _, contentObj := range contentObjs {
				if contentObj.Type == "text" {
					if targetStr == "" {
						targetStr = contentObj.Content
					}
					continue
				}

				uoloadFile := contentObj.GetUploadFile()
				if uoloadFile == nil {
					logger.SysError("file not found")
					continue
				}

				if contentObj.Type != "image" {
					// input.image_list, need url
					continue
				}

				ImageList = append(ImageList, uoloadFile.GetPreviewFullUrl())
			}
			Prompt = targetStr
		}
	}

	request := Request{
		Input: Input{
			Prompt:    Prompt,
			SessionID: conversationID,
			ImageList: ImageList,
			// SessionFileIds: SessionFileIds,
		},
		Parameters: Parameters{
			IncrementalOutput: false,
		},
	}

	return &request
}

func (a *Adaptor) DoRequest(c *gin.Context, meta *meta.Meta, requestBody io.Reader) (*http.Response, error) {
	return custom.DoRequestHelper(a, c, meta, requestBody)
}

func (a *Adaptor) ConvertImageRequest(request *model.ImageRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, meta *meta.Meta) (usage *model.Usage, err *model.ErrorWithStatusCode) {
	var responseText *string
	var channelConversationId string
	if meta.IsStream {
		err, responseText, channelConversationId = StreamHandler(c, resp)
	} else {
		err, responseText, channelConversationId = Handler(c, resp, meta.PromptTokens, meta.ActualModelName)
	}
	if responseText != nil {
		usage = openai.ResponseText2Usage(*responseText, meta.ActualModelName, meta.PromptTokens)
	} else {
		usage = &model.Usage{}
	}
	usage.PromptTokens = meta.PromptTokens
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	a.CustomConfig.ConversationId = channelConversationId
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return "bailian"
}
