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
