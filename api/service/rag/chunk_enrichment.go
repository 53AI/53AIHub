package rag

import (
	"context"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

const (
	chunkEnrichmentPromptVersion           = "v1"
	chunkEnrichmentDefaultBatchTokenBudget = 2200
	chunkEnrichmentChunkOverheadTokens     = 28
	chunkEnrichmentPromptOverheadTokens    = 220
)

// ChunkEnrichmentChunkInput 单个知识块的输入。
type ChunkEnrichmentChunkInput struct {
	ChunkID     int64  `json:"chunk_id"`
	ChunkIndex  int    `json:"chunk_index"`
	Content     string `json:"content"`
	ContentHash string `json:"content_hash"`
}

// ChunkEnrichmentItem 单个知识块的生成结果。
type ChunkEnrichmentItem struct {
	ChunkID         int64    `json:"chunk_id"`
	Summary         string   `json:"summary"`
	CommonQuestions []string `json:"common_questions"`
}

// ChunkEnrichmentRequest 批量块级增强请求。
type ChunkEnrichmentRequest struct {
	DocumentTitle     string
	AnchorContext     string
	GenerateSummary   bool
	GenerateQuestions bool
	Chunks            []ChunkEnrichmentChunkInput
}

type chunkEnrichmentBatchResponse struct {
	Items []ChunkEnrichmentItem `json:"items"`
}

func resolveChunkEnrichmentFastReasoning(ctx context.Context, chunkFastReasoning model.ModelChannelConfig) (*model.ModelChannelConfig, string) {
	if chunkFastReasoning.ChannelID != nil && chunkFastReasoning.ModelName != nil {
		return &chunkFastReasoning, "chunk_fast_reasoning"
	}

	return nil, ""
}

func PartitionChunkEnrichmentChunks(tokenizer *TokenizerService, chunks []ChunkEnrichmentChunkInput, maxBatchTokens int) [][]ChunkEnrichmentChunkInput {
	if tokenizer == nil {
		tokenizer = NewTokenizerService()
	}
	if len(chunks) == 0 {
		return nil
	}
	if maxBatchTokens <= 0 {
		maxBatchTokens = chunkEnrichmentDefaultBatchTokenBudget
	}

	budget := maxBatchTokens - chunkEnrichmentPromptOverheadTokens
	if budget <= 0 {
		budget = maxBatchTokens
	}

	batches := make([][]ChunkEnrichmentChunkInput, 0, 4)
	current := make([]ChunkEnrichmentChunkInput, 0, 4)
	currentTokens := 0

	flush := func() {
		if len(current) == 0 {
			return
		}
		batch := make([]ChunkEnrichmentChunkInput, len(current))
		copy(batch, current)
		batches = append(batches, batch)
		current = current[:0]
		currentTokens = 0
	}

	for _, chunk := range chunks {
		contentTokens, _ := tokenizer.CountTokens(chunk.Content)
		requiredTokens := contentTokens + chunkEnrichmentChunkOverheadTokens
		if len(current) > 0 && currentTokens+requiredTokens > budget {
			flush()
		}
		current = append(current, chunk)
		currentTokens += requiredTokens
	}

	flush()
	return batches
}

func partitionChunkEnrichmentChunks(tokenizer *TokenizerService, chunks []ChunkEnrichmentChunkInput, maxBatchTokens int) [][]ChunkEnrichmentChunkInput {
	return PartitionChunkEnrichmentChunks(tokenizer, chunks, maxBatchTokens)
}

func MapChunkEnrichmentResults(items []ChunkEnrichmentItem) map[int64]ChunkEnrichmentItem {
	result := make(map[int64]ChunkEnrichmentItem, len(items))
	for _, item := range items {
		result[item.ChunkID] = item
	}
	return result
}

func mapChunkEnrichmentResults(items []ChunkEnrichmentItem) map[int64]ChunkEnrichmentItem {
	return MapChunkEnrichmentResults(items)
}

func buildChunkEnrichmentPrompt(req *ChunkEnrichmentRequest) string {
	var builder strings.Builder
	builder.WriteString("你是一个中文知识块生成器。")
	builder.WriteString("请严格根据每个知识块自身内容生成简介和常见问法，不要编造不存在的信息。")
	builder.WriteString("输出必须是合法 JSON，不要包含 Markdown 代码块或解释文字。\n")
	if req.DocumentTitle != "" {
		builder.WriteString(fmt.Sprintf("文档标题：%s\n", req.DocumentTitle))
	}
	if strings.TrimSpace(req.AnchorContext) != "" {
		builder.WriteString("文档锚点上下文：\n")
		builder.WriteString(req.AnchorContext)
		builder.WriteString("\n")
	}
	builder.WriteString("生成要求：\n")
	if req.GenerateSummary {
		builder.WriteString("- summary：为每个块生成 1 段简介，尽量精炼，优先 1-2 句。\n")
	} else {
		builder.WriteString("- summary：返回空字符串。\n")
	}
	if req.GenerateQuestions {
		builder.WriteString("- common_questions：为每个块生成 5 个最可能的用户问法，使用简短疑问句。\n")
	} else {
		builder.WriteString("- common_questions：返回空数组。\n")
	}
	builder.WriteString("返回格式：\n")
	builder.WriteString("{\"items\":[{\"chunk_id\":1,\"summary\":\"...\",\"common_questions\":[\"...\",\"...\",\"...\",\"...\",\"...\"]}]}\n")
	builder.WriteString("待处理知识块：\n")
	for _, chunk := range req.Chunks {
		builder.WriteString(fmt.Sprintf("chunk_id=%d\n", chunk.ChunkID))
		builder.WriteString(fmt.Sprintf("chunk_index=%d\n", chunk.ChunkIndex))
		builder.WriteString("content:\n")
		builder.WriteString(strings.TrimSpace(chunk.Content))
		builder.WriteString("\n---\n")
	}
	return builder.String()
}

// GenerateChunkEnrichmentBatch 批量生成知识块简介和常见问法。
func (s *ContentGeneratorService) GenerateChunkEnrichmentBatch(ctx context.Context, eid int64, config *ChunkConfig, req *ChunkEnrichmentRequest) ([]ChunkEnrichmentItem, error) {
	if req == nil {
		return nil, fmt.Errorf("块级增强请求不能为空")
	}
	if config == nil {
		return nil, fmt.Errorf("分块配置不能为空")
	}
	if config.LogicChannel == nil || config.LogicModelName == nil {
		return nil, fmt.Errorf("未配置逻辑推理渠道，无法生成块级简介和问法")
	}
	if len(req.Chunks) == 0 {
		return []ChunkEnrichmentItem{}, nil
	}

	selectedChannel, selectedModelName, selectErr := config.SelectPipelineLLM()
	if selectErr != nil {
		return nil, fmt.Errorf("没有可用的推理渠道，无法生成块级简介和问法: %v", selectErr)
	}

	prompt := buildChunkEnrichmentPrompt(req)
	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: 4096,
		Messages: []relaymodel.Message{
			{Role: "system", Content: prompt},
		},
	}

	respText, err, openaiErr := s.testChannel(ctx, selectedChannel, chatReq)
	if err != nil || openaiErr != nil {
		if openaiErr != nil {
			return nil, fmt.Errorf("块级简介生成失败: %v", openaiErr)
		}
		return nil, fmt.Errorf("块级简介生成失败: %v", err)
	}

	var response chunkEnrichmentBatchResponse
	if err := common.ParseLLMJSONInto(ctx, respText, &response); err != nil {
		logger.Warnf(ctx, "【工具执行】块级简介响应解析失败: eid=%d, error=%v", eid, err)
		return nil, err
	}

	return response.Items, nil
}
