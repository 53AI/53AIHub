package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

type AgentOpenAPIDocsParameter struct {
	Name        string      `json:"name"`
	In          string      `json:"in"`
	Type        string      `json:"type"`
	Required    bool        `json:"required"`
	Description string      `json:"description"`
	Example     interface{} `json:"example,omitempty"`
}

type AgentOpenAPIDocsEndpoint struct {
	Method          string                      `json:"method"`
	Path            string                      `json:"path"`
	Title           string                      `json:"title"`
	Description     string                      `json:"description"`
	Parameters      []AgentOpenAPIDocsParameter `json:"parameters,omitempty"`
	Request         map[string]interface{}      `json:"request,omitempty"`
	Response        map[string]interface{}      `json:"response,omitempty"`
	RequestExample  map[string]interface{}      `json:"request_example,omitempty"`
	ResponseExample map[string]interface{}      `json:"response_example,omitempty"`
	StreamResponse  map[string]interface{}      `json:"stream_response,omitempty"`
	Notes           []string                    `json:"notes,omitempty"`
}

type AgentOpenAPIDocsTemplate struct {
	Title        string                     `json:"title"`
	BaseURL      string                     `json:"base_url"`
	Auth         map[string]interface{}     `json:"auth"`
	Placeholders map[string]string          `json:"placeholders"`
	QuickStart   []string                   `json:"quick_start"`
	Notes        []string                   `json:"notes,omitempty"`
	Endpoints    []AgentOpenAPIDocsEndpoint `json:"endpoints"`
	Errors       []map[string]string        `json:"errors"`
}

// GetAgentOpenAPIDocsTemplate
// @Summary 获取 Agent OpenAPI 对接文档模板
// @Description 返回固定的 Agent OpenAPI 对接文档模板，前端可替换 BASE_URL、API_KEY、USER、CONVERSATION_ID 等占位符后展示给对接方
// @Tags Agent OpenAPI 管理
// @Accept json
// @Produce json
// @Success 200 {object} model.CommonResponse{data=AgentOpenAPIDocsTemplate} "Success"
// @Security BearerAuth
// @Router /api/agents/openapi/docs-template [get]
func GetAgentOpenAPIDocsTemplate(c *gin.Context) {
	template := AgentOpenAPIDocsTemplate{
		Title:   "Agent OpenAPI 对接文档模板",
		BaseURL: "{{BASE_URL}}/openapi/v1",
		Auth: map[string]interface{}{
			"type":        "bearer",
			"header":      "Authorization: Bearer {{API_KEY}}",
			"description": "所有 /openapi/v1 接口都需要在 Header 中传 Authorization: Bearer {{API_KEY}}，/health 除外。",
		},
		Placeholders: map[string]string{
			"base_url":        "{{BASE_URL}}",
			"api_key":         "{{API_KEY}}",
			"bot_id":          "{{BOT_ID}}",
			"user":            "{{USER}}",
			"conversation_id": "{{CONVERSATION_ID}}",
			"file_id":         "{{FILE_ID}}",
			"message_id":      "{{MESSAGE_ID}}",
		},
		QuickStart: []string{
			"使用 API Key 作为 Bearer Token 调用 OpenAPI。",
			"调用 POST /conversations?user={{USER}} 创建会话并保存返回的 id。",
			"调用 POST /chat/completions 时传入 conversation_id={{CONVERSATION_ID}}。",
			"查询会话详情，从 messages[].id 获取 {{MESSAGE_ID}} 后可调用消息评价接口。",
		},
		Notes: []string{
			"API Key 绑定 Agent：每个 API Key 只能访问其绑定的 Agent，同一 Agent 可创建多个 Key。",
			"user 参数隔离数据：同一个 Agent 下，不同 user 值的会话、文件、消息完全隔离，互不可见。",
			"同一 Agent 不同 Key 共享数据：同一 Agent 下的不同 API Key，只要 user 值相同，访问的是同一组会话、文件、消息。",
			"user 参数为外部用户唯一标识，由调用方自行定义，支持字母、数字、点、下划线、连字符，最长 255 字符。",
		},
		Endpoints: []AgentOpenAPIDocsEndpoint{
			{
				Method:      "GET",
				Path:        "/health",
				Title:       "健康检查",
				Description: "检查 OpenAPI 服务是否可用。",
				ResponseExample: map[string]interface{}{
					"status": "ok",
				},
			},
			{
				Method:      "GET",
				Path:        "/agent",
				Title:       "获取 Agent 信息",
				Description: "获取当前 API Key 绑定的 Agent 信息。",
				ResponseExample: map[string]interface{}{
					"id":          "{{BOT_ID}}",
					"agent_id":    "{{AGENT_ID}}",
					"bot_id":      "{{BOT_ID}}",
					"name":        "Agent 名称",
					"description": "Agent 描述",
					"model":       "deepseek-v3.2",
				},
			},
			{
				Method:      "POST",
				Path:        "/conversations",
				Title:       "创建会话",
				Description: "为指定外部用户创建新会话。chat/completions 必须先创建会话再传 conversation_id。",
				Parameters: []AgentOpenAPIDocsParameter{
					{Name: "user", In: "query", Type: "string", Required: true, Description: "外部用户唯一标识。同一个 user 只能访问自己的会话、文件和消息。", Example: "{{USER}}"},
				},
				Request: map[string]interface{}{
					"query": map[string]string{"user": "{{USER}}"},
					"body":  map[string]interface{}{},
				},
				RequestExample: map[string]interface{}{},
				ResponseExample: map[string]interface{}{
					"id":    "{{CONVERSATION_ID}}",
					"title": "New conversation",
				},
			},
			{
				Method:      "GET",
				Path:        "/conversations",
				Title:       "获取会话列表",
				Description: "获取指定外部用户的会话列表。",
				Parameters: []AgentOpenAPIDocsParameter{
					{Name: "user", In: "query", Type: "string", Required: true, Description: "外部用户唯一标识。", Example: "{{USER}}"},
					{Name: "offset", In: "query", Type: "number", Required: false, Description: "分页偏移量，默认 0。", Example: 0},
					{Name: "limit", In: "query", Type: "number", Required: false, Description: "每页数量，默认 50。", Example: 50},
				},
				Request: map[string]interface{}{
					"query": map[string]string{"user": "{{USER}}", "offset": "0", "limit": "50"},
				},
				ResponseExample: map[string]interface{}{
					"count":         1,
					"conversations": []map[string]interface{}{{"id": "{{CONVERSATION_ID}}", "title": "New conversation", "source": "api"}},
				},
			},
			{
				Method:      "GET",
				Path:        "/conversations/{{CONVERSATION_ID}}",
				Title:       "获取会话详情",
				Description: "获取会话详情和消息列表。消息评价使用 messages[].id。",
				Parameters: []AgentOpenAPIDocsParameter{
					{Name: "conversation_id", In: "path", Type: "string", Required: true, Description: "会话 ID，来自创建会话接口返回的 id。", Example: "{{CONVERSATION_ID}}"},
					{Name: "user", In: "query", Type: "string", Required: true, Description: "外部用户唯一标识。", Example: "{{USER}}"},
					{Name: "offset", In: "query", Type: "number", Required: false, Description: "消息分页偏移量，默认 0。", Example: 0},
					{Name: "limit", In: "query", Type: "number", Required: false, Description: "消息分页数量，默认 50。", Example: 50},
				},
				Request: map[string]interface{}{
					"query": map[string]string{"user": "{{USER}}", "offset": "0", "limit": "50"},
				},
				ResponseExample: map[string]interface{}{
					"id":       "{{CONVERSATION_ID}}",
					"title":    "New conversation",
					"source":   "api",
					"count":    1,
					"messages": []map[string]interface{}{{"id": "{{MESSAGE_ID}}", "message_type": "chat", "request_source": "api", "content": "消息内容"}},
				},
			},
			{
				Method:      "PATCH",
				Path:        "/conversations/{{CONVERSATION_ID}}",
				Title:       "更新会话标题",
				Description: "修改会话标题。",
				Parameters: []AgentOpenAPIDocsParameter{
					{Name: "conversation_id", In: "path", Type: "string", Required: true, Description: "会话 ID。", Example: "{{CONVERSATION_ID}}"},
					{Name: "user", In: "query", Type: "string", Required: true, Description: "外部用户唯一标识。", Example: "{{USER}}"},
					{Name: "title", In: "body", Type: "string", Required: true, Description: "新的会话标题。", Example: "新的会话标题"},
				},
				Request: map[string]interface{}{
					"query": map[string]string{"user": "{{USER}}"},
					"body":  map[string]string{"title": "新的会话标题"},
				},
				RequestExample:  map[string]interface{}{"title": "新的会话标题"},
				ResponseExample: map[string]interface{}{"id": "{{CONVERSATION_ID}}", "title": "新的会话标题"},
			},
			{
				Method:      "DELETE",
				Path:        "/conversations/{{CONVERSATION_ID}}",
				Title:       "删除会话",
				Description: "删除指定会话。",
				Parameters: []AgentOpenAPIDocsParameter{
					{Name: "conversation_id", In: "path", Type: "string", Required: true, Description: "会话 ID。", Example: "{{CONVERSATION_ID}}"},
					{Name: "user", In: "query", Type: "string", Required: true, Description: "外部用户唯一标识。", Example: "{{USER}}"},
				},
				Request: map[string]interface{}{
					"query": map[string]string{"user": "{{USER}}"},
				},
				ResponseExample: map[string]interface{}{},
			},
			{
				Method:      "POST",
				Path:        "/chat/completions",
				Title:       "发送消息",
				Description: "向当前 API Key 绑定的 Agent 发送消息。API Key 已绑定 Agent，不允许传 model。",
				Parameters: []AgentOpenAPIDocsParameter{
					{Name: "user", In: "body", Type: "string", Required: true, Description: "外部用户唯一标识。", Example: "{{USER}}"},
					{Name: "conversation_id", In: "body", Type: "string", Required: true, Description: "会话 ID，必须先调用创建会话接口获取。", Example: "{{CONVERSATION_ID}}"},
					{Name: "messages", In: "body", Type: "array", Required: true, Description: "OpenAI 格式消息数组，至少包含一条 user 消息。", Example: []map[string]string{{"role": "user", "content": "你好"}}},
					{Name: "stream", In: "body", Type: "boolean", Required: false, Description: "是否流式返回。默认 true；前端示例一般用 false。", Example: false},
					{Name: "wiki_search_config", In: "body", Type: "object", Required: false, Description: "Wiki 搜索配置。仅 enabled=true 且 Agent 开启 Wiki 能力时搜索；可传 space_ids、knowledge_base_ids、wiki_page_ids。", Example: map[string]interface{}{"enabled": true}},
				},
				Request: map[string]interface{}{
					"messages":           []map[string]string{{"role": "user", "content": "你好"}},
					"conversation_id":    "{{CONVERSATION_ID}}",
					"user":               "{{USER}}",
					"stream":             false,
					"wiki_search_config": map[string]interface{}{"enabled": true, "space_ids": []string{}, "knowledge_base_ids": []string{}, "wiki_page_ids": []string{}},
				},
				RequestExample: map[string]interface{}{
					"user":               "{{USER}}",
					"conversation_id":    "{{CONVERSATION_ID}}",
					"messages":           []map[string]string{{"role": "user", "content": "你好"}},
					"stream":             false,
					"wiki_search_config": map[string]interface{}{"enabled": true},
				},
				ResponseExample: map[string]interface{}{"id": "chatcmpl_xxx", "object": "chat.completion", "choices": []interface{}{}},
				StreamResponse: map[string]interface{}{
					"content_type": "text/event-stream; charset=utf-8",
					"events": []map[string]interface{}{
						{
							"type":        "message_id_first_frame",
							"description": "OpenAPI 流式首帧，包含 message_id；如果是 API 来源，还会包含 conversation_id 和 run_id。",
							"example": map[string]interface{}{
								"id":              "chatcmpl_xxx",
								"object":          "chat.completion.chunk",
								"created":         1780000000,
								"model":           "deepseek-v3.2",
								"message_id":      "{{MESSAGE_ID}}",
								"conversation_id": "{{CONVERSATION_ID}}",
								"run_id":          "{{RUN_ID}}",
								"choices":         []interface{}{},
							},
						},
						{
							"type":        "chat_delta",
							"description": "模型回答增量，格式兼容 OpenAI chat.completion.chunk。",
							"example": map[string]interface{}{
								"id":      "chatcmpl_xxx",
								"object":  "chat.completion.chunk",
								"created": 1780000000,
								"model":   "deepseek-v3.2",
								"choices": []map[string]interface{}{{"delta": map[string]string{"content": "你好"}, "index": 0}},
							},
						},
						{
							"type":        "process_step",
							"description": "处理过程步骤。enable_process_steps 默认为 true，前端可选择展示或忽略。",
							"object":      "process.step",
							"step_codes":  []string{"intent_classification", "query_expansion", "scope_narrowing", "knowledge_search", "answer_generation", "ref_analysis", "skill_routing", "tool_execution"},
							"statuses":    []string{"start", "completed"},
							"example": map[string]interface{}{
								"id":      "chatcmpl_xxx",
								"object":  "process.step",
								"created": 1780000000,
								"process_step": map[string]interface{}{
									"step_code": "answer_generation",
									"status":    "start",
									"message":   "正在生成回答...",
								},
							},
						},
						{
							"type":        "process_step_end",
							"description": "处理步骤结束标记。",
							"example": map[string]interface{}{
								"id":      "chatcmpl_xxx",
								"object":  "process.step.end",
								"created": 1780000000,
								"message": "Process steps completed",
							},
						},
						{
							"type":        "error",
							"description": "流式错误也使用 SSE data 包裹，随后发送 [DONE]。",
							"example":     map[string]interface{}{"error": map[string]string{"message": "error message", "type": "53aihub_error"}},
						},
						{
							"type":        "done",
							"description": "流式结束标记。",
							"example":     "[DONE]",
						},
					},
				},
				Notes: []string{
					"不要传 model，API Key 已经绑定 Agent。",
					"不要传 temperature、max_tokens、top_p，使用 Agent 后台配置。",
					"conversation_id 必传。",
					"stream=true 时按 SSE 读取，每个事件以 data: 开头，空行分隔。",
					"前端必须处理 [DONE] 结束标记。",
				},
			},
			{
				Method:      "POST",
				Path:        "/files",
				Title:       "上传文件",
				Description: "上传 OpenAPI 文件。",
				Parameters: []AgentOpenAPIDocsParameter{
					{Name: "user", In: "formData", Type: "string", Required: true, Description: "外部用户唯一标识。", Example: "{{USER}}"},
					{Name: "file", In: "formData", Type: "file", Required: true, Description: "上传文件。"},
				},
				Request: map[string]interface{}{
					"content_type": "multipart/form-data",
					"fields":       map[string]string{"user": "{{USER}}", "file": "选择的文件"},
				},
				ResponseExample: map[string]interface{}{"id": "{{FILE_ID}}", "file_name": "demo.txt", "size": 123, "extension": ".txt", "mime_type": "text/plain", "created_time": "2024-01-01T00:00:00Z"},
			},
			{
				Method:      "GET",
				Path:        "/files/{{FILE_ID}}",
				Title:       "获取文件信息",
				Description: "获取上传文件信息。",
				Parameters: []AgentOpenAPIDocsParameter{
					{Name: "file_id", In: "path", Type: "string", Required: true, Description: "文件 ID。", Example: "{{FILE_ID}}"},
					{Name: "user", In: "query", Type: "string", Required: true, Description: "外部用户唯一标识。", Example: "{{USER}}"},
				},
				Request: map[string]interface{}{
					"query": map[string]string{"user": "{{USER}}"},
				},
				ResponseExample: map[string]interface{}{"id": "{{FILE_ID}}", "file_name": "demo.txt", "size": 123, "extension": ".txt", "mime_type": "text/plain", "status": "success", "created_time": "2024-01-01T00:00:00Z"},
			},
		},
		Errors: []map[string]string{
			{"status": "400", "type": "invalid_request_error", "description": "请求参数错误，例如缺少 user、conversation_id 或 rating。"},
			{"status": "401", "type": "invalid_api_key", "description": "API Key 无效、过期或已吊销。"},
			{"status": "403", "type": "permission_error", "description": "无权访问。"},
			{"status": "404", "type": "not_found", "description": "资源不存在，或资源不属于当前 user/API Key。"},
			{"status": "500", "type": "server_error", "description": "服务端错误。"},
		},
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(template))
}
