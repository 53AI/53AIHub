package relay

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

// RelayAudio handles OpenAI-compatible audio transcription/translation/speech requests.
// This is separate from the Ali DashScope voice model path (type 17).
// It supports type 1012 (CustomOpenAI) and other standard OpenAI-compatible channel types.
func RelayAudio(c *gin.Context) {
	relayMode := relaymode.GetByPath(c.Request.URL.Path)
	startTime := time.Now()

	// 0. Save the raw request body BEFORE any parsing (ParseMultipartForm consumes it)
	rawBody := &bytes.Buffer{}
	_, err := io.Copy(rawBody, c.Request.Body)
	if err != nil {
		logger.Errorf(c.Request.Context(), "【音频】读取请求体失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.OpenAIErrorResponse{
			Error: model.OpenAIError{
				Message: "读取请求体失败",
				Type:    "server_error",
			},
		})
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewBuffer(rawBody.Bytes()))

	// 1. Get model name from request
	audioModel, err := getAudioModelFromRequest(c, relayMode)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.OpenAIErrorResponse{
			Error: model.OpenAIError{
				Message: err.Error(),
				Type:    "invalid_request_error",
			},
		})
		return
	}

	// 2. Get user info
	userID := config.GetUserId(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, model.OpenAIErrorResponse{
			Error: model.OpenAIError{
				Message: "未授权访问",
				Type:    "authentication_error",
			},
		})
		return
	}
	user, err := model.GetUserByID(userID)
	if err != nil {
		logger.SysErrorf("【音频】获取用户信息失败: userID=%d err=%v", userID, err)
		c.JSON(http.StatusUnauthorized, model.OpenAIErrorResponse{
			Error: model.OpenAIError{
				Message: "用户信息获取失败",
				Type:    "authentication_error",
			},
		})
		return
	}
	eid := user.Eid

	// 3. Determine channel type
	channelType := c.GetInt(ctxkey.Channel)
	if channelType == 0 {
		channelTypeStr := c.Query("channel_type")
		if channelTypeStr != "" {
			if v, err := strconv.Atoi(channelTypeStr); err == nil {
				channelType = v
			}
		}
	}
	if channelType == 0 {
		channelType = model.ChannelApiTypeCustomOpenAI // default to CustomOpenAI
	}

	// 4. Find a channel that supports the model
	channel, err := model.GetRandomChannel(eid, channelType, audioModel)
	if err != nil {
		logger.Errorf(c.Request.Context(), "【音频】获取渠道失败: model=%s channelType=%d err=%v", audioModel, channelType, err)
		c.JSON(http.StatusServiceUnavailable, model.OpenAIErrorResponse{
			Error: model.OpenAIError{
				Message: fmt.Sprintf("暂无可用的音频服务渠道 (model=%s)", audioModel),
				Type:    "service_unavailable",
			},
		})
		return
	}

	logger.SysLogf("【音频】获取渠道成功: channelID=%d type=%d model=%s", channel.ChannelID, channel.Type, audioModel)

	// 5. Set up channel context
	middleware.SetupContextForSelectedChannel(c, channel, audioModel)

	// 6. Construct the full request URL
	baseURL := channel.GetBaseURL()
	if baseURL == "" {
		if channel.Type >= 0 && channel.Type < len(channeltype.ChannelBaseURLs) && channeltype.ChannelBaseURLs[channel.Type] != "" {
			baseURL = channeltype.ChannelBaseURLs[channel.Type]
		} else {
			baseURL = "https://api.openai.com"
		}
	}

	// Use the custom_openai URL construction logic: trim /v1 and /, then append request path
	baseURL = strings.TrimSuffix(baseURL, "/v1")
	baseURL = strings.TrimSuffix(baseURL, "/")
	fullRequestURL := fmt.Sprintf("%s%s", baseURL, c.Request.URL.Path)

	// For Azure, handle differently
	if channel.Type == channeltype.Azure {
		apiVersion := "2024-03-01-preview"
		if relayMode == relaymode.AudioTranscription {
			fullRequestURL = fmt.Sprintf("%s/openai/deployments/%s/audio/transcriptions?api-version=%s", baseURL, audioModel, apiVersion)
		} else if relayMode == relaymode.AudioSpeech {
			fullRequestURL = fmt.Sprintf("%s/openai/deployments/%s/audio/speech?api-version=%s", baseURL, audioModel, apiVersion)
		}
	}

	logger.SysLogf("【音频】转发请求: method=POST url=%s model=%s", fullRequestURL, audioModel)

	// 7. Forward the request using the saved raw body
	req, err := http.NewRequest(c.Request.Method, fullRequestURL, rawBody)
	if err != nil {
		logger.Errorf(c.Request.Context(), "【音频】创建转发请求失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.OpenAIErrorResponse{
			Error: model.OpenAIError{
				Message: "创建转发请求失败",
				Type:    "server_error",
			},
		})
		return
	}

	// Set headers: Azure uses api-key, others use Bearer Authorization
	if channel.Type == channeltype.Azure {
		apiKey := strings.TrimPrefix(c.Request.Header.Get("Authorization"), "Bearer ")
		req.Header.Set("api-key", apiKey)
	} else {
		req.Header.Set("Authorization", c.Request.Header.Get("Authorization"))
	}
	req.Header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
	req.Header.Set("Accept", c.Request.Header.Get("Accept"))

	// 8. Send the request
	resp, err := client.HTTPClient.Do(req)
	if err != nil {
		logger.Errorf(c.Request.Context(), "【音频】转发请求失败: url=%s err=%v", fullRequestURL, err)
		c.JSON(http.StatusBadGateway, model.OpenAIErrorResponse{
			Error: model.OpenAIError{
				Message: fmt.Sprintf("上游请求失败: %v", err),
				Type:    "upstream_error",
			},
		})
		return
	}
	defer resp.Body.Close()

	// 9. Log the result
	elapsed := time.Since(startTime).Milliseconds()
	logger.SysLogf("【音频】请求完成: status=%d model=%s channelID=%d elapsed=%dms", resp.StatusCode, audioModel, channel.ChannelID, elapsed)

	// 10. Copy response headers and body
	for k, v := range resp.Header {
		c.Writer.Header().Set(k, v[0])
	}
	c.Writer.WriteHeader(resp.StatusCode)

	_, err = io.Copy(c.Writer, resp.Body)
	if err != nil {
		logger.Errorf(c.Request.Context(), "【音频】复制响应体失败: %v", err)
	}
}

// getAudioModelFromRequest extracts the model name from the request.
// For audio transcriptions/translations, it's in the multipart form field "model".
// For audio speech, it's in the JSON body.
// NOTE: The caller (RelayAudio) must save the raw body before calling this function,
// because ParseMultipartForm consumes c.Request.Body.
func getAudioModelFromRequest(c *gin.Context, relayMode int) (string, error) {
	if relayMode == relaymode.AudioSpeech {
		// JSON body: {"model": "tts-1", "input": "...", "voice": "alloy"}
		var ttsRequest struct {
			Model string `json:"model"`
		}
		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			return "", fmt.Errorf("读取请求体失败: %w", err)
		}
		c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

		if err := json.Unmarshal(bodyBytes, &ttsRequest); err != nil {
			return "", fmt.Errorf("解析请求体失败: %w", err)
		}
		if ttsRequest.Model == "" {
			return "tts-1", nil // default
		}
		return ttsRequest.Model, nil
	}

	// Audio transcription/translation: multipart/form-data or JSON
	contentType := c.Request.Header.Get("Content-Type")

	if strings.HasPrefix(contentType, "multipart/form-data") {
		// Parse multipart form to get the model field
		if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
			return "", fmt.Errorf("解析 multipart 表单失败: %w", err)
		}
		modelName := c.Request.FormValue("model")
		if modelName == "" {
			return "whisper-1", nil // default
		}
		return modelName, nil
	}

	// JSON body fallback
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return "", fmt.Errorf("读取请求体失败: %w", err)
	}
	c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	var req struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(bodyBytes, &req); err == nil && req.Model != "" {
		return req.Model, nil
	}

	return "whisper-1", nil
}