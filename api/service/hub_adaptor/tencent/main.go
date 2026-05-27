package tencent

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/service/hub_adaptor/openai"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
)

// Handler 处理非流式响应
func Handler(c *gin.Context, resp *http.Response) (*model.ErrorWithStatusCode, *string, string) {
	var tencentResp TencentResponse
	if err := json.NewDecoder(resp.Body).Decode(&tencentResp); err != nil {
		return openai.ErrorWrapper(fmt.Errorf("failed to decode response: %w", err), "bad_response_format", http.StatusInternalServerError), nil, ""
	}

	// 检查错误
	if tencentResp.Type == "error" {
		return openai.ErrorWrapper(fmt.Errorf("tencent api error: %s", tencentResp.Payload.Content), "tencent_api_error", http.StatusBadRequest), nil, ""
	}

	// 转换响应
	openaiResp := ConvertResponse(&tencentResp, "tencent-bot")

	// 返回响应
	c.JSON(http.StatusOK, openaiResp)
	responseText := tencentResp.Payload.Content
	return nil, &responseText, tencentResp.Payload.SessionID
}

// StreamHandler 处理流式响应
func StreamHandler(c *gin.Context, meta *meta.Meta, resp *http.Response) (*model.ErrorWithStatusCode, *string, string) {
	var responseText string
	var previousContent string // 用于计算增量内容
	scanner := bufio.NewScanner(resp.Body)
	// 设置更大的缓冲区以处理大型响应 (1MB)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	scanner.Split(bufio.ScanLines)
	common.SetEventStreamHeaders(c)

	var sessionID string

	for scanner.Scan() {
		line := scanner.Text()
		// logger.SysLogf("%s", line)
		// 跳过空行
		if line == "" {
			continue
		}

		// 解析SSE格式 - 处理data行
		if strings.HasPrefix(line, "data:") {
			data := strings.TrimPrefix(line, "data:")

			// 跳过心跳包
			if data == "" || data == "ping" {
				continue
			}

			// 检查结束标志
			if data == "[DONE]" {
				c.SSEvent("message", " [DONE]")
				c.Writer.Flush()
				break
			}

			// 转换响应（ConvertStreamResponse现在会处理错误和reply类型）
			openaiResp := ConvertStreamResponse(data, meta.ActualModelName, previousContent)
			if openaiResp != nil {
				// 记录会话ID
				if sessionID == "" {
					sessionID = openaiResp.Id
				}

				// 累积响应文本
				if len(openaiResp.Choices) > 0 {
					if content, ok := openaiResp.Choices[0].Delta.Content.(string); ok {
						responseText += content
					}
				}

				respData, err := json.Marshal(openaiResp)
				if err != nil {
					logger.SysError("failed to marshal stream response: " + err.Error())
					continue
				}

				c.SSEvent("message", " "+string(respData))
				c.Writer.Flush()

				// 检查是否为错误响应，如果是则发送[DONE]并停止处理
				if len(openaiResp.Choices) > 0 && openaiResp.Choices[0].FinishReason != nil && *openaiResp.Choices[0].FinishReason == "error" {
					c.SSEvent("message", " [DONE]")
					c.Writer.Flush()
					break
				}

				// 更新previousContent用于下次计算增量（仅在reply类型时）
				var tencentResp TencentResponse
				if err := json.Unmarshal([]byte(data), &tencentResp); err == nil && tencentResp.Type == "reply" {
					previousContent = tencentResp.Payload.Content
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return openai.ErrorWrapper(fmt.Errorf("failed to read stream: %w", err), "stream_error", http.StatusInternalServerError), nil, ""
	}

	return nil, &responseText, sessionID
}
