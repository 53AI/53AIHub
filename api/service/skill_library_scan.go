package service

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/model"
	skillsvc "github.com/53AI/53AIHub/service/skill"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

const (
	skillScanMaxRetry                    = int64(3)
	skillScanRunningTimeoutSecondsEnvKey = "SKILL_SCAN_RUNNING_TIMEOUT_SECONDS"
	skillScanRunningTimeoutSecondsDef    = 900
	skillDescriptionMaxChars             = 450
	skillScanMarkdownSummaryMaxChars     = 1800
	skillScanInstructionExcerptMaxChars  = 800
	skillScanFileSummaryMaxEntries       = 20
	skillScanFileSummaryMaxRiskEntries   = 12
)

var skillRejectedDeleteDelay = 5 * time.Minute

// SkillScanner defines the scan behavior and can be replaced in tests.
type SkillScanner interface {
	Scan(ctx context.Context, in *SkillScanInput) (*SkillScanOutput, error)
}

type SkillScanInput struct {
	Skill          *model.SkillLibrary
	ScanModel      string
	ScanChannel    *model.Channel
	LLMInvoker     skillLibraryLLMInvoker
	SkillMD        string
	FileEntries    []string
	SkillName      string
	RawDescription string
}

type SkillScanOutput struct {
	RiskLevel         string
	ScoreIntegrity    float64
	ScorePracticality float64
	ScoreSafety       float64
	ScoreCodeQuality  float64
	ScoreDocQuality   float64
	Message           string
	ScanPayload       string
	Retryable         bool
	Description       string
}

type defaultSkillScanner struct{}

type workAIScanRuntime struct {
	Model   string
	Channel *model.Channel
}

type skillScanResultPayload struct {
	RiskLevel         string          `json:"risk_level"`
	ScoreIntegrity    flexibleFloat64 `json:"score_integrity"`
	ScorePracticality flexibleFloat64 `json:"score_practicality"`
	ScoreSafety       flexibleFloat64 `json:"score_safety"`
	ScoreCodeQuality  flexibleFloat64 `json:"score_code_quality"`
	ScoreDocQuality   flexibleFloat64 `json:"score_doc_quality"`
	Message           string          `json:"message"`
	Description       string          `json:"description"`
}

type skillDescriptionRewritePayload struct {
	Description string `json:"description"`
}

type flexibleFloat64 float64

func (f *flexibleFloat64) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || strings.EqualFold(trimmed, "null") {
		*f = 0
		return nil
	}

	var numeric json.Number
	if err := json.Unmarshal(data, &numeric); err == nil {
		value, parseErr := numeric.Float64()
		if parseErr == nil {
			*f = flexibleFloat64(value)
			return nil
		}
	}

	var text string
	if err := json.Unmarshal(data, &text); err == nil {
		text = strings.TrimSpace(text)
		text = strings.TrimSuffix(text, "分")
		text = strings.TrimSuffix(text, "%")
		if text == "" {
			*f = 0
			return nil
		}
		value, parseErr := strconv.ParseFloat(text, 64)
		if parseErr == nil {
			*f = flexibleFloat64(value)
			return nil
		}
	}

	return fmt.Errorf("invalid float value: %s", trimmed)
}

func NewDefaultSkillScanner() SkillScanner {
	return &defaultSkillScanner{}
}

func buildSkillScanPrompt(in *SkillScanInput) (string, string) {
	skillName := ""
	skillSummary := "（无）"
	fileSummary := "（无）"
	if in != nil {
		skillName = strings.TrimSpace(in.SkillName)
		skillSummary = summarizeSkillMarkdownForScan(in.SkillMD)
		fileSummary = summarizeSkillEntriesForScan(in.FileEntries)
	}

	systemPrompt := `# 角色
你是技能安全审计器。

# 目标
请根据输入判断风险并输出评分，只允许返回严格 JSON。

# 输出要求
- 不要返回 Markdown
- 不要返回解释
- 不要返回代码块
- 不要返回额外字段
- 所有评分保留 1 位小数

# 风险策略
- 先判断 risk_level
- 一旦存在明显危险脚本、命令执行、越权或破坏性行为，risk_level 必须为 high
- 高风险时 description 必须为空
- 低/中风险时 description 只保留核心用途，尽量短`

	userPrompt := fmt.Sprintf(`# 待审计技能
## 技能名
%s

## 技能摘要
%s

## 文件清单摘要
%s

## 输出格式
{
  "risk_level": "low|medium|high",
  "score_integrity": 1-5,
  "score_practicality": 1-5,
  "score_safety": 1-5,
  "score_code_quality": 1-5,
  "score_doc_quality": 1-5,
  "message": "简短结论",
  "description": "低/中风险时返回适合前台展示的中文简介；高风险时必须为空"
}

## 评分说明
- 评分范围为 1-5
- 所有评分保留 1 位小数
- 输出必须严格符合上面的 JSON 格式`, skillName, skillSummary, fileSummary)

	return systemPrompt, userPrompt
}

func summarizeSkillMarkdownForScan(skillMD string) string {
	skillMD = strings.TrimSpace(skillMD)
	if skillMD == "" {
		return "（空）"
	}

	parsed, err := skillsvc.ParseSkillMetadata(skillMD)
	if err != nil || parsed == nil {
		return truncateByRunes(skillMD, skillScanMarkdownSummaryMaxChars)
	}

	var builder strings.Builder
	writeLine := func(label, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		builder.WriteString(label)
		builder.WriteString("：")
		builder.WriteString(value)
		builder.WriteString("\n")
	}

	builder.WriteString("### 关键信息\n")
	writeLine("名称", parsed.Name)
	writeLine("描述", truncateByRunes(parsed.Description, 240))
	writeLine("版本", normalizeSkillVersion(parsed.Version))

	if len(parsed.AllowedTools) > 0 {
		builder.WriteString("### 允许工具\n")
		builder.WriteString("- ")
		builder.WriteString(strings.Join(limitStringSlice(parsed.AllowedTools, 8), ", "))
		builder.WriteString("\n")
	}
	if len(parsed.Resources) > 0 {
		builder.WriteString("### 资源\n")
		builder.WriteString("- ")
		builder.WriteString(strings.Join(limitStringSlice(parsed.Resources, 8), ", "))
		builder.WriteString("\n")
	}
	if len(parsed.Requires.Bins) > 0 || len(parsed.Requires.Env) > 0 || len(parsed.Requires.Config) > 0 {
		builder.WriteString("### 依赖\n")
		if len(parsed.Requires.Bins) > 0 {
			builder.WriteString("- bins: ")
			builder.WriteString(strings.Join(limitStringSlice(parsed.Requires.Bins, 8), ", "))
			builder.WriteString("\n")
		}
		if len(parsed.Requires.Env) > 0 {
			builder.WriteString("- env: ")
			builder.WriteString(strings.Join(limitStringSlice(parsed.Requires.Env, 8), ", "))
			builder.WriteString("\n")
		}
		if len(parsed.Requires.Config) > 0 {
			builder.WriteString("- config: ")
			builder.WriteString(strings.Join(limitStringSlice(parsed.Requires.Config, 8), ", "))
			builder.WriteString("\n")
		}
	}

	instruction := strings.TrimSpace(parsed.Instruction)
	if instruction != "" {
		builder.WriteString("### 指令摘录\n")
		builder.WriteString(compactMarkdownExcerpt(instruction, 24, skillScanInstructionExcerptMaxChars))
		builder.WriteString("\n")
	}

	summary := strings.TrimSpace(builder.String())
	if summary == "" {
		return truncateByRunes(skillMD, skillScanMarkdownSummaryMaxChars)
	}
	return truncateByRunes(summary, skillScanMarkdownSummaryMaxChars)
}

func summarizeSkillEntriesForScan(entries []string) string {
	cleaned := make([]string, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		entry = strings.TrimSpace(strings.ReplaceAll(entry, "\\", "/"))
		if entry == "" {
			continue
		}
		if _, exists := seen[entry]; exists {
			continue
		}
		seen[entry] = struct{}{}
		cleaned = append(cleaned, entry)
	}
	if len(cleaned) == 0 {
		return "（无文件清单）"
	}

	topDirs := uniqueTopLevelDirs(cleaned)
	riskEntries := pickRiskRelevantEntries(cleaned, skillScanFileSummaryMaxRiskEntries)
	representative := limitStringSlice(cleaned, skillScanFileSummaryMaxEntries)

	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("- 总文件数：%d\n", len(cleaned)))
	if len(topDirs) > 0 {
		builder.WriteString("- 顶层目录：")
		builder.WriteString(strings.Join(topDirs, ", "))
		builder.WriteString("\n")
	}
	if len(riskEntries) > 0 {
		builder.WriteString("- 风险相关文件：")
		builder.WriteString(strings.Join(riskEntries, ", "))
		builder.WriteString("\n")
	}
	if len(representative) > 0 {
		builder.WriteString("- 代表性文件：\n")
		for _, entry := range representative {
			builder.WriteString("  - ")
			builder.WriteString(entry)
			builder.WriteString("\n")
		}
	}
	remaining := len(cleaned) - len(representative)
	if remaining > 0 {
		builder.WriteString(fmt.Sprintf("- 其余文件：%d 个（已省略）\n", remaining))
	}
	return strings.TrimSpace(builder.String())
}

func compactMarkdownExcerpt(text string, maxLines, maxChars int) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	lines := strings.Split(text, "\n")
	selected := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		selected = append(selected, line)
		if maxLines > 0 && len(selected) >= maxLines {
			break
		}
	}
	if len(selected) == 0 {
		return truncateByRunes(text, maxChars)
	}
	return truncateByRunes(strings.Join(selected, "\n"), maxChars)
}

func limitStringSlice(items []string, limit int) []string {
	if limit <= 0 || len(items) == 0 {
		return nil
	}
	if len(items) <= limit {
		out := make([]string, 0, len(items))
		for _, item := range items {
			item = strings.TrimSpace(item)
			if item != "" {
				out = append(out, item)
			}
		}
		return out
	}

	out := make([]string, 0, limit)
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		out = append(out, item)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func uniqueTopLevelDirs(entries []string) []string {
	seen := make(map[string]struct{})
	dirs := make([]string, 0)
	for _, entry := range entries {
		top := entry
		if idx := strings.Index(top, "/"); idx >= 0 {
			top = top[:idx]
		}
		top = strings.TrimSpace(top)
		if top == "" {
			continue
		}
		if _, exists := seen[top]; exists {
			continue
		}
		seen[top] = struct{}{}
		dirs = append(dirs, top)
	}
	sort.Strings(dirs)
	return limitStringSlice(dirs, 10)
}

func pickRiskRelevantEntries(entries []string, limit int) []string {
	candidates := make([]string, 0)
	for _, entry := range entries {
		lower := strings.ToLower(entry)
		if isRiskRelevantSkillFile(lower) {
			candidates = append(candidates, entry)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	return limitStringSlice(candidates, limit)
}

func isRiskRelevantSkillFile(entry string) bool {
	riskPatterns := []string{
		"install",
		"setup",
		"script",
		"scripts",
		".sh",
		".bash",
		".zsh",
		".ps1",
		".bat",
		".cmd",
		"docker",
		"compose",
		"kubectl",
		"terraform",
		"ansible",
		"curl",
		"wget",
		"powershell",
		"python",
		".py",
		".js",
		".ts",
		"exec",
		"eval",
		"run",
	}
	for _, pattern := range riskPatterns {
		if strings.Contains(entry, pattern) {
			return true
		}
	}
	return false
}

func (s *defaultSkillScanner) Scan(ctx context.Context, in *SkillScanInput) (*SkillScanOutput, error) {
	if in == nil || strings.TrimSpace(in.SkillMD) == "" {
		return nil, ErrSkillScanMissingSkillMD
	}
	if in.ScanChannel == nil {
		return nil, ErrSkillScanNoWorkAIModelConfigured
	}
	if strings.TrimSpace(in.ScanModel) == "" {
		return nil, ErrSkillScanNoWorkAIModelConfigured
	}

	systemPrompt, userPrompt := buildSkillScanPrompt(in)

	request := &relaymodel.GeneralOpenAIRequest{
		Model:     in.ScanModel,
		MaxTokens: 1536,
		Messages: []relaymodel.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	invoker := in.LLMInvoker
	if invoker == nil {
		invoker = newDefaultSkillLibraryLLMInvoker()
	}

	responseText, callErr, openaiErr := invokeSkillLibraryLLMWithInvoker(ctx, invoker, in.ScanChannel, request)
	if callErr != nil {
		logger.Warnf(ctx, "【技能运行】扫描模型调用失败，启用基础兜底: skill_name=%s err=%v", in.SkillName, callErr)
		return fallbackSkillScanOutput(in, fmt.Sprintf("llm call failed: %v", callErr)), nil
	}
	if openaiErr != nil {
		logger.Warnf(ctx, "【技能运行】扫描模型返回错误，启用基础兜底: skill_name=%s err=%s", in.SkillName, openaiErr.Message)
		return fallbackSkillScanOutput(in, fmt.Sprintf("llm scan failed: %s", openaiErr.Message)), nil
	}

	parsed, err := parseSkillScanResultPayload(ctx, responseText)
	if err != nil {
		logger.Warnf(ctx, "【技能运行】扫描响应解析失败: skill_name=%s err=%v response=%q", in.SkillName, err, responseText)
		return fallbackSkillScanOutput(in, err.Error()), nil
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"scan_model":    in.ScanModel,
		"entry_count":   len(in.FileEntries),
		"skill_md_size": len(in.SkillMD),
		"risk_level":    parsed.RiskLevel,
		"llm_response":  responseText,
	})

	output := &SkillScanOutput{
		RiskLevel:         parsed.RiskLevel,
		ScoreIntegrity:    clampScore(float64(parsed.ScoreIntegrity)),
		ScorePracticality: clampScore(float64(parsed.ScorePracticality)),
		ScoreSafety:       clampScore(float64(parsed.ScoreSafety)),
		ScoreCodeQuality:  clampScore(float64(parsed.ScoreCodeQuality)),
		ScoreDocQuality:   clampScore(float64(parsed.ScoreDocQuality)),
		Message:           strings.TrimSpace(parsed.Message),
		Description:       normalizeScanDescription(parsed.Description, parsed.RiskLevel),
		ScanPayload:       string(payload),
		Retryable:         false,
	}
	if output.Message == "" {
		output.Message = "扫描完成"
	}
	if output.RiskLevel == model.SkillRiskLevelHigh {
		output.Message = "当前技能危险性过高，禁止使用。"
		output.Description = ""
	}

	return output, nil
}

func (s *SkillLibraryService) rewriteSkillDescription(ctx context.Context, runtime *workAIScanRuntime, skillName, rawDescription string) string {
	rawDescription = strings.TrimSpace(rawDescription)
	if rawDescription == "" {
		return ""
	}
	if runtime == nil || runtime.Channel == nil || strings.TrimSpace(runtime.Model) == "" {
		return truncateByRunes(rawDescription, skillDescriptionMaxChars)
	}

	invoker := s.resolveLLMInvoker()
	rewritten, err := s.rewriteSkillDescriptionWithInvoker(ctx, runtime, skillName, rawDescription, invoker)
	if err != nil {
		logger.Warnf(ctx, "【技能运行】中文描述生成失败，回退原始描述: skill_name=%s err=%v", skillName, err)
		return truncateByRunes(rawDescription, skillDescriptionMaxChars)
	}
	return rewritten
}

func (s *SkillLibraryService) rewriteSkillDescriptionWithInvoker(ctx context.Context, runtime *workAIScanRuntime, skillName, rawDescription string, invoker skillLibraryLLMInvoker) (string, error) {
	if runtime == nil || runtime.Channel == nil || strings.TrimSpace(runtime.Model) == "" {
		return "", ErrSkillScanNoWorkAIModelConfigured
	}
	if invoker == nil {
		return "", ErrSkillScanNoWorkAIModelConfigured
	}

	rawDescription = strings.TrimSpace(rawDescription)
	if rawDescription == "" {
		return "", nil
	}

	request := &relaymodel.GeneralOpenAIRequest{
		Model:     runtime.Model,
		MaxTokens: 1024,
		Messages: []relaymodel.Message{
			{
				Role:    "system",
				Content: "你是企业技能文案助手。请将输入的技能描述翻译成中文，并严格输出 JSON，禁止 Markdown 和额外解释。",
			},
			{
				Role: "user",
				Content: fmt.Sprintf(`请把下面的技能描述翻译成适合前台展示的中文简介，严格输出 JSON：
{"description":""}
要求：
1) description 必须是中文。
2) description 不超过 %d 个字。
3) 保留技能核心用途，不要输出编号、解释、Markdown 或额外字段。
4) 如果原文已经是中文，也请整理成更自然、更简洁的中文表达。

技能名：%s
原始描述：
%s`, skillDescriptionMaxChars, skillName, rawDescription),
			},
		},
	}

	respText, callErr, openaiErr := invoker.CallChatCompletion(ctx, runtime.Channel, request)
	if callErr != nil {
		return "", callErr
	}
	if openaiErr != nil {
		return "", fmt.Errorf("ai translate failed: %s", openaiErr.Message)
	}

	var payload skillDescriptionRewritePayload
	if err := common.ParseLLMJSONInto(ctx, respText, &payload); err != nil {
		return "", err
	}

	description := strings.TrimSpace(payload.Description)
	description = truncateByRunes(description, skillDescriptionMaxChars)
	if description == "" {
		return "", fmt.Errorf("empty translated description")
	}
	return description, nil
}

func (s *SkillLibraryService) runScanWorker(ctx context.Context, skillID *int64) error {
	if model.DB == nil {
		return nil
	}
	job, err := s.claimPendingScanJob(skillID)
	if err != nil {
		return err
	}
	if job == nil {
		return nil
	}
	return s.executeScanJob(ctx, job)
}

func (s *SkillLibraryService) runImportWorker(ctx context.Context, jobID int64) error {
	if model.DB == nil || jobID <= 0 {
		return nil
	}
	job, err := s.claimPendingScanJobByID(jobID)
	if err != nil {
		return err
	}
	if job == nil {
		return nil
	}
	return s.executeScanJob(ctx, job)
}

func (s *SkillLibraryService) claimPendingScanJob(skillID *int64) (*model.SkillScanJob, error) {
	if model.DB == nil {
		return nil, nil
	}
	var claimed model.SkillScanJob
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&model.SkillScanJob{}).
			Where("status = ?", model.SkillScanJobStatusPending)
		if skillID != nil {
			query = query.Where("skill_library_id = ?", *skillID)
		}

		if err := query.Order("created_time ASC").Order("id ASC").First(&claimed).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}

		now := s.nowFunc().UTC().UnixMilli()
		updateTx := tx.Model(&model.SkillScanJob{}).
			Where("id = ? AND status = ?", claimed.ID, model.SkillScanJobStatusPending).
			Updates(map[string]interface{}{
				"status":        model.SkillScanJobStatusRunning,
				"started_time":  now,
				"finished_time": int64(0),
			})
		if updateTx.Error != nil {
			return updateTx.Error
		}
		if updateTx.RowsAffected == 0 {
			claimed.ID = 0
			return nil
		}
		claimed.Status = model.SkillScanJobStatusRunning
		claimed.StartedTime = now
		return nil
	})
	if err != nil {
		return nil, err
	}
	if claimed.ID == 0 {
		return nil, nil
	}
	return &claimed, nil
}

func (s *SkillLibraryService) claimPendingScanJobByID(jobID int64) (*model.SkillScanJob, error) {
	if model.DB == nil || jobID <= 0 {
		return nil, nil
	}
	var claimed model.SkillScanJob
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.SkillScanJob{}).
			Where("id = ? AND status = ?", jobID, model.SkillScanJobStatusPending).
			First(&claimed).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}

		now := s.nowFunc().UTC().UnixMilli()
		updateTx := tx.Model(&model.SkillScanJob{}).
			Where("id = ? AND status = ?", claimed.ID, model.SkillScanJobStatusPending).
			Updates(map[string]interface{}{
				"status":        model.SkillScanJobStatusRunning,
				"started_time":  now,
				"finished_time": int64(0),
			})
		if updateTx.Error != nil {
			return updateTx.Error
		}
		if updateTx.RowsAffected == 0 {
			claimed.ID = 0
			return nil
		}
		claimed.Status = model.SkillScanJobStatusRunning
		claimed.StartedTime = now
		return nil
	})
	if err != nil {
		return nil, err
	}
	if claimed.ID == 0 {
		return nil, nil
	}
	return &claimed, nil
}

func (s *SkillLibraryService) executeScanJob(ctx context.Context, job *model.SkillScanJob) error {
	if job == nil || job.ID <= 0 {
		return nil
	}

	if job.SkillLibraryID <= 0 {
		return s.executeImportJob(ctx, job)
	}

	logger.Infof(ctx, "【技能运行】开始扫描技能: job_id=%d skill_id=%d", job.ID, job.SkillLibraryID)

	skillInfo, err := model.GetSkillLibraryByID(job.SkillLibraryID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return s.finalizeScanFailure(job.ID, "", "技能不存在，扫描终止", "", false)
		}
		return s.finalizeScanFailure(job.ID, "", fmt.Sprintf("加载技能失败: %v", err), "", true)
	}

	runtime, err := s.resolveWorkAIScanRuntime(ctx, skillInfo.Eid)
	if err != nil {
		if errors.Is(err, ErrSkillScanNoWorkAIModelConfigured) {
			return s.finalizeScanFailure(job.ID, "", "未配置工作AI模型，无法进行技能扫描", "", false)
		}
		return s.finalizeScanFailure(job.ID, "", fmt.Sprintf("读取工作AI模型失败: %v", err), "", true)
	}

	zipContent, err := s.storage.Load(skillInfo.OriginZipKey)
	if err != nil {
		return s.finalizeScanFailure(job.ID, runtime.Model, fmt.Sprintf("读取技能包失败: %v", err), "", true)
	}

	archiveSkillPath := ""
	if skillInfo.SourceType == model.SkillSourceTypeGithub {
		archiveSkillPath = parseGithubSourceSkillPath(skillInfo.SourceRef)
	}
	skillMD, entries, err := s.unzipSkillPackage(zipContent, skillInfo.InstallPath, archiveSkillPath)
	if err != nil {
		retryable := !errors.Is(err, ErrSkillScanMissingSkillMD) && !errors.Is(err, ErrSkillScanZipPathTraversal)
		return s.finalizeScanFailure(job.ID, runtime.Model, scanErrorToMessage(err), "", retryable)
	}

	parsedSkill, parseErr := skillsvc.ParseSkillMetadata(skillMD)
	var rawDescription string
	if parseErr == nil && parsedSkill != nil {
		rawDescription = strings.TrimSpace(parsedSkill.Description)
		skillInfo.Version = normalizeSkillVersion(parsedSkill.Version)
	}

	output, err := s.scanner.Scan(ctx, &SkillScanInput{
		Skill:          skillInfo,
		ScanModel:      runtime.Model,
		ScanChannel:    runtime.Channel,
		LLMInvoker:     s.resolveLLMInvoker(),
		SkillMD:        skillMD,
		FileEntries:    entries,
		SkillName:      skillInfo.SkillName,
		RawDescription: rawDescription,
	})
	if err != nil {
		return s.finalizeScanFailure(job.ID, runtime.Model, fmt.Sprintf("扫描失败: %v", err), "", true)
	}

	if output == nil {
		return s.finalizeScanFailure(job.ID, runtime.Model, "扫描失败: 空响应", "", true)
	}

	if output.RiskLevel != model.SkillRiskLevelLow && output.RiskLevel != model.SkillRiskLevelMedium && output.RiskLevel != model.SkillRiskLevelHigh {
		output.RiskLevel = model.SkillRiskLevelMedium
	}
	if description := resolvePersistedSkillDescription(rawDescription, output); description != "" {
		skillInfo.Description = description
	}

	now := s.nowFunc().UTC().UnixMilli()
	earlyStatus := model.SkillScanJobStatusSuccess
	if output.RiskLevel == model.SkillRiskLevelHigh {
		earlyStatus = model.SkillScanJobStatusFailed
	}
	if err := s.updateSkillScanJobResult(job.ID, job.SkillLibraryID, earlyStatus, runtime.Model, output, now); err != nil {
		return s.finalizeScanFailure(job.ID, runtime.Model, fmt.Sprintf("写入扫描结果失败: %v", err), output.ScanPayload, true)
	}

	err = model.DB.Transaction(func(tx *gorm.DB) error {
		skillUpdates := map[string]interface{}{
			"risk_level":         output.RiskLevel,
			"score_integrity":    clampScore(output.ScoreIntegrity),
			"score_practicality": clampScore(output.ScorePracticality),
			"score_safety":       clampScore(output.ScoreSafety),
			"score_code_quality": clampScore(output.ScoreCodeQuality),
			"score_doc_quality":  clampScore(output.ScoreDocQuality),
			"scan_message":       output.Message,
			"scan_payload":       output.ScanPayload,
			"updated_time":       now,
		}
		if strings.TrimSpace(skillInfo.Description) != "" {
			skillUpdates["description"] = skillInfo.Description
		}
		if strings.TrimSpace(skillInfo.Version) != "" {
			skillUpdates["version"] = skillInfo.Version
		}
		if output.RiskLevel == model.SkillRiskLevelHigh {
			skillUpdates["publish_status"] = model.SkillPublishStatusRejected
			skillUpdates["admin_status"] = model.SkillAdminStatusDisabled
		}

		skillUpdateTx := tx.Model(&model.SkillLibrary{}).Where("id = ?", job.SkillLibraryID).Updates(skillUpdates)
		if skillUpdateTx.Error != nil {
			return skillUpdateTx.Error
		}
		if skillUpdateTx.RowsAffected == 0 {
			return ErrSkillScanSkillDeleted
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrSkillScanSkillDeleted) {
			logger.Warnf(ctx, "【技能运行】扫描时技能已删除: job_id=%d skill_id=%d", job.ID, job.SkillLibraryID)
			return s.finalizeScanFailure(job.ID, runtime.Model, "技能已删除，扫描终止", output.ScanPayload, false)
		}
		return s.finalizeScanFailure(job.ID, runtime.Model, fmt.Sprintf("写入扫描结果失败: %v", err), output.ScanPayload, true)
	}
	if output.RiskLevel == model.SkillRiskLevelHigh {
		s.reloadSkillManagerAsync(ctx, "scan_high_risk", job.SkillLibraryID)
		logger.Warnf(ctx, "【技能运行】扫描判定高风险，准备延迟删除: job_id=%d skill_id=%d", job.ID, job.SkillLibraryID)
		s.scheduleRejectedSkillDeletion(job.SkillLibraryID)
		return nil
	}
	s.reloadSkillManagerAsync(ctx, "scan_success", job.SkillLibraryID)

	logger.Infof(ctx, "【技能运行】扫描完成: job_id=%d skill_id=%d risk_level=%s", job.ID, job.SkillLibraryID, output.RiskLevel)

	return nil
}

func (s *SkillLibraryService) scheduleRejectedSkillDeletion(skillID int64) {
	if skillID <= 0 {
		return
	}
	delay := skillRejectedDeleteDelay
	if delay < 0 {
		delay = 0
	}
	go func() {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		<-timer.C
		if err := s.deleteRejectedSkillIfStillRejected(context.Background(), skillID); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Warnf(context.Background(), "【技能运行】延迟删除高风险技能失败: skill_id=%d err=%v", skillID, err)
		}
	}()
}

func (s *SkillLibraryService) deleteRejectedSkillIfStillRejected(ctx context.Context, skillID int64) error {
	skillInfo, err := model.GetSkillLibraryByID(skillID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if skillInfo.PublishStatus != model.SkillPublishStatusRejected {
		return nil
	}
	logger.Warnf(ctx, "【技能运行】执行延迟删除高风险技能: skill_id=%d", skillID)
	return s.DeleteSkill(ctx, skillInfo.Eid, skillID)
}

func (s *SkillLibraryService) resolveWorkAIScanRuntime(ctx context.Context, eid int64) (*workAIScanRuntime, error) {
	_, agents, err := model.GetAvailableAgentList(eid, nil, []int{model.AgentUsageWorkAI}, 0, 1)
	if err != nil {
		return nil, err
	}
	if len(agents) == 0 || agents[0] == nil {
		return nil, ErrSkillScanNoWorkAIModelConfigured
	}

	agent := agents[0]
	modelName := strings.TrimSpace(agent.Model)
	if modelName == "" || agent.ChannelType == 0 {
		return nil, ErrSkillScanNoWorkAIModelConfigured
	}
	var channel *model.Channel
	if cfg, cfgErr := agent.GetSkillRunConfig(); cfgErr == nil && cfg != nil && cfg.Enable {
		if strings.TrimSpace(cfg.ModelName) != "" {
			modelName = strings.TrimSpace(cfg.ModelName)
		}
		if cfg.ChannelID > 0 {
			if ch, chErr := model.GetChannelByID(cfg.ChannelID); chErr == nil && ch != nil {
				channel = ch
			}
		}
	}
	if channel == nil {
		if cfg, cfgErr := agent.GetFastReasoningConfig(); cfgErr == nil && cfg != nil && cfg.ChannelID != nil && cfg.ModelName != nil {
			if strings.TrimSpace(*cfg.ModelName) != "" {
				modelName = strings.TrimSpace(*cfg.ModelName)
			}
			if ch, chErr := model.GetChannelByID(*cfg.ChannelID); chErr == nil && ch != nil {
				channel = ch
			}
		}
	}
	if channel == nil {
		ch, chErr := GetChannelWithTokenRefresh(ctx, eid, agent.ChannelType, modelName, 0)
		if chErr == nil && ch != nil {
			channel = ch
		}
	}
	if channel == nil || strings.TrimSpace(modelName) == "" {
		return nil, ErrSkillScanNoWorkAIModelConfigured
	}

	return &workAIScanRuntime{
		Model:   modelName,
		Channel: channel,
	}, nil
}

func (s *SkillLibraryService) updateSkillScanJobResult(jobID, skillLibraryID int64, status, scanModel string, output *SkillScanOutput, finishedTime int64) error {
	if jobID <= 0 || model.DB == nil {
		return nil
	}

	updates := map[string]interface{}{
		"status":             status,
		"skill_library_id":   skillLibraryID,
		"risk_level":         model.SkillRiskLevelMedium,
		"score_integrity":    0.0,
		"score_practicality": 0.0,
		"score_safety":       0.0,
		"score_code_quality": 0.0,
		"score_doc_quality":  0.0,
		"message":            "",
		"scan_model":         scanModel,
		"finished_time":      finishedTime,
		"updated_time":       finishedTime,
	}
	if output != nil {
		riskLevel := strings.TrimSpace(output.RiskLevel)
		if riskLevel == "" {
			riskLevel = model.SkillRiskLevelMedium
		}
		updates["risk_level"] = riskLevel
		updates["score_integrity"] = clampScore(output.ScoreIntegrity)
		updates["score_practicality"] = clampScore(output.ScorePracticality)
		updates["score_safety"] = clampScore(output.ScoreSafety)
		updates["score_code_quality"] = clampScore(output.ScoreCodeQuality)
		updates["score_doc_quality"] = clampScore(output.ScoreDocQuality)
		updates["message"] = strings.TrimSpace(output.Message)
		if strings.TrimSpace(output.ScanPayload) != "" {
			updates["scan_payload"] = output.ScanPayload
		}
	}

	return model.DB.Model(&model.SkillScanJob{}).Where("id = ?", jobID).Updates(updates).Error
}

func (s *SkillLibraryService) finalizeScanFailure(jobID int64, scanModel, message, payload string, retryable bool) error {
	if jobID <= 0 || model.DB == nil {
		return nil
	}
	logger.Warnf(context.Background(), "【技能运行】扫描失败: job_id=%d message=%s retryable=%v", jobID, message, retryable)

	now := s.nowFunc().UTC().UnixMilli()
	var job model.SkillScanJob
	if err := model.DB.Where("id = ?", jobID).First(&job).Error; err != nil {
		return err
	}

	status := model.SkillScanJobStatusFailed
	retryCount := job.RetryCount
	startedTime := job.StartedTime
	finishedTime := now

	if retryable && job.RetryCount < skillScanMaxRetry {
		status = model.SkillScanJobStatusPending
		retryCount = job.RetryCount + 1
		startedTime = 0
		finishedTime = 0
	}

	updates := map[string]interface{}{
		"status":        status,
		"retry_count":   retryCount,
		"started_time":  startedTime,
		"finished_time": finishedTime,
		"message":       message,
		"scan_model":    scanModel,
		"updated_time":  now,
	}
	if payload != "" {
		updates["scan_payload"] = payload
	}
	return model.DB.Model(&model.SkillScanJob{}).Where("id = ?", jobID).Updates(updates).Error
}

func (s *SkillLibraryService) recoverStaleRunningJobs(ctx context.Context) error {
	_ = ctx

	timeoutSeconds := env.Int(skillScanRunningTimeoutSecondsEnvKey, skillScanRunningTimeoutSecondsDef)
	if timeoutSeconds <= 0 {
		timeoutSeconds = skillScanRunningTimeoutSecondsDef
	}
	now := s.nowFunc().UTC().UnixMilli()
	deadline := now - int64(timeoutSeconds)*1000

	var runningJobs []*model.SkillScanJob
	if err := model.DB.Where("status = ? AND started_time > 0 AND started_time <= ?", model.SkillScanJobStatusRunning, deadline).
		Find(&runningJobs).Error; err != nil {
		return err
	}

	for _, job := range runningJobs {
		if job == nil {
			continue
		}

		status := model.SkillScanJobStatusPending
		retryCount := job.RetryCount + 1
		startedTime := int64(0)
		finishedTime := int64(0)
		message := "扫描任务超时，已回置重试"

		if job.RetryCount >= skillScanMaxRetry {
			status = model.SkillScanJobStatusFailed
			retryCount = job.RetryCount
			startedTime = job.StartedTime
			finishedTime = now
			message = "扫描任务超时且超过重试上限"
		}

		if err := model.DB.Model(&model.SkillScanJob{}).Where("id = ?", job.ID).Updates(map[string]interface{}{
			"status":        status,
			"retry_count":   retryCount,
			"started_time":  startedTime,
			"finished_time": finishedTime,
			"message":       message,
		}).Error; err != nil {
			return err
		}
	}

	return nil
}

func (s *SkillLibraryService) unzipSkillPackage(zipContent []byte, installPath, skillPath string) (string, []string, error) {
	if len(zipContent) == 0 {
		return "", nil, fmt.Errorf("empty zip content")
	}

	installRoot := filepath.Clean(installPath)
	if installRoot == "" || installRoot == "." {
		return "", nil, fmt.Errorf("invalid install path")
	}
	if err := os.RemoveAll(installRoot); err != nil {
		return "", nil, err
	}
	if err := os.MkdirAll(installRoot, 0755); err != nil {
		return "", nil, err
	}
	inspection, err := extractSkillArchiveToPath(zipContent, skillPath, installRoot)
	if err != nil {
		return "", nil, err
	}
	return inspection.SkillMarkdown, inspection.Entries, nil
}

func detectSingleTopFolder(files []*zip.File) string {
	topFolder := ""
	seenRootFile := false

	for _, file := range files {
		if file == nil {
			continue
		}
		entryName := strings.ReplaceAll(strings.TrimSpace(file.Name), "\\", "/")
		cleanName := path.Clean(entryName)
		if cleanName == "." || cleanName == "" {
			continue
		}
		if strings.HasPrefix(cleanName, "../") || cleanName == ".." || path.IsAbs(cleanName) {
			return ""
		}

		parts := strings.Split(cleanName, "/")
		if len(parts) < 2 {
			seenRootFile = true
			continue
		}

		first := strings.TrimSpace(parts[0])
		if first == "" {
			return ""
		}
		if topFolder == "" {
			topFolder = first
		} else if topFolder != first {
			return ""
		}
	}

	if seenRootFile || topFolder == "" {
		return ""
	}
	return topFolder
}

func (s *SkillLibraryService) buildSkillInstallPath(eid int64, extractFolder string) string {
	root := s.skillRootPath
	if strings.TrimSpace(root) == "" {
		root = filepath.Join("data", "skills")
	}
	if eid == 0 {
		return filepath.Join(root, "global", extractFolder)
	}
	return filepath.Join(root, "tenants", strconv.FormatInt(eid, 10), extractFolder)
}

func clampScore(v float64) float64 {
	if v < 1 {
		v = 1
	}
	if v > 5 {
		v = 5
	}
	return math.Round(v*10) / 10
}

func normalizeScanDescription(description string, riskLevel string) string {
	description = strings.TrimSpace(description)
	if riskLevel == model.SkillRiskLevelHigh {
		return ""
	}
	return truncateByRunes(description, skillDescriptionMaxChars)
}

func resolvePersistedSkillDescription(rawDescription string, output *SkillScanOutput) string {
	rawDescription = strings.TrimSpace(rawDescription)
	if output == nil {
		return truncateByRunes(rawDescription, skillDescriptionMaxChars)
	}
	if strings.TrimSpace(output.RiskLevel) == model.SkillRiskLevelHigh {
		return ""
	}

	description := strings.TrimSpace(output.Description)
	if description == "" {
		description = rawDescription
	}
	return truncateByRunes(description, skillDescriptionMaxChars)
}

func scanErrorToMessage(err error) string {
	if err == nil {
		return "扫描失败"
	}
	if errors.Is(err, ErrSkillScanMissingSkillMD) {
		return "文件不是技能，缺少SKILL.md"
	}
	if errors.Is(err, ErrSkillScanZipPathTraversal) {
		return "技能压缩包包含非法路径"
	}
	return fmt.Sprintf("扫描失败: %v", err)
}

func parseSkillScanResultPayload(ctx context.Context, responseText string) (*skillScanResultPayload, error) {
	var payload skillScanResultPayload
	if err := common.ParseLLMJSONInto(ctx, responseText, &payload); err != nil {
		return nil, fmt.Errorf("scan response parse failed: %v", err)
	}

	switch payload.RiskLevel {
	case model.SkillRiskLevelLow, model.SkillRiskLevelMedium, model.SkillRiskLevelHigh:
	default:
		payload.RiskLevel = model.SkillRiskLevelMedium
	}
	return &payload, nil
}

func fallbackSkillScanOutput(in *SkillScanInput, reason string) *SkillScanOutput {
	riskLevel := model.SkillRiskLevelMedium
	message := "扫描模型未返回有效结果，已启用基础兜底"

	contentToCheck := strings.ToLower(strings.TrimSpace(in.SkillMD) + "\n" + strings.Join(in.FileEntries, "\n"))
	if looksLikeHighRiskSkill(contentToCheck) {
		riskLevel = model.SkillRiskLevelHigh
		message = "基础兜底检测到明显高风险内容，禁止使用"
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"scan_model":      in.ScanModel,
		"entry_count":     len(in.FileEntries),
		"skill_md_size":   len(in.SkillMD),
		"risk_level":      riskLevel,
		"fallback_reason": reason,
	})

	output := &SkillScanOutput{
		RiskLevel:         riskLevel,
		ScoreIntegrity:    fallbackSkillScore(riskLevel),
		ScorePracticality: fallbackSkillScore(riskLevel),
		ScoreSafety:       fallbackSkillScore(riskLevel),
		ScoreCodeQuality:  fallbackSkillScore(riskLevel),
		ScoreDocQuality:   fallbackSkillScore(riskLevel),
		Message:           message,
		ScanPayload:       string(payload),
		Retryable:         false,
	}

	return output
}

func truncateForDebug(text string, maxLen int) string {
	text = strings.TrimSpace(text)
	if text == "" || maxLen <= 0 {
		return text
	}

	runes := []rune(text)
	if len(runes) <= maxLen {
		return text
	}
	return string(runes[:maxLen]) + "...(truncated)"
}

func fallbackSkillScore(riskLevel string) float64 {
	if strings.TrimSpace(riskLevel) == model.SkillRiskLevelHigh {
		return 1.0
	}
	return 3.0
}

func looksLikeHighRiskSkill(content string) bool {
	if content == "" {
		return false
	}

	riskPatterns := []string{
		"rm -rf",
		"curl ",
		"wget ",
		"powershell",
		"cmd.exe",
		"bash -c",
		"sh -c",
		"os.system(",
		"subprocess.",
		"eval(",
		"exec(",
		"chmod +x",
		"sudo ",
		"docker run",
		"kubectl ",
	}
	for _, pattern := range riskPatterns {
		if strings.Contains(content, pattern) {
			return true
		}
	}
	return false
}
