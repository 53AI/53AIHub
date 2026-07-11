package controller

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/client"
)

// MaxKBProfileResponse MaxKB应用配置响应结构
type MaxKBProfileResponse struct {
	Code    int              `json:"code"`
	Message string           `json:"message"`
	Data    MaxKBProfileData `json:"data"`
}

type MaxKBProfileData struct {
	ID                     string                 `json:"id"`
	Name                   string                 `json:"name"`
	Desc                   string                 `json:"desc"`
	Prologue               string                 `json:"prologue"`
	DialogueNumber         int                    `json:"dialogue_number"`
	Icon                   string                 `json:"icon"`
	Type                   string                 `json:"type"`
	SttModelID             *string                `json:"stt_model_id"`
	TtsModelID             *string                `json:"tts_model_id"`
	SttModelEnable         bool                   `json:"stt_model_enable"`
	TtsModelEnable         bool                   `json:"tts_model_enable"`
	TtsType                string                 `json:"tts_type"`
	TtsAutoplay            bool                   `json:"tts_autoplay"`
	SttAutosend            bool                   `json:"stt_autosend"`
	FileUploadEnable       bool                   `json:"file_upload_enable"`
	FileUploadSetting      map[string]interface{} `json:"file_upload_setting"`
	WorkFlow               map[string]interface{} `json:"work_flow"`
	ShowSource             bool                   `json:"show_source"`
	Language               *string                `json:"language"`
	MultipleRoundsDialogue bool                   `json:"multiple_rounds_dialogue"`
}

// @Summary Get MaxKB application profile
// @Description 代理MaxKB应用配置查询接口
// @Tags MaxKB
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param bot-id query string true "Bot ID, format: bot-application-{token}" example:"bot-application-ddac703d701b5cf6dcb9fc4bcc365db7"
// @Success 200 {object} MaxKBProfileResponse
// @Router /api/maxkb/application/profile [get]
func GetMaxKBApplicationProfile(c *gin.Context) {
	// 1. 解析bot-id参数
	botID := c.Query("bot-id")
	if botID == "" {
		logger.SysErrorf("MaxKB请求失败: bot-id参数为空")
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("bot-id parameter is required"))
		return
	}

	logger.SysLogf("MaxKB请求 - bot-id: %s", botID)

	// // 2. 验证bot-id格式并提取application token
	// applicationToken, err := extractApplicationToken(botID)
	// if err != nil {
	// 	logger.SysErrorf("❌ bot-id格式错误: %v", err)
	// 	c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
	// 	return
	// }

	// logger.SysLogf("🔑 提取到application token: %s", applicationToken)

	// 2. 查询包含指定botID的MaxKB渠道
	eid := config.GetEID(c)
	channel, err := findMaxKBChannelByBotID(eid, botID)
	if err != nil {
		logger.SysErrorf("MaxKB渠道查询失败 - eid: %d, bot-id: %s, error: %v", eid, botID, err)
		c.JSON(http.StatusNotFound, model.NotFound.ToErrorResponse(err))
		return
	}

	// 3. 构建代理请求
	fullBaseURL := channel.GetBaseURL()
	if fullBaseURL == "" {
		logger.SysErrorf("MaxKB渠道BaseURL为空")
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("channel base URL is empty"))
		return
	}

	// 提取基础URL (只保留 scheme://host:port 部分)
	baseURL, err := extractBaseURL(fullBaseURL)
	if err != nil {
		logger.SysErrorf("MaxKB BaseURL解析失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	// 4. 发起代理请求
	proxyURL := fmt.Sprintf("%s/api/application/profile", baseURL)
	logger.SysLogf("MaxKB代理请求 - URL: %s", proxyURL)

	response, err := makeMaxKBRequest(proxyURL, channel.Key)
	if err != nil {
		logger.SysErrorf("MaxKB代理请求失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.NetworkError.ToErrorResponse(err))
		return
	}

	// 5. 解析响应并返回结果
	var maxkbResponse MaxKBProfileResponse
	if err := json.Unmarshal(response, &maxkbResponse); err != nil {
		logger.SysErrorf("MaxKB响应解析失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	logger.SysLogf("MaxKB响应成功 - 应用名称: %s, 应用ID: %s", maxkbResponse.Data.Name, maxkbResponse.Data.ID)

	// 返回符合项目规范的响应格式
	c.JSON(http.StatusOK, model.Success.ToResponse(maxkbResponse.Data))
}

// extractBaseURL 从完整URL中提取基础URL
// 例如: http://192.168.1.218:8080/api/application/cd3006e4-6051-11f0-97a0-0242ac110002 -> http://192.168.1.218:8080
func extractBaseURL(fullURL string) (string, error) {
	if fullURL == "" {
		return "", fmt.Errorf("base URL cannot be empty")
	}

	// 解析URL
	parsedURL, err := url.Parse(fullURL)
	if err != nil {
		return "", fmt.Errorf("invalid URL format: %v", err)
	}

	// 构建基础URL (scheme + host)
	baseURL := fmt.Sprintf("%s://%s", parsedURL.Scheme, parsedURL.Host)
	return baseURL, nil
}

// makeMaxKBRequest 发起MaxKB API请求
func makeMaxKBRequest(url, applicationToken string) ([]byte, error) {
	// 创建HTTP请求
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request failed: %v", err)
	}

	// 设置请求头
	req.Header.Set("Accept", "application/json")
	req.Header.Set("AUTHORIZATION", applicationToken)

	logger.SysLogf("MaxKB请求头 - AUTHORIZATION: %s", applicationToken)

	// 发起请求
	resp, err := client.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body failed: %v", err)
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("MaxKB API returned status %d: %s", resp.StatusCode, string(body))
	}

	// 验证响应是否为有效JSON
	var jsonCheck interface{}
	if err := json.Unmarshal(body, &jsonCheck); err != nil {
		return nil, fmt.Errorf("invalid JSON response: %v", err)
	}

	return body, nil
}

// findMaxKBChannelByBotID 根据企业ID和botID查找包含该botID的MaxKB渠道
func findMaxKBChannelByBotID(eid int64, botID string) (*model.Channel, error) {
	// 获取企业下所有MaxKB类型的渠道
	channels, err := model.GetChannelsByEidAndParams(eid, 0, []int{model.ChannelApiTypeMaxKB})
	if err != nil {
		return nil, fmt.Errorf("failed to get MaxKB channels: %v", err)
	}

	if len(channels) == 0 {
		return nil, fmt.Errorf("no MaxKB channels found for enterprise %d", eid)
	}

	// 遍历渠道，查找包含指定botID的渠道
	for _, channel := range channels {
		if containsBotID(channel.Models, botID) {
			return &channel, nil
		}
	}

	return nil, fmt.Errorf("no MaxKB channel found containing bot-id: %s", botID)
}

// containsBotID 检查models字段中是否包含指定的botID
func containsBotID(models, botID string) bool {
	if models == "" || botID == "" {
		return false
	}

	// 将models按逗号分割
	modelList := strings.Split(models, ",")

	// 遍历每个model，检查是否匹配
	for _, model := range modelList {
		// 去除空格
		model = strings.TrimSpace(model)
		if model == botID {
			return true
		}
	}

	return false
}
