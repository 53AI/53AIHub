package rag

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

const graphTemplateSelectionMaxTokens = 4096
const graphTemplateSelectionRelationPreviewLimit = 5

type graphTemplateSelectionResponse struct {
	TemplateID   int64  `json:"template_id"`
	TemplateName string `json:"template_name"`
	Reason       string `json:"reason"`
}

type graphTemplateSelectionExecutor interface {
	Generate(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error)
}

type graphTemplateSelectionLLMExecutor struct {
	contentService *ContentGeneratorService
	channel        *model.Channel
	modelName      string
}

func (e *graphTemplateSelectionLLMExecutor) Generate(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	if e == nil || e.contentService == nil || e.channel == nil {
		return "", fmt.Errorf("图谱模板选择执行器未初始化")
	}

	request := &relaymodel.GeneralOpenAIRequest{
		Model:     e.modelName,
		MaxTokens: maxTokens,
		Messages: []relaymodel.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	resp, err, openaiErr := e.contentService.TestChannel(ctx, e.channel, request)
	if err != nil {
		return "", fmt.Errorf("图谱模板选择失败: %v", err)
	}
	if openaiErr != nil {
		return "", fmt.Errorf("图谱模板选择失败: %v", openaiErr)
	}

	return resp, nil
}

func newGraphTemplateSelectionExecutor(db *gorm.DB, eid int64) (graphTemplateSelectionExecutor, error) {
	chunkCfgService := NewChunkConfigService(db)
	config, err := chunkCfgService.GetConfig(eid, nil, "default")
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to get graph template selection LLM config: %v", err))
		return nil, fmt.Errorf("获取模型配置失败: %v", err)
	}

	selectedChannel, selectedModelName, selectErr := config.SelectPipelineLLM()
	if selectErr != nil {
		return nil, fmt.Errorf("未配置推理模型: %v", selectErr)
	}

	return &graphTemplateSelectionLLMExecutor{
		contentService: NewContentGeneratorService(db),
		channel:        selectedChannel,
		modelName:      selectedModelName,
	}, nil
}

func buildGraphTemplateSelectionSystemPrompt() string {
	return `你是一个知识图谱模板选择助手。
你的任务是根据“当前文件前文”和“候选模板的名称/描述/关系定义”，选择最适配的一个模板。
只允许从候选模板中选择，不要编造新的模板。
候选模板必须是可用于关系抽取的模板，至少要有一条明确的关系定义。
输出只允许 JSON，不要输出 Markdown、解释或代码块标记。

输出格式：
{
  "template_id": 123,
  "template_name": "模板名称",
  "reason": "简短原因"
	}`
}

func parseGraphTemplateSelectionRelations(candidate *model.GraphTemplateBrief) ([]*model.RelationDefinition, error) {
	if candidate == nil {
		return nil, nil
	}

	relationsJSON := strings.TrimSpace(candidate.Relations)
	if relationsJSON == "" {
		return []*model.RelationDefinition{}, nil
	}

	var relations []*model.RelationDefinition
	if err := json.Unmarshal([]byte(relationsJSON), &relations); err != nil {
		return nil, fmt.Errorf("解析关系定义失败: %w", err)
	}

	cleaned := make([]*model.RelationDefinition, 0, len(relations))
	for _, relation := range relations {
		if relation == nil {
			continue
		}

		relation.Source = strings.TrimSpace(relation.Source)
		relation.Predicate = strings.TrimSpace(relation.Predicate)
		relation.Target = strings.TrimSpace(relation.Target)
		if relation.Source == "" || relation.Predicate == "" || relation.Target == "" {
			continue
		}

		cleaned = append(cleaned, relation)
	}

	return cleaned, nil
}

func filterGraphTemplateSelectionCandidates(candidates []*model.GraphTemplateBrief) []*model.GraphTemplateBrief {
	filtered := make([]*model.GraphTemplateBrief, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate == nil {
			continue
		}

		relations, err := parseGraphTemplateSelectionRelations(candidate)
		if err != nil {
			continue
		}
		if len(relations) == 0 {
			continue
		}

		filtered = append(filtered, candidate)
	}

	return filtered
}

func buildGraphTemplateSelectionRelationSummary(candidate *model.GraphTemplateBrief) (int, []string) {
	relations, err := parseGraphTemplateSelectionRelations(candidate)
	if err != nil {
		return 0, nil
	}

	preview := make([]string, 0, graphTemplateSelectionRelationPreviewLimit)
	for _, relation := range relations {
		if relation == nil {
			continue
		}
		preview = append(preview, fmt.Sprintf("%s --[%s]--> %s", relation.Source, relation.Predicate, relation.Target))
		if len(preview) >= graphTemplateSelectionRelationPreviewLimit {
			break
		}
	}

	return len(relations), preview
}

func buildGraphTemplateSelectionUserPrompt(fileContext string, candidates []*model.GraphTemplateBrief) string {
	var sb strings.Builder
	sb.WriteString("## 当前文件前文\n")
	sb.WriteString(strings.TrimSpace(fileContext))
	sb.WriteString("\n\n## 候选模板\n")
	for _, candidate := range candidates {
		if candidate == nil {
			continue
		}

		relationCount, relationPreview := buildGraphTemplateSelectionRelationSummary(candidate)
		fmt.Fprintf(&sb, "- id=%d, name=%s, description=%s, relation_count=%d\n", candidate.ID, candidate.Name, candidate.Description, relationCount)
		if relationCount == 0 {
			sb.WriteString("  relations: 无\n")
			continue
		}

		sb.WriteString("  relations:\n")
		for _, relation := range relationPreview {
			fmt.Fprintf(&sb, "  - %s\n", relation)
		}
		if relationCount > len(relationPreview) {
			fmt.Fprintf(&sb, "  - 其余 %d 条关系定义已省略\n", relationCount-len(relationPreview))
		}
	}
	sb.WriteString("\n请选择最适配的模板，并仅输出 JSON。")
	return sb.String()
}

func parseGraphTemplateSelectionResponseWithContext(ctx context.Context, content string) (*graphTemplateSelectionResponse, error) {
	var resp graphTemplateSelectionResponse
	if err := common.ParseLLMJSONInto(ctx, content, &resp); err != nil {
		return nil, fmt.Errorf("解析图谱模板选择结果失败: %w", err)
	}

	resp.TemplateName = strings.TrimSpace(resp.TemplateName)
	resp.Reason = strings.TrimSpace(resp.Reason)
	return &resp, nil
}

func resolveGraphTemplateSelectionResponse(resp *graphTemplateSelectionResponse, candidates []*model.GraphTemplateBrief) (*model.GraphTemplateBrief, error) {
	if resp == nil {
		return nil, fmt.Errorf("图谱模板选择结果不能为空")
	}

	if resp.TemplateID > 0 {
		for _, candidate := range candidates {
			if candidate != nil && candidate.ID == resp.TemplateID {
				return candidate, nil
			}
		}
	}

	if resp.TemplateName != "" {
		for _, candidate := range candidates {
			if candidate == nil {
				continue
			}
			if strings.EqualFold(strings.TrimSpace(candidate.Name), resp.TemplateName) {
				return candidate, nil
			}
		}
	}

	return nil, fmt.Errorf("图谱模板选择结果未命中任何候选模板")
}

func selectGraphTemplateFromCandidatesWithExecutor(ctx context.Context, fileContext string, candidates []*model.GraphTemplateBrief, executor graphTemplateSelectionExecutor) (*model.GraphTemplateBrief, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	candidates = filterGraphTemplateSelectionCandidates(candidates)
	if len(candidates) == 0 {
		return nil, fmt.Errorf("没有可用的图谱模板候选")
	}
	if executor == nil {
		return nil, fmt.Errorf("图谱模板选择执行器不能为空")
	}

	fileContext = strings.TrimSpace(fileContext)
	if fileContext == "" {
		return nil, fmt.Errorf("图谱模板选择上下文不能为空")
	}

	logger.Debugf(ctx, "【工具执行】图谱模板选择开始: 候选数=%d, 上下文字符数=%d", len(candidates), len([]rune(fileContext)))

	respText, err := executor.Generate(ctx, buildGraphTemplateSelectionSystemPrompt(), buildGraphTemplateSelectionUserPrompt(fileContext, candidates), graphTemplateSelectionMaxTokens)
	if err != nil {
		return nil, err
	}

	resp, err := parseGraphTemplateSelectionResponseWithContext(ctx, respText)
	if err != nil {
		return nil, err
	}

	selected, err := resolveGraphTemplateSelectionResponse(resp, candidates)
	if err != nil {
		return nil, err
	}

	logger.Debugf(ctx, "【工具执行】图谱模板选择完成: 模板ID=%d, 模板名=%s", selected.ID, selected.Name)
	return selected, nil
}

// SelectGraphTemplateByLLM 根据当前企业候选模板和文件前文选择最适配的图谱模板。
func SelectGraphTemplateByLLM(ctx context.Context, db *gorm.DB, eid int64, fileContext string) (*model.GraphTemplate, error) {
	candidates, err := model.GetGraphTemplateBriefList(eid)
	if err != nil {
		return nil, err
	}
	candidates = filterGraphTemplateSelectionCandidates(candidates)
	if len(candidates) == 0 {
		return nil, fmt.Errorf("没有可用的图谱模板候选")
	}

	executor, err := newGraphTemplateSelectionExecutor(db, eid)
	if err != nil {
		return nil, err
	}

	selected, err := selectGraphTemplateFromCandidatesWithExecutor(ctx, fileContext, candidates, executor)
	if err != nil {
		return nil, err
	}

	template, err := model.GetGraphTemplateByID(eid, selected.ID)
	if err != nil {
		return nil, err
	}
	return template, nil
}
