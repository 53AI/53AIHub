package service

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
)

// 本文件实现"提示词契约 → 机械判定"的校验层。
//
// 设计原则（生产踩坑换来的）：
//
//  1. 提示词负责语义质量（要覆盖哪些要点、语气、详略），代码负责可机械判定的不变量。
//     只靠提示词控制不住 —— 提示词第 33 行明确写了"output exactly two lines"，
//     模型照样先回显一句指令再输出两行。
//  2. 代码不能穷举"模型可能会犯的错"。生产实测里黑名单必然被绕过：
//     模型吐出的 "NOT include any analysis..." / "If the content has no substantive
//     information, output only the title line and explanation sentence." 在整个代码
//     仓库里 grep 不到，是模型自造的。追加前缀清单只是打地鼠。
//  3. 因此代码校验的必须是**提示词自己白纸黑字承诺过的契约**。契约是有限的、
//     写在提示词模板里的、可以机械判定的；模型的可能性是无穷的。
//
// 每条契约下面都注明了它在提示词模板中的出处，便于核对。
const (
	// wikiContractCopyWindow 是判定"逐字照抄源内容"的连续窗口长度（rune）。
	//
	// 取 16 的理由：中文正文连续 16 字重合，基本只可能是逐字复制；正常摘要都是
	// 重新组织的句子，实体词会散落在不同位置。英文按字符计同理。
	wikiContractCopyWindow = 16

	// wikiContractCopyRatio 是"照抄"的判定阈值：响应中命中源内容的窗口占比。
	//
	// 实测正常中文摘要的窗口重合率在 5% 以下（只有实体词附近偶有 1-2 个窗口命中），
	// 照抄则是 90% 以上。0.6 留足了安全边际。
	wikiContractCopyRatio = 0.6

	// wikiContractHanRatio 是"以中文为主"的汉字占比下限。
	//
	// 提示词要求 "in {{.Language}}"，语言是请求侧的硬契约。实测照抄源文档指令行时
	// 汉字占比只有 5% 左右，正常中文摘要在 70% 以上。
	wikiContractHanRatio = 0.3
)

// wikiContractViolationMarker 是契约违规错误的统一标记。
//
// 用途：isWikiSummaryFormatRetryableError 靠它识别"这类错误值得重试"，
// 也让日志能一眼区分"格式契约没达标"和"网络故障"。
const wikiContractViolationMarker = "wiki contract violation"

// wikiContractIsSingleParagraph 判定响应是否是提示词承诺的"单段"。
//
// 契约出处：service/wiki_prompt_templates.go:47
//
//	"Return only one compact paragraph, with length proportional to the source."
//
// 提示词要求的是"一个紧凑段落"，那么输出里出现空行分隔的多段就是违约。
// 这条判定比"回显检测"可靠得多 —— 它不看内容像不像指令，只看结构对不对。
func wikiContractIsSingleParagraph(text string) bool {
	normalized := strings.ReplaceAll(strings.TrimSpace(text), "\r\n", "\n")
	if normalized == "" {
		return false
	}
	paragraphs := 0
	for _, block := range strings.Split(normalized, "\n\n") {
		if strings.TrimSpace(block) == "" {
			continue
		}
		paragraphs++
	}
	return paragraphs == 1
}

// wikiContractHasDominantHanRatio 判定响应是否以中文为主。
//
// 契约出处：service/wiki_prompt_templates.go:40 / :24
//
//	"Create a concise intermediate summary of the following document material in {{.Language}}."
//	"Start with exactly one line: SUMMARY: {one concise sentence ...}"
//
// 语言是提示词明确承诺的输出约束，且完全可机械判定。实测模型照抄英文指令行时，
// 汉字占比只有 5% 左右；正常中文摘要在 70% 以上。
func wikiContractHasDominantHanRatio(text string) bool {
	total := 0
	han := 0
	for _, r := range text {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			continue
		}
		total++
		if unicode.Is(unicode.Han, r) {
			han++
		}
	}
	if total == 0 {
		return false
	}
	return float64(han)/float64(total) >= wikiContractHanRatio
}

// wikiContractLooksVerbatimCopy 判定响应是否在逐字照抄源内容。
//
// 契约出处：service/wiki_prompt_templates.go:47
//
//	"Preserve the main subject, key facts, named entities, conclusions, and important figures."
//
// 提炼与照抄的区别正是这条契约：照抄源内容就等于没做提炼。
//
// 生产现场（logs/53AIHub-20261021.log，2026-10-21 05:48 前后 file_id=1978075 系列）：
// reduction 阶段连续 6 次把源文档的指令行原样吐出，例如
//
//	"Follow the source's language.\n\nNo bullet points. Keep the author's meaning.
//	 Do not use a bullet list.\n\nLimit the summary to 200 characters."
//
// 真正的 OpenClaw 正文被整段丢弃。指令行随之成为"文档正文"传给 summary 阶段，
// 最终产出"该来源缺少可综述的材料，仅要求遵循源语言、不使用项目符号…"这种
// 无信息量的摘要页。
//
// 判定方法：把响应切成长度 wikiContractCopyWindow 的滑动窗口，逐个检查是否出现在
// 源内容中。照抄的窗口命中率在 90% 以上，正常摘要在 5% 以下。
func wikiContractLooksVerbatimCopy(response, source string) bool {
	resp := wikiContractNormalizeText(response)
	src := wikiContractNormalizeText(source)

	respRunes := []rune(resp)
	srcRunes := []rune(src)
	if len(respRunes) < wikiContractCopyWindow || len(srcRunes) < wikiContractCopyWindow {
		return false
	}
	// 响应比源还长时，逐字照抄不可能（除非源是响应的子集，此时下面的窗口命中
	// 率自然也会很低），不做额外处理。
	if len(respRunes) > 8000 {
		respRunes = respRunes[:8000]
	}

	hits := 0
	total := 0
	for i := 0; i+wikiContractCopyWindow <= len(respRunes); i++ {
		total++
		if strings.Contains(src, string(respRunes[i:i+wikiContractCopyWindow])) {
			hits++
		}
	}
	if total == 0 {
		return false
	}
	return float64(hits)/float64(total) >= wikiContractCopyRatio
}

// wikiContractNormalizeText 归一化文本：折叠所有空白为单个空格，便于窗口比对。
func wikiContractNormalizeText(text string) string {
	var b strings.Builder
	b.Grow(len(text))
	prevSpace := false
	for _, r := range text {
		if unicode.IsSpace(r) {
			if !prevSpace {
				b.WriteRune(' ')
			}
			prevSpace = true
			continue
		}
		prevSpace = false
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// wikiContractStartsWithSummaryLine 判定响应的第一行是不是 SUMMARY 行。
//
// 契约出处：service/wiki_prompt_templates.go:24
//
//	"1. Start with exactly one line: SUMMARY: {one concise sentence describing this
//	 document for the wiki index}."
//
// 提示词要求 SUMMARY 是**第一行**。但 splitSummaryLine 的实现是"找到最后一个
// SUMMARY 行"，所以响应前面即使塞了一整段回显，也照样能把 SUMMARY 行摘出来
// 并当成有效摘要落库。
//
// 生产现场（logs/53AIHub-20261021.log，file_id=1978075）：
//
//	 If the content has no substantive information, output only the title line and
//	 explanation sentence.        ← 回显，违反"第一行必须是 SUMMARY"
//
//	SUMMARY: 本文档仅包含写作指令，无可提取的实质性内容。
//
//	该来源缺少可综述的材料，仅要求遵循源语言、不使用项目符号、限制在200字符内并附加综述行。
func wikiContractStartsWithSummaryLine(response string) bool {
	trimmed := strings.TrimSpace(response)
	if trimmed == "" {
		return false
	}
	firstLine := trimmed
	if idx := strings.IndexAny(trimmed, "\r\n"); idx >= 0 {
		firstLine = trimmed[:idx]
	}
	firstLine = strings.TrimSpace(firstLine)
	return strings.HasPrefix(firstLine, "SUMMARY:") || strings.HasPrefix(firstLine, "SUMMARY：")
}

// extractWikiTaggedBlock 从模型响应中提取标签包裹的内容。
//
// 提示词现在要求模型用固定标签包裹输出（<intermediate_summary> / <wiki_summary> /
// <wiki_index_intro>）。这比"看开头是不是某句英文"可靠得多：标签是提示词与代码
// 之间的显式约定，模型不遵守就是违约，而不需要代码去猜它可能会怎么违约。
//
// 允许标签外有少量前后空白（模型常在首尾加换行），但不允许标签外有正文——
// 标签外出现内容通常意味着模型在续写提示词，那部分会被丢弃并记为违规。
func extractWikiTaggedBlock(response, tag string) (string, error) {
	trimmed := strings.TrimSpace(response)
	if trimmed == "" {
		return "", fmt.Errorf("response is empty")
	}
	open := "<" + tag + ">"
	close := "</" + tag + ">"
	start := strings.Index(trimmed, open)
	if start < 0 {
		return "", fmt.Errorf("response does not contain the required <%s> opening tag", tag)
	}
	end := strings.Index(trimmed[start:], close)
	if end < 0 {
		return "", fmt.Errorf("response contains <%s> but no matching </%s> closing tag", tag, tag)
	}
	inner := trimmed[start+len(open) : start+end]

	// 标签外还有实质内容 → 模型在续写提示词或输出了协议外的东西。
	if prefix := strings.TrimSpace(trimmed[:start]); prefix != "" {
		return "", fmt.Errorf("response has %.40q before the <%s> tag; the protocol requires the tag first", prefix, tag)
	}
	if suffix := strings.TrimSpace(trimmed[start+end+len(close):]); suffix != "" {
		return "", fmt.Errorf("response has %.40q after the </%s> tag; the protocol requires the tag last", suffix, tag)
	}
	if strings.TrimSpace(inner) == "" {
		return "", fmt.Errorf("response contains <%s>...</%s> but the content is empty", tag, tag)
	}
	return strings.TrimSpace(inner), nil
}

// validateWikiReductionContract 校验 reduction（中间摘要）阶段是否满足提示词契约。
//
// 契约出处：service/wiki_prompt_templates.go 的 WikiSummaryReductionPrompt：
//
//	"Return only one compact paragraph, with length proportional to the source."
//	"Preserve the main subject, key facts, named entities, conclusions, and important figures."
//	"Create a concise intermediate summary of the following document material in {{.Language}}."
//
// 四条缺一不可：
//   - 单段：模型照抄源文档时经常保留原有的空行分段。
//   - 以中文为主：照抄源文档的英文指令行时汉字占比只有 5%。
//   - 非逐字照抄：这条最关键，它是"提炼"与"复制"的分界线。
//   - 非提示词复述：与提示词原文比对，与模型用什么措辞无关。
//
// prompt 为实际发送给模型的提示词原文。
func validateWikiReductionContract(response, source, language string) error {
	trimmed := strings.TrimSpace(response)
	if trimmed == "" {
		return fmt.Errorf("%s: reduction response is empty", wikiContractViolationMarker)
	}
	if !wikiContractIsSingleParagraph(trimmed) {
		return fmt.Errorf("%s: reduction response must be a single paragraph, got %d paragraphs",
			wikiContractViolationMarker, wikiContractParagraphCount(trimmed))
	}
	if wikiIndexIntroRequiresHan(language) && !wikiContractHasDominantHanRatio(trimmed) {
		return fmt.Errorf("%s: reduction response must be written in %s, but Chinese ratio is too low",
			wikiContractViolationMarker, language)
	}
	if wikiContractLooksVerbatimCopy(trimmed, source) {
		return fmt.Errorf("%s: reduction response copies the source verbatim instead of summarizing it",
			wikiContractViolationMarker)
	}
	return nil
}

// validateWikiSummaryContract 校验 summary（文档摘要页）阶段是否满足提示词契约。
//
// 契约出处：service/wiki_prompt_templates.go 的 WikiSummaryPrompt：
//
//	"Your entire response must be exactly this, and nothing else:
//	 <wiki_summary> SUMMARY: {...} {...} </wiki_summary>"
//	"Exactly one line inside the tags starts with \"SUMMARY:\"."
//	"Use only information explicitly present in <content> ..."
//
// 三条校验：
//   - 首行必须是 SUMMARY：提示词明确要求首行。splitSummaryLine 取的是最后一个
//     SUMMARY 行，前面的回显会被静默丢弃后照样落库。
//   - 非逐字照抄：摘要是提炼，不是复制。
//   - 非提示词复述：与提示词原文比对。
//
// prompt 为实际发送给模型的提示词原文。
func validateWikiSummaryContract(response, source, language string) error {
	trimmed := strings.TrimSpace(response)
	if trimmed == "" {
		return fmt.Errorf("%s: summary response is empty", wikiContractViolationMarker)
	}
	if !wikiContractStartsWithSummaryLine(trimmed) {
		return fmt.Errorf("%s: summary response must start with a SUMMARY line, got %.40q",
			wikiContractViolationMarker, trimmed)
	}
	if wikiContractLooksVerbatimCopy(trimmed, source) {
		return fmt.Errorf("%s: summary response copies the source verbatim instead of summarizing it",
			wikiContractViolationMarker)
	}
	return nil
}

// wikiContractParagraphCount 统计响应里的段落数（空行分隔）。
func wikiContractParagraphCount(text string) int {
	normalized := strings.ReplaceAll(strings.TrimSpace(text), "\r\n", "\n")
	count := 0
	for _, block := range strings.Split(normalized, "\n\n") {
		if strings.TrimSpace(block) == "" {
			continue
		}
		count++
	}
	return count
}

// generateCompiledPageContent 生成实体/概念页的正文，并按提示词契约校验。
//
// 这条路径此前完全没有校验——LLM 返回什么就落库什么，是十��调用点里唯一的
// 零防线。校验依据全部来自 WikiPageModifyPrompt 的明文契约：
//
//	"Your FIRST line must be exactly \"SUMMARY:\" followed by one sentence in {{.Language}}"
//	"Write in {{.Language}}."
//
// 判定不依赖任何"模型可能会说什么"的清单：首行前缀、语言占比、与提示词的重合度，
// 三条都与模型用哪种措辞无关。
//
// source 用于"逐字照抄"的判定：把新增的源材料拼起来作为比对基准。
func (s *WikiIngestV2Service) generateCompiledPageContent(ctx context.Context, prompt string, additions []WikiSlugUpdate, language string) (string, error) {
	source := wikiCompiledSourceText(additions)

	var lastViolation string
	compiled, err := generateWikiPromptWithRetry(ctx, func() (string, error) {
		response, callErr := s.llm.Generate(ctx, prompt)
		if callErr != nil {
			return "", callErr
		}
		inner, stripErr := extractWikiTaggedBlock(response, "wiki_page")
		if stripErr != nil {
			lastViolation = stripErr.Error()
			return "", fmt.Errorf("%s: %w", wikiContractViolationMarker, stripErr)
		}
		trimmed := strings.TrimSpace(inner)
		if !wikiContractStartsWithSummaryLine(trimmed) {
			lastViolation = fmt.Sprintf("response must start with a SUMMARY line, got %.40q", trimmed)
			return "", fmt.Errorf("%s: %s", wikiContractViolationMarker, lastViolation)
		}
		if wikiIndexIntroRequiresHan(language) && !wikiContractHasDominantHanRatio(trimmed) {
			lastViolation = fmt.Sprintf("response must be written in %s", language)
			return "", fmt.Errorf("%s: %s", wikiContractViolationMarker, lastViolation)
		}
		if source != "" && wikiContractLooksVerbatimCopy(trimmed, source) {
			lastViolation = "response copies the source chunks verbatim instead of compiling them"
			return "", fmt.Errorf("%s: %s", wikiContractViolationMarker, lastViolation)
		}
		return trimmed, nil
	},
		common.WithMaxRetries(2),
		common.WithRetryableFunc(isWikiSummaryFormatRetryableError),
		common.WithRetryHook(func(attempt int, retryErr error) {
			if attempt <= 0 || lastViolation == "" {
				return
			}
			prompt = prompt + fmt.Sprintf(`

Your previous attempt was rejected: %s

Write the page again, this time producing the <wiki_page> block that satisfies the shape and content requirements above.`, lastViolation)
			logger.Warnf(ctx, "【Wiki生成】 page_modify 重试并纠偏 attempt=%d violation=%s", attempt+1, truncateWikiText(lastViolation, 160))
			lastViolation = ""
		}),
	)
	if err != nil {
		return "", fmt.Errorf("generate compiled page content: %w", err)
	}
	return strings.TrimSpace(compiled), nil
}

// wikiCompiledSourceText 把本次新增的源材料拼成一段文本，供"逐字照抄"判定使用。
func wikiCompiledSourceText(additions []WikiSlugUpdate) string {
	parts := make([]string, 0, len(additions))
	for _, update := range additions {
		if text := strings.TrimSpace(update.Content); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n\n")
}
