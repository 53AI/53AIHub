package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/adaptorregistry"
	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/tokenlimit"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/53AI/53AIHub/service/hub_adaptor/openai"
	"github.com/53AI/53AIHub/service/skill"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/adaptor"
	"github.com/songquanpeng/one-api/relay/meta"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
	"gorm.io/gorm"
)

func init() {
	// 注册 LLM 摘要函数给 tokenlimit 包
	tokenlimit.RegisterSummarizeFunc(func(ctx context.Context, channel *model.Channel, modelName string, messages []relaymodel.Message) (string, error) {
		s := NewContentGeneratorService(model.DB)
		prompt := tokenlimit.BuildCompactPrompt(messages)
		req := &relaymodel.GeneralOpenAIRequest{
			Model:     modelName,
			Messages:  []relaymodel.Message{{Role: "user", Content: prompt}},
			MaxTokens: tokenlimit.DynamicSummaryMax(tokenlimit.EstimateTokens(messages)),
		}
		resp, err, _ := s.testChannel(ctx, channel, req)
		if err != nil {
			return "", err
		}
		return resp, nil
	})
}

// ConversationItem 对话历史项
type ConversationItem struct {
	Query  string `json:"query"`
	Answer string `json:"answer"`
}

// IntentClassificationResult 意图分类结果
type IntentClassificationResult struct {
	Intent          string   `json:"intent"`           // CHITCHAT, SIMPLE_RAG, COMPLEX_AGENT, USE_SKILL
	SkillName       string   `json:"skill_name"`       // 当 Intent="USE_SKILL" 时必填
	Confidence      float64  `json:"confidence"`       // 置信度 0-1
	Reasoning       string   `json:"reasoning"`        // 分类原因
	Keywords        []string `json:"keywords"`         // 仅在 category 不是 CHITCHAT 时提取 2-3 个核心实体词
	DocumentType    string   `json:"document_type"`    // 明确的文种/文档类型，如财务报告、合同、制度
	Answer          string   `json:"answer"`           // 分类结果答案（仅 CHITCHAT）
	NormalizedQuery string   `json:"normalized_query"` // 规范化后的问题，用于检索/路由
	ExpandedQueries []string `json:"expanded_queries"` // 扩展查询问题（用于提升RAG效果，仅 COMPLEX_AGENT）
}

// QueryExpansionResult 复杂问题查询拆解结果
type QueryExpansionResult struct {
	NormalizedQuery string   `json:"normalized_query"` // 规范化后的问题，用于检索/路由
	Keywords        []string `json:"keywords"`         // 复杂问题拆解后的核心检索词
	DocumentType    string   `json:"document_type"`    // 明确的文种/文档类型
	ExpandedQueries []string `json:"expanded_queries"` // 扩展查询问题（用于提升RAG效果）
}

// IntentClassificationRequest 意图分类请求
type IntentClassificationRequest struct {
	Query        string             `json:"query"`        // 用户查询
	Conversation []ConversationItem `json:"conversation"` // 历史对话
}

// ContentGeneratorService AI内容生成服务
type ContentGeneratorService struct {
	chatService *ChatService
}

const internalRequestControlMetadataKey = "_53ai_internal_request_control"

type internalRequestControl struct {
	ReasoningMode string `json:"reasoning_mode,omitempty"`
}

// NewContentGeneratorService 创建内容生成服务实例
func NewContentGeneratorService(db *gorm.DB) *ContentGeneratorService {
	return &ContentGeneratorService{
		chatService: NewChatService(db),
	}
}

// GenerateRawPrompt sends a single raw prompt to the selected pipeline LLM.
// This is a lightweight escape hatch for wiki page compilation and other
// prompt-driven features that do not fit the fixed summary/question helpers.
func (s *ContentGeneratorService) GenerateRawPrompt(ctx context.Context, channel *model.Channel, modelName string, prompt string) (string, error) {
	resp, _, err := s.GenerateRawPromptWithUsage(ctx, channel, modelName, prompt)
	return resp, err
}

// GenerateRawPromptWithUsage sends a single raw prompt and returns token usage.
func (s *ContentGeneratorService) GenerateRawPromptWithUsage(ctx context.Context, channel *model.Channel, modelName string, prompt string) (string, *relaymodel.Usage, error) {
	if channel == nil {
		return "", nil, fmt.Errorf("没有配置推理渠道，无法生成内容")
	}
	if strings.TrimSpace(modelName) == "" {
		return "", nil, fmt.Errorf("没有配置推理模型，无法生成内容")
	}

	req := &relaymodel.GeneralOpenAIRequest{
		Model:     modelName,
		MaxTokens: 0,
		Messages: []relaymodel.Message{{
			Role:    "system",
			Content: prompt,
		}},
	}

	resp, usage, err, openaiErr := s.testChannelInternal(ctx, channel, req)
	if err != nil || openaiErr != nil {
		if openaiErr != nil {
			return "", nil, fmt.Errorf("OpenAI API错误: %v", openaiErr)
		}
		return "", nil, fmt.Errorf("AI生成内容失败: %v", err)
	}
	return resp, usage, nil
}

// GenerateSummaryRequest 生成概要请求
type GenerateSummaryRequest struct {
	Content      string `json:"content"`       // 原始内容
	MaxSummaries int    `json:"max_summaries"` // 最大概要数量
	MaxTokens    int    `json:"max_tokens"`    // 每个概要最大token数
}

// GenerateQuestionsRequest 生成问题请求
type GenerateQuestionsRequest struct {
	Content      string `json:"content"`       // 原始内容
	MaxQuestions int    `json:"max_questions"` // 最大问题数量
	MaxTokens    int    `json:"max_tokens"`    // 每个问题最大token数
}

// GenerateQuestionsAndSummaryRequest 生成问题和简介请求
type GenerateQuestionsAndSummaryRequest struct {
	Content string `json:"content"` // 原始内容
}

// GenerateQuestionsAndSummaryResponse 生成问题和简介响应
type GenerateQuestionsAndSummaryResponse struct {
	Questions []string `json:"questions"` // 3个常见问法
	Summary   string   `json:"summary"`   // 简介
}

type GenerateQuestionsSummaryAndEntitiesResponse struct {
	Questions []string          `json:"questions"`
	Summary   string            `json:"summary"`
	Entities  []ExtractedEntity `json:"entities"`
}

type GenerateSummaryQuestionsKnowledgeMapRequest struct {
	Content              string
	RootTitle            string
	SummaryPrompt        string
	SummaryMaxWords      int
	GenerateSummary      bool
	GenerateQuestions    bool
	GenerateKnowledgeMap bool
}

type GenerateSummaryQuestionsKnowledgeMapResponse struct {
	Summary      string   `json:"summary"`
	Questions    []string `json:"questions"`
	KnowledgeMap string   `json:"knowledge_map"`
}

type GenerateKnowledgeMapRequest struct {
	Content   string `json:"content"`
	RootTitle string `json:"root_title"`
}

// GenerateSummary 生成内容概要
func (s *ContentGeneratorService) GenerateSummary(ctx context.Context, eid int64, config *ChunkConfig, req *GenerateSummaryRequest) ([]string, error) {
	selectedChannel, selectedModelName, selectErr := config.SelectPipelineLLM()
	if selectErr != nil {
		return nil, fmt.Errorf("没有配置推理渠道，无法生成概要: %v", selectErr)
	}

	budget := tokenlimit.ComputeBudget(ctx, selectedChannel.ChannelID, selectedChannel.Config, selectedModelName, 0, 8192, 6000)
	content := ComposeSummaryInput(req.Content, budget.InputAvailable)

	// 构建概要生成的提示词
	prompt := s.buildSummaryPrompt(content, req.MaxSummaries)

	// 调用LLM生成概要

	// 调试日志：记录请求

	// 设置超时上下文
	timeoutCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// 使用带超时的上下文（虽然Chat方法目前不接受context，但保留以便后续改进）
	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: 0, // 不限制输出，由模型自由生成
	}
	testMessage := relaymodel.Message{
		Role:    "system",
		Content: prompt,
	}
	chatReq.Messages = append(chatReq.Messages, testMessage)

	_ = timeoutCtx
	content, err, openaiErr := s.testChannel(ctx, selectedChannel, chatReq)
	if err != nil || openaiErr != nil {
		logger.Errorf(ctx, "AI生成概要失败: %v", err)
		return nil, fmt.Errorf("AI生成概要失败: %v", err)
	}
	// 调试日志：记录响应

	summaries := s.parseSummaryContent(content)
	// 调试日志：记录解析结果

	return summaries, nil
}

// GenerateQuestions 生成常见问题
func (s *ContentGeneratorService) GenerateQuestions(ctx context.Context, eid int64, config *ChunkConfig, req *GenerateQuestionsRequest) ([]string, error) {
	selectedChannel, selectedModelName, selectErr := config.SelectPipelineLLM()
	if selectErr != nil {
		return nil, fmt.Errorf("没有配置推理渠道，无法生成问题: %v", selectErr)
	}

	budget := tokenlimit.ComputeBudget(ctx, selectedChannel.ChannelID, selectedChannel.Config, selectedModelName, 0, 8192, 6000)
	content := ComposeSummaryInput(req.Content, budget.InputAvailable)

	// 构建问题生成的提示词
	prompt := s.buildQuestionsPrompt(content, req.MaxQuestions)

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: 0, // 不限制输出，由模型自由生成
	}
	testMessage := relaymodel.Message{
		Role:    "system",
		Content: "你是一个专业的问题生成助手。请根据给定的内容生成相关的常见问题，问题应该自然、实用。",
	}

	userMessage := relaymodel.Message{
		Role:    "user",
		Content: prompt,
	}
	chatReq.Messages = append(chatReq.Messages, testMessage)
	chatReq.Messages = append(chatReq.Messages, userMessage)

	// 调试日志：记录请求

	// 设置超时上下文
	timeoutCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// 使用带超时的上下文（虽然Chat方法目前不接受context，但保留以便后续改进）
	_ = timeoutCtx
	content, err, openaiErr := s.testChannel(ctx, selectedChannel, chatReq)
	if err != nil || openaiErr != nil {
		logger.Errorf(ctx, "AI生成问题失败: %v", err)
		if openaiErr != nil {
			logger.Errorf(ctx, "OpenAI API错误: %v", openaiErr)
			return nil, fmt.Errorf("OpenAI API错误: %v", openaiErr)
		}
		return nil, fmt.Errorf("AI生成问题失败: %v", err)
	}

	// 调试日志：记录响应

	questions := s.parseQuestionsContent(content)
	// 调试日志：记录解析结果

	return questions, nil
}

// buildSummaryPrompt 构建概要生成提示词
func (s *ContentGeneratorService) buildSummaryPrompt(content string, maxSummaries int) string {
	return fmt.Sprintf(`请直接为以下内容生成%d个简洁概要，每个概要一行：

内容：
%s

要求：
- 直接输出概要内容
- 不要包含前言或解释
- 每行一个概要
- 概要要包含核心信息

概要：`, maxSummaries, content)
}

// buildQuestionsPrompt 构建问题生成提示词
func (s *ContentGeneratorService) buildQuestionsPrompt(content string, maxQuestions int) string {
	return fmt.Sprintf(`请直接为以下内容生成%d个相关问题，每个问题一行：

内容：
%s

要求：
- 直接输出问题
- 不要包含前言或解释
- 每个问题必须以问号结尾
- 每行一个问题

问题：`, maxQuestions, content)
}

// GenerateFastIntentRoute 生成轻量意图路由结果，不做复杂问题拆解。
func (s *ContentGeneratorService) GenerateFastIntentRoute(
	ctx context.Context,
	eid int64,
	config *ChunkConfig,
	request *IntentClassificationRequest,
	availableSkills []*skill.Skill,
	agent *model.Agent,
) (*IntentClassificationResult, error) {
	selectedChannel, selectedModelName, err := resolveIntentGenerationChannel(ctx, agent, config, "GenerateFastIntentRoute")
	if err != nil {
		return nil, err
	}

	cacheKey := buildFastIntentRouteCacheKey(eid, agent, config, request, availableSkills, selectedChannel, selectedModelName)
	result, err := s.getOrBuildCachedIntentClassification(ctx, cacheKey, func() (*IntentClassificationResult, error) {
		return s.generateFastIntentRouteWithoutCache(ctx, selectedChannel, selectedModelName, request, availableSkills)
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

// GenerateComplexQueryExpansion 仅为复杂 RAG 问题生成拆分查询。
func (s *ContentGeneratorService) GenerateComplexQueryExpansion(
	ctx context.Context,
	eid int64,
	config *ChunkConfig,
	request *IntentClassificationRequest,
	agent *model.Agent,
) (*QueryExpansionResult, error) {
	selectedChannel, selectedModelName, err := resolveIntentGenerationChannel(ctx, agent, config, "GenerateComplexQueryExpansion")
	if err != nil {
		return nil, err
	}

	cacheKey := buildQueryExpansionCacheKey(eid, agent, config, request, selectedChannel, selectedModelName)
	result, err := s.getOrBuildCachedQueryExpansion(ctx, cacheKey, func() (*QueryExpansionResult, error) {
		return s.generateComplexQueryExpansionWithoutCache(ctx, selectedChannel, selectedModelName, request)
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

// GenerateIntentClassification 生成意图分类
func (s *ContentGeneratorService) GenerateIntentClassification(
	ctx context.Context,
	eid int64,
	config *ChunkConfig,
	request *IntentClassificationRequest,
	availableSkills []*skill.Skill,
	agent *model.Agent,
) (*IntentClassificationResult, error) {
	selectedChannel, selectedModelName, err := resolveIntentGenerationChannel(ctx, agent, config, "GenerateIntentClassification")
	if err != nil {
		return nil, err
	}

	cacheKey := buildIntentClassificationCacheKey(eid, agent, config, request, availableSkills, selectedChannel, selectedModelName)
	result, err := s.getOrBuildCachedIntentClassification(ctx, cacheKey, func() (*IntentClassificationResult, error) {
		return s.generateIntentClassificationWithoutCache(ctx, selectedChannel, selectedModelName, request, availableSkills)
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

func resolveIntentGenerationChannel(ctx context.Context, agent *model.Agent, config *ChunkConfig, caller string) (*model.Channel, string, error) {
	if config == nil {
		return nil, "", fmt.Errorf("分块配置不能为空")
	}

	preferFastReasoning := caller == "GenerateFastIntentRoute" || caller == "GenerateIntentClassification"

	selectFastReasoning := func() (*model.Channel, string) {
		selectedFastReasoning, source := resolveIntentClassificationFastReasoning(ctx, agent, config.FastReasoning)
		if selectedFastReasoning == nil {
			return nil, ""
		}

		channel, err := model.GetChannelByID(*selectedFastReasoning.ChannelID)
		if err == nil && channel != nil {
			return channel, strings.TrimSpace(*selectedFastReasoning.ModelName)
		}

		logger.Warnf(ctx, "[%s] %s渠道不可用: channel_id=%d, err=%v", caller, source, *selectedFastReasoning.ChannelID, err)
		return nil, ""
	}

	selectLogicReasoning := func() (*model.Channel, string) {
		if config.LogicChannel != nil && config.LogicModelName != nil {
			selectedModelName := strings.TrimSpace(*config.LogicModelName)
			if selectedModelName != "" {
				return config.LogicChannel, selectedModelName
			}
		}

		if config.LogicChannelID != nil && config.LogicModelName != nil {
			selectedModelName := strings.TrimSpace(*config.LogicModelName)
			if selectedModelName == "" {
				return nil, ""
			}

			ch, err := model.GetChannelByID(*config.LogicChannelID)
			if err == nil && ch != nil {
				return ch, selectedModelName
			}
			logger.Warnf(ctx, "[%s] LogicReasoning渠道不可用: channel_id=%d, err=%v", caller, *config.LogicChannelID, err)
		}

		return nil, ""
	}

	if preferFastReasoning {
		if selectedChannel, selectedModelName := selectFastReasoning(); selectedChannel != nil {
			return selectedChannel, selectedModelName, nil
		}
		if selectedChannel, selectedModelName := selectLogicReasoning(); selectedChannel != nil {
			return selectedChannel, selectedModelName, nil
		}
	} else {
		if selectedChannel, selectedModelName := selectLogicReasoning(); selectedChannel != nil {
			return selectedChannel, selectedModelName, nil
		}
		if selectedChannel, selectedModelName := selectFastReasoning(); selectedChannel != nil {
			return selectedChannel, selectedModelName, nil
		}
	}

	return nil, "", fmt.Errorf("没有可用的模型渠道进行意图分类")
}

func (s *ContentGeneratorService) generateFastIntentRouteWithoutCache(
	ctx context.Context,
	selectedChannel *model.Channel,
	selectedModelName string,
	request *IntentClassificationRequest,
	availableSkills []*skill.Skill,
) (*IntentClassificationResult, error) {
	systemPrompt := s.buildFastIntentRouteSystemPrompt(availableSkills)
	userPrompt := s.buildIntentClassificationUserPrompt(request)

	messages := []relaymodel.Message{
		{
			Role:    "system",
			Content: systemPrompt,
		},
		{
			Role:    "user",
			Content: userPrompt,
		},
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:    selectedModelName,
		Messages: messages,
	}
	applyInternalRequestControl(chatReq, &internalRequestControl{ReasoningMode: "disabled"})

	content, err, openaiErr := s.testChannel(timeoutCtx, selectedChannel, chatReq)
	if err != nil || openaiErr != nil {
		logger.Errorf(ctx, "快速意图路由调用LLM失败: %v", err)
		return nil, fmt.Errorf("快速意图路由调用LLM失败: %v", err)
	}

	result, err := s.parseFastIntentRouteResponse(content)
	if err != nil {
		logger.Errorf(ctx, "解析快速意图路由响应失败: %v", err)
		return nil, fmt.Errorf("解析快速意图路由响应失败: %v", err)
	}

	if result != nil {
		result.NormalizedQuery = strings.TrimSpace(result.NormalizedQuery)
		if result.NormalizedQuery == "" && request != nil && strings.TrimSpace(request.Query) != "" && result.Intent != "CHITCHAT" {
			result.NormalizedQuery = strings.TrimSpace(request.Query)
		}
	}

	return result, nil
}

func (s *ContentGeneratorService) generateComplexQueryExpansionWithoutCache(
	ctx context.Context,
	selectedChannel *model.Channel,
	selectedModelName string,
	request *IntentClassificationRequest,
) (*QueryExpansionResult, error) {
	systemPrompt := s.buildComplexQueryExpansionSystemPrompt()
	userPrompt := s.buildQueryExpansionUserPrompt(request)

	messages := []relaymodel.Message{
		{
			Role:    "system",
			Content: systemPrompt,
		},
		{
			Role:    "user",
			Content: userPrompt,
		},
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:    selectedModelName,
		Messages: messages,
	}
	applyInternalRequestControl(chatReq, &internalRequestControl{ReasoningMode: "disabled"})

	content, err, openaiErr := s.testChannel(timeoutCtx, selectedChannel, chatReq)
	if err != nil || openaiErr != nil {
		logger.Errorf(ctx, "复杂问题拆解调用LLM失败: %v", err)
		return nil, fmt.Errorf("复杂问题拆解调用LLM失败: %v", err)
	}

	result, err := s.parseComplexQueryExpansionResponse(content)
	if err != nil {
		logger.Errorf(ctx, "解析复杂问题拆解响应失败: %v", err)
		return nil, fmt.Errorf("解析复杂问题拆解响应失败: %v", err)
	}

	if result != nil && result.NormalizedQuery == "" && request != nil && strings.TrimSpace(request.Query) != "" {
		result.NormalizedQuery = strings.TrimSpace(request.Query)
	}

	return result, nil
}

func (s *ContentGeneratorService) generateIntentClassificationWithoutCache(
	ctx context.Context,
	selectedChannel *model.Channel,
	selectedModelName string,
	request *IntentClassificationRequest,
	availableSkills []*skill.Skill,
) (*IntentClassificationResult, error) {
	// 构建提示词
	systemPrompt := s.buildIntentClassificationSystemPrompt(availableSkills)
	userPrompt := s.buildIntentClassificationUserPrompt(request)

	// 构建消息
	messages := []relaymodel.Message{
		{
			Role:    "system",
			Content: systemPrompt,
		},
		{
			Role:    "user",
			Content: userPrompt,
		},
	}

	// 设置超时上下文
	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	// 调用LLM
	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:    selectedModelName,
		Messages: messages,
	}
	applyInternalRequestControl(chatReq, &internalRequestControl{ReasoningMode: "disabled"})

	content, err, openaiErr := s.testChannel(timeoutCtx, selectedChannel, chatReq)
	if err != nil || openaiErr != nil {
		logger.Errorf(ctx, "意图分类调用LLM失败: %v", err)
		return nil, fmt.Errorf("意图分类调用LLM失败: %v", err)
	}

	// 解析响应
	result, err := s.parseIntentClassificationResponse(content)
	if err != nil {
		logger.Errorf(ctx, "解析意图分类响应失败: %v", err)
		return nil, fmt.Errorf("解析意图分类响应失败: %v", err)
	}

	if result != nil {
		result.NormalizedQuery = strings.TrimSpace(result.NormalizedQuery)
		if result.NormalizedQuery == "" && request != nil && strings.TrimSpace(request.Query) != "" && result.Intent != "CHITCHAT" {
			result.NormalizedQuery = strings.TrimSpace(request.Query)
		}
	}

	return result, nil
}

func resolveIntentClassificationFastReasoning(ctx context.Context, agent *model.Agent, chunkFastReasoning model.ModelChannelConfig) (*model.ModelChannelConfig, string) {
	if chunkFastReasoning.ChannelID != nil && chunkFastReasoning.ModelName != nil {
		return &chunkFastReasoning, "chunk_fast_reasoning"
	}

	if agent != nil {
		agentFastReasoning, err := agent.GetFastReasoningConfig()
		if err != nil {
			logger.Warnf(ctx, "[GenerateIntentClassification] 读取agent fast_reasoning配置失败: %v", err)
		} else if agentFastReasoning != nil && agentFastReasoning.ChannelID != nil && agentFastReasoning.ModelName != nil {
			return agentFastReasoning, "agent_fast_reasoning"
		}
	}

	return nil, ""
}

// GenerateQuestionsAndSummary 生成问题和简介
func (s *ContentGeneratorService) GenerateQuestionsAndSummary(ctx context.Context, eid int64, config *ChunkConfig, req *GenerateQuestionsAndSummaryRequest) (*GenerateQuestionsAndSummaryResponse, error) {
	selectedChannel, selectedModelName, selectErr := config.SelectPipelineLLM()
	if selectErr != nil {
		return nil, fmt.Errorf("没有配置推理渠道，无法生成问题和简介: %v", selectErr)
	}

	budget := tokenlimit.ComputeBudget(ctx, selectedChannel.ChannelID, selectedChannel.Config, selectedModelName, 0, 8192, 6000)
	content := ComposeSummaryInput(req.Content, budget.InputAvailable)

	// 构建问题和简介生成的提示词
	prompt := s.buildQuestionsAndSummaryPrompt(content)

	// 调用LLM生成问题和简介

	// 设置超时上下文
	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: 0, // 不限制输出，由模型自由生成
	}
	systemMessage := relaymodel.Message{
		Role:    "system",
		Content: "你是一个文档分析助手。根据用户提供的文档内容，生成3个常见问法和1份简介。内容可能是从文档多个位置拼接而成的代表性窗口，请综合整体语义，不要把窗口边界当成章节边界。严格按照JSON格式输出，不要包含其他内容。",
	}

	userMessage := relaymodel.Message{
		Role:    "user",
		Content: prompt,
	}
	chatReq.Messages = append(chatReq.Messages, systemMessage)
	chatReq.Messages = append(chatReq.Messages, userMessage)

	_ = timeoutCtx
	content, err, openaiErr := s.testChannel(ctx, selectedChannel, chatReq)
	if err != nil || openaiErr != nil {
		logger.Errorf(ctx, "AI生成问题和简介失败: %v", err)
		if openaiErr != nil {
			logger.Errorf(ctx, "OpenAI API错误: %v", openaiErr)
			return nil, fmt.Errorf("OpenAI API错误: %v", openaiErr)
		}
		return nil, fmt.Errorf("AI生成问题和简介失败: %v", err)
	}

	// 解析JSON响应
	response, err := s.parseQuestionsAndSummaryContent(content)
	if err != nil {
		logger.Errorf(ctx, "解析问题和简介内容失败: %v", err)
		return nil, fmt.Errorf("解析问题和简介内容失败: %v", err)
	}

	return response, nil
}

func (s *ContentGeneratorService) GenerateQuestionsSummaryAndEntities(ctx context.Context, eid int64, config *ChunkConfig, req *GenerateQuestionsAndSummaryRequest) (*GenerateQuestionsSummaryAndEntitiesResponse, error) {
	selectedChannel, selectedModelName, selectErr := config.SelectPipelineLLM()
	if selectErr != nil {
		return nil, fmt.Errorf("没有配置推理渠道，无法生成问题和简介: %v", selectErr)
	}

	budget := tokenlimit.ComputeBudget(ctx, selectedChannel.ChannelID, selectedChannel.Config, selectedModelName, 0, 8192, 6000)
	content := ComposeSummaryInput(req.Content, budget.InputAvailable)
	prompt := s.buildQuestionsSummaryAndEntitiesPrompt(content)

	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: 0, // 不限制输出，由模型自由生成
	}
	systemMessage := relaymodel.Message{
		Role:    "system",
		Content: "你是一个文档分析与信息抽取助手。根据用户提供的文档内容，生成3个常见问法、1份简介，并抽取实体列表。内容可能是从文档多个位置拼接而成的代表性窗口，请综合整体语义，不要把窗口边界当成章节边界。严格按照JSON格式输出，不要包含其他内容。",
	}
	userMessage := relaymodel.Message{
		Role:    "user",
		Content: prompt,
	}
	chatReq.Messages = append(chatReq.Messages, systemMessage, userMessage)

	_ = timeoutCtx
	resp, err, openaiErr := s.testChannel(ctx, selectedChannel, chatReq)
	if err != nil || openaiErr != nil {
		logger.Errorf(ctx, "AI生成问题、简介与实体失败: %v", err)
		if openaiErr != nil {
			logger.Errorf(ctx, "OpenAI API错误: %v", openaiErr)
			return nil, fmt.Errorf("OpenAI API错误: %v", openaiErr)
		}
		return nil, fmt.Errorf("AI生成问题、简介与实体失败: %v", err)
	}

	parsed, err := s.parseQuestionsSummaryAndEntitiesContent(resp)
	if err != nil {
		logger.Errorf(ctx, "解析问题、简介与实体内容失败: %v", err)
		return nil, fmt.Errorf("解析问题、简介与实体内容失败: %v", err)
	}

	return parsed, nil
}

func (s *ContentGeneratorService) GenerateSummaryQuestionsKnowledgeMap(ctx context.Context, eid int64, config *ChunkConfig, req *GenerateSummaryQuestionsKnowledgeMapRequest) (*GenerateSummaryQuestionsKnowledgeMapResponse, *relaymodel.Usage, error) {
	selectedChannel, selectedModelName, selectErr := config.SelectPipelineLLM()
	if selectErr != nil {
		return nil, nil, fmt.Errorf("没有配置推理渠道，无法生成内容: %v", selectErr)
	}

	budget := tokenlimit.ComputeBudget(ctx, selectedChannel.ChannelID, selectedChannel.Config, selectedModelName, 0, 8192, 6000)
	content := ComposeSummaryInput(req.Content, budget.InputAvailable)
	promptReq := *req
	if promptReq.SummaryMaxWords <= 0 {
		promptReq.SummaryMaxWords = resolveSummaryMaxWords(req.Content)
	}
	prompt := s.buildSummaryQuestionsKnowledgeMapPrompt(&promptReq)

	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: 0, // 不限制输出，由模型自由生成
	}
	systemMessage := relaymodel.Message{
		Role:    "system",
		Content: prompt,
	}
	userMessage := relaymodel.Message{
		Role:    "user",
		Content: content,
	}
	chatReq.Messages = append(chatReq.Messages, systemMessage, userMessage)

	_ = timeoutCtx
	resp, usage, err, openaiErr := s.testChannelInternal(ctx, selectedChannel, chatReq)
	if err != nil || openaiErr != nil {
		logger.Errorf(ctx, "AI生成内容失败: %v", err)
		if openaiErr != nil {
			logger.Errorf(ctx, "OpenAI API错误: %v", openaiErr)
			return nil, usage, fmt.Errorf("OpenAI API错误: %v", openaiErr)
		}
		return nil, usage, fmt.Errorf("AI生成内容失败: %v", err)
	}

	parsed, err := s.parseSummaryQuestionsKnowledgeMapContent(resp)
	if err != nil {
		logger.Errorf(ctx, "解析生成内容失败: %v", err)
		return nil, usage, fmt.Errorf("解析生成内容失败: %v", err)
	}

	if req.GenerateSummary {
		if strings.TrimSpace(parsed.Summary) == "" {
			return nil, usage, fmt.Errorf("简介内容不能为空")
		}
	} else {
		parsed.Summary = ""
	}

	if req.GenerateQuestions {
		if len(parsed.Questions) != 3 {
			return nil, usage, fmt.Errorf("期望3个问题，实际得到%d个", len(parsed.Questions))
		}
	} else {
		parsed.Questions = nil
	}

	if req.GenerateKnowledgeMap {
		if strings.TrimSpace(parsed.KnowledgeMap) == "" {
			return nil, usage, fmt.Errorf("知识地图内容不能为空")
		}
		normalized, err := s.normalizeKnowledgeMapMarkdown(parsed.KnowledgeMap)
		if err != nil {
			return nil, usage, err
		}
		parsed.KnowledgeMap = normalized
	} else {
		parsed.KnowledgeMap = ""
	}

	return parsed, usage, nil
}

func resolveSummaryMaxWords(content string) int {
	length := len([]rune(strings.TrimSpace(content)))
	switch {
	case length <= 4000:
		return 500
	case length <= 20000:
		return 800
	case length <= 50000:
		return 1200
	default:
		return 1500
	}
}

func (s *ContentGeneratorService) GenerateKnowledgeMap(ctx context.Context, channel *model.Channel, modelName string, req *GenerateKnowledgeMapRequest) (string, *relaymodel.Usage, error) {
	if channel == nil {
		return "", nil, fmt.Errorf("知识地图生成渠道不能为空")
	}
	if strings.TrimSpace(req.Content) == "" {
		return "", nil, fmt.Errorf("知识地图生成内容不能为空")
	}
	rootTitle := strings.TrimSpace(req.RootTitle)
	if rootTitle == "" {
		rootTitle = "知识地图"
	}

	systemPrompt := fmt.Sprintf(`你是一个擅长结构化内容梳理的文档分析助手。
请根据给定的文档内容，生成一份 Mermaid 思维导图 (mindmap) 的 Markdown 代码。

要求：
1. 只输出 Mermaid 代码块，不要添加任何解释或前后缀文本。
2. 使用如下基本格式：
   `+"```"+`mermaid
   mindmap
     root((%s))
       一级节点
         二级节点
   `+"```"+`
3. 结构要求：
   - 根节点使用圆角形：root((%s))
   - 1-3 级层次，避免过深嵌套
   - 覆盖文档的核心模块、关键流程、重要概念
   - 节点文本简洁清晰，不要超过 20 个字
4. 不要生成与内容无关的节点，不要虚构信息。

下面是待分析的文档内容：`, rootTitle, rootTitle)

	budget := tokenlimit.ComputeBudget(ctx, channel.ChannelID, channel.Config, modelName, 0, 8192, 6000)
	content := ComposeSummaryInput(req.Content, budget.InputAvailable)

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     modelName,
		MaxTokens: 0, // 不限制输出，由模型自由生成
	}
	systemMessage := relaymodel.Message{
		Role:    "system",
		Content: systemPrompt,
	}
	userMessage := relaymodel.Message{
		Role:    "user",
		Content: content,
	}
	chatReq.Messages = append(chatReq.Messages, systemMessage, userMessage)

	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	_ = timeoutCtx
	resp, usage, err, openaiErr := s.testChannelInternal(ctx, channel, chatReq)
	if err != nil || openaiErr != nil {
		logger.Errorf(ctx, "AI生成知识地图失败: %v", err)
		if openaiErr != nil {
			logger.Errorf(ctx, "OpenAI API错误: %v", openaiErr)
			return "", usage, fmt.Errorf("OpenAI API错误: %v", openaiErr)
		}
		return "", usage, fmt.Errorf("AI生成知识地图失败: %v", err)
	}

	result, err := s.normalizeKnowledgeMapMarkdown(resp)
	if err != nil {
		logger.Errorf(ctx, "解析知识地图内容失败: %v", err)
		return "", usage, err
	}
	return result, usage, nil
}

func (s *ContentGeneratorService) normalizeKnowledgeMapMarkdown(content string) (string, error) {
	c := strings.TrimSpace(content)
	if c == "" {
		return "", fmt.Errorf("知识地图内容为空")
	}

	start := strings.Index(c, "```mermaid")
	if start != -1 {
		rest := c[start:]
		closeIdx := strings.Index(rest[len("```mermaid"):], "```")
		if closeIdx != -1 {
			closePos := len("```mermaid") + closeIdx
			block := strings.TrimSpace(rest[:closePos+3])
			if block != "" {
				return block, nil
			}
		}
	}

	idx := strings.Index(c, "mindmap")
	if idx != -1 {
		c = strings.TrimSpace(c[idx:])
	}

	return "```mermaid\n" + c + "\n```", nil
}

// buildQuestionsAndSummaryPrompt 构建问题和简介生成的提示词
func (s *ContentGeneratorService) buildQuestionsAndSummaryPrompt(content string) string {
	return fmt.Sprintf(`你是一个文档分析助手。根据用户提供的文档内容，生成3个常见问法和1份简介。
文档内容可能是从多个窗口拼接而成的代表性片段，请综合全局语义，不要把窗口边界当成章节边界。

## 要求

### 常见问法
- 生成3个用户最可能提出的问题
- 使用简短疑问句形式
- 问题应覆盖文档核心内容

### 简介
- 200字以内
- 引导性风格，吸引用户进一步阅读
- 准确概括文档主旨

## 输出格式
严格按以下JSON格式输出，不要包含其他内容：
{
  "questions": ["问题1", "问题2", "问题3"],
  "summary": "简介内容"
}

## 文档内容
%s`, content)
}

func (s *ContentGeneratorService) buildSummaryQuestionsKnowledgeMapPrompt(req *GenerateSummaryQuestionsKnowledgeMapRequest) string {
	rootTitle := strings.TrimSpace(req.RootTitle)
	if rootTitle == "" {
		rootTitle = "知识地图"
	}
	summaryMaxWords := req.SummaryMaxWords
	if summaryMaxWords <= 0 {
		summaryMaxWords = 500
	}
	summaryPrompt := strings.TrimSpace(req.SummaryPrompt)
	if summaryPrompt == "" {
		summaryPrompt = "请为该文档生成一整篇浓缩摘要，优先使用 2-5 个主题段落而不是分点罗列，覆盖背景、要点、结论与适用范围。"
	}

	var builder strings.Builder
	builder.WriteString("你是一个文档分析助手。根据文档内容生成结构化摘要、常见问法和知识地图。内容可能是从多个窗口拼接而成的代表性片段，请综合全局语义，不要把窗口边界当成章节边界。\n\n")
	builder.WriteString("生成规则：\n")
	if req.GenerateSummary {
		builder.WriteString(fmt.Sprintf("1) summary：%s 字数不超过 %d 字。不要按片段顺序罗列，不要输出目录式大纲，而是写成一个完整、连贯的摘要。\n", summaryPrompt, summaryMaxWords))
	} else {
		builder.WriteString("1) summary：未开启，返回空字符串。\n")
	}
	if req.GenerateQuestions {
		builder.WriteString("2) questions：生成3个用户最可能提出的问题，使用简短疑问句，覆盖核心内容。\n")
	} else {
		builder.WriteString("2) questions：未开启，返回空数组。\n")
	}
	if req.GenerateKnowledgeMap {
		builder.WriteString(fmt.Sprintf("3) knowledge_map：生成 Mermaid 思维导图代码块，根节点为 root((%s))，1-3级层次，覆盖核心模块、关键流程、重要概念，节点不超过20字，只输出 Mermaid 代码块内容。\n", rootTitle))
	} else {
		builder.WriteString("3) knowledge_map：未开启，返回空字符串。\n")
	}

	builder.WriteString("4) image rule：如果文档内容中包含 <images> 标签或可见图片引用，优先在 summary 中保留相关图片，使用 Markdown 语法 ![caption](url) 原样引用，不要改写 url。\n")

	builder.WriteString("\n输出格式为 JSON，不要包含其他内容：\n")
	builder.WriteString("{\n")
	builder.WriteString(`  "summary": "简介内容",` + "\n")
	builder.WriteString(`  "questions": ["问题1", "问题2", "问题3"],` + "\n")
	builder.WriteString(`  "knowledge_map": "` + "```mermaid\nmindmap\n  root((" + rootTitle + "))\n  节点\n```" + "\"\n")
	builder.WriteString("}\n")
	return builder.String()
}

func (s *ContentGeneratorService) buildQuestionsSummaryAndEntitiesPrompt(content string) string {
	return fmt.Sprintf(`你是一个文档分析与信息抽取助手。根据用户提供的文档内容，生成3个常见问法、1份简介，并抽取实体列表。
文档内容可能是从多个窗口拼接而成的代表性片段，请综合全局语义，不要把窗口边界当成章节边界。

## 要求

### 常见问法
- 生成3个用户最可能提出的问题
- 使用简短疑问句形式
- 问题应覆盖文档核心内容

### 简介
- 200字以内
- 引导性风格，吸引用户进一步阅读
- 准确概括文档主旨

### 实体抽取
实体类型必须从下面枚举中选择，且必须严格使用这些英文标签：
- %s: 人物（真实的人名）
- %s: 组织/公司/部门/机构
- %s: 产品/系统/服务/平台名称（软件、硬件、业务产品）
- %s: 地点（国家、省市、园区、地址等）
- %s: 时间（日期、月份、年份、时间点、时间范围）
- %s: 事件（发布、会议、故障、活动等有发生含义的事件）
- %s: 文档/制度/规范/手册/协议/文件名等
- %s: 概念/术语/指标/名词性知识点
- %s: 方法/流程/步骤/方案/机制

抽取规则：
1) 只抽取文本中明确出现的实体，不要猜测或补全。
2) 实体名必须是原文中的连续片段，保持原文大小写与中文全角半角。
3) 去重：同一 type + name 只能出现一次。
4) 如果不确定类型，优先用 Concept；不要发明新类型。
5) 高频基础实体补充：当文本中某个复合实体（例如“火星导弹”）重复出现时，需要补充抽取其基础组成实体（例如“火星”“导弹”），基础实体也必须满足规则 1) 和 2)。
6) confidence 取值范围 0-1。

## 输出格式
严格按以下JSON格式输出，不要包含其他内容：
{
  "questions": ["问题1", "问题2", "问题3"],
  "summary": "简介内容",
  "entities": [
    {"type": "Concept", "name": "术语", "confidence": 0.86}
  ]
}

## 文档内容
%s`, model.EntityTypePerson, model.EntityTypeOrganization, model.EntityTypeProduct, model.EntityTypeLocation, model.EntityTypeTime, model.EntityTypeEvent, model.EntityTypeDocument, model.EntityTypeConcept, model.EntityTypeMethod, content)
}

// parseQuestionsAndSummaryContent 解析AI生成的问题和简介内容
func (s *ContentGeneratorService) parseQuestionsAndSummaryContent(content string) (*GenerateQuestionsAndSummaryResponse, error) {
	var response GenerateQuestionsAndSummaryResponse
	if err := common.ParseLLMJSONInto(context.Background(), content, &response); err != nil {
		logger.Errorf(context.Background(), "JSON解析失败: %v, 完整响应: %s", err, content)
		return nil, fmt.Errorf("JSON解析失败: %v", err)
	}

	// 验证结果
	if len(response.Questions) != 3 {
		return nil, fmt.Errorf("期望3个问题，实际得到%d个", len(response.Questions))
	}

	if response.Summary == "" {
		return nil, fmt.Errorf("简介内容不能为空")
	}

	return &response, nil
}

func (s *ContentGeneratorService) parseSummaryQuestionsKnowledgeMapContent(content string) (*GenerateSummaryQuestionsKnowledgeMapResponse, error) {
	var response GenerateSummaryQuestionsKnowledgeMapResponse
	if err := common.ParseLLMJSONInto(context.Background(), content, &response); err != nil {
		logger.Errorf(context.Background(), "[parseSummaryQuestionsKnowledgeMapContent] JSON解析失败: %v, 原始内容: %s", err, content)
		return nil, fmt.Errorf("JSON解析失败: %v", err)
	}

	return &response, nil
}

func (s *ContentGeneratorService) parseQuestionsSummaryAndEntitiesContent(content string) (*GenerateQuestionsSummaryAndEntitiesResponse, error) {
	var response GenerateQuestionsSummaryAndEntitiesResponse
	if err := common.ParseLLMJSONInto(context.Background(), content, &response); err != nil {
		logger.Errorf(context.Background(), "[parseQuestionsSummaryAndEntitiesContent] JSON解析失败: %v, 原始内容: %s", err, content)
		return nil, fmt.Errorf("JSON解析失败: %v", err)
	}

	if len(response.Questions) != 3 {
		return nil, fmt.Errorf("期望3个问题，实际得到%d个", len(response.Questions))
	}
	if strings.TrimSpace(response.Summary) == "" {
		return nil, fmt.Errorf("简介内容不能为空")
	}

	return &response, nil
}

// parseSummaryContent 解析AI生成的概要内容
func (s *ContentGeneratorService) parseSummaryContent(content string) []string {
	lines := strings.Split(content, "\n")
	var summaries []string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		// 过滤空行和明显的非概要内容
		if line != "" &&
			!strings.HasPrefix(line, "概要") &&
			!strings.HasPrefix(line, "总结") &&
			!strings.HasPrefix(line, "摘要") &&
			len(line) > 10 { // 最小长度过滤
			// 移除可能的前缀符号
			line = strings.TrimPrefix(line, "•")
			line = strings.TrimPrefix(line, "-")
			line = strings.TrimPrefix(line, "*")
			line = strings.TrimSpace(line)
			summaries = append(summaries, line)
		}
	}

	return summaries
}

// parseQuestionsContent 解析AI生成的问题内容
func (s *ContentGeneratorService) parseQuestionsContent(content string) []string {
	lines := strings.Split(content, "\n")
	var questions []string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		// 过滤空行和明显的非问题内容
		if line != "" &&
			(strings.Contains(line, "？") || strings.Contains(line, "?")) &&
			!strings.HasPrefix(line, "问题") &&
			len(line) > 5 { // 最小长度过滤
			// 移除可能的前缀符号
			line = strings.TrimPrefix(line, "•")
			line = strings.TrimPrefix(line, "-")
			line = strings.TrimPrefix(line, "*")
			line = strings.TrimSpace(line)
			questions = append(questions, line)
		}
	}

	return questions
}

// GenerateContentForKnowledgeChunk 为知识块生成AI内容
func (s *ContentGeneratorService) GenerateContentForKnowledgeChunk(ctx context.Context, eid int64, config *ChunkConfig, content string) (summaries []string, questions []string, err error) {
	// 检查配置，如果不为ai则直接返回空结果
	if config.SummaryGeneration != "ai" && config.QuestionGeneration != "ai" {
		return nil, nil, nil
	}

	// 并发生成概要和问题
	type SummaryResult struct {
		summaries []string
		err       error
	}

	type QuestionResult struct {
		questions []string
		err       error
	}

	summaryChan := make(chan SummaryResult, 1)
	questionChan := make(chan QuestionResult, 1)

	// 生成概要
	go func() {
		var summaries []string
		var err error

		if config.SummaryGeneration == "ai" {
			summaries, err = s.GenerateSummary(ctx, eid, config, &GenerateSummaryRequest{
				Content:      content,
				MaxSummaries: 3, // 默认生成3个概要
				MaxTokens:    0, // 不限制输出，由模型自由生成
			})
		}
		summaryChan <- SummaryResult{summaries: summaries, err: err}
	}()

	// 生成问题
	go func() {
		var questions []string
		var err error

		if config.QuestionGeneration == "ai" {
			questions, err = s.GenerateQuestions(ctx, eid, config, &GenerateQuestionsRequest{
				Content:      content,
				MaxQuestions: 5, // 默认生成5个问题
				MaxTokens:    0, // 不限制输出，由模型自由生成
			})
		}
		questionChan <- QuestionResult{questions: questions, err: err}
	}()

	// 等待结果
	summaryResult := <-summaryChan
	questionResult := <-questionChan

	// 记录错误但不阻止整个流程
	if summaryResult.err != nil {
		logger.Warnf(ctx, "生成概要失败: %v", summaryResult.err)
	}
	if questionResult.err != nil {
		logger.Warnf(ctx, "生成问题失败: %v", questionResult.err)
	}

	return summaryResult.summaries, questionResult.questions, nil
}

func (s *ContentGeneratorService) testChannel(ctx context.Context, channel *model.Channel, request *relaymodel.GeneralOpenAIRequest) (responseMessage string, err error, openaiErr *relaymodel.Error) {
	responseMessage, _, err, openaiErr = s.testChannelInternal(ctx, channel, request)
	return responseMessage, err, openaiErr
}

// TestChannel 公开的方法，供其他 service 调用
func (s *ContentGeneratorService) TestChannel(ctx context.Context, channel *model.Channel, request *relaymodel.GeneralOpenAIRequest) (string, error, *relaymodel.Error) {
	return s.testChannel(ctx, channel, request)
}

func (s *ContentGeneratorService) testChannelInternal(ctx context.Context, channel *model.Channel, request *relaymodel.GeneralOpenAIRequest) (responseMessage string, usage *relaymodel.Usage, err error, openaiErr *relaymodel.Error) {
	//startTime := time.Now()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = &http.Request{
		Method: "POST",
		URL:    &url.URL{Path: "/v1/chat/completions"},
		Body:   nil,
		Header: make(http.Header),
	}
	c.Request.Header.Set("Authorization", "Bearer "+channel.Key)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(ctxkey.Channel, channel.Type)
	baseURL := channel.GetBaseURL()
	if baseURL == "" && channel.Type >= 1000 {
		return "", nil, fmt.Errorf("channel %d (type %d) has no base URL configured", channel.ChannelID, channel.Type), nil
	}
	c.Set(ctxkey.BaseURL, baseURL)
	cfg, _ := channel.LoadConfig()
	c.Set(ctxkey.Config, cfg)
	middleware.SetupContextForSelectedChannel(c, channel, "")
	meta := meta.GetByContext(c)
	apiType := model.GetApiType(channel.Type)
	meta.APIType = apiType
	// apiType := channeltype.ToAPIType(channel.Type)
	adaptor := GetAdaptor(meta.APIType)
	err = SetCustomConfig(&adaptor, &custom.CustomConfig{
		ConversationId: "",
		UserId:         "53AIHub",
	})
	if err != nil {
		return "", nil, err, nil
	}
	// adaptor := relay.GetAdaptor(apiType)
	if adaptor == nil {
		return "", nil, fmt.Errorf("invalid api type: %d, adaptor is nil", apiType), nil
	}
	adaptor.Init(meta)
	modelName := request.Model
	modelMap := channel.GetModelMapping()
	if modelName == "" || !strings.Contains(channel.Models, modelName) {
		modelNames := strings.Split(channel.Models, ",")
		if len(modelNames) > 0 {
			modelName = modelNames[0]
		}
	}
	if modelMap != nil && modelMap[modelName] != "" {
		modelName = modelMap[modelName]
	}
	meta.OriginModelName, meta.ActualModelName = request.Model, modelName
	request.Model = modelName
	requestControl := extractInternalRequestControl(request)

	// max_tokens 封顶：不影响原始请求的其他字段
	tokenCfg := tokenlimit.ParseConfig(ctx, channel.ChannelID, channel.Config, request.Model)
	if tokenCfg.MaxTokens > 0 {
		tokenlimit.ApplyMaxTokens(ctx, channel.ChannelID, request, tokenCfg.MaxTokens)
	}

	convertedRequest, err := adaptor.ConvertRequest(c, relaymode.ChatCompletions, request)
	if err != nil {
		return "", nil, err, nil
	}
	convertedRequest, err = applyConvertedRequestControl(channel, convertedRequest, requestControl)
	if err != nil {
		return "", nil, err, nil
	}
	jsonData, err := json.Marshal(convertedRequest)
	if err != nil {
		return "", nil, err, nil
	}
	defer func() {
		//logContent := fmt.Sprintf("渠道 %s 测试成功，响应：%s", channel.Name, responseMessage)
		if err != nil || openaiErr != nil {
			// errorMessage := ""
			// if err != nil {
			// 	errorMessage = err.Error()
			// } else {
			// 	errorMessage = openaiErr.Message
			// }
			//logContent = fmt.Sprintf("渠道 %s 测试失败，错误：%s", channel.Name, errorMessage)
		}
		// go model.RecordTestLog(ctx, &model.Log{
		// 	ChannelId:   channel.Id,
		// 	ModelName:   modelName,
		// 	Content:     logContent,
		// 	ElapsedTime: helper.CalcElapsedTime(startTime),
		// })
	}()
	requestBody := bytes.NewBuffer(jsonData)
	c.Request.Body = io.NopCloser(requestBody)
	resp, err := adaptor.DoRequest(c, meta, requestBody)
	if err != nil {
		logger.Warnf(ctx, "【LLM诊断-请求】渠道请求失败: channel_id=%d, api_type=%d, model=%s, max_tokens=%d, request_bytes=%d, err_type=%T",
			channel.ChannelID, apiType, meta.ActualModelName, request.MaxTokens, len(jsonData), err)
		return "", nil, err, nil
	}
	if resp != nil && resp.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		logger.Warnf(ctx, "【LLM诊断-响应】渠道返回非成功状态: channel_id=%d, api_type=%d, model=%s, http_status=%d, response_bytes=%d",
			channel.ChannelID, apiType, meta.ActualModelName, resp.StatusCode, len(responseBody))

		// 尝试解析 OpenAI 格式的错误
		var errResponse relaymodel.ErrorWithStatusCode
		if err := json.Unmarshal(responseBody, &errResponse); err == nil && errResponse.Error.Message != "" {
			return "", nil, fmt.Errorf("http status code: %d, model: %s, error: %s", resp.StatusCode, meta.ActualModelName, errResponse.Error.Message), &errResponse.Error
		}

		// 如果不是标准格式，返回原始响应体
		return "", nil, fmt.Errorf("http status code: %d, model: %s, response: %s", resp.StatusCode, meta.ActualModelName, string(responseBody)), nil
	}
	usage, respErr := adaptor.DoResponse(c, resp, meta)
	if respErr != nil {
		logger.Warnf(ctx, "【LLM诊断-响应】渠道响应转换失败: channel_id=%d, api_type=%d, model=%s, response_bytes=%d, err_type=%T",
			channel.ChannelID, apiType, meta.ActualModelName, w.Body.Len(), respErr)
		return "", nil, fmt.Errorf("%s", respErr.Error.Message), &respErr.Error
	}
	if usage == nil {
		logger.Warnf(ctx, "【LLM诊断-响应】渠道响应 usage 为空: channel_id=%d, api_type=%d, model=%s, response_bytes=%d",
			channel.ChannelID, apiType, meta.ActualModelName, w.Body.Len())
		return "", nil, errors.New("usage is nil"), nil
	}
	rawResponse := w.Body.String()
	_, responseMessage, err = s.parseTestResponse(rawResponse)
	if err != nil {
		logger.Warnf(ctx, "【LLM诊断-解析】响应无法用于内容生成: channel_id=%d, api_type=%d, model=%s, max_tokens=%d, %s, parse_err=%v",
			channel.ChannelID, apiType, meta.ActualModelName, request.MaxTokens, summarizeTestChannelResponse(rawResponse), err)
		if json.Valid([]byte(rawResponse)) {
			if responseError := classifyTestChannelResponseError(rawResponse, ""); responseError != nil {
				logger.Warnf(ctx, "【LLM诊断-错误】响应包含模型错误: channel_id=%d, model=%s, %s",
					channel.ChannelID, meta.ActualModelName, summarizeTestChannelResponse(rawResponse))
				return "", nil, responseError, nil
			}
		}
		return "", nil, err, nil
	}
	if responseError := classifyTestChannelResponseError(rawResponse, responseMessage); responseError != nil {
		logger.Warnf(ctx, "【LLM诊断-错误】响应内容被判定为模型错误: channel_id=%d, model=%s, %s",
			channel.ChannelID, meta.ActualModelName, summarizeTestChannelResponse(rawResponse))
		return "", nil, responseError, nil
	}

	// 统一 token 预算日志
	usageTokenCfg := tokenlimit.ParseConfig(ctx, channel.ChannelID, channel.Config, meta.ActualModelName)
	ctxSource, mtSource := tokenlimit.ReportConfigSource(usageTokenCfg, meta.ActualModelName)
	inputBudget := tokenlimit.DefaultContextBudget
	if usageTokenCfg.ContextLength > 0 {
		inputBudget = int(usageTokenCfg.ContextLength)
	}
	logger.Infof(ctx, "【智能生成-token 预算】类型=content_gen 步骤=test_channel 模型=%s\n"+
		"  输入预算=%d 实际输入token=%d 输出上限=%d 实际输出token=%d\n"+
		"  上下文来源=%s 输出上限来源=%s",
		meta.ActualModelName,
		inputBudget, usage.PromptTokens,
		request.MaxTokens, usage.CompletionTokens,
		ctxSource, mtSource)

	return responseMessage, usage, nil, nil
}

func GetAdaptor(apiType int) adaptor.Adaptor {
	return adaptorregistry.GetAdaptor(apiType)
}

func SetCustomConfig(a *adaptor.Adaptor, customConfig *custom.CustomConfig) error {
	return adaptorregistry.SetCustomConfig(a, customConfig)
}

func applyInternalRequestControl(request *relaymodel.GeneralOpenAIRequest, control *internalRequestControl) {
	if request == nil || control == nil {
		return
	}
	metadata, _ := request.Metadata.(map[string]interface{})
	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	metadata[internalRequestControlMetadataKey] = map[string]interface{}{
		"reasoning_mode": control.ReasoningMode,
	}
	request.Metadata = metadata
}

func extractInternalRequestControl(request *relaymodel.GeneralOpenAIRequest) *internalRequestControl {
	if request == nil {
		return nil
	}
	metadata, ok := request.Metadata.(map[string]interface{})
	if !ok || len(metadata) == 0 {
		return nil
	}
	rawControl, exists := metadata[internalRequestControlMetadataKey]
	if !exists {
		return nil
	}

	controlMap, ok := rawControl.(map[string]interface{})
	if !ok {
		return nil
	}
	control := &internalRequestControl{}
	if mode, ok := controlMap["reasoning_mode"].(string); ok {
		control.ReasoningMode = strings.TrimSpace(mode)
	}

	delete(metadata, internalRequestControlMetadataKey)
	if len(metadata) == 0 {
		request.Metadata = nil
	} else {
		request.Metadata = metadata
	}

	if control.ReasoningMode == "" {
		return nil
	}
	return control
}

func applyConvertedRequestControl(channel *model.Channel, convertedRequest any, control *internalRequestControl) (any, error) {
	if control == nil || strings.TrimSpace(control.ReasoningMode) == "" || channel == nil {
		return convertedRequest, nil
	}
	if strings.TrimSpace(channel.Config) == "" {
		return convertedRequest, nil
	}

	var configMap map[string]interface{}
	if err := json.Unmarshal([]byte(channel.Config), &configMap); err != nil {
		return convertedRequest, nil
	}
	deepThinking, _ := configMap["deep_thinking"].(bool)
	if !deepThinking {
		return convertedRequest, nil
	}

	raw, err := json.Marshal(convertedRequest)
	if err != nil {
		return nil, err
	}
	var requestMap map[string]interface{}
	if err := json.Unmarshal(raw, &requestMap); err != nil {
		return nil, err
	}

	switch control.ReasoningMode {
	case "disabled":
		requestMap["thinking"] = map[string]interface{}{"type": "disabled"}
		requestMap["enable_thinking"] = false
	}

	return requestMap, nil
}

func (s *ContentGeneratorService) parseTestResponse(resp string) (*openai.TextResponse, string, error) {
	var response openai.TextResponse
	err := json.Unmarshal([]byte(resp), &response)
	if err != nil {
		return nil, "", err
	}
	if len(response.Choices) == 0 {
		return nil, "", errors.New("response has no choices")
	}
	stringContent, ok := response.Choices[0].Content.(string)
	if !ok {
		return nil, "", errors.New("response content is not string")
	}
	return &response, stringContent, nil
}

// summarizeTestChannelResponse 只输出响应结构信息，不输出模型原文，避免日志泄露用户内容或密钥。
func summarizeTestChannelResponse(raw string) string {
	type responseChoice struct {
		FinishReason string `json:"finish_reason"`
		Message      struct {
			Content          json.RawMessage `json:"content"`
			ReasoningContent json.RawMessage `json:"reasoning_content"`
		} `json:"message"`
		Text json.RawMessage `json:"text"`
	}
	var envelope struct {
		Choices []responseChoice `json:"choices"`
	}
	if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
		return fmt.Sprintf("response_bytes=%d, json_valid=false", len(raw))
	}
	contentBytes := 0
	reasoningBytes := 0
	textBytes := 0
	finishReason := ""
	if len(envelope.Choices) > 0 {
		choice := envelope.Choices[0]
		contentBytes = len(choice.Message.Content)
		reasoningBytes = len(choice.Message.ReasoningContent)
		textBytes = len(choice.Text)
		finishReason = choice.FinishReason
	}
	return fmt.Sprintf("response_bytes=%d, json_valid=true, choices=%d, content_bytes=%d, reasoning_bytes=%d, text_bytes=%d, finish_reason=%q",
		len(raw), len(envelope.Choices), contentBytes, reasoningBytes, textBytes, finishReason)
}

func classifyTestChannelResponseError(rawResponse, responseContent string) error {
	message := common.ClassifyLLMResponseError(rawResponse, responseContent)
	if message == "" {
		return nil
	}
	return errors.New(message)
}

// buildFastIntentRouteSystemPrompt 构建轻量意图路由系统提示词
func (s *ContentGeneratorService) buildFastIntentRouteSystemPrompt(availableSkills []*skill.Skill) string {
	skillDesc := "无"
	if len(availableSkills) > 0 {
		var sb strings.Builder
		for _, sk := range availableSkills {
			if sk == nil {
				continue
			}
			sb.WriteString(fmt.Sprintf("- %s: %s\n", strings.TrimSpace(sk.Name), strings.TrimSpace(sk.Description)))
		}
		if strings.TrimSpace(sb.String()) != "" {
			skillDesc = sb.String()
		}
	}

	return fmt.Sprintf(`你是知识库系统的快速意图路由器，只输出JSON。

目标:
用最少判断完成路由、核心检索词和文种识别。不要生成最终回复正文，不要拆解多个检索问题。

意图类型:
- CHITCHAT: 闲聊、问候、感谢、告别、情绪表达，或无需知识库即可回复的非业务问题。
- SIMPLE_RAG: 单一事实、单一对象、单一制度、单一记录、单一产品信息查询，通常一次检索即可回答。
- COMPLEX_AGENT: 需要比较、总结、归因、评估、规划、多步推理或跨文档整合的问题。
- USE_SKILL: 用户明确要求执行某个技能操作。

分类优先级:
USE_SKILL > COMPLEX_AGENT > SIMPLE_RAG > CHITCHAT

判定规则:
1. 涉及企业信息、制度、人员、记录、产品事实、业务数据的问题，不判为 CHITCHAT。
2. 只有明确要求执行技能操作时才判为 USE_SKILL。
3. 需要比较、总结、归因、评估、规划、方案生成、跨文档整合时判为 COMPLEX_AGENT。
4. 其他需要知识库检索但目标单一的问题判为 SIMPLE_RAG。
5. 不确定时优先判为 SIMPLE_RAG。

字段规则:
1. keywords:
- 提取核心检索词，保留原词，不做同义改写
- 优先提取实体名、制度名、字段名、业务动作、专有名词
- 通常 1-6 个，无则 []

2. document_type:
- 当问题明确指向某类文档时，提取最贴近的文种名称
- 例如财务报告、年度报告、合同、制度、公告、招股说明书
- 无法明确判断时返回 ""

3. normalized_query:
- 只做上下文消解，不扩展用户意图
- 补全代词、省略对象、必要时间范围
- 相对时间按 Current Time 转成明确时间
- 去掉寒暄和语气词
- 原问题已清晰时，保持原文

4. skill_name:
- 仅 intent=USE_SKILL 时填写
- 必须从 Available Skills 中选择
- 没有明确匹配则返回 ""，不要编造

Available Skills:
%s

输出要求:
1. 只输出JSON。
2. 不输出解释。
3. 只返回下面列出的字段。
4. intent!=USE_SKILL 时 skill_name=""。
5. CHITCHAT 的 normalized_query 可以为空。
6. confidence 为 0 到 1 的数字。

{
  "intent": "CHITCHAT" | "SIMPLE_RAG" | "COMPLEX_AGENT" | "USE_SKILL",
  "skill_name": "",
  "confidence": 0.0,
  "reasoning": "分类理由简要说明",
  "keywords": [],
  "document_type": "",
  "normalized_query": ""
}`, skillDesc)
}

func (s *ContentGeneratorService) buildComplexQueryExpansionSystemPrompt() string {
	return `你是复杂知识库问题的查询拆解器，只输出JSON。

任务:
仅针对已经判定为 COMPLEX_AGENT 的问题，生成更适合知识库检索的规范问题和拆分查询。

规则:
1. normalized_query 只做上下文消解和必要时间明确，不引入新对象、新事实或新结论。
2. expanded_queries 基于 normalized_query 生成 1-3 个检索问题。
3. expanded_queries 从不同检索角度切入，但保持原意不变。
4. keywords 提取核心检索词，保留原词，不做同义改写。
5. document_type 只在问题明确指向某类文档时填写，否则返回 ""。
6. 不生成最终回复正文，不解释拆解理由。

{
  "normalized_query": "",
  "keywords": [],
  "document_type": "",
  "expanded_queries": []
}`
}

// buildIntentClassificationSystemPrompt 构建意图分类系统提示词
func (s *ContentGeneratorService) buildIntentClassificationSystemPrompt(availableSkills []*skill.Skill) string {
	skillDesc := ""
	if len(availableSkills) > 0 {
		var sb strings.Builder
		sb.WriteString("4. **USE_SKILL**: 当用户明确想要执行特定任务，且该任务匹配以下[自动触发技能]时选择此项。\n")
		sb.WriteString("   - 你必须等待工具返回真实结果后，才能基于该结果回答用户。在工具执行完成前，不要假设或编造任何结果。\n")
		sb.WriteString("   - **重要**: skill_name 只能填写一个最匹配的技能名称，不要填写多个。如果用户请求涉及多个技能，选择第一个需要执行的技能，后续技能由 Agent 自动串联调用。\n")
		sb.WriteString("   [自动触发技能列表]:\n")
		for _, sk := range availableSkills {
			sb.WriteString(fmt.Sprintf("   - %s: %s\n", sk.Name, sk.Description))
		}
		skillDesc = sb.String()
	}

	return fmt.Sprintf(`你是知识库系统的轻量意图路由器，只输出JSON。

任务:
根据最近对话、当前问题和当前时间，判断用户请求应进入哪个处理链路。

意图类型:
- CHITCHAT: 闲聊、问候、感谢、告别、情绪表达，或无需知识库即可回复的非业务问题。
- SIMPLE_RAG: 单一事实、单一对象、单一制度、单一记录、单一产品信息查询，通常一次检索即可回答。
- COMPLEX_AGENT: 需要比较、总结、归因、评估、规划、多步推理或跨文档整合的问题。
- USE_SKILL: 用户明确要求执行某个技能操作。


分类优先级:
USE_SKILL > COMPLEX_AGENT > SIMPLE_RAG > CHITCHAT

判定规则:
1. 涉及企业信息、制度、人员、记录、产品事实、业务数据的问题，不判为 CHITCHAT。
2. 只有明确要求执行技能操作时才判为 USE_SKILL。
3. 需要比较、总结、归因、评估、规划、方案生成、跨文档整合时判为 COMPLEX_AGENT。
4. 其他需要知识库检索但目标单一的问题判为 SIMPLE_RAG。
5. 不确定时优先判为 SIMPLE_RAG。

字段规则:
1. keywords:
- 提取核心检索词，保留原词，不做同义改写
- 优先提取实体名、制度名、字段名、业务动作、专有名词
- 通常 1-6 个，无则 []

2. document_type:
- 当问题明确指向某类文档时，提取最贴近的文种名称
- 例如财务报告、年度报告、合同、制度、公告、招股说明书
- 无法明确判断时返回 ""

3. normalized_query:
- 只做上下文消解，不扩展用户意图。
- 补全代词、省略对象、必要时间范围。
- 相对时间按 Current Time 转成明确时间。
- 去掉寒暄和语气词。
- 原问题已清晰时，保持原文。

4. expanded_queries:
- 仅 intent=COMPLEX_AGENT 生成 1-3 个
- 基于 normalized_query 扩展，而不是直接基于原始问题扩展
- 结合已消解的上下文对象和明确时间范围
- 从不同检索角度切入，保持原意不变
- 简短、适合检索
- 不得引入新事实、新对象、新时间范围或新结论

5. skill_name 规则:
- 仅 intent=USE_SKILL 时填写。
- 必须从 Available Skills 中选择。
- 没有明确匹配则返回 ""，不要编造。

Available Skills:
%s

输出要求:
1. 只输出JSON。
2. 不输出解释。
3. 所有字段必须返回。
4. intent!=USE_SKILL 时 skill_name=""。
5. CHITCHAT 的 normalized_query 可以为空。
6. confidence 为 0 到 1 的数字。

Output Format:
只输出 JSON，所有字段必须返回，无内容时返回 "" 或 []。

{
  "intent": "CHITCHAT" | "SIMPLE_RAG" | "COMPLEX_AGENT" | "USE_SKILL",
  "skill_name": "",
  "confidence": 0.0,
  "reasoning": "分类理由简要说明",
  "keywords": [],
  "document_type": "",
  "normalized_query": "",
  "answer": "",
  "expanded_queries": []
}`, skillDesc)
}

// buildIntentClassificationUserPrompt 构建意图分类用户提示词
func (s *ContentGeneratorService) buildIntentClassificationUserPrompt(request *IntentClassificationRequest) string {
	var builder strings.Builder
	if request == nil {
		request = &IntentClassificationRequest{}
	}

	builder.WriteString(fmt.Sprintf("User Question: %s\n\n", request.Query))

	if len(request.Conversation) > 0 {
		builder.WriteString("Recent Conversation:\n")
		for i, conv := range request.Conversation {
			builder.WriteString(fmt.Sprintf("%d. User: %s\n", i+1, conv.Query))
			if conv.Answer != "" {
				builder.WriteString(fmt.Sprintf("   Assistant: %s\n", conv.Answer))
			}
		}
		builder.WriteString("\n")
	}

	builder.WriteString(fmt.Sprintf("Current Time: %s\n\n", time.Now().Format("2006-01-02 15:04:05")))

	builder.WriteString(`Instructions:
判断用户问题的意图类型，并补全 normalized_query。输出对应的JSON格式结果。`)

	return builder.String()
}

func (s *ContentGeneratorService) buildQueryExpansionUserPrompt(request *IntentClassificationRequest) string {
	var builder strings.Builder

	if request != nil {
		builder.WriteString(fmt.Sprintf("User Question: %s\n\n", request.Query))

		if len(request.Conversation) > 0 {
			builder.WriteString("Recent Conversation:\n")
			for i, conv := range request.Conversation {
				builder.WriteString(fmt.Sprintf("%d. User: %s\n", i+1, conv.Query))
				if conv.Answer != "" {
					builder.WriteString(fmt.Sprintf("   Assistant: %s\n", conv.Answer))
				}
			}
			builder.WriteString("\n")
		}
	}

	builder.WriteString(fmt.Sprintf("Current Time: %s\n\n", time.Now().Format("2006-01-02 15:04:05")))

	builder.WriteString(`Instructions:
补全 normalized_query，并生成 expanded_queries。输出对应的JSON格式结果。`)

	return builder.String()
}

// parseIntentClassificationResponse 解析意图分类响应
func (s *ContentGeneratorService) parseIntentClassificationResponse(content string) (*IntentClassificationResult, error) {
	var result IntentClassificationResult
	if err := common.ParseLLMJSONInto(context.Background(), content, &result); err != nil {
		return nil, fmt.Errorf("JSON解析失败: %v", err)
	}

	if err := normalizeIntentClassificationResult(&result, true); err != nil {
		return nil, err
	}

	return &result, nil
}

func (s *ContentGeneratorService) parseFastIntentRouteResponse(content string) (*IntentClassificationResult, error) {
	var result IntentClassificationResult
	if err := common.ParseLLMJSONInto(context.Background(), content, &result); err != nil {
		return nil, fmt.Errorf("JSON解析失败: %v", err)
	}

	if err := normalizeIntentClassificationResult(&result, false); err != nil {
		return nil, err
	}
	result.Answer = ""
	result.ExpandedQueries = nil

	return &result, nil
}

func (s *ContentGeneratorService) parseComplexQueryExpansionResponse(content string) (*QueryExpansionResult, error) {
	var result QueryExpansionResult
	if err := common.ParseLLMJSONInto(context.Background(), content, &result); err != nil {
		return nil, fmt.Errorf("JSON解析失败: %v", err)
	}

	result.NormalizedQuery = strings.TrimSpace(result.NormalizedQuery)
	result.DocumentType = strings.TrimSpace(result.DocumentType)
	result.Keywords = cleanStringList(result.Keywords)
	result.ExpandedQueries = cleanStringList(result.ExpandedQueries)
	if len(result.ExpandedQueries) == 0 {
		logger.Warnf(context.Background(), "复杂问题拆解缺少扩展查询")
	}

	return &result, nil
}

func normalizeIntentClassificationResult(result *IntentClassificationResult, allowExpandedQueries bool) error {
	if result == nil {
		return fmt.Errorf("意图分类结果为空")
	}

	result.Intent = strings.ToUpper(strings.TrimSpace(result.Intent))
	result.SkillName = strings.TrimSpace(result.SkillName)
	result.Reasoning = strings.TrimSpace(result.Reasoning)
	result.DocumentType = strings.TrimSpace(result.DocumentType)
	result.Answer = strings.TrimSpace(result.Answer)
	result.NormalizedQuery = strings.TrimSpace(result.NormalizedQuery)
	result.Keywords = cleanStringList(result.Keywords)

	validIntents := map[string]bool{
		"CHITCHAT":      true,
		"SIMPLE_RAG":    true,
		"COMPLEX_AGENT": true,
		"USE_SKILL":     true,
	}

	if !validIntents[result.Intent] {
		return fmt.Errorf("无效的意图类别: %s", result.Intent)
	}

	if allowExpandedQueries && result.Intent == "COMPLEX_AGENT" {
		if len(result.ExpandedQueries) == 0 {
			logger.Warnf(context.Background(), "意图为 %s 但缺少扩展查询", result.Intent)
		}
		result.ExpandedQueries = cleanStringList(result.ExpandedQueries)
	} else {
		result.ExpandedQueries = nil
	}

	if math.IsNaN(result.Confidence) || math.IsInf(result.Confidence, 0) {
		logger.Warnf(context.Background(), "意图分类置信度异常（NaN/Inf），重置为0.5")
		result.Confidence = 0.5
	}
	if result.Confidence < 0 {
		logger.Warnf(context.Background(), "意图分类置信度小于0，已裁剪: %.4f", result.Confidence)
		result.Confidence = 0
	}
	if result.Confidence > 1 {
		logger.Warnf(context.Background(), "意图分类置信度大于1，已裁剪: %.4f", result.Confidence)
		result.Confidence = 1
	}

	return nil
}

func cleanStringList(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	cleaned := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		cleaned = append(cleaned, trimmed)
	}

	if len(cleaned) == 0 {
		return nil
	}
	return cleaned
}
