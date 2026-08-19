package steps

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

const smartMatchPromptVersion = "v3"

var (
	documentChunkingHeaderPattern        = regexp.MustCompile(`(?m)^(#{1,6})\s+(.+)$`)
	documentChunkingNumericBulletPattern = regexp.MustCompile(`^\d+[.)、]\s+`)
)

type SmartMatchCandidate struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type SmartMatchResult struct {
	SelectedKey         string                    `json:"selected_key"`
	SelectedName        string                    `json:"selected_name"`
	SelectedDescription string                    `json:"selected_description"`
	SelectedConfig      *V2DocumentChunkingConfig `json:"selected_config,omitempty"`
	EffectiveConfig     *V2DocumentChunkingConfig `json:"effective_config,omitempty"`
	Reason              string                    `json:"reason"`
	Confidence          float64                   `json:"confidence"`
	FallbackUsed        bool                      `json:"fallback_used"`
	PromptVersion       string                    `json:"prompt_version"`
	ModelName           string                    `json:"model_name"`
	MatchedAt           int64                     `json:"matched_at"`
	Candidates          SmartMatchCandidates      `json:"candidates"`
}

type SmartMatchCandidates []SmartMatchCandidate

func (c *SmartMatchCandidates) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" {
		*c = nil
		return nil
	}

	var rawItems []json.RawMessage
	if err := json.Unmarshal(data, &rawItems); err != nil {
		return err
	}

	items := make([]SmartMatchCandidate, 0, len(rawItems))
	for _, rawItem := range rawItems {
		var candidate SmartMatchCandidate
		if err := json.Unmarshal(rawItem, &candidate); err == nil {
			candidate.Key = strings.TrimSpace(candidate.Key)
			candidate.Name = strings.TrimSpace(candidate.Name)
			candidate.Description = strings.TrimSpace(candidate.Description)
			if candidate.Key == "" && candidate.Name == "" {
				continue
			}
			items = append(items, candidate)
			continue
		}

		var key string
		if err := json.Unmarshal(rawItem, &key); err == nil {
			key = strings.TrimSpace(key)
			if key == "" {
				continue
			}
			items = append(items, SmartMatchCandidate{
				Key:  key,
				Name: key,
				// 字符串候选没有额外描述，保持为空即可。
			})
			continue
		}

		return fmt.Errorf("候选项解析失败: %s", strings.TrimSpace(string(rawItem)))
	}

	*c = items
	return nil
}

type DocumentParsingSmartMatchConfig struct {
	EnableSmartMatch      bool   `json:"enable_smart_match"`
	MatchPreferencePrompt string `json:"match_preference_prompt"`
	ModelName             string `json:"model_name"`
}

type DocumentChunkingSmartMatchConfig struct {
	EnableSmartMatch bool   `json:"enable_smart_match"`
	ModelName        string `json:"model_name"`
}

func buildDocumentParsingSmartMatchCandidates(ctx context.Context, eid int64) ([]SmartMatchCandidate, error) {
	platformSettings, err := model.GetEnabledPlatformSettingsByEid(eid)
	if err != nil {
		return nil, fmt.Errorf("查询企业启用平台设置失败: %w", err)
	}

	enabledKeys := make(map[string]struct{}, len(platformSettings))
	for _, platformSetting := range platformSettings {
		key := strings.TrimSpace(platformSetting.PlatformKey)
		if key == "" {
			continue
		}
		enabledKeys[key] = struct{}{}
	}
	if len(enabledKeys) == 0 {
		logger.Debugf(ctx, "【智能匹配】当前企业未配置启用的平台设置，使用 MarkItDown 兼容候选")
	}
	metas := model.ListDefaultPlatformSettingDisplayMetas()
	candidates := make([]SmartMatchCandidate, 0, len(metas))
	for _, meta := range metas {
		if meta.PlatformKey != model.PLATFORM_KEY_MARKITDOWN {
			if _, ok := enabledKeys[meta.PlatformKey]; !ok {
				continue
			}
		}
		candidates = append(candidates, SmartMatchCandidate{
			Key:         meta.PlatformKey,
			Name:        meta.DisplayName,
			Description: meta.DisplayDescription,
		})
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("当前企业未配置可用于智能匹配的文档解析平台设置")
	}

	return candidates, nil
}

func buildDocumentChunkingSmartMatchCandidates() []SmartMatchCandidate {
	return []SmartMatchCandidate{
		{Key: model.ChunkTypeDefault, Name: "通用文档", Description: "适合普通文档、说明文和综合性内容，AI 仅在该路径下自动选参"},
		{Key: model.ChunkTypeQA, Name: "百问百答", Description: "适合问答对格式的文档，如 FAQ、知识库问答等"},
		{Key: model.ChunkTypeDataTable, Name: "数据表格", Description: "适合结构化表格数据，如 Excel 表格、数据报表等"},
	}
}

func buildDocumentParsingSmartMatchSystemPrompt(preferencePrompt string, candidates []SmartMatchCandidate) string {
	return buildSmartMatchSystemPrompt("文档解析器", preferencePrompt, candidates, []string{
		"你的任务是根据文档内容、文件特征和偏好提示词，从候选解析器中选择最适合的一个。",
		"只允许从候选项中选择，不要编造新的解析器。",
		"如果信息不足，优先结合偏好提示词给出稳健选择。",
	})
}

func buildDocumentChunkingSmartMatchSystemPrompt(candidates []SmartMatchCandidate) string {
	var sb strings.Builder
	sb.WriteString("你是一个严谨的语料拆分智能选参助手。\n")
	sb.WriteString("你的任务是根据文档结构特征，为文档选择最适合的类型（default/qa/data_table）和拆分参数方案。\n")
	sb.WriteString("你不是自由编造参数，而是要在合理范围内做结构化决策。\n")
	sb.WriteString("如果信息不足，也必须返回默认方案，并给出保守且稳健的参数。\n")
	sb.WriteString("先判断文档类型，再决定参数，不要直接从 baseline 复制。\n")
	sb.WriteString("文档类型倾向：\n")
	sb.WriteString("- 会议纪要 / 分析报告 / 方案文档 / 制度说明：标题层级通常较清晰，优先 identifier；多为 h2 或 h3；max_length 通常偏 1536~3072；append_subtitle 通常开启。\n")
	sb.WriteString("- 长篇叙述 / 通知说明 / 复盘总结：标题层级可能不稳定但正文很长，优先 length；max_length 通常偏 1024~2048；append_subtitle 视标题是否稳定决定。\n")
	sb.WriteString("- QA / 问答文档：问题-答案边界明显时，优先判断为 qa 类型。\n")
	sb.WriteString("- 表格 / 清单 / 结构化列表：表格结构清晰、数据量较大时，优先判断为 data_table 类型。\n")
	sb.WriteString("决策原则：\n")
	sb.WriteString("1. 先看结构特征摘要，再看内容预览，不要只凭局部关键词判断。\n")
	sb.WriteString("2. 标题层级清晰、章节边界明显时，优先选择 strategy=identifier。\n")
	sb.WriteString("3. 标题稀疏、段落长、叙述型内容占比高时，优先选择 strategy=length。\n")
	sb.WriteString("4. parent_chunk.mode 和 child_chunk.mode 允许选择 page；page 仅在文档包含独立行 <!-- page: N --> 页面标记时使用，并按页面保持边界。使用 page 时不需要 identifier_level。\n")
	sb.WriteString("5. max_length 只能从 512、768、1024、1536、2048、3072 中选择，不要输出任意数值。\n")
	sb.WriteString("6. append_subtitle 只有在文档确实存在稳定的多级标题链、子标题能帮助召回时才开启；平铺式或噪声式文档应关闭。\n")
	sb.WriteString("7. append_title 和 append_filename 用于补充检索上下文，文档标题清晰且内容较长时通常保留开启。\n")
	sb.WriteString("8. 会议纪要、分析报告、方案文档、制度说明等结构化文档，优先保留标题链和子标题；表格/问答文档则以最小可用上下文为准。\n")
	sb.WriteString("9. 优先保证语义完整，再考虑压缩长度；chunk 过碎会损失上下文，chunk 过大则降低检索精度。\n")
	sb.WriteString("10. 如果结构特征摘要已经给出建议文档类型，必须把该建议当作首要输入，再结合内容预览修正参数。\n")
	sb.WriteString("类型判断优先级：\n")
	sb.WriteString("1. 如果文档同时具有 qa 和 data_table 特征，qa 优先。\n")
	sb.WriteString("2. 如果置信度低于 0.5，fallback 到 default。\n")
	sb.WriteString("输出只允许 JSON，不要输出 Markdown、解释或代码块标记。\n")
	sb.WriteString("输出格式：\n")
	sb.WriteString("{\n")
	sb.WriteString(`  "selected_key": "根据文档内容判断的类型（default/qa/data_table）",` + "\n")
	sb.WriteString(`  "selected_name": "通用文档",` + "\n")
	sb.WriteString(`  "selected_description": "自动选参后的通用文档方案",` + "\n")
	sb.WriteString(`  "selected_config": {` + "\n")
	sb.WriteString(`    "chunk_type": "default",` + "\n")
	sb.WriteString(`    "parent_chunk": {` + "\n")
	sb.WriteString(`      "mode": "custom",` + "\n")
	sb.WriteString(`      "strategy": "identifier",` + "\n")
	sb.WriteString(`      "identifier_level": "h2",` + "\n")
	sb.WriteString(`      "max_length": 2048,` + "\n")
	sb.WriteString(`      "append_filename": true,` + "\n")
	sb.WriteString(`      "append_title": true,` + "\n")
	sb.WriteString(`      "append_subtitle": true` + "\n")
	sb.WriteString(`    },` + "\n")
	sb.WriteString(`    "child_chunk": {` + "\n")
	sb.WriteString(`      "mode": "custom",` + "\n")
	sb.WriteString(`      "strategy": "length",` + "\n")
	sb.WriteString(`      "identifier_level": "h3",` + "\n")
	sb.WriteString(`      "max_length": 512` + "\n")
	sb.WriteString(`    },` + "\n")
	sb.WriteString(`    "index_enhancement": {` + "\n")
	sb.WriteString(`      "metadata_injection": {` + "\n")
	sb.WriteString(`        "append_filename": true,` + "\n")
	sb.WriteString(`        "append_title": true,` + "\n")
	sb.WriteString(`        "append_subtitle": true` + "\n")
	sb.WriteString(`      },` + "\n")
	sb.WriteString(`      "generative_enhancement": {` + "\n")
	sb.WriteString(`        "generate_summary": true,` + "\n")
	sb.WriteString(`        "generate_faq": true` + "\n")
	sb.WriteString(`      }` + "\n")
	sb.WriteString(`    }` + "\n")
	sb.WriteString(`  },` + "\n")
	sb.WriteString(`  "reason": "简短原因",` + "\n")
	sb.WriteString(`  "confidence": 0.95,` + "\n")
	sb.WriteString(`  "fallback_used": false,` + "\n")
	sb.WriteString(`  "prompt_version": "`)
	sb.WriteString(smartMatchPromptVersion)
	sb.WriteString(`",` + "\n")
	sb.WriteString(`  "model_name": "模型名",` + "\n")
	sb.WriteString(`  "matched_at": 1710000000,` + "\n")
	sb.WriteString(`  "candidates": [` + "\n")
	sb.WriteString(`    { "key": "default", "name": "通用文档", "description": "通用文档" }` + "\n")
	sb.WriteString(`  ]` + "\n")
	sb.WriteString("}\n\n")
	sb.WriteString("参数选取约束：\n")
	sb.WriteString("- parent_chunk 和 child_chunk 需要分别根据文档层级与内容密度决定，不要简单复制 baseline。\n")
	sb.WriteString("- 如果文档层级清晰但内容很长，parent_chunk 选 identifier，child_chunk 选 length 通常更稳。\n")
	sb.WriteString("- 如果标题很少且段落很长，parent_chunk 和 child_chunk 都要更偏向 length。\n")
	sb.WriteString("- 如果文档里有明显的层级目录、章节、子章节，可以适当保留 append_subtitle=true；若内容扁平则关闭。\n")
	sb.WriteString("- 最大长度要结合章节平均长度和内容密度调整，避免 chunk 太碎或太大。\n")
	sb.WriteString("- 会议纪要/分析报告通常是“章节多 + 观点密集”的结构，child_chunk 可更偏向 1024 左右；FAQ/表格文档通常更碎，child_chunk 可更偏向 512~768。\n")
	sb.WriteString("注意：candidates 字段必须是对象数组，不允许返回字符串数组。\n")
	sb.WriteString("候选项：\n")
	for _, candidate := range candidates {
		if candidate.Key == "" && candidate.Name == "" {
			continue
		}
		fmt.Fprintf(&sb, "- key=%s, name=%s, description=%s\n", candidate.Key, candidate.Name, candidate.Description)
	}
	return sb.String()
}

func buildDocumentParsingSmartMatchUserPrompt(fileName, fileExt, preferencePrompt string, candidates []SmartMatchCandidate) string {
	var sb strings.Builder
	sb.WriteString("## 文件信息\n")
	sb.WriteString("- 文件名：")
	sb.WriteString(strings.TrimSpace(fileName))
	sb.WriteByte('\n')
	sb.WriteString("- 文件后缀：")
	sb.WriteString(strings.TrimSpace(fileExt))
	sb.WriteByte('\n')
	if trimmed := strings.TrimSpace(preferencePrompt); trimmed != "" {
		sb.WriteString("- 偏好提示词：")
		sb.WriteString(trimmed)
		sb.WriteByte('\n')
	}
	sb.WriteString("\n## 候选解析器\n")
	for _, candidate := range candidates {
		fmt.Fprintf(&sb, "- key=%s, name=%s, description=%s\n", candidate.Key, candidate.Name, candidate.Description)
	}
	sb.WriteString("\n请选择最适合当前文件的解析器，并仅输出 JSON。")
	return sb.String()
}

func buildDocumentChunkingSmartMatchUserPrompt(fileName, content string, baseline *V2DocumentChunkingConfig, candidates []SmartMatchCandidate) string {
	var sb strings.Builder
	sb.WriteString("## 文件信息\n")
	sb.WriteString("- 文件名：")
	sb.WriteString(strings.TrimSpace(fileName))
	sb.WriteByte('\n')
	sb.WriteString("\n## 结构特征摘要\n")
	sb.WriteString(buildDocumentChunkingStructureSummary(content))
	sb.WriteString("\n## 文件内容预览\n")
	sb.WriteString(buildSmartMatchContentPreview(content, 1600))
	sb.WriteString("\n\n## 当前默认配置\n")
	if baseline != nil {
		if baselineBytes, err := json.MarshalIndent(baseline, "", "  "); err == nil {
			sb.WriteString(string(baselineBytes))
			sb.WriteByte('\n')
		}
	}
	sb.WriteString("\n## 选参要求\n")
	sb.WriteString("- 先根据结构特征摘要判断文档类型，再结合预览内容确认参数。\n")
	sb.WriteString("- 默认配置 baseline 只作为参考，不要直接照抄；如果结构特征更适合其他参数，以结构特征为准。\n")
	sb.WriteString("- 必须在合理参数空间内选择，不要输出任意数值。\n")
	sb.WriteString("- 如果文档明显是会议分析报告、方案、制度、长文说明，优先保留标题链与子标题；如果是扁平列表、短 FAQ 或表格式内容，则降低对子标题和大 chunk 的依赖。\n")
	sb.WriteString("- 如果结构特征摘要给出了建议文档类型，先按该类型做初始判断，再结合预览内容微调参数。\n")
	sb.WriteString("\n## 候选方案\n")
	for _, candidate := range candidates {
		fmt.Fprintf(&sb, "- key=%s, name=%s, description=%s\n", candidate.Key, candidate.Name, candidate.Description)
	}
	sb.WriteString("\n请选择最适合当前文件的通用文档分块参数方案，并仅输出 JSON。")
	return sb.String()
}

func buildDocumentChunkingStructureSummary(content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return "- 文档为空或仅包含空白内容\n"
	}

	lines := strings.Split(content, "\n")
	headers := documentChunkingHeaderPattern.FindAllStringSubmatch(content, -1)
	headerCount := len(headers)
	headerLevelCounts := map[string]int{
		"h1": 0,
		"h2": 0,
		"h3": 0,
		"h4": 0,
		"h5": 0,
		"h6": 0,
	}
	for _, header := range headers {
		if len(header) < 2 {
			continue
		}
		level := len(header[1])
		key := fmt.Sprintf("h%d", level)
		headerLevelCounts[key]++
	}

	paragraphs := strings.Count(content, "\n\n") + 1
	bulletLines := 0
	tableBlocks := 0
	codeFenceCount := 0
	qaHintCount := 0
	longLineCount := 0
	longLineThreshold := 180
	inTable := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			inTable = false
			continue
		}
		if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") || strings.HasPrefix(trimmed, "• ") || documentChunkingNumericBulletPattern.MatchString(trimmed) {
			bulletLines++
		}
		if strings.Contains(trimmed, "|") && strings.Count(trimmed, "|") >= 2 {
			if !inTable {
				tableBlocks++
				inTable = true
			}
		} else {
			inTable = false
		}
		if strings.HasPrefix(trimmed, "```") {
			codeFenceCount++
		}
		if strings.HasPrefix(trimmed, "问题：") || strings.HasPrefix(trimmed, "回答：") || strings.Contains(trimmed, "Q:") || strings.Contains(trimmed, "A:") {
			qaHintCount++
		} else if regexp.MustCompile(`^问题\s+\d+\s*[:：]`).MatchString(trimmed) || regexp.MustCompile(`^问题\d+\s*[:：]`).MatchString(trimmed) || regexp.MustCompile(`^(?:专家答复|专家回答|专家回复|答复|解答)\s*[:：]`).MatchString(trimmed) {
			qaHintCount++
		}
		if len([]rune(trimmed)) >= longLineThreshold {
			longLineCount++
		}
	}

	docRunes := len([]rune(content))
	densityScore := "mixed"
	recommendedDocType := "general_document"
	switch {
	case headerCount >= 6 && longLineCount <= 3:
		densityScore = "hierarchy_strong"
		recommendedDocType = "meeting_or_report"
	case bulletLines >= 8 || tableBlocks >= 3:
		densityScore = "list_or_table_heavy"
		recommendedDocType = "list_or_table"
	case longLineCount >= 5 && headerCount <= 2:
		densityScore = "narrative_dense"
		recommendedDocType = "long_narrative"
	case qaHintCount >= 3:
		densityScore = "qa_like"
		recommendedDocType = "faq_or_qa"
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "- 文档长度：%d 字符\n", docRunes)
	fmt.Fprintf(&sb, "- 标题总数：%d\n", headerCount)
	fmt.Fprintf(&sb, "- 标题层级分布：h1=%d, h2=%d, h3=%d, h4=%d, h5=%d, h6=%d\n",
		headerLevelCounts["h1"], headerLevelCounts["h2"], headerLevelCounts["h3"], headerLevelCounts["h4"], headerLevelCounts["h5"], headerLevelCounts["h6"])
	fmt.Fprintf(&sb, "- 段落数：%d\n", paragraphs)
	fmt.Fprintf(&sb, "- 列表行数：%d\n", bulletLines)
	fmt.Fprintf(&sb, "- 表格块数：%d\n", tableBlocks)
	fmt.Fprintf(&sb, "- 代码块边界数：%d\n", codeFenceCount)
	fmt.Fprintf(&sb, "- 问答特征数：%d\n", qaHintCount)
	fmt.Fprintf(&sb, "- 长行数：%d\n", longLineCount)
	fmt.Fprintf(&sb, "- 建议文档类型：%s\n", recommendedDocType)
	fmt.Fprintf(&sb, "- 结构倾向：%s\n", densityScore)
	return sb.String()
}

func buildSmartMatchContentPreview(content string, limit int) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	runes := []rune(content)
	if limit <= 0 || len(runes) <= limit {
		return content
	}
	return string(runes[:limit]) + "\n...（内容已截断）"
}

func buildSmartMatchSystemPrompt(subject, preferencePrompt string, candidates []SmartMatchCandidate, extraLines []string) string {
	var sb strings.Builder
	sb.WriteString("你是一个严谨的")
	sb.WriteString(subject)
	sb.WriteString("智能匹配助手。\n")
	for _, line := range extraLines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		sb.WriteString(line)
		sb.WriteByte('\n')
	}
	if trimmed := strings.TrimSpace(preferencePrompt); trimmed != "" {
		sb.WriteString("偏好提示词：")
		sb.WriteString(trimmed)
		sb.WriteByte('\n')
	}
	sb.WriteString("输出只允许 JSON，不要输出 Markdown、解释或代码块标记。\n")
	sb.WriteString("输出格式：\n")
	sb.WriteString("{\n")
	sb.WriteString(`  "selected_key": "候选key",` + "\n")
	sb.WriteString(`  "selected_name": "候选名称",` + "\n")
	sb.WriteString(`  "selected_description": "候选描述",` + "\n")
	sb.WriteString(`  "reason": "简短原因",` + "\n")
	sb.WriteString(`  "confidence": 0.95,` + "\n")
	sb.WriteString(`  "fallback_used": false,` + "\n")
	sb.WriteString(`  "prompt_version": "`)
	sb.WriteString(smartMatchPromptVersion)
	sb.WriteString(`",` + "\n")
	sb.WriteString(`  "model_name": "模型名",` + "\n")
	sb.WriteString(`  "matched_at": 1710000000,` + "\n")
	sb.WriteString(`  "candidates": [` + "\n")
	sb.WriteString(`    { "key": "候选key", "name": "候选名称", "description": "候选描述" }` + "\n")
	sb.WriteString(`  ]` + "\n")
	sb.WriteString("}\n\n")
	sb.WriteString("注意：candidates 字段必须是对象数组，不允许返回字符串数组。\n")
	sb.WriteString("候选项：\n")
	for _, candidate := range candidates {
		if candidate.Key == "" && candidate.Name == "" {
			continue
		}
		fmt.Fprintf(&sb, "- key=%s, name=%s, description=%s\n", candidate.Key, candidate.Name, candidate.Description)
	}
	return sb.String()
}

func parseSmartMatchResult(ctx context.Context, content string) (*SmartMatchResult, error) {
	var result SmartMatchResult
	if err := common.ParseLLMJSONInto(ctx, content, &result); err != nil {
		return nil, fmt.Errorf("解析智能匹配结果失败: %w", err)
	}
	normalizeSmartMatchResult(&result)
	return &result, nil
}

func normalizeSmartMatchResult(result *SmartMatchResult) {
	if result == nil {
		return
	}

	result.SelectedKey = strings.TrimSpace(result.SelectedKey)
	result.SelectedName = strings.TrimSpace(result.SelectedName)
	result.SelectedDescription = strings.TrimSpace(result.SelectedDescription)
	result.Reason = strings.TrimSpace(result.Reason)
	result.PromptVersion = strings.TrimSpace(result.PromptVersion)
	result.ModelName = strings.TrimSpace(result.ModelName)

	if result.PromptVersion == "" {
		result.PromptVersion = smartMatchPromptVersion
	}
	if result.MatchedAt <= 0 {
		result.MatchedAt = time.Now().Unix()
	}

	normalized := make([]SmartMatchCandidate, 0, len(result.Candidates))
	for _, candidate := range result.Candidates {
		candidate.Key = strings.TrimSpace(candidate.Key)
		candidate.Name = strings.TrimSpace(candidate.Name)
		candidate.Description = strings.TrimSpace(candidate.Description)
		if candidate.Key == "" && candidate.Name == "" {
			continue
		}
		normalized = append(normalized, candidate)
	}
	result.Candidates = SmartMatchCandidates(normalized)

	normalizeV2DocumentChunkingConfig(result.SelectedConfig)
	normalizeV2DocumentChunkingConfig(result.EffectiveConfig)
	if result.EffectiveConfig == nil && result.SelectedConfig != nil {
		cloned := cloneV2DocumentChunkingConfig(result.SelectedConfig)
		result.EffectiveConfig = cloned
	}

	if result.Confidence < 0.5 && result.SelectedKey != model.ChunkTypeDefault {
		result.SelectedKey = model.ChunkTypeDefault
		result.FallbackUsed = true
		result.Reason = "置信度过低，使用默认类型"
	}

	if result.SelectedKey == model.ChunkTypeQA || result.SelectedKey == model.ChunkTypeDataTable {
		result.SelectedConfig = &V2DocumentChunkingConfig{
			ChunkType: result.SelectedKey,
		}
	}
}

func validateSmartMatchResult(result *SmartMatchResult, allowFallback bool) error {
	if result == nil {
		return fmt.Errorf("智能匹配结果不能为空")
	}
	if result.SelectedKey == "" && result.SelectedName == "" {
		return fmt.Errorf("智能匹配结果缺少选择项")
	}
	if result.Confidence < 0 || result.Confidence > 1 {
		return fmt.Errorf("智能匹配结果置信度必须在 0~1 之间")
	}

	allowed := make(map[string]struct{}, len(result.Candidates))
	for _, candidate := range result.Candidates {
		if candidate.Key == "" {
			continue
		}
		allowed[candidate.Key] = struct{}{}
	}
	if len(allowed) == 0 {
		return fmt.Errorf("智能匹配候选项不能为空")
	}

	if result.SelectedKey != "" {
		if _, ok := allowed[result.SelectedKey]; ok {
			return nil
		}
	}
	if allowFallback && result.FallbackUsed {
		return nil
	}

	return fmt.Errorf("智能匹配结果未命中候选项: %s", result.SelectedKey)
}

func validateDocumentChunkingSmartMatchResult(result *SmartMatchResult) error {
	if result == nil {
		return fmt.Errorf("语料拆分智能匹配结果不能为空")
	}
	if result.SelectedConfig == nil {
		return fmt.Errorf("语料拆分智能匹配结果缺少 selected_config")
	}
	validChunkTypes := map[string]bool{
		model.ChunkTypeDefault:   true,
		model.ChunkTypeQA:        true,
		model.ChunkTypeDataTable: true,
	}
	if !validChunkTypes[strings.TrimSpace(result.SelectedConfig.ChunkType)] && strings.TrimSpace(result.SelectedConfig.ChunkType) != "" {
		return fmt.Errorf("语料拆分智能匹配仅支持 default、qa、data_table 类型")
	}

	selectedKey := strings.TrimSpace(result.SelectedKey)
	chunkType := strings.TrimSpace(result.SelectedConfig.ChunkType)
	if selectedKey == model.ChunkTypeQA || selectedKey == model.ChunkTypeDataTable {
		if chunkType != selectedKey {
			return fmt.Errorf("selected_config.chunk_type 不匹配 selected_key")
		}
	} else {
		if err := validateDocumentChunkingConfig(result.SelectedConfig); err != nil {
			return err
		}
	}

	if result.EffectiveConfig == nil {
		result.EffectiveConfig = cloneV2DocumentChunkingConfig(result.SelectedConfig)
	}
	return nil
}

type smartMatchExecutor interface {
	Generate(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error)
}

type smartMatchLLMExecutor struct {
	contentService *rag.ContentGeneratorService
	channel        *model.Channel
	modelName      string
}

func (e *smartMatchLLMExecutor) Generate(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	if e == nil || e.contentService == nil || e.channel == nil {
		return "", fmt.Errorf("智能匹配执行器未初始化")
	}

	request := &relaymodel.GeneralOpenAIRequest{
		Model:     e.modelName,
		MaxTokens: 0, // 不限制输出，由模型自由生成
		Messages: []relaymodel.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	resp, err, openaiErr := e.contentService.TestChannel(ctx, e.channel, request)
	if err != nil {
		return "", fmt.Errorf("智能匹配调用失败: %v", err)
	}
	if openaiErr != nil {
		return "", fmt.Errorf("智能匹配调用失败: %v", openaiErr)
	}

	return resp, nil
}

func newSmartMatchExecutor(db *gorm.DB, eid int64) (smartMatchExecutor, string, error) {
	chunkCfgService := rag.NewChunkConfigService(db)
	config, err := chunkCfgService.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to get smart match LLM config: %v", err))
		return nil, "", fmt.Errorf("获取模型配置失败: %v", err)
	}

	selectedChannel, selectedModelName, selectErr := config.SelectPipelineLLM()
	if selectErr != nil {
		return nil, "", fmt.Errorf("未配置推理模型: %v", selectErr)
	}

	return &smartMatchLLMExecutor{
		contentService: rag.NewContentGeneratorService(db),
		channel:        selectedChannel,
		modelName:      selectedModelName,
	}, selectedModelName, nil
}

func selectSmartMatchResult(ctx context.Context, executor smartMatchExecutor, modelName, systemPrompt, userPrompt string, candidates []SmartMatchCandidate) (*SmartMatchResult, error) {
	if executor == nil {
		return nil, fmt.Errorf("智能匹配执行器不能为空")
	}

	resp, err := executor.Generate(ctx, systemPrompt, userPrompt, 2048)
	if err != nil {
		return nil, err
	}

	result, err := parseSmartMatchResult(ctx, resp)
	if err != nil {
		return nil, err
	}

	if len(result.Candidates) == 0 {
		result.Candidates = SmartMatchCandidates(cloneSmartMatchCandidates(candidates))
	}
	result.ModelName = strings.TrimSpace(modelName)
	normalizeSmartMatchResult(result)
	if err := validateSmartMatchResultAgainstCandidates(result, candidates, result.FallbackUsed); err != nil {
		return nil, err
	}
	return result, nil
}

func validateSmartMatchResultAgainstCandidates(result *SmartMatchResult, candidates []SmartMatchCandidate, allowFallback bool) error {
	if result == nil {
		return fmt.Errorf("智能匹配结果不能为空")
	}

	if len(candidates) == 0 {
		candidates = []SmartMatchCandidate(result.Candidates)
	}

	allowed := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		if candidate.Key == "" {
			continue
		}
		allowed[candidate.Key] = struct{}{}
	}
	if len(allowed) == 0 {
		return fmt.Errorf("智能匹配候选项不能为空")
	}

	if result.SelectedKey != "" {
		if _, ok := allowed[result.SelectedKey]; ok {
			return nil
		}
	}
	if allowFallback && result.FallbackUsed {
		return nil
	}

	return fmt.Errorf("智能匹配结果未命中候选项: %s", result.SelectedKey)
}

func cloneSmartMatchCandidates(candidates []SmartMatchCandidate) []SmartMatchCandidate {
	if len(candidates) == 0 {
		return nil
	}
	cloned := make([]SmartMatchCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		candidate.Key = strings.TrimSpace(candidate.Key)
		candidate.Name = strings.TrimSpace(candidate.Name)
		candidate.Description = strings.TrimSpace(candidate.Description)
		if candidate.Key == "" && candidate.Name == "" {
			continue
		}
		cloned = append(cloned, candidate)
	}
	return cloned
}

func smartMatchCandidateKeys(candidates []SmartMatchCandidate) string {
	if len(candidates) == 0 {
		return ""
	}

	keys := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		key := strings.TrimSpace(candidate.Key)
		if key == "" {
			continue
		}
		keys = append(keys, key)
	}
	return strings.Join(keys, ",")
}

func mapKeys(values map[string]struct{}) []string {
	if len(values) == 0 {
		return nil
	}

	keys := make([]string, 0, len(values))
	for key := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func selectDocumentParsingSmartMatch(ctx context.Context, db *gorm.DB, eid int64, fileName, fileExt, preferencePrompt string) (*SmartMatchResult, error) {
	candidates, err := buildDocumentParsingSmartMatchCandidates(ctx, eid)
	if err != nil {
		return nil, err
	}
	logger.Debugf(ctx, "【智能匹配】开始文档解析器选择: 文件名=%s, 后缀=%s, 候选数=%d, 候选来源=当前企业启用平台设置+MarkItDown兼容项, 候选keys=%s, 偏好提示词已设置=%t",
		strings.TrimSpace(fileName), strings.TrimSpace(fileExt), len(candidates), smartMatchCandidateKeys(candidates), strings.TrimSpace(preferencePrompt) != "")
	executor, modelName, err := newSmartMatchExecutor(db, eid)
	if err != nil {
		return nil, err
	}
	logger.Debugf(ctx, "【智能匹配】文档解析器模型信息: model=%s", strings.TrimSpace(modelName))

	systemPrompt := buildDocumentParsingSmartMatchSystemPrompt(preferencePrompt, candidates)
	userPrompt := buildDocumentParsingSmartMatchUserPrompt(fileName, fileExt, preferencePrompt, candidates)
	result, err := selectSmartMatchResult(ctx, executor, modelName, systemPrompt, userPrompt, candidates)
	if err != nil {
		return nil, err
	}
	logger.Debugf(ctx, "【智能匹配】文档解析器选择完成: selected_key=%s, fallback=%t, confidence=%.2f, reason=%s",
		result.SelectedKey, result.FallbackUsed, result.Confidence, result.Reason)
	return result, nil
}

func selectDocumentChunkingSmartMatch(ctx context.Context, db *gorm.DB, eid int64, fileName, content string, baseline *V2DocumentChunkingConfig) (*SmartMatchResult, error) {
	candidates := buildDocumentChunkingSmartMatchCandidates()
	logger.Debugf(ctx, "【智能匹配】开始语料拆分选择: 文件名=%s, 内容长度=%d, 候选数=%d",
		strings.TrimSpace(fileName), len([]rune(content)), len(candidates))
	executor, modelName, err := newSmartMatchExecutor(db, eid)
	if err != nil {
		return nil, err
	}
	logger.Debugf(ctx, "【智能匹配】语料拆分模型信息: model=%s", strings.TrimSpace(modelName))

	systemPrompt := buildDocumentChunkingSmartMatchSystemPrompt(candidates)
	userPrompt := buildDocumentChunkingSmartMatchUserPrompt(fileName, content, baseline, candidates)
	result, err := selectSmartMatchResult(ctx, executor, modelName, systemPrompt, userPrompt, candidates)
	if err != nil {
		return nil, err
	}

	if err := validateDocumentChunkingSmartMatchResult(result); err != nil {
		return nil, err
	}
	logger.Debugf(ctx, "【智能匹配】语料拆分选择完成: selected_key=%s, fallback=%t, confidence=%.2f, reason=%s, selected_config=%s",
		result.SelectedKey, result.FallbackUsed, result.Confidence, result.Reason, formatDocumentChunkingSmartMatchConfigForLog(result.SelectedConfig))
	return result, nil
}

func formatDocumentChunkingSmartMatchConfigForLog(cfg *V2DocumentChunkingConfig) string {
	if cfg == nil {
		return "null"
	}

	pretty, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Sprintf(`{"marshal_error":%q}`, err.Error())
	}
	return string(pretty)
}

func cloneV2DocumentChunkingConfig(cfg *V2DocumentChunkingConfig) *V2DocumentChunkingConfig {
	if cfg == nil {
		return nil
	}
	cloned := *cfg
	return &cloned
}

func normalizeV2DocumentChunkingConfig(cfg *V2DocumentChunkingConfig) {
	if cfg == nil {
		return
	}

	cfg.ChunkType = strings.TrimSpace(cfg.ChunkType)
	cfg.MatchPreferencePrompt = strings.TrimSpace(cfg.MatchPreferencePrompt)
	cfg.ParentChunk.Mode = strings.TrimSpace(cfg.ParentChunk.Mode)
	cfg.ParentChunk.Strategy = strings.TrimSpace(cfg.ParentChunk.Strategy)
	cfg.ParentChunk.IdentifierLevel = strings.TrimSpace(cfg.ParentChunk.IdentifierLevel)
	if cfg.ParentChunk.OverlapSize != nil {
		value := clampV2OverlapSize(*cfg.ParentChunk.OverlapSize)
		cfg.ParentChunk.OverlapSize = &value
	}
	cfg.ChildChunk.Mode = strings.TrimSpace(cfg.ChildChunk.Mode)
	cfg.ChildChunk.Strategy = strings.TrimSpace(cfg.ChildChunk.Strategy)
	cfg.ChildChunk.IdentifierLevel = strings.TrimSpace(cfg.ChildChunk.IdentifierLevel)
	if cfg.ChildChunk.OverlapSize != nil {
		value := clampV2OverlapSize(*cfg.ChildChunk.OverlapSize)
		cfg.ChildChunk.OverlapSize = &value
	}
	if cfg.ChunkType == "" {
		cfg.ChunkType = model.ChunkTypeDefault
	}
}

func validateDocumentChunkingConfig(cfg *V2DocumentChunkingConfig) error {
	if cfg == nil {
		return fmt.Errorf("语料拆分配置不能为空")
	}

	if strings.TrimSpace(cfg.ChunkType) != model.ChunkTypeDefault {
		return fmt.Errorf("语料拆分仅支持 default 通用文档")
	}
	if err := validateDocumentChunkingLayerConfig("parent_chunk", cfg.ParentChunk, true); err != nil {
		return err
	}
	if err := validateDocumentChunkingLayerConfig("child_chunk", cfg.ChildChunk, false); err != nil {
		return err
	}
	return nil
}

func validateDocumentChunkingLayerConfig(fieldName string, layer V2ChunkingLayerConfig, requireIdentifierLevel bool) error {
	validModes := map[string]struct{}{
		"":        {},
		"default": {},
		"custom":  {},
		"whole":   {},
		"page":    {},
	}
	if _, ok := validModes[strings.TrimSpace(layer.Mode)]; !ok {
		return fmt.Errorf("%s 的 mode 非法: %s", fieldName, layer.Mode)
	}

	validStrategies := map[string]struct{}{
		"":           {},
		"identifier": {},
		"length":     {},
	}
	if _, ok := validStrategies[strings.TrimSpace(layer.Strategy)]; !ok {
		return fmt.Errorf("%s 的 strategy 非法: %s", fieldName, layer.Strategy)
	}

	level := strings.TrimSpace(layer.IdentifierLevel)
	if requireIdentifierLevel && level == "" && strings.TrimSpace(layer.Mode) != "page" {
		return fmt.Errorf("%s 的 identifier_level 不能为空", fieldName)
	}
	if level != "" {
		validLevels := map[string]struct{}{
			"h1": {}, "h2": {}, "h3": {}, "h4": {}, "h5": {}, "h6": {},
		}
		if requireIdentifierLevel {
			validLevels["page"] = struct{}{}
		}
		if _, ok := validLevels[level]; !ok {
			return fmt.Errorf("%s 的 identifier_level 非法: %s", fieldName, layer.IdentifierLevel)
		}
	}
	if layer.MaxLength <= 0 && strings.TrimSpace(layer.Mode) != "whole" {
		// 整篇(whole)模式不强制 max_length:未配置时由后端 WHOLE_CHUNK_MAX_TOKENS 兜底
		return fmt.Errorf("%s 的 max_length 必须大于 0", fieldName)
	}

	return nil
}
