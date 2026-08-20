package agentcore

import (
	"context"
	"fmt"
	"math"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// SchemaProvider returns an executor-facing JSON Schema without coupling the
// core package to a particular tool registry.
type SchemaProvider func(functionName string) (map[string]any, bool)

type ArgsSchemaValidator struct {
	Provider SchemaProvider
}

func (ArgsSchemaValidator) Name() string { return "args_schema" }
func (ArgsSchemaValidator) Stage() ToolPolicyStage {
	return StageValidate
}
func (p ArgsSchemaValidator) Before(_ context.Context, call *ToolCallContext) BeforeToolDecision {
	if call == nil || call.ParseErr != nil || p.Provider == nil {
		return BeforeToolDecision{}
	}
	schema, ok := p.Provider(call.FunctionName)
	if !ok {
		return BeforeToolDecision{Block: true, Code: "UNKNOWN_TOOL", Summary: "工具不存在", Content: "未找到对应的工具定义", Meta: retryableMeta()}
	}
	errors := validateSchemaValue(call.ArgsParsed, schema, "")
	if len(errors) == 0 {
		return BeforeToolDecision{}
	}
	return BeforeToolDecision{
		Block: true, Code: "ARGUMENT_SCHEMA_INVALID", Summary: "工具参数不符合 Schema",
		Content: strings.Join(errors, "；"), Meta: retryableMeta(),
	}
}
func (ArgsSchemaValidator) After(context.Context, *ToolCallContext, *ToolExecutionResult) AfterToolDecision {
	return AfterToolDecision{}
}

// ArgsBudgetGuard limits input size before a tool can allocate or send it to a
// sandbox. Limits are deliberately deterministic and may be narrowed by tools.
type ArgsBudgetGuard struct {
	MaxArgsChars    int
	MaxFieldChars   int
	MaxCommandChars int
	MaxWriteChars   int
}

func (ArgsBudgetGuard) Name() string { return "args_budget" }
func (ArgsBudgetGuard) Stage() ToolPolicyStage {
	return StageGuard
}
func (p ArgsBudgetGuard) Before(_ context.Context, call *ToolCallContext) BeforeToolDecision {
	if call == nil || call.ParseErr != nil {
		return BeforeToolDecision{}
	}
	if p.MaxArgsChars > 0 && len(call.ArgsRaw) > p.MaxArgsChars {
		return budgetDecision(fmt.Sprintf("本次工具参数为 %d 字符，超过 %d 字符限制，请拆分调用。", len(call.ArgsRaw), p.MaxArgsChars))
	}
	for field, value := range call.ArgsParsed {
		text, ok := value.(string)
		if !ok {
			continue
		}
		if p.MaxFieldChars > 0 && len(text) > p.MaxFieldChars {
			return budgetDecision(fmt.Sprintf("字段 %s 为 %d 字符，超过单字段限制 %d，请拆分调用。", field, len(text), p.MaxFieldChars))
		}
		if field == "command" && p.MaxCommandChars > 0 && len(text) > p.MaxCommandChars {
			return budgetDecision(fmt.Sprintf("Shell command 为 %d 字符，超过限制 %d，请拆分命令。", len(text), p.MaxCommandChars))
		}
		if (field == "content" || field == "code") && p.MaxWriteChars > 0 && len(text) > p.MaxWriteChars {
			return budgetDecision(fmt.Sprintf("字段 %s 为 %d 字符，超过写入限制 %d，请分块写入。", field, len(text), p.MaxWriteChars))
		}
	}
	return BeforeToolDecision{}
}
func (ArgsBudgetGuard) After(context.Context, *ToolCallContext, *ToolExecutionResult) AfterToolDecision {
	return AfterToolDecision{}
}

func budgetDecision(content string) BeforeToolDecision {
	return BeforeToolDecision{Block: true, Code: "ARGUMENT_TOO_LARGE", Summary: "工具参数超过安全预算", Content: content, Meta: retryableMeta()}
}

// PlaceholderGuard blocks only deterministic placeholders. Allow permits a
// Skill or controlled built-in tool to use a literal placeholder intentionally.
type PlaceholderGuard struct {
	Allow func(call *ToolCallContext, field, value string) bool
}

var placeholderPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\{\{\s*(todo|placeholder)\s*\}\}`),
	regexp.MustCompile(`(?i)<placeholder>`),
	regexp.MustCompile(`(?i)\b(your_api_key|replace_me)\b`),
	regexp.MustCompile(`(?i)^/path/to/file$`),
	regexp.MustCompile(`(?i)^example@example\.com$`),
}

func (PlaceholderGuard) Name() string { return "placeholder" }
func (PlaceholderGuard) Stage() ToolPolicyStage {
	return StageGuard
}
func (p PlaceholderGuard) Before(_ context.Context, call *ToolCallContext) BeforeToolDecision {
	if call == nil || call.ParseErr != nil {
		return BeforeToolDecision{}
	}
	for field, value := range call.ArgsParsed {
		text, ok := value.(string)
		if !ok || (p.Allow != nil && p.Allow(call, field, text)) {
			continue
		}
		for _, pattern := range placeholderPatterns {
			if pattern.MatchString(strings.TrimSpace(text)) || pattern.FindStringIndex(text) != nil {
				return BeforeToolDecision{Block: true, Code: "PLACEHOLDER_DETECTED", Summary: "工具参数包含未替换的占位符", Content: fmt.Sprintf("字段 %s 包含占位符，请替换为实际值后再调用。", field), Meta: retryableMeta()}
			}
		}
	}
	return BeforeToolDecision{}
}
func (PlaceholderGuard) After(context.Context, *ToolCallContext, *ToolExecutionResult) AfterToolDecision {
	return AfterToolDecision{}
}

// PathContainmentGuard rejects explicit traversal attempts. Sandbox-side path
// validation remains authoritative for symlinks and tenant-specific roots.
type PathContainmentGuard struct{}

func (PathContainmentGuard) Name() string { return "path_containment" }
func (PathContainmentGuard) Stage() ToolPolicyStage {
	return StageGuard
}
func (PathContainmentGuard) Before(_ context.Context, call *ToolCallContext) BeforeToolDecision {
	if call == nil || call.ParseErr != nil {
		return BeforeToolDecision{}
	}
	for _, field := range []string{"path", "cwd"} {
		value, ok := call.ArgsParsed[field].(string)
		if !ok || strings.TrimSpace(value) == "" {
			continue
		}
		normalized := filepath.ToSlash(filepath.Clean(value))
		if normalized == ".." || strings.HasPrefix(normalized, "../") || strings.Contains(normalized, "/../") {
			return BeforeToolDecision{Block: true, Code: "PATH_ESCAPE_BLOCKED", Summary: "路径越过允许的工作目录", Content: fmt.Sprintf("字段 %s 不允许包含越界路径。", field), Meta: retryableMeta()}
		}
	}
	return BeforeToolDecision{}
}
func (PathContainmentGuard) After(context.Context, *ToolCallContext, *ToolExecutionResult) AfterToolDecision {
	return AfterToolDecision{}
}

func retryableMeta() map[string]any { return map[string]any{"retryable_by_model": true} }

func validateSchemaValue(value any, schema map[string]any, path string) []string {
	if schema == nil {
		return nil
	}
	fieldPath := path
	if fieldPath == "" {
		fieldPath = "参数"
	}
	var errors []string
	typeName, _ := schema["type"].(string)
	switch typeName {
	case "object":
		object, ok := value.(map[string]any)
		if !ok {
			return []string{fieldPath + " 应为对象"}
		}
		properties, _ := schema["properties"].(map[string]any)
		required := stringSlice(schema["required"])
		for _, field := range required {
			if _, exists := object[field]; !exists {
				errors = append(errors, "字段 "+field+" 为必填项")
			}
		}
		allowUnknown, _ := schema["additionalProperties"].(bool)
		if !allowUnknown {
			keys := make([]string, 0, len(object))
			for key := range object {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				property, exists := properties[key]
				if !exists {
					errors = append(errors, "字段 "+key+" 不受该工具支持")
					continue
				}
				propertySchema, _ := property.(map[string]any)
				errors = append(errors, validateSchemaValue(object[key], propertySchema, key)...)
			}
		}
	case "string":
		text, ok := value.(string)
		if !ok {
			return []string{fieldPath + " 应为字符串"}
		}
		if max, ok := integer(schema["maxLength"]); ok && len(text) > max {
			errors = append(errors, fmt.Sprintf("字段 %s 长度不能超过 %d", fieldPath, max))
		}
		if min, ok := integer(schema["minLength"]); ok && len(text) < min {
			errors = append(errors, fmt.Sprintf("字段 %s 长度不能小于 %d", fieldPath, min))
		}
	case "integer":
		if number, ok := floatNumber(value); !ok || math.Trunc(number) != number {
			return []string{fieldPath + " 应为整数"}
		}
		if number, ok := floatNumber(value); ok {
			errors = append(errors, numberRangeErrors(fieldPath, number, schema)...)
		}
	case "number":
		number, ok := floatNumber(value)
		if !ok {
			return []string{fieldPath + " 应为数字"}
		}
		errors = append(errors, numberRangeErrors(fieldPath, number, schema)...)
	case "boolean":
		if _, ok := value.(bool); !ok {
			return []string{fieldPath + " 应为布尔值"}
		}
	case "array":
		array, ok := value.([]any)
		if !ok {
			return []string{fieldPath + " 应为数组"}
		}
		if items, ok := schema["items"].(map[string]any); ok {
			for index, item := range array {
				errors = append(errors, validateSchemaValue(item, items, fmt.Sprintf("%s[%d]", fieldPath, index))...)
			}
		}
	}
	if enum, ok := schema["enum"].([]any); ok && !containsAny(enum, value) {
		errors = append(errors, "字段 "+fieldPath+" 不在允许的枚举值中")
	}
	if enum, ok := schema["enum"].([]string); ok && !containsString(enum, fmt.Sprint(value)) {
		errors = append(errors, "字段 "+fieldPath+" 不在允许的枚举值中")
	}
	return errors
}

func stringSlice(value any) []string {
	switch values := value.(type) {
	case []string:
		return values
	case []any:
		result := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
		return result
	}
	return nil
}
func integer(value any) (int, bool) {
	number, ok := floatNumber(value)
	return int(number), ok && math.Trunc(number) == number
}
func floatNumber(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case float32:
		return float64(number), true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	}
	return 0, false
}
func numberRangeErrors(path string, value float64, schema map[string]any) []string {
	var errors []string
	if min, ok := floatNumber(schema["minimum"]); ok && value < min {
		errors = append(errors, fmt.Sprintf("字段 %s 不能小于 %v", path, min))
	}
	if max, ok := floatNumber(schema["maximum"]); ok && value > max {
		errors = append(errors, fmt.Sprintf("字段 %s 不能大于 %v", path, max))
	}
	return errors
}
func containsAny(values []any, target any) bool {
	for _, value := range values {
		if fmt.Sprint(value) == fmt.Sprint(target) {
			return true
		}
	}
	return false
}
func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
