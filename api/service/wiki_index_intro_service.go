package service

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/53AI/53AIHub/common/logger"
)

type WikiIndexIntroLLMRunner interface {
	Generate(ctx context.Context, prompt string) (string, error)
}

type WikiIndexIntroService struct {
	prompts *WikiPromptService
	llm     WikiIndexIntroLLMRunner
}

type WikiIndexIntroInput struct {
	Language          string
	DocumentSummaries []string
	ExistingIntro     string
	ChangeDescription string
}

func NewWikiIndexIntroService(prompts *WikiPromptService, llm WikiIndexIntroLLMRunner) *WikiIndexIntroService {
	if prompts == nil {
		prompts = NewWikiPromptService()
	}
	return &WikiIndexIntroService{
		prompts: prompts,
		llm:     llm,
	}
}

// wikiIndexIntroMaxAttempts 是index 简介的最大尝试次数（首次 + 2 次纠偏重试）。
const wikiIndexIntroMaxAttempts = 3

// wikiIndexIntroRetryReminder 在重试时追加的纠偏指令。
//
// 背景：生产日志 logs/53AIHub-20261021.log:65225 / :73001 显示，模型对该提示词的回应是
// 原样吐出一句自造的指令套话（"NOT include any analysis, explanations, or markdown
// formatting. Do NOT put the output in a code block."），且多次重试返回完全相同的文本。
// 因此重试不能只是重复同一段提示词，必须显式指出"上一次输出无效"并给出可验证的交付格式。
const wikiIndexIntroRetryReminder = `

<important_reminder>
Your previous reply was rejected: it restated these instructions instead of producing the wiki introduction.
The reply must satisfy ALL of the following, otherwise it will be rejected again:
1. The FIRST line starts with "# " followed by a Chinese title.
2. Followed by 2-3 Chinese sentences describing what this wiki covers.
3. It must NOT contain any English instruction text, any mention of these rules, and no explanation of what you are doing.
Now output the final result directly.
</important_reminder>`

func (s *WikiIndexIntroService) GenerateIntro(ctx context.Context, input WikiIndexIntroInput) (string, error) {
	if s == nil || s.prompts == nil {
		return "", fmt.Errorf("wiki index intro service is nil")
	}
	if s.llm == nil {
		return "", fmt.Errorf("wiki llm runner is nil")
	}

	prompt, err := s.prompts.Render(WikiIndexIntroPrompt, map[string]any{
		"DocumentSummaries": renderWikiIndexDocumentSummaries(input.DocumentSummaries),
		"Language":          normalizeWikiIndexLanguage(input.Language),
	})
	if err != nil {
		return "", fmt.Errorf("render wiki index intro prompt: %w", err)
	}

	return s.generateValidated(ctx, "generate", prompt, input)
}

func (s *WikiIndexIntroService) UpdateIntro(ctx context.Context, input WikiIndexIntroInput) (string, error) {
	if s == nil || s.prompts == nil {
		return "", fmt.Errorf("wiki index intro service is nil")
	}
	if s.llm == nil {
		return "", fmt.Errorf("wiki llm runner is nil")
	}

	existing := strings.TrimSpace(input.ExistingIntro)

	// 污染自愈：库里已有的简介如果本身就是提示词回显，继续把它当"现有简介"回灌只会
	// 自我强化——日志 :72955 的请求里<current_introduction> 已经是被污染的内容，
	// 模型于是照着它又吐了一遍同样的垃圾。此处直接判定为无历史简介，走全新生成。
	if wikiIndexIntroIsPolluted(existing) {
		logger.Warnf(ctx, "【Wiki生成】 WikiIndexIntro 现有简介疑似提示词回显，改为重新生成: preview=%q",
			truncateWikiIndexText(existing, 120))
		input.ExistingIntro = ""
		existing = ""
	}

	// 没有可用历史简介时，退回"首次生成"提示词，避免把空<current_introduction> 喂给模型。
	if existing == "" {
		return s.GenerateIntro(ctx, input)
	}

	prompt, err := s.prompts.Render(WikiIndexIntroUpdatePrompt, map[string]any{
		"ExistingIntro":     existing,
		"ChangeDescription": strings.TrimSpace(input.ChangeDescription),
		"DocumentSummaries": renderWikiIndexDocumentSummaries(input.DocumentSummaries),
		"Language":          normalizeWikiIndexLanguage(input.Language),
	})
	if err != nil {
		return "", fmt.Errorf("render wiki index intro update prompt: %w", err)
	}

	return s.generateValidated(ctx, "update", prompt, input)
}

// generateValidated 调用模型并校验输出；不合格时带纠偏指令重试。
// 全部尝试失败后返回错误，由调用方决定不落库（保持现有内容不变）。
//
// 重试携带纠偏信息：每次失败都会把"上一次具体违反了哪条契约"回灌给模型。
// 早期实现重发的是逐字节相同的提示词，属于盲重采样——生产日志里出现过多次
// 逐字节相同的响应，纯粹浪费 token。
func (s *WikiIndexIntroService) generateValidated(ctx context.Context, action, prompt string, input WikiIndexIntroInput) (string, error) {
	language := normalizeWikiIndexLanguage(input.Language)
	var lastErr error
	var lastViolation string

	for attempt := 1; attempt <= wikiIndexIntroMaxAttempts; attempt++ {
		current := prompt
		if attempt > 1 && lastViolation != "" {
			current = prompt + fmt.Sprintf(`

Your previous attempt was rejected: %s

Produce the <wiki_index_intro> block again, this time satisfying the shape and content requirements above.`, lastViolation)
		}

		raw, err := s.llm.Generate(ctx, current)
		if err != nil {
			lastErr = fmt.Errorf("generate wiki index intro (%s): %w", action, err)
			logger.Warnf(ctx, "【Wiki生成】 WikiIndexIntro 调用失败 action=%s attempt=%d/%d err=%v",
				action, attempt, wikiIndexIntroMaxAttempts, err)
			continue
		}

		intro, verr := extractWikiTaggedBlock(raw, "wiki_index_intro")
		if verr != nil {
			lastErr = verr
			lastViolation = verr.Error()
			logger.Warnf(ctx, "【Wiki生成】 WikiIndexIntro 输出协议违规 action=%s attempt=%d/%d err=%v raw=%q",
				action, attempt, wikiIndexIntroMaxAttempts, verr, truncateWikiIndexText(strings.TrimSpace(raw), 200))
			continue
		}
		if verr := validateWikiIndexIntroOutput(intro, language); verr != nil {
			lastErr = verr
			lastViolation = verr.Error()
			logger.Warnf(ctx, "【Wiki生成】 WikiIndexIntro 输出校验失败 action=%s attempt=%d/%d err=%v raw=%q",
				action, attempt, wikiIndexIntroMaxAttempts, verr, truncateWikiIndexText(strings.TrimSpace(raw), 200))
			continue
		}

		if attempt > 1 {
			logger.Infof(ctx, "【Wiki生成】 WikiIndexIntro 重试后通过校验 action=%s attempt=%d/%d chars=%d",
				action, attempt, wikiIndexIntroMaxAttempts, len([]rune(intro)))
		}
		return normalizeWikiIndexIntroOutput(intro), nil
	}

	return "", fmt.Errorf("wiki index intro (%s) rejected after %d attempts: %w", action, wikiIndexIntroMaxAttempts, lastErr)
}

// validateWikiIndexIntroOutput 校验模型输出是否是可落库的简介。
//
// 判定依据全部来自提示词自身的硬性契约（service/wiki_prompt_templates.go 的
// WikiIndexIntroPrompt / WikiIndexIntroUpdatePrompt）：
//
//	"The first line after the opening tag is a Markdown heading: it starts with "# " followed by the title."
//	"two or three sentences in {{.Language}} describing what this wiki covers"
//
// 三条校验缺一不可：仅判空会让自造指令直接落库；仅判语言会放过纯英文正文；
// 仅判回显则对没命中任何清单的套话失效。
//
func validateWikiIndexIntroOutput(raw, language string) error {
	intro := strings.TrimSpace(raw)
	if intro == "" {
		return fmt.Errorf("intro is empty")
	}
	if !strings.HasPrefix(intro, "#") {
		return fmt.Errorf("intro must start with a '# ' title line, got %.40q", intro)
	}
	if wikiIndexIntroRequiresHan(language) && !wikiResponseHasSubstantiveHanRatio(intro) {
		return fmt.Errorf("intro has no substantive Chinese content for language %q", language)
	}
	return nil
}

// wikiIndexIntroIsPolluted 判断库中已有简介是否为提示词回显/指令套话。
//
// 判定不依赖任何具体字符串清单：合法简介必然以 "# " 开头且含实质中文，
// 两者缺一即为污染。
func wikiIndexIntroIsPolluted(existing string) bool {
	existing = strings.TrimSpace(existing)
	if existing == "" {
		return false
	}
	if !strings.HasPrefix(existing, "#") {
		return true
	}
	return !wikiResponseHasSubstantiveHanRatio(existing)
}

func wikiRuneIsHan(r rune) bool {
	return unicode.Is(unicode.Han, r)
}

// wikiIndexIntroRequiresHan 判断目标语言是否要求中文输出。
func wikiIndexIntroRequiresHan(language string) bool {
	normalized := strings.ToLower(strings.TrimSpace(language))
	if normalized == "" {
		return true
	}
	for _, marker := range []string{"中文", "chinese", "zh", "cn", "简体", "繁體", "繁体"} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func renderWikiIndexDocumentSummaries(summaries []string) string {
	if len(summaries) == 0 {
		return "(no documents yet)"
	}
	var builder strings.Builder
	for _, summary := range summaries {
		summary = strings.TrimSpace(summary)
		if summary == "" {
			continue
		}
		builder.WriteString("<document>\n")
		builder.WriteString(summary)
		builder.WriteString("\n</document>\n\n")
	}
	result := strings.TrimSpace(builder.String())
	if result == "" {
		return "(no documents yet)"
	}
	return result
}

func normalizeWikiIndexIntroOutput(raw string) string {
	intro := strings.TrimSpace(raw)
	if intro == "" {
		return "# Wiki Index\n\nThis wiki contains knowledge extracted from uploaded documents."
	}
	if idx := strings.Index(intro, "\n## "); idx >= 0 {
		intro = strings.TrimSpace(intro[:idx])
	}
	return intro
}

func normalizeWikiIndexLanguage(language string) string {
	language = strings.TrimSpace(language)
	if language == "" {
		return "中文"
	}
	return language
}