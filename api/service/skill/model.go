package skill

import (
	"fmt"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Schema constants for skill metadata validation
const (
	// Required fields
	SchemaFieldName = "name"

	// Optional fields
	SchemaFieldDescription  = "description"
	SchemaFieldVersion      = "version"
	SchemaFieldAutoMatch    = "auto_match"
	SchemaFieldTools        = "tools"
	SchemaFieldAllowedTools = "allowed_tools"
	SchemaFieldResources    = "resources"
	SchemaFieldRequires     = "requires"
)

// SchemaValidationWarning represents a validation warning for skill metadata
type SchemaValidationWarning struct {
	Field   string // The field that has an issue
	Message string // Human-readable warning message
	Level   string // "error" or "warning"
}

// Skill represents a loaded skill from SKILL.md
type Skill struct {
	Name         string           `json:"name"`
	Description  string           `json:"description"`
	Version      string           `json:"version"`
	Path         string           `json:"path"`          // Path to the skill directory
	Content      string           `json:"content"`       // Full content of SKILL.md
	Instruction  string           `json:"instruction"`   // The instruction part
	Tools        []ToolDefinition `json:"tools"`         // Tools defined in the skill
	AllowedTools []string         `json:"allowed_tools"` // Allowed script patterns for code-interpreter
	Resources    []string         `json:"resources"`
	Requires     SkillRequires    `json:"requires"`
	AutoMatch    bool             `json:"auto_match"` // Whether to automatically match this skill in intent classification
}

type SkillRequires struct {
	Bins   []string `json:"bins" yaml:"bins"`
	Env    []string `json:"env" yaml:"env"`
	Config []string `json:"config" yaml:"config"`
}

// ToolDefinition represents a tool available to the skill
type ToolDefinition struct {
	Name        string                 `json:"name" yaml:"name"`
	Description string                 `json:"description" yaml:"description"`
	Parameters  map[string]interface{} `json:"parameters" yaml:"parameters"` // JSON Schema for parameters
	Type        string                 `json:"type" yaml:"type"`             // function, etc.
}

// SkillMatchResult represents the result of matching a query against skills
type SkillMatchResult struct {
	Skill *Skill
	Score float64
}

func parseFlowStringList(raw string) []string {
	raw = strings.TrimSpace(raw)
	raw = strings.Trim(raw, "[]")
	if raw == "" {
		return nil
	}

	items := strings.Split(raw, ",")
	result := make([]string, 0, len(items))
	for _, item := range items {
		value := strings.TrimSpace(item)
		value = strings.Trim(value, `"'`)
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

// frontmatterStruct 用于 YAML 解析的临时结构
type frontmatterStruct struct {
	Name         string        `yaml:"name"`
	Description  string        `yaml:"description"`
	Version      string        `yaml:"version"`
	AutoMatch    bool          `yaml:"auto_match"`
	Tools        interface{}   `yaml:"tools"`
	AllowedTools []string      `yaml:"allowed_tools"`
	Resources    []string      `yaml:"resources"`
	Requires     SkillRequires `yaml:"requires"`
}

var knownFrontmatterFields = map[string]struct{}{
	"name":          {},
	"description":   {},
	"version":       {},
	"auto_match":    {},
	"tools":         {},
	"allowed_tools": {},
	"resources":     {},
	"requires":      {},
}

func hasCodeInterpreterTool(tools []ToolDefinition) bool {
	for _, tool := range tools {
		if strings.TrimSpace(tool.Name) == "code-interpreter" {
			return true
		}
	}
	return false
}

func validateFrontmatterSchema(frontmatter string) []SchemaValidationWarning {
	var warnings []SchemaValidationWarning
	if strings.TrimSpace(frontmatter) == "" {
		return warnings
	}

	raw := make(map[string]interface{})
	if err := yaml.Unmarshal([]byte(frontmatter), &raw); err != nil {
		return warnings
	}

	unknownFields := make([]string, 0)
	for key := range raw {
		if _, ok := knownFrontmatterFields[key]; !ok {
			unknownFields = append(unknownFields, key)
		}
	}
	sort.Strings(unknownFields)

	for _, field := range unknownFields {
		warnings = append(warnings, SchemaValidationWarning{
			Field:   field,
			Message: fmt.Sprintf("unknown metadata field '%s' in skill frontmatter", field),
			Level:   "warning",
		})
	}
	return warnings
}

// ValidateSkillMetadata validates skill metadata and returns warnings
func ValidateSkillMetadata(skill *Skill) []SchemaValidationWarning {
	var warnings []SchemaValidationWarning

	// Validate name
	if skill.Name == "" {
		warnings = append(warnings, SchemaValidationWarning{
			Field:   SchemaFieldName,
			Message: "skill name is empty, will use directory name as fallback",
			Level:   "warning",
		})
	} else if !isValidSkillName(skill.Name) {
		warnings = append(warnings, SchemaValidationWarning{
			Field:   SchemaFieldName,
			Message: fmt.Sprintf("skill name '%s' contains invalid characters (should be alphanumeric with hyphens/underscores)", skill.Name),
			Level:   "warning",
		})
	}

	// Validate tools
	for _, tool := range skill.Tools {
		toolName := strings.TrimSpace(tool.Name)
		if toolName == "" {
			warnings = append(warnings, SchemaValidationWarning{
				Field:   SchemaFieldTools,
				Message: "tool name is empty",
				Level:   "warning",
			})
			continue
		}
		if strings.ContainsAny(toolName, " \t\n\r") {
			warnings = append(warnings, SchemaValidationWarning{
				Field:   SchemaFieldTools,
				Message: fmt.Sprintf("tool name '%s' contains whitespace", toolName),
				Level:   "warning",
			})
		}
	}

	if strings.TrimSpace(skill.Description) == "" {
		warnings = append(warnings, SchemaValidationWarning{
			Field:   SchemaFieldDescription,
			Message: "skill description is empty",
			Level:   "warning",
		})
	}

	// Validate allowed_tools patterns
	for _, pattern := range skill.AllowedTools {
		if strings.TrimSpace(pattern) == "" {
			warnings = append(warnings, SchemaValidationWarning{
				Field:   SchemaFieldAllowedTools,
				Message: "allowed_tools contains empty pattern",
				Level:   "warning",
			})
			continue
		}
		if strings.Contains(pattern, "..") {
			warnings = append(warnings, SchemaValidationWarning{
				Field:   SchemaFieldAllowedTools,
				Message: fmt.Sprintf("allowed_tools pattern '%s' contains path traversal sequence '..'", pattern),
				Level:   "error",
			})
		}
	}

	for _, bin := range skill.Requires.Bins {
		if strings.TrimSpace(bin) == "" {
			warnings = append(warnings, SchemaValidationWarning{
				Field:   SchemaFieldRequires,
				Message: "requires.bins contains empty item",
				Level:   "warning",
			})
		}
	}
	for _, envName := range skill.Requires.Env {
		if strings.TrimSpace(envName) == "" {
			warnings = append(warnings, SchemaValidationWarning{
				Field:   SchemaFieldRequires,
				Message: "requires.env contains empty item",
				Level:   "warning",
			})
		}
	}
	for _, cfg := range skill.Requires.Config {
		if strings.TrimSpace(cfg) == "" {
			warnings = append(warnings, SchemaValidationWarning{
				Field:   SchemaFieldRequires,
				Message: "requires.config contains empty item",
				Level:   "warning",
			})
		}
	}
	return warnings
}

// isValidSkillName checks if a skill name follows naming conventions
func isValidSkillName(name string) bool {
	if name == "" {
		return false
	}
	for _, c := range name {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// ParseSkillMetadataResult contains the parsed skill and validation warnings
type ParseSkillMetadataResult struct {
	Skill    *Skill
	Warnings []SchemaValidationWarning
}

func normalizeYAMLValue(value interface{}) interface{} {
	switch v := value.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(v))
		for k, val := range v {
			out[k] = normalizeYAMLValue(val)
		}
		return out
	case map[interface{}]interface{}:
		out := make(map[string]interface{}, len(v))
		for k, val := range v {
			out[fmt.Sprintf("%v", k)] = normalizeYAMLValue(val)
		}
		return out
	case []interface{}:
		out := make([]interface{}, 0, len(v))
		for _, val := range v {
			out = append(out, normalizeYAMLValue(val))
		}
		return out
	default:
		return value
	}
}

func parseToolDefinitionMap(raw map[string]interface{}) *ToolDefinition {
	name, _ := raw["name"].(string)
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	toolType, _ := raw["type"].(string)
	toolType = strings.TrimSpace(toolType)
	if toolType == "" {
		toolType = "function"
	}
	desc, _ := raw["description"].(string)
	tool := &ToolDefinition{
		Name:        name,
		Description: strings.TrimSpace(desc),
		Type:        toolType,
	}

	if rawParams, ok := raw["parameters"]; ok {
		normalized := normalizeYAMLValue(rawParams)
		if paramsMap, ok := normalized.(map[string]interface{}); ok {
			tool.Parameters = paramsMap
		}
	}
	return tool
}

func parseToolsField(raw interface{}) []ToolDefinition {
	var tools []ToolDefinition
	appendToolByName := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		tools = append(tools, ToolDefinition{Name: name, Type: "function"})
	}
	appendToolByMap := func(m map[string]interface{}) {
		tool := parseToolDefinitionMap(m)
		if tool != nil {
			tools = append(tools, *tool)
		}
	}

	switch v := raw.(type) {
	case nil:
		return nil
	case []string:
		for _, t := range v {
			appendToolByName(t)
		}
	case string:
		for _, t := range parseFlowStringList(v) {
			appendToolByName(t)
		}
	case []interface{}:
		for _, item := range v {
			switch typed := normalizeYAMLValue(item).(type) {
			case string:
				appendToolByName(typed)
			case map[string]interface{}:
				appendToolByMap(typed)
			}
		}
	}
	return tools
}

// Helper to parse metadata from markdown content (YAML Frontmatter)
// Returns the skill and any validation warnings
func ParseSkillMetadata(content string) (*Skill, error) {
	skill := &Skill{Content: content}

	// 使用 strings.SplitN 分割 frontmatter
	parts := strings.SplitN(content, "---", 3)
	if len(parts) < 3 {
		return skill, nil // No frontmatter
	}

	frontmatter := strings.TrimSpace(parts[1])
	skill.Instruction = strings.TrimSpace(parts[2])

	// 优先使用 YAML 解析器（支持 block style）
	var fm frontmatterStruct
	if err := yaml.Unmarshal([]byte(frontmatter), &fm); err == nil {
		// YAML 解析成功
		skill.Name = fm.Name
		skill.Description = fm.Description
		skill.Version = fm.Version
		skill.AutoMatch = fm.AutoMatch
		skill.AllowedTools = fm.AllowedTools
		skill.Resources = fm.Resources
		skill.Requires = fm.Requires
		skill.Tools = parseToolsField(fm.Tools)
		return skill, nil
	}

	// 降级：逐行解析（兼容旧格式）
	lines := strings.Split(frontmatter, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "name:") {
			skill.Name = strings.TrimSpace(strings.TrimPrefix(line, "name:"))
		} else if strings.HasPrefix(line, "description:") {
			skill.Description = strings.TrimSpace(strings.TrimPrefix(line, "description:"))
		} else if strings.HasPrefix(line, "version:") {
			skill.Version = strings.TrimSpace(strings.TrimPrefix(line, "version:"))
		} else if strings.HasPrefix(line, "auto_match:") {
			val := strings.TrimSpace(strings.TrimPrefix(line, "auto_match:"))
			if val == "true" {
				skill.AutoMatch = true
			} else {
				skill.AutoMatch = false
			}
		} else if strings.HasPrefix(line, "tools:") {
			toolsStr := strings.TrimSpace(strings.TrimPrefix(line, "tools:"))
			toolNames := parseFlowStringList(toolsStr)
			for _, t := range toolNames {
				skill.Tools = append(skill.Tools, ToolDefinition{Name: t, Type: "function"})
			}
		} else if strings.HasPrefix(line, "allowed_tools:") {
			allowedToolsStr := strings.TrimSpace(strings.TrimPrefix(line, "allowed_tools:"))
			skill.AllowedTools = parseFlowStringList(allowedToolsStr)
		}
	}

	return skill, nil
}

// ParseSkillMetadataWithValidation parses and validates skill metadata
func ParseSkillMetadataWithValidation(content string) (*Skill, []SchemaValidationWarning, error) {
	skill, err := ParseSkillMetadata(content)
	if err != nil {
		return nil, nil, err
	}
	warnings := ValidateSkillMetadata(skill)
	parts := strings.SplitN(content, "---", 3)
	if len(parts) >= 3 {
		frontmatter := strings.TrimSpace(parts[1])
		warnings = append(warnings, validateFrontmatterSchema(frontmatter)...)
	}
	return skill, warnings, nil
}
