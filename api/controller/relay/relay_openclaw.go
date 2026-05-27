package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/openclaw"
	"github.com/gin-gonic/gin"
)

func handleOpenClawAgent(
	c *gin.Context,
	chatRequest *ChatRequest,
	agent *model.Agent,
	messageStatus *MessageStatsInfo,
) error {
	if !agent.IsOpenClawAgent() {
		return fmt.Errorf("agent is not OpenClaw type")
	}

	gatewayConfig, err := agent.GetOpenClawGatewayConfig()
	if err != nil {
		return fmt.Errorf("get gateway config: %w", err)
	}

	if gatewayConfig == nil && agent.ChannelType == model.ChannelApiTypeOpenClaw {
		channel, err := model.GetRandomChannel(agent.Eid, agent.ChannelType, agent.Model)
		if err != nil {
			return fmt.Errorf("get openclaw channel: %w", err)
		}

		gatewayConfig = &model.OpenClawGatewayConfig{}
		if channel.Config != "" {
			_ = json.Unmarshal([]byte(channel.Config), gatewayConfig)
		}
		if channel.BaseURL != nil && *channel.BaseURL != "" {
			gatewayConfig.GatewayURL = *channel.BaseURL
		}
		if channel.Key != "" {
			gatewayConfig.AuthToken = channel.Key
		}

		if gatewayConfig.TimeoutMs == 0 {
			gatewayConfig.TimeoutMs = 30000
		}
		if gatewayConfig.MaxRetries == 0 {
			gatewayConfig.MaxRetries = 3
		}
	}

	if gatewayConfig == nil {
		return fmt.Errorf("no openclaw config found")
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	conversationID := chatRequest.ConversationID
	if conversationID == 0 {
		lastMessage := ""
		if len(chatRequest.Messages) > 0 {
			// Content 可能是 string 或 []ContentItem
			if contentStr, ok := chatRequest.Messages[len(chatRequest.Messages)-1].Content.(string); ok {
				lastMessage = contentStr
			}
		}
		conversation := &model.Conversation{
			Eid:         eid,
			UserID:      userID,
			AgentID:     agent.AgentID,
			Title:       lastMessage[:min(50, len(lastMessage))],
			Status:      model.ConversationStatusActive,
			DeletedTime: 0,
			Model:       agent.Model,
			FileID:      chatRequest.MessageFileID,
		}
		if err := model.CreateConversation(conversation); err != nil {
			return fmt.Errorf("create conversation: %w", err)
		}
		conversationID = conversation.ConversationID
	}

	client, err := openclaw.NewHTTPClient(gatewayConfig)
	if err != nil {
		return fmt.Errorf("create OpenClaw client: %w", err)
	}

	messages := make([]openclaw.Message, 0, len(chatRequest.Messages))
	for _, msg := range chatRequest.Messages {
		messages = append(messages, openclaw.Message{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}

	req := &openclaw.ChatCompletionRequest{
		Model:    agent.Model,
		Messages: messages,
		Stream:   chatRequest.Stream,
	}

	if chatRequest.Stream {
		return handleOpenClawStream(c, client, req, conversationID, userID, eid, agent, messageStatus)
	}

	return handleOpenClawSync(c, client, req, conversationID, userID, eid, agent, messageStatus)
}

func handleOpenClawSync(
	c *gin.Context,
	client *openclaw.HTTPClient,
	req *openclaw.ChatCompletionRequest,
	conversationID int64,
	userID int64,
	eid int64,
	agent *model.Agent,
	messageStatus *MessageStatsInfo,
) error {
	ctx := c.Request.Context()

	messageJSON, _ := json.Marshal(req.Messages)
	msg := &model.Message{
		Eid:               eid,
		UserID:            userID,
		ConversationID:    conversationID,
		AgentID:           agent.AgentID,
		Message:           string(messageJSON),
		Answer:            "",
		ReasoningContent:  "",
		ModelName:         req.Model,
		Quota:             0,
		PromptTokens:      0,
		CompletionTokens:  0,
		TotalTokens:       0,
		ChannelId:         0,
		RequestId:         messageStatus.RequestId,
		ElapsedTime:       0,
		IsStream:          false,
		QuotaContent:      "",
		AgentCustomConfig: agent.CustomConfig,
		FileID:            0,
	}
	if err := model.CreateMessage(msg); err != nil {
		logger.Errorf(ctx, "create openclaw message failed: %v", err)
	}

	resp, err := client.SendChatRequest(ctx, req)
	if err != nil {
		if msg.ID > 0 {
			msg.Answer = err.Error()
			model.UpdateMessage(msg)
		}
		return err
	}

	if len(resp.Choices) == 0 {
		return fmt.Errorf("no choices in response")
	}

	var contentStr string
	if content, ok := resp.Choices[0].Message.Content.(string); ok {
		contentStr = content
	} else if contentBytes, err := json.Marshal(resp.Choices[0].Message.Content); err == nil {
		contentStr = string(contentBytes)
	}

	if msg.ID > 0 {
		msg.Answer = contentStr
		msg.PromptTokens = resp.Usage.PromptTokens
		msg.CompletionTokens = resp.Usage.CompletionTokens
		msg.TotalTokens = resp.Usage.TotalTokens
		if err := model.UpdateMessage(msg); err != nil {
			logger.Errorf(ctx, "update openclaw message failed: %v", err)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"id":      resp.ID,
		"object":  resp.Object,
		"created": resp.Created,
		"model":   resp.Model,
		"choices": resp.Choices,
		"usage":   resp.Usage,
	})

	return nil
}

func handleOpenClawStream(
	c *gin.Context,
	client *openclaw.HTTPClient,
	req *openclaw.ChatCompletionRequest,
	conversationID int64,
	userID int64,
	eid int64,
	agent *model.Agent,
	messageStatus *MessageStatsInfo,
) error {
	requestCtx := c.Request.Context()
	execCtx := context.Background()
	runSvc := service.NewAgentRunService()

	messageJSON, _ := json.Marshal(req.Messages)
	msg := &model.Message{
		Eid:               eid,
		UserID:            userID,
		ConversationID:    conversationID,
		AgentID:           agent.AgentID,
		Message:           string(messageJSON),
		Answer:            "",
		ReasoningContent:  "",
		ModelName:         req.Model,
		Quota:             0,
		PromptTokens:      0,
		CompletionTokens:  0,
		TotalTokens:       0,
		ChannelId:         0,
		RequestId:         messageStatus.RequestId,
		ElapsedTime:       0,
		IsStream:          true,
		QuotaContent:      "",
		AgentCustomConfig: agent.CustomConfig,
		FileID:            0,
	}
	if err := model.CreateMessage(msg); err != nil {
		logger.Errorf(execCtx, "create openclaw stream message failed: %v", err)
	}

	var run *model.AgentRun
	if messageStatus != nil && strings.TrimSpace(messageStatus.RequestId) != "" && msg.ID > 0 {
		createdRun, created, runErr := runSvc.EnsureRunForRequest(execCtx, eid, conversationID, msg.ID, messageStatus.RequestId)
		if runErr != nil {
			logger.Warnf(execCtx, "create openclaw run failed: eid=%d, conversation_id=%d, message_id=%d, request_id=%s, err=%v",
				eid, conversationID, msg.ID, messageStatus.RequestId, runErr)
		} else {
			run = createdRun
			if created {
				if _, err := runSvc.AppendEvent(execCtx, eid, run.RunID, run.RequestID, model.AgentRunEventRunCreated, msg.ID, map[string]interface{}{
					"conversation_id": conversationID,
					"message_id":      msg.ID,
				}); err != nil {
					logger.Warnf(execCtx, "append agent run created event failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, err)
				}
			}
			if err := runSvc.UpdateRunStatus(execCtx, eid, run.RunID, model.AgentRunStatusRunning, "", ""); err != nil {
				logger.Warnf(execCtx, "mark agent run running failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, err)
			}
			if _, err := runSvc.AppendEvent(execCtx, eid, run.RunID, run.RequestID, model.AgentRunEventStatusChanged, msg.ID, map[string]interface{}{
				"status":       model.AgentRunStatusRunning,
				"current_step": "openclaw_stream",
			}); err != nil {
				logger.Warnf(execCtx, "append agent run running event failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, err)
			}
		}
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	c.SSEvent("conversation_id", fmt.Sprintf("%d", conversationID))

	streamCtx, streamCancel := context.WithCancel(execCtx)
	defer streamCancel()

	chunkCh, errCh := client.SendChatRequestStream(streamCtx, req)

	fullContent := ""
	cancelRequested := false
	clientCtxDone := requestCtx.Done()
	cancelCheckTicker := time.NewTicker(1 * time.Second)
	defer cancelCheckTicker.Stop()

	// 发送初始角色信息
	initialChunk := map[string]interface{}{
		"choices": []map[string]interface{}{
			{
				"index": 0,
				"delta": map[string]interface{}{
					"role": "assistant",
				},
			},
		},
	}
	if !config.IsSSECompactMode() {
		initialChunk = map[string]interface{}{
			"id":      fmt.Sprintf("chatcmpl-%d", time.Now().Unix()),
			"object":  "chat.completion.chunk",
			"created": time.Now().Unix(),
			"model":   req.Model,
			"choices": []map[string]interface{}{
				{
					"index": 0,
					"delta": map[string]interface{}{
						"role": "assistant",
					},
					"finish_reason": nil,
				},
			},
		}
	}
	c.SSEvent("", initialChunk)

	for chunkCh != nil || errCh != nil {
		select {
		case chunk, ok := <-chunkCh:
			if !ok {
				chunkCh = nil
				if run != nil && cancelRequested {
					if _, err := runSvc.FinalizeCancelledRun(execCtx, eid, run.RunID, "", ""); err != nil {
						logger.Warnf(execCtx, "finalize cancelled run failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, err)
					}
				} else {
					if msg.ID > 0 {
						msg.Answer = fullContent
						if err := model.UpdateMessage(msg); err != nil {
							logger.Errorf(execCtx, "update openclaw stream message failed: %v", err)
						}
					}
					if run != nil {
						if _, err := runSvc.AppendEvent(execCtx, eid, run.RunID, run.RequestID, model.AgentRunEventMessageDone, msg.ID, map[string]interface{}{
							"answer": fullContent,
						}); err != nil {
							logger.Warnf(execCtx, "append agent run message.completed failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, err)
						}
						if _, err := runSvc.FinalizeCompletedRun(execCtx, eid, run.RunID, "", ""); err != nil {
							logger.Warnf(execCtx, "finalize completed run failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, err)
						}
					}
				}
				c.SSEvent("", "[DONE]")
				return nil
			}

			if len(chunk.Choices) > 0 {
				delta := chunk.Choices[0].Delta.Content
				fullContent += delta
				if run != nil {
					if _, err := runSvc.AppendEvent(execCtx, eid, run.RunID, run.RequestID, model.AgentRunEventMessageDelta, msg.ID, map[string]interface{}{
						"delta": delta,
					}); err != nil {
						logger.Warnf(execCtx, "append agent run message.delta failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, err)
					}
				}

				response := map[string]interface{}{
					"choices": []map[string]interface{}{
						{
							"index": 0,
							"delta": map[string]interface{}{
								"content": delta,
							},
						},
					},
				}
				if !config.IsSSECompactMode() {
					response = map[string]interface{}{
						"id":      chunk.ID,
						"object":  "chat.completion.chunk",
						"created": chunk.Created,
						"model":   chunk.Model,
						"choices": []map[string]interface{}{
							{
								"index": 0,
								"delta": map[string]interface{}{
									"content": delta,
								},
								"finish_reason": nil,
							},
						},
					}
				}
				c.SSEvent("", response)
			}

		case err, ok := <-errCh:
			if !ok {
				errCh = nil
				continue
			}
			if err != nil {
				chunkCh = nil
				errCh = nil
				if msg.ID > 0 {
					msg.Answer = err.Error()
					if updateErr := model.UpdateMessage(msg); updateErr != nil {
						logger.Warnf(execCtx, "update openclaw stream error message failed: %v", updateErr)
					}
				}
				errorPayload := map[string]interface{}{
					"message": err.Error(),
					"type":    "server_error",
					"model":   req.Model,
				}
				if agent != nil {
					errorPayload["channel_name"] = "openclaw"
					errorPayload["channel_type"] = agent.ChannelType
				}
				c.SSEvent("", map[string]interface{}{
					"error": errorPayload,
				})
				if run != nil {
					if errors.Is(err, context.Canceled) || cancelRequested {
						if _, finalizeErr := runSvc.FinalizeCancelledRun(execCtx, eid, run.RunID, "", ""); finalizeErr != nil {
							logger.Warnf(execCtx, "finalize cancelled run after error failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, finalizeErr)
						}
					} else {
						if _, finalizeErr := runSvc.FinalizeFailedRun(execCtx, eid, run.RunID, "", err.Error()); finalizeErr != nil {
							logger.Warnf(execCtx, "finalize failed run failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, finalizeErr)
						}
					}
				}
				return err
			}
		case <-cancelCheckTicker.C:
			if run == nil {
				continue
			}
			currentRun, runErr := runSvc.GetRunByRunID(execCtx, eid, run.RunID)
			if runErr != nil {
				logger.Warnf(execCtx, "reload agent run status failed: eid=%d, run_id=%s, err=%v", eid, run.RunID, runErr)
				continue
			}
			if currentRun.Status == model.AgentRunStatusCancelling || currentRun.Status == model.AgentRunStatusCancelled {
				cancelRequested = true
				streamCancel()
			}
		case <-clientCtxDone:
			clientCtxDone = nil
			logger.Infof(execCtx, "openclaw client disconnected, keep run alive: conversation_id=%d", conversationID)
		}
	}
	return nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
