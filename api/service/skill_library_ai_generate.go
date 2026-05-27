package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

const (
	SkillAIGenerateTypeCapabilities    = "capabilities"
	SkillAIGenerateTypeUsageExample    = "usage_example"
	SkillAIGenerateTypeBestPractice    = "best_practice"
	SkillAIGenerateTypeFAQ             = "faq"
	SkillAIGenerateTypeDocumentSummary = "document_summary"
)

const (
	defaultTitleMaxChars       = 20
	defaultDescriptionMaxChars = 1000
	defaultQuestionMaxChars    = 20
	defaultAnswerMaxChars      = 1000
	defaultCaseMaxChars        = 200
	defaultSummaryMaxChars     = 500
)

var (
	ErrSkillAIGenerationTypeInvalid = errors.New("invalid generation_type")
	ErrSkillAIGenerationParseFailed = errors.New("ai response parse failed")
	ErrSkillAIGenerationDocRequired = errors.New("document content is required")
)

type SkillAIGenerateRequest struct {
	GenerationType      string `json:"generation_type"`
	SkillMD             string `json:"skill_md"`
	TitleMaxChars       int    `json:"title_max_chars"`
	DescriptionMaxChars int    `json:"description_max_chars"`
	QuestionMaxChars    int    `json:"question_max_chars"`
	AnswerMaxChars      int    `json:"answer_max_chars"`
	CaseMaxChars        int    `json:"case_max_chars"`
	TargetChars         int    `json:"target_chars"`
	Document            string `json:"document"`
}

type SkillAIGenerateResult struct {
	GenerationType string            `json:"generation_type"`
	Content        map[string]string `json:"content"`
}

type skillAIGeneratePayload struct {
	Title        string `json:"title"`
	Description  string `json:"description"`
	Question     string `json:"question"`
	Answer       string `json:"answer"`
	PositiveCase string `json:"positive_case"`
	NegativeCase string `json:"negative_case"`
	Summary      string `json:"summary"`
}

func (s *SkillLibraryService) GenerateSkillContent(ctx context.Context, eid, skillID int64, req *SkillAIGenerateRequest) (*SkillAIGenerateResult, error) {
	if req == nil {
		return nil, ErrSkillImportRequestInvalid
	}

	generationType := strings.TrimSpace(req.GenerationType)
	if !isValidSkillAIGenerationType(generationType) {
		return nil, ErrSkillAIGenerationTypeInvalid
	}

	skillInfo, err := model.GetSkillLibraryByIDAndEID(eid, skillID)
	if err != nil {
		return nil, err
	}
	if skillInfo.Eid == 0 {
		return nil, ErrSkillPlatformReadonly
	}

	runtime, err := s.resolveWorkAIScanRuntime(ctx, eid)
	if err != nil {
		return nil, err
	}

	skillMD, err := s.resolveSkillMDForAIGenerate(skillInfo, req.SkillMD)
	if err != nil {
		return nil, err
	}

	prompt, err := s.buildSkillAIGeneratePrompt(generationType, skillMD, req)
	if err != nil {
		return nil, err
	}

	request := &relaymodel.GeneralOpenAIRequest{
		Model:     runtime.Model,
		MaxTokens: 2048,
		Messages: []relaymodel.Message{
			{
				Role:    "system",
				Content: "你是企业技能文案助手。请严格输出 JSON，禁止 Markdown 与额外解释。",
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
	}

	respText, callErr, openaiErr := invokeSkillLibraryLLMWithInvoker(ctx, s.resolveLLMInvoker(), runtime.Channel, request)
	if callErr != nil {
		return nil, callErr
	}
	if openaiErr != nil {
		return nil, fmt.Errorf("ai generate failed: %s", openaiErr.Message)
	}

	parsed, err := parseSkillAIGeneratePayload(respText)
	if err != nil {
		return nil, err
	}

	result := &SkillAIGenerateResult{
		GenerationType: generationType,
		Content:        make(map[string]string),
	}
	titleMax, descMax, questionMax, answerMax, caseMax, summaryMax := normalizeGenerateLimits(req)

	switch generationType {
	case SkillAIGenerateTypeCapabilities:
		result.Content["title"] = truncateByRunes(strings.TrimSpace(parsed.Title), titleMax)
		result.Content["description"] = truncateByRunes(strings.TrimSpace(parsed.Description), descMax)
	case SkillAIGenerateTypeUsageExample:
		result.Content["question"] = truncateByRunes(strings.TrimSpace(parsed.Question), questionMax)
		result.Content["answer"] = truncateByRunes(strings.TrimSpace(parsed.Answer), answerMax)
	case SkillAIGenerateTypeBestPractice:
		result.Content["positive_case"] = truncateByRunes(strings.TrimSpace(parsed.PositiveCase), caseMax)
		result.Content["negative_case"] = truncateByRunes(strings.TrimSpace(parsed.NegativeCase), caseMax)
	case SkillAIGenerateTypeFAQ:
		result.Content["question"] = truncateByRunes(strings.TrimSpace(parsed.Question), questionMax)
		result.Content["answer"] = truncateByRunes(strings.TrimSpace(parsed.Answer), answerMax)
	case SkillAIGenerateTypeDocumentSummary:
		result.Content["summary"] = truncateByRunes(strings.TrimSpace(parsed.Summary), summaryMax)
	default:
		return nil, ErrSkillAIGenerationTypeInvalid
	}

	return result, nil
}

func (s *SkillLibraryService) resolveSkillMDForAIGenerate(skillInfo *model.SkillLibrary, input string) (string, error) {
	if strings.TrimSpace(input) != "" {
		return input, nil
	}
	if skillInfo == nil {
		return "", gorm.ErrRecordNotFound
	}
	content, err := os.ReadFile(filepath.Join(skillInfo.InstallPath, "SKILL.md"))
	if err != nil {
		return "", err
	}
	return string(content), nil
}

func (s *SkillLibraryService) buildSkillAIGeneratePrompt(generationType, skillMD string, req *SkillAIGenerateRequest) (string, error) {
	titleMax, descMax, questionMax, answerMax, caseMax, summaryMax := normalizeGenerateLimits(req)
	switch generationType {
	case SkillAIGenerateTypeCapabilities:
		return fmt.Sprintf(`请基于 SKILL.md 生成“能做什么”文案，输出 JSON：
{"title":"", "description":""}
要求：
1) title 不超过 %d 字符。
2) description 不超过 %d 字符。

SKILL.md:
%s`, titleMax, descMax, skillMD), nil
	case SkillAIGenerateTypeUsageExample:
		return fmt.Sprintf(`请基于 SKILL.md 生成“使用示例”，输出 JSON：
{"question":"", "answer":""}
要求：
1) question 不超过 %d 字符。
2) answer 不超过 %d 字符。

SKILL.md:
%s`, questionMax, answerMax, skillMD), nil
	case SkillAIGenerateTypeBestPractice:
		return fmt.Sprintf(`请基于 SKILL.md 生成“最佳实践”，输出 JSON：
{"positive_case":"", "negative_case":""}
要求：
1) positive_case 不超过 %d 字符。
2) negative_case 不超过 %d 字符。

SKILL.md:
%s`, caseMax, caseMax, skillMD), nil
	case SkillAIGenerateTypeFAQ:
		return fmt.Sprintf(`请基于 SKILL.md 生成“常见问题”，输出 JSON：
{"question":"", "answer":""}
要求：
1) question 不超过 %d 字符。
2) answer 不超过 %d 字符。

SKILL.md:
%s`, questionMax, answerMax, skillMD), nil
	case SkillAIGenerateTypeDocumentSummary:
		document := strings.TrimSpace(req.Document)
		if document == "" {
			return "", ErrSkillAIGenerationDocRequired
		}
		return fmt.Sprintf(`请根据输入文档生成摘要，输出 JSON：
{"summary":""}
要求：
1) summary 不超过 %d 字符。
2) 保留关键事实，不输出额外字段。

文档内容：
%s`, summaryMax, document), nil
	default:
		return "", ErrSkillAIGenerationTypeInvalid
	}
}

func isValidSkillAIGenerationType(generationType string) bool {
	switch generationType {
	case SkillAIGenerateTypeCapabilities,
		SkillAIGenerateTypeUsageExample,
		SkillAIGenerateTypeBestPractice,
		SkillAIGenerateTypeFAQ,
		SkillAIGenerateTypeDocumentSummary:
		return true
	default:
		return false
	}
}

func normalizeGenerateLimits(req *SkillAIGenerateRequest) (titleMax, descMax, questionMax, answerMax, caseMax, summaryMax int) {
	titleMax = normalizeLimit(req.TitleMaxChars, defaultTitleMaxChars)
	descMax = normalizeLimit(req.DescriptionMaxChars, defaultDescriptionMaxChars)
	questionMax = normalizeLimit(req.QuestionMaxChars, defaultQuestionMaxChars)
	answerMax = normalizeLimit(req.AnswerMaxChars, defaultAnswerMaxChars)
	caseMax = normalizeLimit(req.CaseMaxChars, defaultCaseMaxChars)
	summaryMax = normalizeLimit(req.TargetChars, defaultSummaryMaxChars)
	return
}

func normalizeLimit(input, fallback int) int {
	if input <= 0 {
		return fallback
	}
	return input
}

func parseSkillAIGeneratePayload(respText string) (*skillAIGeneratePayload, error) {
	content := strings.TrimSpace(respText)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, ErrSkillAIGenerationParseFailed
	}

	var payload skillAIGeneratePayload
	errObj := json.Unmarshal([]byte(content), &payload)
	if errObj == nil {
		return &payload, nil
	}

	var payloadList []skillAIGeneratePayload
	errArr := json.Unmarshal([]byte(content), &payloadList)
	if errArr == nil {
		if len(payloadList) == 0 {
			return nil, ErrSkillAIGenerationParseFailed
		}
		return &payloadList[0], nil
	}

	return nil, fmt.Errorf("%w: %v", ErrSkillAIGenerationParseFailed, errObj)
}

func truncateByRunes(input string, maxChars int) string {
	if maxChars <= 0 {
		return ""
	}
	if utf8.RuneCountInString(input) <= maxChars {
		return input
	}
	runes := []rune(input)
	return string(runes[:maxChars])
}
