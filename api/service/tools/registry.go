package tools

import (
	"fmt"
)

// ToolDefinition represents the schema for an LLM tool
type ToolDefinition struct {
	Type     string   `json:"type"`
	Function Function `json:"function"`
}

type Function struct {
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Parameters  interface{} `json:"parameters,omitempty"`
}

var registry = map[string]ToolDefinition{
	"web-search": {
		Type: "function",
		Function: Function{
			Name:        "web-search",
			Description: "Search the web for information",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "The search query",
					},
				},
				"required": []string{"query"},
			},
		},
	},
	"web_fetch": {
		Type: "function",
		Function: Function{
			Name:        "web_fetch",
			Description: "Fetch a URL and return extracted text content. Supports HTML/text/JSON with SSRF protection.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"url": map[string]interface{}{
						"type":        "string",
						"description": "HTTP or HTTPS URL to fetch",
					},
					"extractMode": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"markdown", "text"},
						"description": "Extraction mode. Default: markdown",
					},
					"maxChars": map[string]interface{}{
						"type":        "integer",
						"description": "Maximum characters in response. Default: 60000",
					},
				},
				"required": []string{"url"},
			},
		},
	},
	"code-interpreter": {
		Type: "function",
		Function: Function{
			Name:        "code-interpreter",
			Description: "Execute code in a workspace-backed sandboxed environment. Prefer writing files for larger scripts or generated artifacts. Supports Node.js, Python, and Bash scripts.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"language": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"nodejs", "python", "bash"},
						"description": "Programming language to use",
					},
					"code": map[string]interface{}{
						"type":        "string",
						"description": "The code to execute",
					},
				},
				"required": []string{"language", "code"},
			},
		},
	},
	"run_shell": {
		Type: "function",
		Function: Function{
			Name:        "run_shell",
			Description: "Run a shell command in a workspace-backed sandbox. Prefer this for command-line tasks or invoking scripts already present in the workspace.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"command": map[string]interface{}{
						"type":        "string",
						"description": "Shell command to execute",
					},
					"timeout": map[string]interface{}{
						"type":        "integer",
						"description": "Timeout in seconds (optional, default 30)",
					},
					"cwd": map[string]interface{}{
						"type":        "string",
						"description": "Working directory relative to workspace (optional)",
					},
				},
				"required": []string{"command"},
			},
		},
	},
	"read_file": {
		Type: "function",
		Function: Function{
			Name:        "read_file",
			Description: "Read a text file from the workspace. Supports line-based pagination via offset/limit or tail_lines.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "Relative file path to read",
					},
					"max_bytes": map[string]interface{}{
						"type":        "integer",
						"description": "Optional maximum bytes to read",
					},
					"offset": map[string]interface{}{
						"type":        "integer",
						"description": "Start line number (0-indexed). Optional.",
					},
					"limit": map[string]interface{}{
						"type":        "integer",
						"description": "Maximum number of lines to return from offset. Optional.",
					},
					"tail_lines": map[string]interface{}{
						"type":        "integer",
						"description": "Return only the last N lines. Optional. If provided, it takes precedence over offset/limit.",
					},
					"cwd": map[string]interface{}{
						"type":        "string",
						"description": "Working directory relative to workspace (optional)",
					},
				},
				"required": []string{"path"},
			},
		},
	},
	"write_file": {
		Type: "function",
		Function: Function{
			Name:        "write_file",
			Description: "Write text content to a file in the workspace. For larger outputs, prefer writing via a script or generating the file inside the sandbox.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "Relative file path to write",
					},
					"content": map[string]interface{}{
						"type":        "string",
						"description": "Text content to write",
					},
					"append": map[string]interface{}{
						"type":        "boolean",
						"description": "Append instead of overwrite (optional)",
					},
					"create_if_missing": map[string]interface{}{
						"type":        "boolean",
						"description": "Whether to create file if not exists. Default true.",
					},
					"cwd": map[string]interface{}{
						"type":        "string",
						"description": "Working directory relative to workspace (optional)",
					},
				},
				"required": []string{"path", "content"},
			},
		},
	},
	"prepare_input_file": {
		Type: "function",
		Function: Function{
			Name:        "prepare_input_file",
			Description: "Prepare an input file in the workspace. Prefer this semantic tool for large or structured content that will be consumed by scripts or shell commands.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "Relative file path to write",
					},
					"content": map[string]interface{}{
						"type":        "string",
						"description": "Text content to write",
					},
					"append": map[string]interface{}{
						"type":        "boolean",
						"description": "Append instead of overwrite (optional)",
					},
					"create_if_missing": map[string]interface{}{
						"type":        "boolean",
						"description": "Whether to create file if not exists. Default true.",
					},
					"cwd": map[string]interface{}{
						"type":        "string",
						"description": "Working directory relative to workspace (optional)",
					},
				},
				"required": []string{"path", "content"},
			},
		},
	},
	"list_files": {
		Type: "function",
		Function: Function{
			Name:        "list_files",
			Description: "List files and directories in the workspace.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "Relative path to list (optional, default current directory)",
					},
					"recursive": map[string]interface{}{
						"type":        "boolean",
						"description": "Whether to list recursively",
					},
					"max_entries": map[string]interface{}{
						"type":        "integer",
						"description": "Maximum number of entries (optional, default 200)",
					},
					"cwd": map[string]interface{}{
						"type":        "string",
						"description": "Working directory relative to workspace (optional)",
					},
				},
			},
		},
	},
	"edit": {
		Type: "function",
		Function: Function{
			Name:        "edit",
			Description: "Edit a file by replacing exact text matches in the workspace, without rewriting the entire file manually.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path": map[string]interface{}{
						"type":        "string",
						"description": "Relative file path to edit",
					},
					"old_string": map[string]interface{}{
						"type":        "string",
						"description": "Exact text to find",
					},
					"new_string": map[string]interface{}{
						"type":        "string",
						"description": "Replacement text",
					},
					"replace_all": map[string]interface{}{
						"type":        "boolean",
						"description": "Replace all matches (default false)",
					},
					"cwd": map[string]interface{}{
						"type":        "string",
						"description": "Working directory relative to workspace (optional)",
					},
				},
				"required": []string{"path", "old_string", "new_string"},
			},
		},
	},
	"save_memory": {
		Type: "function",
		Function: Function{
			Name:        "save_memory",
			Description: "保存一条记忆到数据库中。当用户明确要求记住某信息（如'记住'、'记录'、'保存'、'请记住'）时调用此工具。支持保存偏好、事实知识或工具使用教训。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"content": map[string]interface{}{
						"type":        "string",
						"description": "需要记住的记忆内容，用中文描述",
					},
					"type": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"preference", "fact", "tool_lesson"},
						"description": "记忆类型：preference=用户偏好/习惯, fact=事实/知识/画像, tool_lesson=工具使用教训",
					},
					"scope": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"agent", "user"},
						"description": "保存范围：agent=助手对该用户的记忆(默认，仅当前助手可见), user=用户全局记忆(跨所有助手可见)",
					},
					"topic": map[string]interface{}{
						"type":        "string",
						"description": "当 type=tool_lesson 时指定关联的工具名称（如 web_search、memory_search）",
					},
				},
				"required": []string{"content", "type"},
			},
		},
	},
	"memory_search": {
		Type: "function",
		Function: Function{
			Name:        "memory_search",
			Description: "搜索用户或助手的记忆。只读操作，不会修改任何数据。当需要回顾用户信息、历史偏好、项目知识或工具教训时调用此工具。query 越长越精确则召回越准。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "搜索关键词，越精确召回越准。例如搜索用户技术栈可传'技术栈 开发语言'",
					},
					"memory_type": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"user", "agent", "tool_lesson", "all"},
						"description": "搜索范围：user=用户全局记忆(画像/知识/偏好), agent=助手对用户的记忆, tool_lesson=工具使用教训, all=全部范围(默认)",
					},
					"max_results": map[string]interface{}{
						"type":        "integer",
						"description": "最大返回条数(1-10)，默认5",
					},
				},
				"required": []string{"query"},
			},
		},
	},
}

// GetToolDefinition returns the full tool definition for a given tool name
func GetToolDefinition(name string) (*ToolDefinition, error) {
	if tool, ok := registry[name]; ok {
		return &tool, nil
	}
	return nil, fmt.Errorf("tool not found: %s", name)
}

// ListTools returns all available tools
func ListTools() []string {
	keys := make([]string, 0, len(registry))
	for k := range registry {
		keys = append(keys, k)
	}
	return keys
}
