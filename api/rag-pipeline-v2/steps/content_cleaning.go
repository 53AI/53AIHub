package steps

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/tokenlimit"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

// contentCleaningLine 批次中的单行输入，带稳定行号 ID。
// 模型只能修改当前批次行，未返回的行保持原文。
type contentCleaningLine struct {
	ID   int    `json:"id"`
	Text string `json:"text"`
}

// contentCleaningFeatureNames feature key 到中文名称的映射，用于日志输出。
var contentCleaningFeatureNames = map[string]string{
	"remove_invalid_tags": "移除无效标签",
	"typo_correction":     "错别字纠正",
	"grammar_correction":  "语法纠正",
	"format_correction":   "格式纠正",
	"ocr_correction":      "OCR纠错",
	"formula_restoration": "公式还原",
	"sensitive_mask":      "敏感脱敏",
	"glossary":            "专业词库",
	"custom_prompt":       "自定义规则",
}

// contentCleaningFeatureNamesFromKeys 将 feature key 列表转为中文名称列表。
func contentCleaningFeatureNamesFromKeys(keys []string) []string {
	names := make([]string, 0, len(keys))
	for _, k := range keys {
		if name, ok := contentCleaningFeatureNames[k]; ok {
			names = append(names, name)
		} else {
			names = append(names, k)
		}
	}
	return names
}

// contentCleaningEntity 跨批次实体脱敏上下文，仅在单次任务内存中维护，不落库、不写日志。
type contentCleaningEntity struct {
	Type     string `json:"type"`
	Original string `json:"original"`
	Masked   string `json:"masked"`
}

// contentCleaningBatchRequest 发送给大模型的批次请求。
type contentCleaningBatchRequest struct {
	Lines           []contentCleaningLine   `json:"lines"`
	EnabledFeatures []string                `json:"enabled_features"`
	SensitiveFields []string                `json:"sensitive_fields"`
	EntityContext   []contentCleaningEntity `json:"entity_context"`
	Glossary        []string                `json:"glossary,omitempty"`      // 专业词库列表
	CustomPrompt    string                  `json:"custom_prompt,omitempty"` // 自定义规则（附加提示词）
}

// contentCleaningReplacement 模型返回的单行替换。
type contentCleaningReplacement struct {
	ID   int    `json:"id"`
	Text string `json:"text"`
}

// UnmarshalJSON 兼容部分模型将替换文本字段命名为 replacement 的旧格式，
// 同时继续拒绝其他未声明字段，避免削弱批次响应的结构校验。
func (r *contentCleaningReplacement) UnmarshalJSON(data []byte) error {
	var payload struct {
		ID          int     `json:"id"`
		Text        *string `json:"text"`
		Replacement *string `json:"replacement"`
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return err
	}

	if payload.Text != nil && payload.Replacement != nil && *payload.Text != *payload.Replacement {
		return fmt.Errorf("text 与 replacement 字段内容不一致")
	}

	r.ID = payload.ID
	switch {
	case payload.Text != nil:
		r.Text = *payload.Text
	case payload.Replacement != nil:
		r.Text = *payload.Replacement
	default:
		r.Text = ""
	}
	return nil
}

// contentCleaningBatchResponse 模型返回的批次响应。
// 模型只返回发生变化的行，未返回的行保持原样，节省输出 token。
type contentCleaningBatchResponse struct {
	Replacements []contentCleaningReplacement `json:"replacements"`
	Entities     []contentCleaningEntity      `json:"entities"`
}

// maxContentCleaningLinesPerBatch 单批次最大行数，避免单批过大。
const maxContentCleaningLinesPerBatch = 500

// contentCleaningBatch 一个待处理的行批次。
type contentCleaningBatch struct {
	Lines []contentCleaningLine
}

// contentCleaningPromptHeader 通用指令头，所有批次都携带。
const contentCleaningPromptHeader = `你是内容清洗助手。请根据输入批次和 enabled_features 处理文档行，只修改需要清洗的当前批次行。
只能返回 JSON，不要返回 Markdown、解释文字或代码围栏。响应格式必须是：{"replacements":[],"entities":[]}。
replacements 只包含发生变化的行，每项必须包含当前批次中已有的 id 和替换后的完整 text；未变化的行不要返回。entities 用于返回需要跨批次保持一致的脱敏实体。

注意：必须完整检查所有 enabled_features 对应的清洗能力，并逐项应用到当前批次中，不得遗漏。`

// contentCleaningFeatureInstructions 按功能拆分的指令段，仅拼接已开启功能，节省每批重复的指令 token。
var contentCleaningFeatureInstructions = map[string]string{
	"remove_invalid_tags": `当 enabled_features 包含 remove_invalid_tags 时，必须移除文档中的页眉、页脚、页码、注脚等无效标签或非正文内容，保留正文。`,
	"typo_correction":     `当 enabled_features 包含 typo_correction 时，必须纠正文本中的错别字和拼写错误。`,
	"format_correction": `当 enabled_features 包含 format_correction 时，必须修复 Markdown 格式问题，返回修改后的完整行文本：
- 代码块：必须确保三个反引号开始和结束标记正确配对。例如，三个反引号加 sql 后缺少结束标记，必须补全；三个反引号后缺少语言标识则无需添加。
- 表格：必须确保每行末尾的竖线 | 完整，所有行列数一致，分隔行与列数匹配。例如，|a|b 补全为 |a|b|；|a|b| 与 |---| 不匹配，需修正分隔行。
- 加粗/斜体/其他行内标记：必须确保标记正确闭合，不遗留未闭合的 **、*、__、_ 等标记。`,
	"ocr_correction":      `当 enabled_features 包含 ocr_correction 时，必须纠正 OCR 识别产生的错误：水印文字、杂字、乱码，以及勾选/叉选标记（如 ✓/✗/☑/☐）还原为文字描述（如"已勾选"/"未勾选"）。`,
	"grammar_correction":  `当 enabled_features 包含 grammar_correction 时，必须纠正文本中的语法错误，保持原意不变。`,
	"formula_restoration": `当 enabled_features 包含 formula_restoration 时，必须修正 OCR 造成的公式样式错位，还原 LaTeX 公式格式（如 $...$ 或 $$...$$ 内的内容）。`,
	"sensitive_mask": `当 enabled_features 包含 sensitive_mask 时，必须识别当前批次中的中文姓名并执行脱敏：
- 仅处理姓名；手机号、邮箱、身份证号、银行卡号、API Key 已由系统规则处理，无需重复处理。
- 只脱敏，不删除、不整行替换；除姓名外保留原文、标点、标签和行结构。
- 姓名保留姓氏，例如"张三"替换为"张*"。
- 同一 original+type 必须优先复用 entity_context 中已有的 masked 值，新增实体必须写入 entities，保证后续批次一致。`,
	"glossary":      `当 enabled_features 包含 glossary 时，必须参考 glossary 列表中的专业术语，确保文档中的术语用法一致。`,
	"custom_prompt": `当 enabled_features 包含 custom_prompt 时，必须参考 custom_prompt 中的附加规则执行清洗。`,
}

func buildContentCleaningLLMPrompt(batchJSON string, enabledFeatures []string) string {
	var sb strings.Builder
	sb.WriteString(contentCleaningPromptHeader)
	for _, key := range enabledFeatures {
		if section, ok := contentCleaningFeatureInstructions[key]; ok {
			sb.WriteString("\n\n")
			sb.WriteString(section)
		}
	}
	sb.WriteString("\n\n输入批次：\n")
	sb.WriteString(batchJSON)
	return sb.String()
}

// estimateContentCleaningTokens 粗略估算文本 token 数，与 tokenlimit.TruncateContent 保持一致（rune/3）。
// lazy: rune/3 为粗估，若需精确 token 计数可接入 tokenizer
func estimateContentCleaningTokens(text string) int {
	return len([]rune(text)) / 3
}

// buildContentCleaningBatches 按带行号的 Markdown 结构批次切分文档。
// 规则：
//   - 每行分配稳定递增 ID（从 1 开始）。
//   - 代码块（```）、表格（|）、公式块（$$）等跨行结构必须整体归批，不得拆分。
//   - 按单批次 token 预算和行数双阈值分批；当前批加入结构块后超预算仍整体保留。
//   - 禁止按字节硬截断 UTF-8 文本。
func buildContentCleaningBatches(content string, batchTokenBudget int) []contentCleaningBatch {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	if batchTokenBudget <= 0 {
		batchTokenBudget = contentCleaningStepMaxInput
	}

	lines := splitContentCleaningLines(content)
	if len(lines) == 0 {
		return nil
	}

	// 将行分组为结构块：普通行各自一组，代码块/表格/公式块作为一组
	groups := groupContentCleaningLines(lines)

	var batches []contentCleaningBatch
	current := contentCleaningBatch{}
	currentTokens := 0

	flush := func() {
		if len(current.Lines) > 0 {
			batches = append(batches, current)
			current = contentCleaningBatch{}
			currentTokens = 0
		}
	}

	for _, g := range groups {
		groupTokens := 0
		for _, l := range g {
			groupTokens += estimateContentCleaningTokens(l.Text)
		}

		// 超过行数阈值或加入后超 token 预算则先 flush（结构块整体保留，不拆分）
		wouldExceedTokens := currentTokens+groupTokens > batchTokenBudget
		wouldExceedLines := len(current.Lines)+len(g) > maxContentCleaningLinesPerBatch
		if len(current.Lines) > 0 && (wouldExceedTokens || wouldExceedLines) {
			flush()
		}

		current.Lines = append(current.Lines, g...)
		currentTokens += groupTokens
	}
	flush()

	return batches
}

// splitContentCleaningLines 将内容按行切分，分配稳定递增 ID。
func splitContentCleaningLines(content string) []contentCleaningLine {
	// 统一换行符
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	parts := strings.Split(normalized, "\n")
	lines := make([]contentCleaningLine, 0, len(parts))
	id := 1
	for _, p := range parts {
		lines = append(lines, contentCleaningLine{ID: id, Text: p})
		id++
	}
	return lines
}

// groupContentCleaningLines 将行分组：跨行结构（代码块、表格、公式）整体一组。
func groupContentCleaningLines(lines []contentCleaningLine) [][]contentCleaningLine {
	groups := make([][]contentCleaningLine, 0, len(lines))
	i := 0
	for i < len(lines) {
		text := strings.TrimSpace(lines[i].Text)
		if strings.HasPrefix(text, "```") {
			// 代码块：从开始标记到结束标记
			start := i
			i++
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i].Text), "```") {
				i++
			}
			if i < len(lines) {
				i++ // 包含结束标记行
			}
			groups = append(groups, lines[start:i])
			continue
		}
		if isContentCleaningTableLine(text) {
			// 表格块：连续的表格行整体一组
			start := i
			for i < len(lines) && isContentCleaningTableLine(strings.TrimSpace(lines[i].Text)) {
				i++
			}
			groups = append(groups, lines[start:i])
			continue
		}
		if strings.HasPrefix(text, "$$") {
			// 公式块：$$ ... $$，支持单行和多行
			start := i
			if strings.Count(text, "$$") >= 2 {
				// 单行公式 $$...$$
				groups = append(groups, lines[i:i+1])
				i++
				continue
			}
			i++
			for i < len(lines) && !strings.Contains(strings.TrimSpace(lines[i].Text), "$$") {
				i++
			}
			if i < len(lines) {
				i++
			}
			groups = append(groups, lines[start:i])
			continue
		}
		groups = append(groups, lines[i:i+1])
		i++
	}
	return groups
}

// isContentCleaningTableLine 判断是否为 Markdown 表格行（含分隔行）。
func isContentCleaningTableLine(text string) bool {
	if text == "" {
		return false
	}
	if !strings.Contains(text, "|") {
		return false
	}
	// 分隔行如 | --- | --- |
	if strings.HasPrefix(text, "|") {
		return true
	}
	return false
}

// validateAndMergeContentCleaningResponse 校验模型响应并合并为 ID->替换文本 map。
// 校验规则：
//   - 替换 ID 必须在当前批次行 ID 集合内（拒绝未知/越界）。
//   - 替换 ID 不可重复（拒绝重复）。
//   - 替换文本为空表示删除该行，允许为空。
//   - 未返回的行保持原文。
//
// 返回的 map key 为行 ID（int），value 为最终文本（替换或原文）。
func validateAndMergeContentCleaningResponse(ctx context.Context, batch contentCleaningBatchRequest, resp contentCleaningBatchResponse) (map[int]string, error) {
	validIDs := make(map[int]bool, len(batch.Lines))
	for _, l := range batch.Lines {
		validIDs[l.ID] = true
	}

	result := make(map[int]string, len(batch.Lines))
	for _, l := range batch.Lines {
		result[l.ID] = l.Text
	}

	seen := make(map[int]bool, len(resp.Replacements))
	for _, r := range resp.Replacements {
		// 降级：未知 ID 跳过（该行保留原文），重复 ID 取首个，不因单条非法响应失败整批
		if !validIDs[r.ID] {
			logger.Warnf(ctx, "【内容清洗】响应包含未知行 ID，跳过: id=%d", r.ID)
			continue
		}
		if seen[r.ID] {
			logger.Warnf(ctx, "【内容清洗】响应包含重复行 ID，取首个: id=%d", r.ID)
			continue
		}
		seen[r.ID] = true
		result[r.ID] = r.Text
	}

	return result, nil
}

// mergeContentCleaningReplacements 将替换应用到行并重组为文本。
// 行顺序保持原始顺序，未替换行保留原文。
func mergeContentCleaningReplacements(lines []contentCleaningLine, replacements map[int]string) string {
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		if text, ok := replacements[l.ID]; ok {
			parts = append(parts, text)
		} else {
			parts = append(parts, l.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// updateContentCleaningEntityContext 去重合并实体上下文。
// 同一 original+type 视为重复，不追加；新增实体追加到末尾。
// 实体上下文仅在单次任务内存中维护，不落库、不写日志。
func updateContentCleaningEntityContext(ctx []contentCleaningEntity, newEntities []contentCleaningEntity) []contentCleaningEntity {
	seen := make(map[string]bool, len(ctx))
	for _, e := range ctx {
		seen[e.Type+"|"+e.Original] = true
	}
	updated := make([]contentCleaningEntity, len(ctx))
	copy(updated, ctx)
	for _, e := range newEntities {
		key := e.Type + "|" + e.Original
		if seen[key] {
			continue
		}
		seen[key] = true
		updated = append(updated, e)
	}
	return updated
}

// usageWrapper 包装 token 用量，屏蔽对 relaymodel.Usage 的直接依赖，便于测试。
type usageWrapper struct {
	prompt     int
	completion int
}

func (u *usageWrapper) total() int {
	if u == nil {
		return 0
	}
	return u.prompt + u.completion
}

// contentCleaningLLMInvoker 抽象 LLM 调用，便于测试用 fake invoker 替换。
// 返回模型原始响应文本、token 用量和错误。
type contentCleaningLLMInvoker interface {
	Invoke(ctx context.Context, prompt string) (string, *usageWrapper, error)
	// InputBudget 返回单批次输入 token 预算，用于批次切分。
	InputBudget() int
}

// NewContentCleaningHandler 创建 content_cleaning 步骤处理函数。
// 读取 document_parsing 产生的原始 FileBody，按批次调用企业默认逻辑推理模型
// 清洗、纠错和脱敏，全部成功后事务创建第二条 FileBody，不覆盖原始记录。
func NewContentCleaningHandler(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return newContentCleaningHandlerWithInvoker(db, nil)
}

// newContentCleaningHandlerWithInvoker 支持注入 LLM invoker，测试传入 fake invoker。
func newContentCleaningHandlerWithInvoker(db *gorm.DB, invoker contentCleaningLLMInvoker) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, stepConfig json.RawMessage) error {
		cfg := model.DefaultContentCleaningConfig()
		if len(stepConfig) > 0 && string(stepConfig) != "null" {
			if err := json.Unmarshal(stepConfig, &cfg); err != nil {
				return fmt.Errorf("解析内容清洗配置失败: %v", err)
			}
		}
		if job == nil {
			return fmt.Errorf("job 不能为空")
		}
		if len(cfg.EnabledFeatureKeys()) == 0 {
			return completeContentCleaningStep(db, job.JobID, map[string]interface{}{
				"skipped": true,
				"reason":  "未选择内容清洗能力",
			})
		}

		params, err := parseContentCleaningParams(job)
		if err != nil {
			return err
		}

		// 生产环境注入基于 ContentGeneratorService 的真实 invoker
		realInvoker := invoker
		if realInvoker == nil {
			realInvoker = newContentCleaningProductionInvoker(db, params.Eid, cfg.EnabledFeatureKeys())
		}

		cleaned, totalTokens, err := executeContentCleaning(ctx, db, params, cfg, realInvoker.InputBudget(), realInvoker)
		if err != nil {
			return err
		}

		// 写入 Job metadata/step result，保留已有 metadata
		return completeContentCleaningStep(db, job.JobID, map[string]interface{}{
			"cleaned_content_length": len([]rune(cleaned)),
			"total_tokens":           totalTokens,
		})
	}
}

// contentCleaningParams 从 job 提取的执行参数。
type contentCleaningParams struct {
	Eid       int64
	FileID    int64
	UserID    int64
	LibraryID int64
	RunID     string
}

// parseContentCleaningParams 从 job.StartParameters 解析参数。
func parseContentCleaningParams(job *model.RagJob) (contentCleaningParams, error) {
	if job == nil {
		return contentCleaningParams{}, fmt.Errorf("job 不能为空")
	}
	var params map[string]interface{}
	if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
		return contentCleaningParams{}, fmt.Errorf("解析任务参数失败: %v", err)
	}
	p := contentCleaningParams{
		Eid:    safeToInt64(params["eid"]),
		FileID: safeToInt64(params["file_id"]),
		UserID: safeToInt64(params["user_id"]),
		RunID:  job.RunID,
	}
	if p.Eid <= 0 {
		p.Eid = job.Eid
	}
	if p.FileID <= 0 {
		p.FileID = job.RelatedId
	}
	return p, nil
}

// ruleCleanableFields 规则可处理的敏感字段集合；姓名无可靠正则边界，必须走 LLM。
var ruleCleanableFields = map[string]bool{"手机号": true, "邮箱": true, "身份证": true, "银行卡": true, "API Key": true}

// llmRequiredFeatures 计算启用功能中哪些必须走 LLM。
// 返回 (llmFeatures, ruleOnly)：ruleOnly 表示全部可规则化，可零 LLM 调用完成清洗。
func llmRequiredFeatures(cfg model.ContentCleaningConfig) ([]string, bool) {
	var llm []string
	// 布尔功能全部是 LLM 功能，除 remove_invalid_tags（规则处理）
	if cfg.TypoCorrection {
		llm = append(llm, "typo_correction")
	}
	if cfg.GrammarCorrection {
		llm = append(llm, "grammar_correction")
	}
	if cfg.FormatCorrection {
		llm = append(llm, "format_correction")
	}
	if cfg.OCRCorrection {
		llm = append(llm, "ocr_correction")
	}
	if cfg.FormulaRestoration {
		llm = append(llm, "formula_restoration")
	}
	if cfg.Glossary.Enabled {
		llm = append(llm, "glossary")
	}
	if cfg.CustomPrompt.Enabled {
		llm = append(llm, "custom_prompt")
	}
	// 敏感字段中仅"姓名"走 LLM
	if cfg.SensitiveMask.Enabled {
		for _, f := range cfg.SensitiveMask.Fields {
			if f == "姓名" {
				llm = append(llm, "sensitive_mask")
				break
			}
		}
	}
	return llm, len(llm) == 0
}

// llmSensitiveFields 混合路径下传给 LLM 的敏感字段：仅保留规则处理不了的"姓名"。
func llmSensitiveFields(cfg model.ContentCleaningConfig) []string {
	if !cfg.SensitiveMask.Enabled {
		return nil
	}
	for _, f := range cfg.SensitiveMask.Fields {
		if f == "姓名" {
			return []string{"姓名"}
		}
	}
	return nil
}

// saveCleanedFileBody 事务创建第二条 FileBody，不更新原始记录；纯规则与 LLM 路径共用。
func saveCleanedFileBody(db *gorm.DB, params contentCleaningParams, cleaned string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		newBody := &model.FileBody{
			Eid:       params.Eid,
			FileID:    params.FileID,
			LibraryID: params.LibraryID,
			Content:   cleaned,
			UserID:    params.UserID,
		}
		if err := newBody.ProcessContentStorage(); err != nil {
			return fmt.Errorf("处理文件内容存储失败: %v", err)
		}
		if err := tx.Create(newBody).Error; err != nil {
			return fmt.Errorf("保存清洗后文件体失败: %v", err)
		}
		return nil
	})
}

func formatContentCleaningLLMResponseLog(batchLabel string, lines []contentCleaningLine, response string) string {
	firstID, lastID := 0, 0
	if len(lines) > 0 {
		firstID = lines[0].ID
		lastID = lines[len(lines)-1].ID
	}
	return fmt.Sprintf("【诊断-内容清洗】批次=%s，行数=%d，首行ID=%d，末行ID=%d，LLM完整输出：%s",
		batchLabel, len(lines), firstID, lastID, response)
}

func formatContentCleaningLineChangeLog(lineID int, before, after string) string {
	return fmt.Sprintf("【诊断-内容清洗】行ID=%d，原文=%q，新文=%q", lineID, before, after)
}

// executeContentCleaning 执行内容清洗核心逻辑：
//  1. 校验参数，获取文件，检查停止信号。
//  2. 通过 RunID 找 document_parsing Job/Step 定位解析源 FileBody（不盲读最新）。
//  3. 按批次构造并调用 invoker，全部在内存合并；任一批次失败/非法响应则返回 error。
//  4. 全部成功后事务创建第二条 FileBody，不更新原始记录。
//
// batchTokenBudget 为单批次输入 token 预算，由调用方通过 tokenlimit.ComputeBudget 算出传入；
// 返回清洗后内容、累计 token 和错误。
func executeContentCleaning(ctx context.Context, db *gorm.DB, params contentCleaningParams, cfg model.ContentCleaningConfig, batchTokenBudget int, invoker contentCleaningLLMInvoker) (string, int, error) {
	if params.Eid <= 0 || params.FileID <= 0 {
		return "", 0, fmt.Errorf("eid 和 file_id 不能为空")
	}
	if invoker == nil {
		return "", 0, fmt.Errorf("LLM invoker 不能为空")
	}

	// 获取文件信息
	var file model.File
	if err := db.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error; err != nil {
		return "", 0, fmt.Errorf("获取文件信息失败: %v", err)
	}
	params.LibraryID = file.LibraryID
	if params.UserID == 0 {
		params.UserID = file.UserID
	}

	// 检查停止信号
	if err := common.CheckRagTaskStop(file.LibraryID, file.ID); err != nil {
		return "", 0, err
	}

	// 定位解析源 FileBody（通过 RunID 找 document_parsing 时间边界，不盲读最新）
	sourceBody, err := locateContentCleaningSourceBody(db, params)
	if err != nil {
		return "", 0, err
	}
	sourceContent, err := sourceBody.GetContent()
	if err != nil {
		return "", 0, fmt.Errorf("读取源文件内容失败: %v", err)
	}
	if strings.TrimSpace(sourceContent) == "" {
		return "", 0, fmt.Errorf("源文件内容为空，无法清洗")
	}

	// 智能路由：确定性规则（无效标签/手机号/邮箱/身份证/银行卡/API Key）前置处理；
	// 全部可规则化时零 LLM 调用，否则规则先行、LLM 只处理剩余项（含姓名脱敏）
	llmFeatures, ruleOnly := llmRequiredFeatures(cfg)
	ruleApplied := false
	if cfg.RemoveInvalidTags {
		sourceContent = ruleCleanInvalidTags(sourceContent)
		ruleApplied = true
	}
	if cfg.SensitiveMask.Enabled {
		var ruleResults []ruleCleaningResult
		sourceContent, ruleResults = ruleCleanSensitive(sourceContent, ruleCleanableFields)
		if len(ruleResults) > 0 {
			ruleApplied = true
		}
	}
	logger.Infof(ctx, "【内容清洗】规则处理完成: file_id=%d, rule_applied=%v, 剩余LLM功能=%v",
		params.FileID, ruleApplied, llmFeatures)

	if strings.TrimSpace(sourceContent) == "" {
		return "", 0, fmt.Errorf("规则清洗后内容为空，无法继续")
	}

	if ruleOnly {
		cleaned := sourceContent
		if err := saveCleanedFileBody(db, params, cleaned); err != nil {
			return "", 0, err
		}
		logger.Infof(ctx, "【内容清洗】完成(纯规则): file_id=%d, 替换行=0, token=0", params.FileID)
		return cleaned, 0, nil
	}

	// 批次构造
	batches := buildContentCleaningBatches(sourceContent, batchTokenBudget)
	if len(batches) == 0 {
		return "", 0, fmt.Errorf("批次构造结果为空")
	}

	// 启用的清洗能力：传给 LLM 的功能与敏感字段均过滤为规则处理后的剩余项
	enabledFeatures := llmFeatures
	sensitiveFields := llmSensitiveFields(cfg)

	logger.Infof(ctx, "【内容清洗】配置: file_id=%d, 已开启=%v, sensitive_fields=%v, glossary=%d条, custom_prompt=%v",
		params.FileID, contentCleaningFeatureNamesFromKeys(enabledFeatures), sensitiveFields, len(cfg.Glossary.Items), cfg.CustomPrompt.Enabled)

	// 收集所有行（用于最终重组）和批次校验
	allLines := make([]contentCleaningLine, 0)
	for _, b := range batches {
		allLines = append(allLines, b.Lines...)
	}

	// 跨批次实体上下文（仅内存）
	entityContext := make([]contentCleaningEntity, 0)
	// 累计替换：行ID -> 替换文本
	mergedReplacements := make(map[int]string)
	totalTokens := 0

	for _, batch := range batches {
		if err := common.CheckRagTaskStop(file.LibraryID, file.ID); err != nil {
			return "", 0, err
		}

		batchReplacements, batchEntities, batchTokens, err := processContentCleaningLinesWithRetry(
			ctx, invoker, batch.Lines, enabledFeatures, sensitiveFields, entityContext, cfg,
		)
		if err != nil {
			return "", 0, err
		}
		totalTokens += batchTokens

		for id, text := range batchReplacements {
			mergedReplacements[id] = text
		}

		if len(batchEntities) > 0 {
			entityContext = updateContentCleaningEntityContext(entityContext, batchEntities)
		}
	}

	// 全部成功，重组清洗后内容
	cleaned := mergeContentCleaningReplacements(allLines, mergedReplacements)

	if err := saveCleanedFileBody(db, params, cleaned); err != nil {
		return "", 0, err
	}

	logger.Infof(ctx, "【内容清洗】完成: file_id=%d, 批次=%d, 替换行=%d, token=%d",
		params.FileID, len(batches), len(mergedReplacements), totalTokens)
	return cleaned, totalTokens, nil
}

// tryContentCleaningBatch 尝试处理一组行作为单批次，成功返回替换、实体和 token 用量，失败返回 error。
// 使用 %w 保留错误链，供 IsTruncationError 检测。
func tryContentCleaningBatch(ctx context.Context, invoker contentCleaningLLMInvoker, lines []contentCleaningLine, enabledFeatures []string, sensitiveFields []string, entityContext []contentCleaningEntity, cfg model.ContentCleaningConfig) (map[int]string, []contentCleaningEntity, int, error) {
	req := contentCleaningBatchRequest{
		Lines:           lines,
		EnabledFeatures: enabledFeatures,
		SensitiveFields: sensitiveFields,
		EntityContext:   entityContext,
		Glossary:        cfg.Glossary.Items,
		CustomPrompt:    cfg.CustomPrompt.Content,
	}
	promptBytes, err := json.Marshal(req)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("序列化批次请求失败: %v", err)
	}

	// 瞬时错误重试：仅重试调用层错误，解析/校验错误不重试（由降级与截断分半兜底）
	// lazy: 固定间隔 1s, 需精细化退避时复用 relay 的 RetryPolicy
	var respText string
	var usage *usageWrapper
	const contentCleaningMaxAttempts = 3
	for attempt := 1; ; attempt++ {
		respText, usage, err = invoker.Invoke(ctx, string(promptBytes))
		if respText != "" {
			batchLabel := "未知"
			if len(lines) > 0 {
				batchLabel = fmt.Sprintf("行%d-%d", lines[0].ID, lines[len(lines)-1].ID)
			}
			status := "成功"
			if err != nil {
				status = "失败"
			}
			logger.Infof(ctx, "%s，尝试次数=%d，调用状态=%s", formatContentCleaningLLMResponseLog(batchLabel, lines, respText), attempt, status)
		}
		if err == nil || attempt >= contentCleaningMaxAttempts {
			break
		}
		logger.Warnf(ctx, "【内容清洗】批次 LLM 调用失败，准备重试: 第%d次, 行数=%d, err=%v", attempt, len(lines), err)
		time.Sleep(time.Second)
	}
	if err != nil {
		logger.Warnf(ctx, "【内容清洗】批次 LLM 调用失败: 行数=%d, 功能数=%d, 敏感字段数=%d, 实体上下文数=%d, err=%v",
			len(lines), len(enabledFeatures), len(sensitiveFields), len(entityContext), err)
		return nil, nil, 0, fmt.Errorf("批次 LLM 调用失败: %w", err)
	}
	tokens := 0
	if usage != nil {
		tokens = usage.total()
	}

	var resp contentCleaningBatchResponse
	if err := common.ParseLLMJSONInto(ctx, respText, &resp); err != nil {
		return nil, nil, tokens, fmt.Errorf("批次响应解析失败: %w", err)
	}

	batchReplacements, err := validateAndMergeContentCleaningResponse(ctx, req, resp)
	if err != nil {
		return nil, nil, tokens, fmt.Errorf("批次响应校验失败: %w", err)
	}

	// 只记录发生变化的行（与原文不同）
	filtered := make(map[int]string)
	for id, text := range batchReplacements {
		for _, l := range lines {
			if l.ID == id && l.Text != text {
				filtered[id] = text
			}
		}
	}
	if len(filtered) == 0 {
		logger.Infof(ctx, "【诊断-内容清洗】本批次无行变更：行数=%d", len(lines))
	} else {
		for _, l := range lines {
			if text, ok := filtered[l.ID]; ok {
				logger.Infof(ctx, "%s", formatContentCleaningLineChangeLog(l.ID, l.Text, text))
			}
		}
	}

	return filtered, resp.Entities, tokens, nil
}

// processContentCleaningLinesWithRetry 处理一组行，遇截断错误自动分半重试，单行失败降级保留原文。
func processContentCleaningLinesWithRetry(ctx context.Context, invoker contentCleaningLLMInvoker, lines []contentCleaningLine, enabledFeatures []string, sensitiveFields []string, entityContext []contentCleaningEntity, cfg model.ContentCleaningConfig) (map[int]string, []contentCleaningEntity, int, error) {
	if len(lines) == 0 {
		return nil, entityContext, 0, nil
	}

	replacements, entities, tokens, err := tryContentCleaningBatch(ctx, invoker, lines, enabledFeatures, sensitiveFields, entityContext, cfg)
	if err == nil {
		return replacements, entities, tokens, nil
	}

	// 截断错误：分半重试
	if common.IsTruncationError(err) && len(lines) > 1 {
		mid := len(lines) / 2
		logger.Warnf(ctx, "【内容清洗】批次截断，分半重试: 行数=%d, err=%v", len(lines), err)

		leftReplacements, leftEntities, leftTokens, err := processContentCleaningLinesWithRetry(ctx, invoker, lines[:mid], enabledFeatures, sensitiveFields, entityContext, cfg)
		if err != nil {
			return nil, nil, tokens + leftTokens, err
		}

		mergedEntityContext := updateContentCleaningEntityContext(entityContext, leftEntities)

		rightReplacements, rightEntities, rightTokens, err := processContentCleaningLinesWithRetry(ctx, invoker, lines[mid:], enabledFeatures, sensitiveFields, mergedEntityContext, cfg)
		if err != nil {
			return nil, nil, tokens + leftTokens + rightTokens, err
		}

		merged := make(map[int]string)
		for k, v := range leftReplacements {
			merged[k] = v
		}
		for k, v := range rightReplacements {
			merged[k] = v
		}
		mergedEntities := updateContentCleaningEntityContext(leftEntities, rightEntities)
		return merged, mergedEntities, tokens + leftTokens + rightTokens, nil
	}

	// 单行截断时保留原文，避免单行无法再拆分；其他错误必须让任务失败并进入恢复路径。
	if len(lines) == 1 && common.IsTruncationError(err) {
		logger.Warnf(ctx, "【内容清洗】单行 LLM 解析失败，保留原文: line_id=%d, err=%v", lines[0].ID, err)
		return nil, entityContext, tokens, nil
	}

	// 非截断的多行错误，不可恢复
	return nil, nil, tokens, err
}

// locateContentCleaningSourceBody 定位 document_parsing 产生的源 FileBody。
// 优先通过当前 RunID 找 document_parsing Job 的完成时间作为边界，
// 取该时间之前最旧的 FileBody 作为解析源（避免读到清洗结果）。
// 无 RunID 或无对应 Job 时降级为该文件最旧的 FileBody。
func locateContentCleaningSourceBody(db *gorm.DB, params contentCleaningParams) (*model.FileBody, error) {
	var boundary int64
	if params.RunID != "" {
		var parseJob model.RagJob
		err := db.Where("eid = ? AND run_id = ? AND type = ?", params.Eid, params.RunID, "document_parsing").
			First(&parseJob).Error
		if err == nil {
			var parseStep model.RagJobStep
			if e := db.Where("job_id = ?", parseJob.JobID).First(&parseStep).Error; e == nil {
				boundary = parseStep.EndTime
				if boundary == 0 {
					boundary = parseStep.CreatedTime
				}
			}
		}
	}

	query := db.Where("eid = ? AND file_id = ?", params.Eid, params.FileID)
	if boundary > 0 {
		query = query.Where("created_time <= ?", boundary)
	}

	var body model.FileBody
	if err := query.Order("id ASC").First(&body).Error; err != nil {
		return nil, fmt.Errorf("未找到解析源 FileBody: %v", err)
	}
	return &body, nil
}

// completeContentCleaningStep 完成 content_cleaning 步骤，写入 step result，保留已有 metadata。
func completeContentCleaningStep(db *gorm.DB, jobID int64, result map[string]interface{}) error {
	var jobStep model.RagJobStep
	err := db.Where("job_id = ?", jobID).First(&jobStep).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return fmt.Errorf("获取任务步骤失败: %v", err)
	}
	if err == gorm.ErrRecordNotFound {
		jobStep = model.RagJobStep{
			JobID:     jobID,
			Status:    model.RagJobStepStatusSuccess,
			StartTime: time.Now().UnixMilli(),
		}
	}
	if err := jobStep.CompleteSuccessfully(result); err != nil {
		return err
	}
	return db.Save(&jobStep).Error
}

// relaymodelUsageToWrapper 将 relaymodel.Usage 转为 usageWrapper。
func relaymodelUsageToWrapper(u *relaymodel.Usage) *usageWrapper {
	if u == nil {
		return nil
	}
	return &usageWrapper{
		prompt:     u.PromptTokens,
		completion: u.CompletionTokens,
	}
}

// contentCleaningProductionInvoker 生产环境 invoker，基于 ContentGeneratorService。
// 通过企业默认逻辑推理渠道和模型调用，保持 MaxTokens=0，由统一渠道配置处理。
type contentCleaningProductionInvoker struct {
	channel         *model.Channel
	model           string
	gen             contentCleaningGenerator
	eid             int64
	inputBudget     int      // 单批次输入 token 预算，来自 tokenlimit.ComputeBudget
	enabledFeatures []string // 已开启清洗功能，用于 prompt 按功能裁剪
}

// contentCleaningStepMaxInput 内容清洗单批次最大输入 token（stepMaxInput）。
// 仅作 ComputeBudget 的上限封顶：实际预算按渠道模型上下文自动调整，
// 小上下文模型自动下调，大上下文模型可用到 16000，减少批次数提升吞吐。
const contentCleaningStepMaxInput = 16000

// newContentCleaningProductionInvoker 构造生产 invoker：
// 通过企业默认分块配置选择逻辑推理渠道和模型，缺失配置时 Invoke 时报错（步骤失败）。
// 通过 tokenlimit.ComputeBudget 计算输入预算，Invoke 时用 TruncateContent 控制输入，保持 MaxTokens=0。
func newContentCleaningProductionInvoker(db *gorm.DB, eid int64, enabledFeatures []string) contentCleaningLLMInvoker {
	invoker := &contentCleaningProductionInvoker{
		eid:             eid,
		enabledFeatures: enabledFeatures,
	}
	if db == nil {
		return invoker
	}
	// 选择企业默认逻辑推理渠道和模型
	configSvc := rag.NewChunkConfigService(db)
	enterpriseConfig, err := configSvc.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		return invoker
	}
	channel, modelName, err := enterpriseConfig.SelectPipelineLLM()
	if err != nil {
		return invoker
	}
	invoker.channel = channel
	invoker.model = modelName
	invoker.gen = &contentCleaningGeneratorAdapter{db: db}
	// 计算输入预算：systemTokens=0, requestedOutput=8192, stepMaxInput=6000。
	// 实际请求保持 MaxTokens=0，由统一渠道配置处理。
	budget := tokenlimit.ComputeBudget(context.Background(), channel.ChannelID, channel.Config, modelName, 0, 8192, contentCleaningStepMaxInput)
	invoker.inputBudget = budget.InputAvailable
	return invoker
}

// InputBudget 返回单批次输入 token 预算，供 executeContentCleaning 用于批次切分。
func (p *contentCleaningProductionInvoker) InputBudget() int {
	if p.inputBudget > 0 {
		return p.inputBudget
	}
	return contentCleaningStepMaxInput
}

// contentCleaningGenerator 抽象 ContentGeneratorService.GenerateRawPromptWithUsage，
// 便于在测试中替换；生产实现转调 rag.ContentGeneratorService。
type contentCleaningGenerator interface {
	GenerateRawPromptWithUsage(ctx context.Context, channel *model.Channel, modelName string, prompt string) (string, *relaymodel.Usage, error)
}

// contentCleaningGeneratorAdapter 适配 rag.ContentGeneratorService 到 contentCleaningGenerator 接口。
type contentCleaningGeneratorAdapter struct {
	db *gorm.DB
}

func (a *contentCleaningGeneratorAdapter) GenerateRawPromptWithUsage(ctx context.Context, channel *model.Channel, modelName string, prompt string) (string, *relaymodel.Usage, error) {
	return rag.NewContentGeneratorService(a.db).GenerateRawPromptWithUsage(ctx, channel, modelName, prompt)
}

// Invoke 执行单批次 LLM 调用。
// 调用前用 tokenlimit.TruncateContent 控制输入在预算内，保持 MaxTokens=0。
func (p *contentCleaningProductionInvoker) Invoke(ctx context.Context, prompt string) (string, *usageWrapper, error) {
	if p.gen == nil {
		return "", nil, fmt.Errorf("内容清洗 LLM 生成器未初始化")
	}
	if p.channel == nil || strings.TrimSpace(p.model) == "" {
		return "", nil, fmt.Errorf("未配置企业默认逻辑推理渠道或模型，无法执行内容清洗")
	}
	truncated := tokenlimit.TruncateContent(buildContentCleaningLLMPrompt(prompt, p.enabledFeatures), p.InputBudget())
	resp, usage, err := p.gen.GenerateRawPromptWithUsage(ctx, p.channel, p.model, truncated)
	if err != nil {
		return "", nil, err
	}
	return resp, relaymodelUsageToWrapper(usage), nil
}
