package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"

	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/singleflight"
	"gorm.io/gorm"
)

// ============================================================
// 常量与结构体
// ============================================================

const compressPromptPolicyVersion = "v1"

// compressTranscriptStrictPrompt 严格保真模式 Prompt（纪要、洞察）
const compressTranscriptStrictPrompt = `你是精确的会议转写文本压缩器。对以下转写文本进行高保真压缩--只删除明确无意义的冗余，绝不添加、修改或概括任何内容。

## 核心原则
1. 只删不增：只能删除文字，绝不能添加、改写或替换任何词。
2. 保守删除：只删除明确无意义的内容。不确定时，保留。
3. 不改变表述：不能改变用词、数字、人名、表述方式。

## 可删除内容（仅以下类别）
1. 单独成句的纯语气词：嗯、呃、啊（仅当独立出现或位于句首时删除）
2. 连续完全相同的重复：同一句话连续出现 2 次以上的，只保留 1 次
3. 连续空白和格式噪声

## 不可删除
1. 所有数字、金额、日期、时间、版本号
2. 所有人名、角色名、专有名词
3. 所有决策、结论、观点、分歧
4. 所有因果关系、条件关系、时间顺序
5. 所有行动项、责任人、截止时间
6. "这个/那个/然后/就是/其实/好的/收到/明白"等词--可能承载决策含义
7. 自我修正（"不对，我是说…"）--反映决策者真实思考过程
8. 确认性回应（"好的""明白"）--可能代表任务接受

## 输出要求
- 仅输出纯文本，无任何格式标记
- 不要添加标题、编号、列表符号、JSON、Markdown
- 保持原始段落顺序和时间顺序
- 原始文本可能包含语音识别错误，保留原文，不要自行纠正`

// compressTranscriptBalancedPrompt 平衡压缩模式 Prompt（模板总结）
const compressTranscriptBalancedPrompt = `你是会议转写文本压缩器。对以下转写文本进行压缩--删除冗余信息，保留全部事实和语义。

## 核心原则
1. 只删不增：只能删除文字，绝不能添加、改写或替换任何词。
2. 事实零丢失：所有事实性信息必须保留。不确定时，保留。
3. 不改变表述：不能改变用词、数字、人名、表述方式。

## 可删除内容
1. 单独成句的纯语气词：嗯、呃、啊
2. 连续完全相同的重复
3. 寒暄客套：大家好、辛苦大家、谢谢各位（仅在话轮开头出现时）
4. 明确离题的闲聊：与会议主题完全无关的讨论
5. 自我修正痕迹：只保留修正后的最终版本
6. 连续空白和格式噪声

## 不可删除
1. 所有数字、金额、日期、时间、版本号
2. 所有人名、角色名、专有名词
3. 所有决策、结论、观点、分歧
4. 所有因果关系、条件关系、时间顺序
5. 所有行动项、责任人、截止时间
6. "这个/那个/然后/就是/其实"等词--可能承载语义
7. 所有条件和约束、引用和依据

## 输出要求
- 仅输出纯文本，无任何格式标记
- 不要添加标题、编号、列表符号、JSON、Markdown
- 保持原始段落顺序和时间顺序
- 原始文本可能包含语音识别错误，保留原文，不要自行纠正`

// compressTranscriptSemanticPrompt 语义压缩 Prompt（per-segment 兜底）
const compressTranscriptSemanticPrompt = `你是会议转写语义压缩器。

当前转写经过高保真压缩后仍然超过模型输入预算。请对以下转写分片进行语义压缩--在不超过指定长度的前提下，将内容重新整理为信息密度更高的文本。

允许：
- 合并重复表达
- 改写和归纳原文
- 删除无实质信息的过程性内容

必须保留：
1. 所有重要事实、数字、金额、日期和时间
2. 所有人名、角色、客户名、项目名和专有名词
3. 所有明确决定和结论
4. 所有主要观点，包括反对意见和未达成一致的分歧
5. 所有决策原因、条件、约束和风险
6. 所有行动项、责任人和截止时间
7. 所有尚未解决的问题

不得：
- 将建议写成决定
- 将个人观点写成会议共识
- 删除少数人的反对意见
- 修改数字、人名和时间
- 添加原文不存在的事实

仅输出压缩后的纯文本，不要输出解释、标题、JSON 或 Markdown。`

// TranscriptPrepareRequest 转写预处理请求参数
type TranscriptPrepareRequest struct {
	EID                int64
	FileID             int64
	Consumer           string // "meeting_minutes" | "insights" | "template_summary"
	ContextLength      int    // 模型 context_length
	FixedInputTokens   int    // 非转写输入的 token 数
	MaxOutputTokens    int    // 为 LLM 输出预留的 token 数
	SafetyMargin       int    // 安全余量（建议 500）
	Mode               string // "strict" | "balanced"
	RawText            string // optional: 如果非空，跳过 DB 查询
	InferenceModelID   int64  // optional: 如果非 0，跳过 DB 查询配置
	InferenceModelName string // optional: 配合 InferenceModelID 使用
}

// PreparedTranscript 压缩后的转写文本及元数据
type PreparedTranscript struct {
	Text              string
	SourceHash        string // SHA256(canonicalText)
	SourceTokens      int
	ResultTokens      int
	CacheHit          bool
	CompressionRounds int
	InputKind         string // "original" | "extractive_compressed" | "semantic_compressed"
	Degraded          bool   // true 表示经过了语义压缩兜底
}

// compressionConfig 压缩流程的内部配置
type compressionConfig struct {
	ContextLength      int
	Mode               string
	InferenceModelID   int64
	InferenceModelName string
}

// ============================================================
// 3.1 canonicalizeTranscript - 确定性格式规范化
// ============================================================

// canonicalizeTranscript 对转写文本进行确定性格式规范化：
// - 合并连续空白为单个空格
// - 统一换行符 \r\n -> \n
// - 移除不可打印字符
// - 去除每行首尾空白
// - 保留段落结构（\n\n 边界）
func canonicalizeTranscript(text string) string {
	if text == "" {
		return ""
	}

	// 1. 统一换行符
	text = strings.ReplaceAll(text, "\r\n", "\n")

	// 2. 移除不可打印字符（保留 \n, \t, 空格和可见字符）
	var b strings.Builder
	b.Grow(len(text))
	for _, r := range text {
		if r == '\n' || r == '\t' || r == ' ' || unicode.IsPrint(r) {
			b.WriteRune(r)
		}
	}
	text = b.String()

	// 3. 按行处理：去除每行首尾空白，合并连续空白
	lines := strings.Split(text, "\n")
	var resultLines []string
	for _, line := range lines {
		// 合并连续空白为单个空格
		trimmed := strings.TrimSpace(line)
		// 合并连续空白
		trimmed = mergeWhitespace(trimmed)
		resultLines = append(resultLines, trimmed)
	}

	// 4. 合并连续空白行（保留段落边界）
	var result strings.Builder
	prevEmpty := false
	for i, line := range resultLines {
		if line == "" {
			if !prevEmpty {
				if i > 0 {
					result.WriteString("\n")
				}
				prevEmpty = true
			}
			continue
		}
		if prevEmpty || i > 0 {
			// 如果前一行是空行，加上空行（段落边界）
			if prevEmpty {
				result.WriteString("\n")
			} else {
				result.WriteString("\n")
			}
		}
		result.WriteString(line)
		prevEmpty = false
	}

	return strings.TrimSpace(result.String())
}

// mergeWhitespace 合并连续空白为单个空格
func mergeWhitespace(s string) string {
	if s == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range s {
		if r == ' ' || r == '\t' {
			if !prevSpace {
				b.WriteRune(' ')
				prevSpace = true
			}
		} else {
			b.WriteRune(r)
			prevSpace = false
		}
	}
	return b.String()
}

// ============================================================
// 3.2 preCompressTranscript - 预压缩（严格规则去冗余）
// ============================================================

// preCompressTranscript 对转写文本进行预压缩，无 LLM 调用：
// - 删除单独成句的纯语气词：嗯、呃、啊（仅当独立出现或位于句首时删除）
// - 删除连续完全相同的重复句（只保留 1 次）
// - 删除连续重复的 ASR 片段
// - 清理多余空白和格式噪声
func preCompressTranscript(text string) string {
	if text == "" {
		return ""
	}

	lines := strings.Split(text, "\n")
	var result []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			result = append(result, line)
			continue
		}

		// 删除单独成句的纯语气词
		trimmed = removeStandaloneFiller(trimmed)

		// 跳过空行（语气词删除后可能为空）
		if trimmed == "" {
			continue
		}

		result = append(result, trimmed)
	}

	// 删除连续完全相同的重复行（只保留 1 次）
	result = removeConsecutiveDuplicates(result)

	// 合并结果
	text = strings.Join(result, "\n")

	// 清理多余空白
	text = canonicalizeTranscript(text)

	return text
}

// removeStandaloneFiller 删除单独成句的纯语气词
func removeStandaloneFiller(line string) string {
	// 检查是否整个行就是语气词
	fillers := []string{"嗯", "呃", "啊"}
	trimmed := strings.TrimSpace(line)
	for _, f := range fillers {
		if trimmed == f {
			return ""
		}
		// 句首语气词（语气词后跟标点或空格）
		if strings.HasPrefix(trimmed, f) {
			rest := strings.TrimPrefix(trimmed, f)
			if rest == "" || strings.HasPrefix(rest, "，") || strings.HasPrefix(rest, "。") || strings.HasPrefix(rest, "！") || strings.HasPrefix(rest, "？") || strings.HasPrefix(rest, "、") {
				// 删除语气词，保留后续内容
				trimmed = strings.TrimSpace(rest)
				// 递归检查是否还有语气词
				return removeStandaloneFiller(trimmed)
			}
		}
	}
	return trimmed
}

// removeConsecutiveDuplicates 删除连续完全相同的行（只保留 1 次）
func removeConsecutiveDuplicates(lines []string) []string {
	if len(lines) <= 1 {
		return lines
	}
	var result []string
	prev := ""
	for _, line := range lines {
		curr := strings.TrimSpace(line)
		if curr != "" && curr == strings.TrimSpace(prev) {
			// 跳过连续重复行
			continue
		}
		result = append(result, line)
		prev = line
	}
	return result
}

// ============================================================
// 3.3 estimateTokens - token 估算
// ============================================================

// estimateTokens 估算字符串的 token 数（保守估算：rune * 0.75）
func estimateTokens(text string) int {
	return int(float64(len([]rune(text))) * 0.75)
}

// ============================================================
// 3.4 isOrderedSubsequence - 有序子序列检查
// ============================================================

// isOrderedSubsequence 检查 output 是否是 input 的有序子序列（rune 级别）。
// 大小写不敏感，空白归一化。
func isOrderedSubsequence(output, input string) bool {
	if output == "" {
		return true
	}
	if input == "" {
		return false
	}

	output = strings.ToLower(output)
	input = strings.ToLower(input)

	// 空白归一化：将多个空格/制表符合并为单个空格
	output = normalizeWhitespace(output)
	input = normalizeWhitespace(input)

	outputRunes := []rune(output)
	inputRunes := []rune(input)

	oi := 0
	for _, ir := range inputRunes {
		if oi < len(outputRunes) && outputRunes[oi] == ir {
			oi++
		}
	}

	return oi == len(outputRunes)
}

// normalizeWhitespace 将连续空白字符归一化为单个空格
func normalizeWhitespace(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			if !prevSpace {
				b.WriteRune(' ')
				prevSpace = true
			}
		} else {
			b.WriteRune(r)
			prevSpace = false
		}
	}
	return strings.TrimSpace(b.String())
}

// ============================================================
// 3.5 validateKeyFields - 关键字段验证
// ============================================================

// speakerLabelPattern 匹配发言者标签，如 "张三:" 或 "Speaker 1:"
var speakerLabelPattern = regexp.MustCompile(`[\p{Han}]{2,4}\s*:|Speaker\s*\d+\s*:`)

// digitPattern 匹配数字序列（含小数点、万等单位）
var digitPattern = regexp.MustCompile(`\d+\.?\d*万?`)

// validateKeyFields 验证 output 是否保留了 input 中的所有关键字段：
// - 数字序列（含小数点、万等单位）
// - 否定词（不/没/无/非/否）
// - 发言者标签
func validateKeyFields(output, input string) bool {
	if output == "" && input == "" {
		return true
	}

	// 验证数字
	inputDigits := digitPattern.FindAllString(input, -1)
	outputDigits := digitPattern.FindAllString(output, -1)
	if len(outputDigits) < len(inputDigits) {
		return false
	}

	// 验证否定词
	negationWords := []string{"不", "没", "无", "非", "否"}
	inputNegationCount := countSubstrings(input, negationWords)
	outputNegationCount := countSubstrings(output, negationWords)
	if outputNegationCount < inputNegationCount {
		return false
	}

	// 验证发言者标签
	inputLabels := speakerLabelPattern.FindAllString(input, -1)
	outputLabels := speakerLabelPattern.FindAllString(output, -1)
	if len(outputLabels) < len(inputLabels) {
		return false
	}

	return true
}

// countSubstrings 计算字符串中所有子串的出现次数之和
func countSubstrings(s string, subs []string) int {
	count := 0
	for _, sub := range subs {
		count += strings.Count(s, sub)
	}
	return count
}

// ============================================================
// 3.6 isFatalError - 致命错误判断
// ============================================================

// isFatalError 判断错误是否为致命错误（401/403/模型不存在/渠道不可用）
func isFatalError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "http_code=401") ||
		strings.Contains(msg, "http_code=403") ||
		strings.Contains(msg, "model not found") ||
		strings.Contains(msg, "channel unavailable") ||
		strings.Contains(msg, "模型不存在") ||
		strings.Contains(msg, "渠道不可用") {
		return true
	}
	return false
}

// ============================================================
// 3.7 isContextTooLongError - 上下文过长错误判断
// ============================================================

// isContextTooLongError 判断错误是否为 context length 超限
func isContextTooLongError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "http_code=413") {
		return true
	}
	if strings.Contains(msg, "http_code=400") && (strings.Contains(msg, "context length") || strings.Contains(msg, "context_length")) {
		return true
	}
	return false
}

// ============================================================
// 3.9 compressTranscriptSegment - 压缩单个分片
// ============================================================

// compressTranscriptSegment 压缩单个分片，含输出验证。
// 返回压缩后的文本。如果验证失败或非致命错误，返回原 segment。
// 如果致命错误，返回 error。
func compressTranscriptSegment(ctx context.Context, config *model.RecordingConfig, segment string, mode string) (string, error) {
	if segment == "" {
		return "", nil
	}

	var prompt string
	switch mode {
	case "strict":
		prompt = compressTranscriptStrictPrompt
	case "balanced":
		prompt = compressTranscriptBalancedPrompt
	default:
		prompt = compressTranscriptStrictPrompt
	}

	userPrompt := fmt.Sprintf("<transcript_segment>\n%s\n</transcript_segment>", segment)

	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		return &relaymodel.GeneralOpenAIRequest{
			Model: config.InferenceModelName,
			Messages: []relaymodel.Message{
				{Role: "system", Content: prompt},
				{Role: "user", Content: userPrompt},
			},
		}
	}

	result, err := callLLMWithRetry(ctx, config, buildRequest)
	if err != nil {
		if isFatalError(err) {
			return "", err
		}
		// context length 超限：该片保留原文，由下一轮递减分片处理
		if isContextTooLongError(err) {
			return segment, nil
		}
		// 其他非致命错误：保留原文
		return segment, nil
	}

	result = strings.TrimSpace(result)
	if result == "" {
		return segment, nil
	}

	// 输出验证
	if !isOrderedSubsequence(result, segment) {
		return segment, nil
	}
	if !validateKeyFields(result, segment) {
		return segment, nil
	}

	return result, nil
}

// ============================================================
// 3.10 compressTranscriptExtractive - 高保真迭代压缩
// ============================================================

// compressTranscriptExtractive 执行高保真迭代压缩（最多 3 轮）。
// 不重压已压缩分片：Round 1 后跟踪每片压缩率，后续轮次仅重压压缩不足的分片（ratio > 0.7）。
// 返回 (compressedText, roundsCompleted, error)
func compressTranscriptExtractive(ctx context.Context, config *compressionConfig, text string, targetTokens int) (string, int, error) {
	if text == "" {
		return "", 0, nil
	}

	// 计算压缩 prompt 的 token 数
	prompt := compressTranscriptStrictPrompt
	if config.Mode == "balanced" {
		prompt = compressTranscriptBalancedPrompt
	}
	compressionPromptTokens := estimateTokens(prompt)

	// 初始分片大小
	segmentMaxTokens := (config.ContextLength - compressionPromptTokens - 100 - 500) / 2
	segmentMaxChars := int(float64(segmentMaxTokens) / 0.75)

	currentText := text
	maxConcurrency := 5

	// 跨轮次跟踪分片压缩结果，实现"不重压已压缩分片"
	type chunkResult struct {
		original   string
		compressed string
		ratio      float64 // compressed/original
	}
	var roundChunks [][]chunkResult // roundChunks[round-1] = 该轮的分片结果
	var prevRoundStartTokens int    // 上一轮开始前的 token 数，用于进展检查

	for round := 1; round <= 3; round++ {
		maxChars := int(float64(segmentMaxChars) * []float64{1.0, 0.8, 0.6}[round-1])
		if maxChars < 100 {
			maxChars = 100
		}

		// 检查是否已达标
		beforeTokens := estimateTokens(currentText)
		if beforeTokens <= targetTokens {
			return currentText, round - 1, nil
		}

		// Round 2+ 进展检查：比较上一轮开始前 vs 本轮开始前
		if round > 1 && prevRoundStartTokens > 0 {
			reduction := float64(prevRoundStartTokens-beforeTokens) / float64(prevRoundStartTokens) * 100
			if reduction < 10 {
				return currentText, round - 1, nil
			}
		}
		prevRoundStartTokens = beforeTokens

		// Round 1: 分片并压缩全部
		// Round 2+: 复用上一轮的分片，仅重压 ratio > 0.7 的分片
		var chunks []string
		var prevResults []chunkResult

		if round == 1 {
			chunks = chunkTranscript(currentText, maxChars)
			if len(chunks) <= 1 {
				return currentText, 0, nil
			}
		} else {
			// 复用上一轮的分片，仅重压压缩不足的
			prevResults = roundChunks[len(roundChunks)-1]
			chunks = make([]string, len(prevResults))
			for i, pr := range prevResults {
				chunks[i] = pr.compressed
			}
		}

		compressed := make([]string, len(chunks))
		results := make([]chunkResult, len(chunks))

		g, gCtx := errgroup.WithContext(ctx)
		g.SetLimit(maxConcurrency)

		for i, chunk := range chunks {
			i, chunk := i, chunk
			originalTokens := estimateTokens(chunk)

			g.Go(func() error {
				// Round 2+：跳过已充分压缩的分片
				if round > 1 && i < len(prevResults) {
					if prevResults[i].ratio <= 0.7 {
						compressed[i] = prevResults[i].compressed
						results[i] = chunkResult{
							original:   prevResults[i].original,
							compressed: prevResults[i].compressed,
							ratio:      prevResults[i].ratio,
						}
						return nil
					}
				}

				select {
				case <-gCtx.Done():
					return gCtx.Err()
				default:
				}

				actualCfg := &model.RecordingConfig{
					InferenceModelID:   config.InferenceModelID,
					InferenceModelName: config.InferenceModelName,
				}

				var compressErr error
				compressed[i], compressErr = compressTranscriptSegment(gCtx, actualCfg, chunk, config.Mode)
				if compressErr != nil {
					if isFatalError(compressErr) {
						return compressErr
					}
					compressed[i] = chunk
				}

				compressedTokens := estimateTokens(compressed[i])
				ratio := float64(1.0)
				if originalTokens > 0 {
					ratio = float64(compressedTokens) / float64(originalTokens)
				}
				results[i] = chunkResult{
					original:   chunk,
					compressed: compressed[i],
					ratio:      ratio,
				}
				return nil
			})
		}

		if err := g.Wait(); err != nil {
			return currentText, round - 1, err
		}

		// 拼接结果
		var b strings.Builder
		for _, c := range compressed {
			b.WriteString(c)
			b.WriteString("\n\n")
		}
		currentText = strings.TrimSpace(b.String())

		// 保存本轮结果供下轮使用
		roundChunks = append(roundChunks, results)

		afterTokens := estimateTokens(currentText)
		if afterTokens <= targetTokens {
			return currentText, round, nil
		}

		// 如果所有分片都已充分压缩，提前退出
		if round > 1 || len(chunks) <= 1 {
			allCompressed := true
			for _, r := range results {
				if r.ratio > 0.7 {
					allCompressed = false
					break
				}
			}
			if allCompressed {
				return currentText, round, nil
			}
		}
	}

	return currentText, 3, nil
}

// ============================================================
// 3.11 compressTranscriptSemantic - 语义压缩兜底
// ============================================================

// compressTranscriptSemantic 执行语义压缩兜底（分片执行，每片按比例分配目标预算）。
// 不验证有序子序列（语义压缩允许改写）。
func compressTranscriptSemantic(ctx context.Context, config *compressionConfig, text string, targetTokens int) (string, error) {
	if text == "" {
		return "", nil
	}

	// 计算压缩 prompt 的 token 数
	compressionPromptTokens := estimateTokens(compressTranscriptSemanticPrompt)

	// 分片大小
	segmentMaxTokens := (config.ContextLength - compressionPromptTokens - 100 - 500) / 2
	segmentMaxChars := int(float64(segmentMaxTokens) / 0.75)
	if segmentMaxChars < 100 {
		segmentMaxChars = 100
	}

	// 重新分片（不重用 extractive 的分片）
	chunks := chunkTranscript(text, segmentMaxChars)
	if len(chunks) == 0 {
		return "", nil
	}

	totalTokens := estimateTokens(text)
	if totalTokens <= 0 {
		return text, nil
	}

	maxConcurrency := 5
	results := make([]string, len(chunks))
	g, gCtx := errgroup.WithContext(ctx)
	g.SetLimit(maxConcurrency)

	for i, chunk := range chunks {
		i, chunk := i, chunk
		chunkTokens := estimateTokens(chunk)

		// 每片分配目标输出预算（按比例，预留 10% 防溢出）
		chunkTargetTokens := int(float64(targetTokens) * float64(chunkTokens) / float64(totalTokens) * 0.9)
		if chunkTargetTokens < 50 {
			chunkTargetTokens = 50
		}

		g.Go(func() error {
			select {
			case <-gCtx.Done():
				return gCtx.Err()
			default:
			}

			actualCfg := &model.RecordingConfig{
				InferenceModelID:   config.InferenceModelID,
				InferenceModelName: config.InferenceModelName,
			}

			userPrompt := fmt.Sprintf("目标长度：不超过 %d tokens。\n\n<transcript_segment>\n%s\n</transcript_segment>", chunkTargetTokens, chunk)
			buildRequest := func() *relaymodel.GeneralOpenAIRequest {
				return &relaymodel.GeneralOpenAIRequest{
					Model: config.InferenceModelName,
					Messages: []relaymodel.Message{
						{Role: "system", Content: compressTranscriptSemanticPrompt},
						{Role: "user", Content: userPrompt},
					},
				}
			}

			result, err := callLLMWithRetry(gCtx, actualCfg, buildRequest)
			if err != nil {
				if isFatalError(err) {
					return err
				}
				results[i] = chunk
				return nil
			}

			result = strings.TrimSpace(result)
			if result == "" {
				results[i] = chunk
				return nil
			}

			// 输出长度检查：如果压缩后反而更长，保留原文
			if len([]rune(result)) >= len([]rune(chunk)) {
				results[i] = chunk
				return nil
			}

			results[i] = result
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return text, err
	}

	// 拼接结果
	var b strings.Builder
	for _, r := range results {
		b.WriteString(r)
		b.WriteString("\n\n")
	}
	return strings.TrimSpace(b.String()), nil
}

// ============================================================
// 3.12 prepareTranscript - 降级链路编排
// ============================================================

// prepareTranscript 执行降级链路：原文检查 -> 预压缩 -> 高保真提取式压缩 -> 语义压缩兜底
func prepareTranscript(ctx context.Context, req TranscriptPrepareRequest, canonicalText string, sourceHash string, sourceTokens int, inferenceModelID int64, inferenceModelName string) (PreparedTranscript, error) {
	targetTokens := req.ContextLength - req.FixedInputTokens - req.MaxOutputTokens - req.SafetyMargin
	if targetTokens < 100 {
		targetTokens = 100
	}

	// 1. 原文适配
	if sourceTokens <= targetTokens {
		return PreparedTranscript{
			Text:              canonicalText,
			SourceHash:        sourceHash,
			SourceTokens:      sourceTokens,
			ResultTokens:      sourceTokens,
			CacheHit:          false,
			CompressionRounds: 0,
			InputKind:         "original",
			Degraded:          false,
		}, nil
	}

	// 2. 预压缩（结果必须通过有序子序列验证，不通过则跳过）
	preCompressed := preCompressTranscript(canonicalText)
	preCompressedValid := isOrderedSubsequence(preCompressed, canonicalText)
	if !preCompressedValid {
		preCompressed = canonicalText
	}
	preTokens := estimateTokens(preCompressed)
	if preTokens <= targetTokens && preCompressedValid {
		return PreparedTranscript{
			Text:              preCompressed,
			SourceHash:        sourceHash,
			SourceTokens:      sourceTokens,
			ResultTokens:      preTokens,
			CacheHit:          false,
			CompressionRounds: 0,
			InputKind:         "extractive_compressed",
			Degraded:          false,
		}, nil
	}

	// 3. 高保真提取式压缩（安心录跳过此步骤，保留代码供恢复参考）
	cfg := &compressionConfig{
		ContextLength:      req.ContextLength,
		Mode:               req.Mode,
		InferenceModelID:   inferenceModelID,
		InferenceModelName: inferenceModelName,
	}

	// extractiveText, rounds, err := compressTranscriptExtractive(ctx, cfg, preCompressed, targetTokens)
	// if err != nil && isFatalError(err) {
	// 	return PreparedTranscript{}, err
	// }
	// extractiveTokens := estimateTokens(extractiveText)
	// if extractiveTokens <= targetTokens {
	// 	return PreparedTranscript{
	// 		Text:              extractiveText,
	// 		SourceHash:        sourceHash,
	// 		SourceTokens:      sourceTokens,
	// 		ResultTokens:      extractiveTokens,
	// 		CacheHit:          false,
	// 		CompressionRounds: rounds,
	// 		InputKind:         "extractive_compressed",
	// 		Degraded:          false,
	// 	}, nil
	// }
	extractiveText := preCompressed
	rounds := 0

	// 4. 语义压缩兜底
	textForSemantic := extractiveText
	if textForSemantic == "" {
		textForSemantic = preCompressed
	}

	semanticText, err := compressTranscriptSemantic(ctx, cfg, textForSemantic, targetTokens)
	if err != nil {
		return PreparedTranscript{}, fmt.Errorf("语义压缩失败: %w", err)
	}

	semanticTokens := estimateTokens(semanticText)
	if semanticTokens > targetTokens {
		return PreparedTranscript{}, fmt.Errorf("语义压缩后仍超出预算")
	}

	return PreparedTranscript{
		Text:              semanticText,
		SourceHash:        sourceHash,
		SourceTokens:      sourceTokens,
		ResultTokens:      semanticTokens,
		CacheHit:          false,
		CompressionRounds: rounds,
		InputKind:         "semantic_compressed",
		Degraded:          true,
	}, nil
}

// ============================================================
// 3.13 loadCompressedTranscript - 从缓存读取压缩转写
// ============================================================

// loadCompressedTranscript 从 recording_file_summaries(template_id=-2) 读取压缩转写缓存。
// 执行 6 项验证：sourceHash, targetBucket, policyVersion, compressionType, modelID, token 复核
func loadCompressedTranscript(fileID int64, sourceHashShort string, targetBucket int, policyVersion string, compressionType string, modelID int64, targetTokens int) (string, bool, error) {
	summary, err := model.GetSummaryByTemplateID(fileID, -2)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("读取压缩缓存失败: %w", err)
	}
	if summary == nil {
		return "", false, nil
	}

	// 解析 template_name：压缩转写_{hash8}_{bucket}_{policyVersion}_{compressionType}
	// parts[0]=压缩转写, parts[1]=hash8, parts[2]=bucket, parts[3]=version, parts[4]=type
	templateName := summary.TemplateName
	parts := strings.Split(templateName, "_")
	if len(parts) < 5 {
		return "", false, nil
	}

	cachedHash := parts[1]
	cachedBucket := parts[2]
	cachedVersion := parts[3]
	cachedType := parts[4]

	// 1. sourceHash 验证
	if cachedHash != sourceHashShort {
		return "", false, nil
	}

	// 2. targetBucket 验证
	bucketStr := fmt.Sprintf("%d", targetBucket)
	if cachedBucket != bucketStr {
		return "", false, nil
	}

	// 3. policyVersion 验证
	if cachedVersion != policyVersion {
		return "", false, nil
	}

	// 4. compressionType 验证
	if cachedType != compressionType {
		return "", false, nil
	}

	// 5. compressorModel 验证
	if summary.InferenceModelID != modelID {
		return "", false, nil
	}

	// 6. token 复核
	content := string(summary.SummaryContent)
	if estimateTokens(content) > targetTokens {
		return "", false, nil
	}

	return content, true, nil
}

// ============================================================
// 3.14 storeCompressedTranscript - 缓存压缩转写
// ============================================================

// storeCompressedTranscript 将压缩后的转写缓存到 recording_file_summaries(template_id=-2)
func storeCompressedTranscript(fileID int64, sourceHashShort string, targetBucket int, policyVersion string, compressionType string, modelID int64, content string) error {
	templateName := fmt.Sprintf("压缩转写_%s_%d_%s_%s", sourceHashShort, targetBucket, policyVersion, compressionType)

	summary := &model.RecordingFileSummary{
		FileID:           fileID,
		TemplateID:       -2,
		TemplateName:     templateName,
		InferenceModelID: modelID,
		SummaryContent:   model.LongText(content),
	}

	// 事务：先删后插
	return model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("file_id = ? AND template_id = ?", fileID, -2).Delete(&model.RecordingFileSummary{}).Error; err != nil {
			return err
		}
		return tx.Create(summary).Error
	})
}

// ============================================================
// 3.15 getOrCompressTranscript - 统一入口
// ============================================================

// singleflightGroup 用于避免并发重复压缩
var singleflightGroup singleflight.Group

// singleflightKey 生成 singleflight 去重 key
func singleflightKey(fileID int64, sourceHashShort string, targetBucket int, mode string, modelID int64, policyVersion string) string {
	return fmt.Sprintf("%d:%s:%d:%s:%d:%s", fileID, sourceHashShort, targetBucket, mode, modelID, policyVersion)
}

// getOrCompressTranscript 是所有 LLM 消费者的统一入口。
// 流程：加载 -> 规范化 -> 查缓存 -> 压缩 -> 存缓存
func getOrCompressTranscript(ctx context.Context, req TranscriptPrepareRequest) (PreparedTranscript, error) {
	// 1. 加载转写文本
	var transcriptText string
	if req.RawText != "" {
		// 使用提供的原始文本
		transcriptText = extractTranscriptFromJSON(req.RawText)
		if transcriptText == "" {
			transcriptText = req.RawText
		}
	} else {
		var err error
		transcriptText, err = loadTranscriptText(ctx, req.EID, req.FileID)
		if err != nil {
			return PreparedTranscript{}, fmt.Errorf("读取转写文本失败: %w", err)
		}
	}

	if transcriptText == "" {
		return PreparedTranscript{}, fmt.Errorf("转写文本为空")
	}

	// 2. 规范化
	canonicalText := canonicalizeTranscript(transcriptText)
	hash := sha256.Sum256([]byte(canonicalText))
	sourceHash := fmt.Sprintf("%x", hash)
	sourceHashShort := sourceHash[:8]
	sourceTokens := estimateTokens(canonicalText)

	targetTokens := req.ContextLength - req.FixedInputTokens - req.MaxOutputTokens - req.SafetyMargin
	if targetTokens < 100 {
		targetTokens = 100
	}

	// 3. 原文适配
	if sourceTokens <= targetTokens {
		return PreparedTranscript{
			Text:              canonicalText,
			SourceHash:        sourceHash,
			SourceTokens:      sourceTokens,
			ResultTokens:      sourceTokens,
			CacheHit:          false,
			CompressionRounds: 0,
			InputKind:         "original",
			Degraded:          false,
		}, nil
	}

	// 4. 获取模型配置（优先使用请求中传入的，否则查询 DB）
	var inferenceModelID int64
	var inferenceModelName string
	if req.InferenceModelID != 0 {
		inferenceModelID = req.InferenceModelID
		inferenceModelName = req.InferenceModelName
	} else {
		dbConfig, dbErr := model.ValidateOrCreateRecordingConfig(req.EID)
		if dbErr != nil {
			return PreparedTranscript{}, fmt.Errorf("获取录音配置失败: %w", dbErr)
		}
		inferenceModelID = dbConfig.InferenceModelID
		inferenceModelName = dbConfig.InferenceModelName
	}

	// 5. 查缓存
	compressionType := "extractive"
	targetBucket := computeTargetBucket(targetTokens)

	cached, ok, cacheErr := loadCompressedTranscript(req.FileID, sourceHashShort, targetBucket, compressPromptPolicyVersion, compressionType, inferenceModelID, targetTokens)
	if cacheErr != nil {
		return PreparedTranscript{}, fmt.Errorf("缓存读取失败: %w", cacheErr)
	}
	if ok {
		canonicalCached := canonicalizeTranscript(cached)
		return PreparedTranscript{
			Text:              canonicalCached,
			SourceHash:        sourceHash,
			SourceTokens:      sourceTokens,
			ResultTokens:      estimateTokens(canonicalCached),
			CacheHit:          true,
			CompressionRounds: 0,
			InputKind:         "extractive_compressed",
			Degraded:          false,
		}, nil
	}

	// 6. 缓存未命中 -> singleflight -> 压缩
	key := singleflightKey(req.FileID, sourceHashShort, targetBucket, req.Mode, inferenceModelID, compressPromptPolicyVersion)

	sfResult, sfErr, _ := singleflightGroup.Do(key, func() (interface{}, error) {
		prepared, err := prepareTranscript(ctx, req, canonicalText, sourceHash, sourceTokens, inferenceModelID, inferenceModelName)
		if err != nil {
			return PreparedTranscript{}, err
		}

		// 存缓存（仅缓存压缩后的结果，非 original）
		if prepared.InputKind != "original" {
			cType := "extractive"
			if prepared.InputKind == "semantic_compressed" {
				cType = "semantic"
			}
			// 非致命错误不阻塞主流程
			_ = storeCompressedTranscript(req.FileID, sourceHashShort, targetBucket, compressPromptPolicyVersion, cType, inferenceModelID, prepared.Text)
		}

		return prepared, nil
	})

	if sfErr != nil {
		return PreparedTranscript{}, sfErr
	}

	result := sfResult.(PreparedTranscript)
	return result, nil
}

// ============================================================
// 辅助函数
// ============================================================

// computeTargetBucket 将 targetTokens 向上取整到 1000
func computeTargetBucket(tokens int) int {
	if tokens <= 0 {
		return 0
	}
	return int(math.Ceil(float64(tokens)/1000)) * 1000
}