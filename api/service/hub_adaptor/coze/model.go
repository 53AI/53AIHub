package coze

import "encoding/json"

type Message struct {
	Role        string `json:"role"`
	Type        string `json:"type"`
	Content     string `json:"content"`
	ContentType string `json:"content_type"`
}

const (
	TypeQuestion     = "question"
	TypeAnswer       = "answer"
	TypeFunctionCall = "function_call"
	TypeToolResponse = "tool_response"
)

const (
	ContentTypeText         = "text"
	ContentTypeObjectString = "object_string"
)

type AdditionalMessage struct {
	Role        string `json:"role"`
	Content     string `json:"content"`
	ContentType string `json:"content_type"`
	Type        string `json:"type"`
}

type ErrorInformation struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

type Request struct {
	BotId              string              `json:"bot_id"`
	UserID             string              `json:"user_id"`
	AdditionalMessages []AdditionalMessage `json:"additional_messages,omitempty"`
	Stream             bool                `json:"stream"`
}

type Response struct {
	ConversationId string    `json:"conversation_id,omitempty"`
	Messages       []Message `json:"messages,omitempty"`
	Code           int       `json:"code,omitempty"`
	Msg            string    `json:"msg,omitempty"`
}

type StreamResponse struct {
	Event            string            `json:"event,omitempty"`
	Message          *Message          `json:"message,omitempty"`
	IsFinish         bool              `json:"is_finish,omitempty"`
	Index            int               `json:"index,omitempty"`
	ConversationId   string            `json:"conversation_id,omitempty"`
	ErrorInformation *ErrorInformation `json:"error_information,omitempty"`
}

type StreamResponseV3 struct {
	ID             string      `json:"id"`
	ConversationId string      `json:"conversation_id"`
	BotId          string      `json:"bot_id"`
	Role           string      `json:"role"`
	Type           string      `json:"type"`
	Content        interface{} `json:"content"`
	ContentType    string      `json:"content_type"`
	ChatId         string      `json:"chat_id"`
	SectionId      string      `json:"section_id"`
}

type ChatFailedResponse struct {
	ID             string           `json:"id"`
	ConversationId string           `json:"conversation_id"`
	BotId          string           `json:"bot_id"`
	LastError      ErrorInformation `json:"last_error"`
	Status         string           `json:"status"`
}

type CozeErrorResponse struct {
	Code   int             `json:"code"`
	Msg    string          `json:"msg"`
	Detail json.RawMessage `json:"detail"`
}

// Workflow related structures
type WorkflowRequest struct {
	WorkflowID string                 `json:"workflow_id"`
	Parameters map[string]interface{} `json:"parameters"`
}

type WorkflowResponse struct {
	Code      int         `json:"code"`
	Msg       string      `json:"msg"`
	Data      interface{} `json:"data"` // 可能是字符串或对象
	ExecuteID string      `json:"execute_id"`
	DebugURL  string      `json:"debug_url"`
	Token     int         `json:"token"`
}

type WorkflowExecutionData struct {
	ExecuteID string                 `json:"execute_id"`
	Status    string                 `json:"status"`
	Output    map[string]interface{} `json:"output"`
	Error     *WorkflowError         `json:"error,omitempty"`
}

type WorkflowError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

const (
	WorkflowStatusSuccess = "success"
	WorkflowStatusFailed  = "failed"
	WorkflowStatusRunning = "running"
)
