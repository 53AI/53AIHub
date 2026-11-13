package dify

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
	db_model "github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/render"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
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
	return fmt.Sprintf("%s/v1/chat-messages", baseUrl), nil
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
	request.User = a.meta.Config.UserID
	return ConvertRequest(*request, a.meta, a.CustomConfig), nil
}

func ConvertRequest(textRequest model.GeneralOpenAIRequest, meta *meta.Meta, customConfig *custom.CustomConfig) *Request {
	modelName := "bot-" + strings.TrimPrefix(meta.ActualModelName, "bot-")
	channelID := meta.ChannelId
	difyRequest := Request{
		ConversationId: customConfig.ConversationId,
		User:           customConfig.UserId,
		ResponseMode:   ResponseModeBlock,
		Inputs:         struct{}{},
	}
	if textRequest.Stream {
		difyRequest.ResponseMode = ResponseModeStream
	}

	queryStr := ""
	for i := len(textRequest.Messages) - 1; i >= 0; i-- {
		if textRequest.Messages[i].Role == "user" {
			queryStr = textRequest.Messages[i].StringContent()
			break
		}
	}

	difyRequest.Query = queryStr
	var files []File
	var contentObjs []db_model.ObjectStringContent

	if err := json.Unmarshal([]byte(queryStr), &contentObjs); err == nil {
		if len(contentObjs) > 0 {
			targetStr := ""
			for _, contentObj := range contentObjs {
				if contentObj.Type == "text" {
					if targetStr == "" {
						targetStr = contentObj.Content
					}
					continue
				}
				if contentObj.Type != "image" {
					logger.SysError("File types are not supported temporarily")
					continue
				}

				uoloadFile := contentObj.GetUploadFile()
				if uoloadFile == nil {
					logger.SysError("file not found")
					continue
				}
				fileMapping := uoloadFile.GetChannelFileMapping(channelID, modelName)
				if fileMapping == nil {
					fileMapping = &db_model.ChannelFileMapping{}
					err := DIFYUploadFile(meta, uoloadFile, fileMapping)
					if err != nil {
						logger.SysError(fmt.Sprintf("upload file failed: %v", err))
						continue
					}
					err = db_model.CreateChannelFileMapping(fileMapping)
					if err != nil {
						logger.SysError(fmt.Sprintf("create file mapping failed: %v", err))
						continue
					}
				} else if helper.GetTimestamp() > fileMapping.ExpirationTime {
					err := DIFYUploadFile(meta, uoloadFile, fileMapping)
					if err != nil {
						logger.SysError(fmt.Sprintf("update file failed: %v", err))
						continue
					}
					err = db_model.UpdateChannelFileMapping(fileMapping)
					if err != nil {
						logger.SysError(fmt.Sprintf("update file mapping failed: %v", err))
						continue
					}
				}

				files = append(files, File{
					Type:           "image",
					TransferMethod: "local_file",
					UploadFileID:   fileMapping.ChannelFileID,
					Url:            "",
				})
			}
			difyRequest.Files = files
			difyRequest.Query = targetStr
		}
	}
	logger.SysLogf("difyRequest: %+v", difyRequest)
	return &difyRequest
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
	if meta.IsStream {
		err, responseText, _ = StreamHandler(c, resp, meta.ActualModelName, func(id string) error {
			return a.persistConversationID(c, id)
		})
	} else {
		err, responseText, _ = Handler(c, resp, meta.ActualModelName, func(id string) error {
			return a.persistConversationID(c, id)
		})
	}
	if responseText != nil {
		usage = openai.ResponseText2Usage(*responseText, meta.ActualModelName, meta.PromptTokens)
	} else {
		usage = &model.Usage{}
	}
	usage.PromptTokens = meta.PromptTokens
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	// 流式会话 ID 已在首个上游事件到达时持久化成功，再结束前端流。
	if meta.IsStream && err == nil {
		render.Done(c)
	}
	return
}

// persistConversationID 只写渠道会话映射；配额及消息内容仍由通用后置流程处理。
func (a *Adaptor) persistConversationID(c *gin.Context, channelConversationId string) error {
	if channelConversationId == "" {
		return nil
	}
	if a.CustomConfig.AIHubConversationId == 0 {
		a.CustomConfig.ConversationId = channelConversationId
		return nil
	}

	eid, userID, conversationID := config.GetEID(c), config.GetUserId(c), a.CustomConfig.AIHubConversationId
	db := db_model.DB.WithContext(c.Request.Context())
	result := db.Model(&db_model.Conversation{}).
		Where("eid = ? AND user_id = ? AND conversation_id = ?", eid, userID, conversationID).
		Where("(channel_conversation_id = ? OR channel_conversation_id = ? OR channel_conversation_id IS NULL)", "", channelConversationId).
		Update("channel_conversation_id", channelConversationId)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var conversation db_model.Conversation
		err := db.Select("channel_conversation_id").
			Where("eid = ? AND user_id = ? AND conversation_id = ?", eid, userID, conversationID).
			Take(&conversation).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("Dify 会话映射保存失败：未找到对应的 53AIHub 会话")
		}
		if err != nil {
			return err
		}
		if conversation.ChannelConversationID != channelConversationId {
			return fmt.Errorf("Dify 会话映射保存失败：会话已有不同的 Dify 映射，拒绝覆盖")
		}
	}
	a.CustomConfig.ConversationId = channelConversationId
	return nil
}

func Handler(c *gin.Context, resp *http.Response, modelName string, persistConversationID func(string) error) (*model.ErrorWithStatusCode, *string, string) {
	channelConversationId := ""
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return openai.ErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError), nil, channelConversationId
	}
	err = resp.Body.Close()
	if err != nil {
		return openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil, channelConversationId
	}
	var difyResponse BlockResponse
	err = json.Unmarshal(responseBody, &difyResponse)
	if err != nil {
		return openai.ErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError), nil, channelConversationId
	}

	fullTextResponse := ResponseDify2OpenAI(&difyResponse)
	fullTextResponse.Model = modelName
	jsonResponse, err := json.Marshal(fullTextResponse)
	if err != nil {
		return openai.ErrorWrapper(err, "marshal_response_body_failed", http.StatusInternalServerError), nil, channelConversationId
	}
	if difyResponse.ConversationID != "" {
		if saveErr := persistConversationID(difyResponse.ConversationID); saveErr != nil {
			return openai.ErrorWrapper(saveErr, "persist_dify_conversation_id_failed", http.StatusInternalServerError), nil, ""
		}
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = c.Writer.Write(jsonResponse)
	var responseText string
	if len(fullTextResponse.Choices) > 0 {
		responseText = fullTextResponse.Choices[0].Message.StringContent()
	}
	channelConversationId = difyResponse.ConversationID
	return nil, &responseText, channelConversationId
}

func ResponseDify2OpenAI(difyResponse *BlockResponse) *openai.TextResponse {
	var responseText string
	responseText = difyResponse.Answer
	choice := openai.TextResponseChoice{
		Index: 0,
		Message: model.Message{
			Role:    "assistant",
			Content: responseText,
			Name:    nil,
		},
		FinishReason: "stop",
	}
	fullTextResponse := openai.TextResponse{
		Id:      fmt.Sprintf("chatcmpl-%s", difyResponse.ConversationID),
		Model:   "dify-bot",
		Object:  "chat.completion",
		Created: helper.GetTimestamp(),
		Choices: []openai.TextResponseChoice{choice},
	}
	return &fullTextResponse
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return "dify"
}

func DIFYUploadFile(meta *meta.Meta, uploadFile *db_model.UploadFile, fileMapping *db_model.ChannelFileMapping) error {
	baseUrl, err := custom.GetBaseURL(meta.BaseURL)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("%s/v1/files/upload", baseUrl)
	fileContent, err := storage.StorageInstance.Load(uploadFile.Key)
	if err != nil {
		return err
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Add form fields
	_ = writer.WriteField("user", meta.Config.UserID)
	var quoteEscaper = strings.NewReplacer("\\", "\\\\", `"`, "\\\"")

	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition",
		fmt.Sprintf(`form-data; name="%s"; filename="%s"; type="%s"`,
			quoteEscaper.Replace("file"),
			quoteEscaper.Replace(uploadFile.FileName),
			quoteEscaper.Replace(uploadFile.MimeType)))
	h.Set("Content-Type", uploadFile.MimeType)
	part, err := writer.CreatePart(h)

	_, err = io.Copy(part, bytes.NewReader(fileContent))
	if err != nil {
		return err
	}

	err = writer.Close()
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+meta.APIKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("upload failed with status: %d", resp.StatusCode)
	}

	var result DIFYUploadResponse
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return err
	}

	fileMapping.ChannelFileID = result.ID
	fileMapping.Eid = uploadFile.Eid
	fileMapping.FileID = uploadFile.ID
	fileMapping.ChannelID = meta.ChannelId
	fileMapping.Model = "bot-" + strings.TrimPrefix(meta.ActualModelName, "bot-")
	fileMapping.ExpirationTime = helper.GetTimestamp() + 3600*24*30
	jsonResult, err := json.Marshal(result)
	if err != nil {
		return err
	}
	fileMapping.ApiResponse = string(jsonResult)

	return nil
}
