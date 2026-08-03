// Package tokenlimit 提供渠道 Token 限制的统一管理：max_tokens 封顶、context_length 压缩。
//
// 核心策略（参考 goclaw）：
//   - 超过 context_length → 自动压缩（tool_result 裁剪 + 可选 LLM 摘要），绝不拦截
//   - 压缩失败 → 保留原始消息，不报错
//   - max_tokens → 封顶，不能超过配置值
package tokenlimit

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

const (
	LogPrefix = "【token限制】"

	// 压缩阈值
	maxToolContentLen = 6000 // tool_result 字符数上限
	compactHeadChars  = 3000 // tool_result 保留头字符数
	compactTailChars  = 3000 // tool_result 保留尾字符数

	minMessagesCompact = 6 // 最少消息数才做对话摘要
	keepRatio          = 3 // 保留最近 1/keepRatio 的消息
	minKeepMessages    = 4 // 最少保留消息数
)

// ModelConfig 模型级别配置项
type ModelConfig struct {
	ModelID       string `json:"model_id"`
	ContextLength int64  `json:"context_length"`
	MaxTokens     int64  `json:"max_tokens"`
	DeepThinking  *bool  `json:"deep_thinking,omitempty"`
	Vision        *bool  `json:"vision,omitempty"`
}

// Config 从 Channel Config JSON 中解析的 token 配置（兼容新旧格式）
type Config struct {
	ContextLength int64 // 压缩水位线，0 不限制
	MaxTokens     int64 // 输出封顶，0 不限制
	DeepThinking  *bool // 深度思考（仅新格式 per-model 有效）
	Vision        *bool // 视觉识别（仅新格式 per-model 有效）
}

// Result 验证结果
type Result struct {
	PromptTokens  int
	ContextLength int64
	NeedCompact   bool // 是否需要压缩
}

// SummarizeFunc 是外部注入的 LLM 摘要函数
// 由 service/rag/content_generator.go 在 init 中注入
type SummarizeFunc func(ctx context.Context, channel *model.Channel, modelName string, messages []relaymodel.Message) (string, error)

var summarizeFn SummarizeFunc

// RegisterSummarizeFunc 注册 LLM 摘要函数（由 rag 包注入）
func RegisterSummarizeFunc(fn SummarizeFunc) {
	summarizeFn = fn
}

// ==================== 配置解析 ====================

// ParseConfig 解析渠道配置，查找指定 model 的配置
// 支持两种格式：
//
//	新格式（数组）：[{"model_id":"gpt-4o","max_tokens":128000,...}, ...]
//	旧格式（对象）：{"max_tokens":128000,"context_length":128000}
//
// 新格式按 model_id 查找，未找到返回零值（不限制）
// 旧格式直接解析顶层字段，保持向后兼容
func ParseConfig(ctx context.Context, channelID int64, configJSON string, modelName string) Config {
	var cfg Config
	if configJSON == "" {
		return cfg
	}

	// 尝试解析为新格式（数组）
	var models []ModelConfig
	if err := json.Unmarshal([]byte(configJSON), &models); err == nil && len(models) > 0 {
		for _, mc := range models {
			if mc.ModelID == modelName {
				cfg.ContextLength = mc.ContextLength
				cfg.MaxTokens = mc.MaxTokens
				cfg.DeepThinking = mc.DeepThinking
				cfg.Vision = mc.Vision
				if cfg.ContextLength > 0 || cfg.MaxTokens > 0 {
					logger.Infof(ctx, "%s渠道 token 配置: 渠道ID=%d, model=%s, context_length=%d, max_tokens=%d",
						LogPrefix, channelID, modelName, cfg.ContextLength, cfg.MaxTokens)
				}
				return cfg
			}
		}
		// 数组格式但未找到 model → 不限制
		logger.Debugf(ctx, "%s渠道未找到模型配置: 渠道ID=%d, model=%s, 不限制",
			LogPrefix, channelID, modelName)
		return cfg
	}

	// 回退：解析为旧格式（对象）
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(configJSON), &m); err != nil {
		logger.Warnf(ctx, "%s解析渠道 token 配置失败: 渠道ID=%d, err=%v", LogPrefix, channelID, err)
		return cfg
	}
	if v, ok := m["context_length"].(float64); ok && v > 0 {
		cfg.ContextLength = int64(v)
	}
	if v, ok := m["max_tokens"].(float64); ok && v > 0 {
		cfg.MaxTokens = int64(v)
	}
	if cfg.ContextLength > 0 || cfg.MaxTokens > 0 {
		logger.Infof(ctx, "%s渠道 token 配置: 渠道ID=%d, context_length=%d, max_tokens=%d",
			LogPrefix, channelID, cfg.ContextLength, cfg.MaxTokens)
	}
	return cfg
}

// lookupModelContextLength 从模型目录获取模型上下文长度
func lookupModelContextLength(modelName string) int {
	if modelName == "" {
		return 0
	}
	loader := common.GetModelCatalogLoader()
	if loader == nil {
		return 0
	}
	return loader.GetModelContextLength(modelName)
}

// ReportConfigSource 构建配置来源描述字符串
func ReportConfigSource(cfg Config, modelName string) (contextSource string, maxTokensSource string) {
	if cfg.ContextLength > 0 {
		contextSource = fmt.Sprintf("渠道配置(%d)", cfg.ContextLength)
	} else if ctxLen := lookupModelContextLength(modelName); ctxLen > 0 {
		contextSource = fmt.Sprintf("模型目录(%d)", ctxLen)
	} else {
		contextSource = fmt.Sprintf("默认(%d)", DefaultContextBudget)
	}
	if cfg.MaxTokens > 0 {
		maxTokensSource = fmt.Sprintf("渠道配置(%d)", cfg.MaxTokens)
	} else if ctxLen := lookupModelContextLength(modelName); ctxLen > 0 {
		derived := ctxLen / 10
		if derived < DefaultOutputBudget {
			derived = DefaultOutputBudget
		}
		maxTokensSource = fmt.Sprintf("模型目录推导(%d)", derived)
	} else {
		maxTokensSource = fmt.Sprintf("默认(%d)", DefaultOutputBudget)
	}
	return
}

// ParseModelConfigs 解析渠道配置中所有模型的配置（供 adaptor 遍历使用）
func ParseModelConfigs(configJSON string) []ModelConfig {
	var models []ModelConfig
	if configJSON == "" {
		return nil
	}
	if err := json.Unmarshal([]byte(configJSON), &models); err != nil {
		return nil // 旧格式或错误，不返回 per-model 配置
	}
	return models
}

// ==================== 输入验证 ====================

// ValidateInput 验证输入 token，返回是否需要压缩
// contextLength <= 0 → 不限制；超过 → NeedCompact=true，绝不拦截
func ValidateInput(ctx context.Context, channelID int64, promptTokens int, contextLength int64) Result {
	if contextLength <= 0 {
		return Result{PromptTokens: promptTokens, ContextLength: contextLength}
	}
	if promptTokens <= int(contextLength) {
		return Result{PromptTokens: promptTokens, ContextLength: contextLength}
	}
	logger.Infof(ctx, "%s输入超过 context_length: 渠道ID=%d, promptTokens=%d, contextLength=%d, 将自动压缩",
		LogPrefix, channelID, promptTokens, contextLength)
	return Result{
		PromptTokens:  promptTokens,
		ContextLength: contextLength,
		NeedCompact:   true,
	}
}

// ==================== 消息压缩 ====================

// CompactMessages 执行消息压缩（参考 goclaw 机制）：
//  1. Pruning: 裁剪过长的 tool_result（纯文本，无需 LLM）
//  2. Compaction: 调 LLM 将前 70% 消息压缩成摘要（需注册 summarizeFn）
//
// summarizeFn 可以为 nil，此时只做 pruning。
// 任何步骤失败都保留原始 messages，不报错。
func CompactMessages(ctx context.Context, messages []relaymodel.Message,
	channel *model.Channel, modelName string,
	summarizeFnArg func(context.Context, *model.Channel, string, []relaymodel.Message) (string, error),
	estimatedTokens int, contextLength int64) ([]relaymodel.Message, int) {

	if channel == nil || len(messages) == 0 {
		return messages, estimatedTokens
	}

	// Step 1: Pruning — 裁剪过长 tool_result（永远成功，无需 LLM）
	pruned := pruneToolResults(messages)
	newTokens := estimateTokens(pruned)

	if contextLength > 0 && newTokens <= int(contextLength) {
		logger.Infof(ctx, "%s对话历史 tool_result 已裁剪: 压缩前=%d tokens, 压缩后=%d tokens",
			LogPrefix, estimatedTokens, newTokens)
		return pruned, newTokens
	}

	// Step 2: Compaction — 调 LLM 压缩对话（无 summarizeFn 或消息太少时跳过）
	if summarizeFnArg == nil || len(messages) < minMessagesCompact {
		if len(messages) < minMessagesCompact {
			logger.Infof(ctx, "%s跳过 LLM 摘要: 消息数=%d 小于阈值 %d，原始 tokens=%d",
				LogPrefix, len(messages), minMessagesCompact, estimatedTokens)
		}
		return pruned, newTokens
	}

	keepCount := len(messages) * keepRatio / 10
	if keepCount < minKeepMessages {
		keepCount = minKeepMessages
	}

	splitIdx := len(messages) - keepCount

	// 找安全切割点（不切在 tool_result 中间）
	for splitIdx > 0 {
		if messages[splitIdx].Role == "tool" {
			splitIdx--
			continue
		}
		break
	}
	if splitIdx <= 1 {
		logger.Infof(ctx, "%s跳过 LLM 摘要: 切割点 index=%d 太靠前，原始 tokens=%d",
			LogPrefix, splitIdx, estimatedTokens)
		return pruned, newTokens
	}

	summary, err := summarizeFnArg(ctx, channel, modelName, messages[:splitIdx])
	if err != nil {
		logger.Warnf(ctx, "%s对话压缩失败: err=%v", LogPrefix, err)
		return pruned, newTokens
	}

	summaryMsg := relaymodel.Message{
		Role:    "system",
		Content: "[对话摘要]\n" + summary,
	}
	result := make([]relaymodel.Message, 0, 1+keepCount)
	result = append(result, summaryMsg)
	result = append(result, messages[splitIdx:]...)

	resultTokens := estimateTokens(result)
	logger.Infof(ctx, "%s对话历史已压缩: 压缩前=%d tokens (%d 条消息), 压缩后=%d tokens (%d 条消息), 摘要: %s",
		LogPrefix, estimatedTokens, len(messages), resultTokens, len(result),
		truncateString(summary, 60))

	return result, resultTokens
}

// pruneToolResults 裁剪过长的 tool_result 消息
func pruneToolResults(messages []relaymodel.Message) []relaymodel.Message {
	if len(messages) == 0 {
		return messages
	}
	var modified bool
	result := make([]relaymodel.Message, len(messages))
	copy(result, messages)

	for i, m := range result {
		if m.Role != "tool" {
			continue
		}
		content, ok := m.Content.(string)
		if !ok || len([]rune(content)) <= maxToolContentLen {
			continue
		}
		runes := []rune(content)
		trimmed := string(runes[:compactHeadChars]) +
			fmt.Sprintf("\n...[已截断，原始 %d 字符]...\n", len(runes)) +
			string(runes[len(runes)-compactTailChars:])
		result[i] = relaymodel.Message{
			Role:       m.Role,
			Content:    trimmed,
			ToolCallId: m.ToolCallId,
		}
		modified = true
	}
	if !modified {
		return messages
	}
	return result
}

// ==================== 摘要提示词构建 ====================

// BuildCompactPrompt 构建压缩摘要的 system prompt
func BuildCompactPrompt(messages []relaymodel.Message) string {
	var sb strings.Builder
	for _, m := range messages {
		content, _ := m.Content.(string)
		role := m.Role
		if role == "" {
			role = "user"
		}
		sb.WriteString(fmt.Sprintf("%s: %s\n", role, content))
	}

	return fmt.Sprintf(`请用简洁的语言概括以下对话内容，用于 AI 恢复工作上下文。

必须保留：
- 当前进行中的任务及其状态
- 用户最后一次请求的内容
- 已经做出的决定
- 待办事项和未完成的工作

优先保留最近的上下文。

对话内容：
%s`, sb.String())
}

// DynamicSummaryMax 动态计算摘要输出 token 预算（输入 / 25，clamp [512, 4096]）
func DynamicSummaryMax(inputTokens int) int {
	out := inputTokens / 25
	if out < 512 {
		return 512
	}
	if out > 4096 {
		return 4096
	}
	return out
}

// ==================== Token 估算 ====================

// EstimateTokens 估算 message 的 token 数（rune/3 近似 + 每消息 4 token 开销）
func EstimateTokens(messages []relaymodel.Message) int {
	total := 0
	for _, m := range messages {
		content, ok := m.Content.(string)
		if ok {
			total += len([]rune(content)) / 3
		}
		total += 4
	}
	return total
}

// estimateTokens 包内简写
func estimateTokens(messages []relaymodel.Message) int {
	return EstimateTokens(messages)
}

// ==================== max_tokens 封顶 ====================

// ApplyMaxTokens 对 max_tokens 做封顶处理
// 规则：用户未设置时用配置值作为默认值；用户已设置时取 min(用户值, 配置值)
// configMaxTokens <= 0 时不做任何修改
func ApplyMaxTokens(ctx context.Context, channelID int64, request *relaymodel.GeneralOpenAIRequest, configMaxTokens int64) {
	if configMaxTokens <= 0 || request.MaxTokens <= 0 {
		return
	}
	if int64(request.MaxTokens) > configMaxTokens {
		original := request.MaxTokens
		request.MaxTokens = int(configMaxTokens)
		logger.Debugf(ctx, "%smax_tokens 封顶: 渠道ID=%d, 用户请求=%d, 配置上限=%d, 实际使用=%d",
			LogPrefix, channelID, original, configMaxTokens, request.MaxTokens)
	}
}

// ==================== Pipeline Budget ====================

const (
	// DefaultContextBudget 渠道无配置时的默认输入上下文字段（128K）
	DefaultContextBudget = 128000
	// DefaultOutputBudget 渠道无配置时的默认输出上限
	DefaultOutputBudget = 4096
)

// PipelineBudget pipeline 步骤的 token 预算
type PipelineBudget struct {
	InputAvailable int // 可用输入预算（三保险后）
	OutputLimit    int // 输出上限
}

// ComputeBudget 计算三保险后的输入预算和输出上限：
//
//	effectiveInput = min(channel.context_length × 80%, stepMaxInput, 128000)
//	InputAvailable = effectiveInput - systemTokens - OutputLimit
//	OutputLimit   = min(cfg.MaxTokens(>0) 或 max(4096, model_context/10), requestedOutput)
//
//	stepMaxInput=0 时表示不限。
//	如果 InputAvailable <= 0，返回 1000 兜底并打 Warn 日志。
//
//	model_context 来源优先级：渠道配置 > 模型目录 > DefaultContextBudget(128000)
func ComputeBudget(ctx context.Context, channelID int64, configJSON string, modelName string, systemTokens, requestedOutput, stepMaxInput int) PipelineBudget {
	cfg := ParseConfig(ctx, channelID, configJSON, modelName)
	modelCtx := lookupModelContextLength(modelName)

	// 输出上限
	outputLimit := DefaultOutputBudget
	if cfg.MaxTokens > 0 {
		outputLimit = int(cfg.MaxTokens)
	} else if modelCtx > 0 {
		// 渠道未配置 max_tokens 时，从模型上下文推导：modelCtx/10，保底 DefaultOutputBudget
		derived := modelCtx / 10
		if derived > DefaultOutputBudget {
			outputLimit = derived
		}
	}
	if requestedOutput > 0 && requestedOutput < outputLimit {
		outputLimit = requestedOutput
	}

	// 输入预算
	inputRaw := int64(DefaultContextBudget)
	if cfg.ContextLength > 0 {
		inputRaw = cfg.ContextLength
	} else if modelCtx > 0 {
		inputRaw = int64(modelCtx)
	}
	after80 := int(float64(inputRaw) * 0.8)

	effective := after80
	if stepMaxInput > 0 && stepMaxInput < effective {
		effective = stepMaxInput
	}
	if DefaultContextBudget < effective {
		effective = DefaultContextBudget
	}

	inputAvailable := effective - systemTokens - outputLimit
	if inputAvailable <= 0 {
		inputAvailable = 1000
		logger.Warnf(ctx, "%spipeline budget 预算不足: channelID=%d, inputRaw=%d, 80%%=%d, stepMax=%d, system=%d, output=%d, 已兜底到 1000",
			LogPrefix, channelID, inputRaw, after80, stepMaxInput, systemTokens, outputLimit)
	}

	logger.Debugf(ctx, "%spipeline budget: 渠道ID=%d, context_length=%d, 80%%=%d, step_limit=%d, effective_input=%d, output_limit=%d",
		LogPrefix, channelID, inputRaw, after80, stepMaxInput, effective, outputLimit)

	return PipelineBudget{
		InputAvailable: inputAvailable,
		OutputLimit:    outputLimit,
	}
}

// TruncateContent 将内容截断到指定 token 预算内（保留开头，从末尾截断）
// budget <= 0 返回空字符串
func TruncateContent(content string, budget int) string {
	if budget <= 0 {
		return ""
	}
	// rune/3 粗略估算 token 数，保持与 EstimateTokens 一致
	estimatedTokens := len([]rune(content)) / 3
	if estimatedTokens <= budget {
		return content
	}
	// 保留预算对应的 rune 数，注意 role 开销
	maxRunes := budget * 3
	runes := []rune(content)
	if maxRunes >= len(runes) {
		return content
	}
	truncated := string(runes[:maxRunes])
	return truncated + fmt.Sprintf("\n...[内容已截断，原始 %d tokens，当前 %d tokens]...", estimatedTokens, budget)
}

// truncateString 截断字符串到指定长度（用于日志输出）
func truncateString(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}
