package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// SaveRAGStats 保存RAG统计数据到消息记录
// 统一从 sources 中提取引用信息，不再区分不同的搜索模式
func SaveRAGStats(
	ctx context.Context,
	c *gin.Context,
	message *model.Message,
	responseContent string,
	eid int64,
) error {
	// 1. 从 Context 获取 sources
	sourcesValue, exists := c.Get("rag_sources")
	if !exists {
		// 没有 RAG 数据，跳过
		logger.Debugf(ctx, "未找到 RAG sources，跳过统计")
		return nil
	}

	sources, ok := sourcesValue.([]rag.SourceReference)
	if !ok || len(sources) == 0 {
		logger.Warnf(ctx, "sources 类型转换失败或为空")
		return nil
	}

	// 2. 生成引用统计数据
	ragStats := generateRAGStats(ctx, eid, sources, responseContent, message.KnowledgeType)

	// 3. 更新消息记录
	message.CitationCount = len(ragStats.FileQuotations)

	ragStatsJSON, err := json.Marshal(ragStats)
	if err != nil {
		logger.Warnf(ctx, "序列化 RAG 统计数据失败: %s", err.Error())
		return fmt.Errorf("序列化 RAG 统计数据失败: %v", err)
	}

	message.RAGStats = string(ragStatsJSON)

	return nil
}

// RAGStatsData RAG 统计数据结构
type RAGStatsData struct {
	DocumentSearch     *DocumentSearchData `json:"document_search"`     // 文档搜索数据
	DocumentQuotations []string            `json:"document_quotations"` // 实际引用的分片ID列表（hash后）
	FileQuotations     []string            `json:"file_quotations"`     // 实际引用的文件ID列表（hash后）
	Performance        *PerformanceData    `json:"performance"`         // 性能数据
	Type               string              `json:"type"`                // 统计类型标识
}

// DocumentSearchData 文档搜索数据
type DocumentSearchData struct {
	Chunks []ChunkData `json:"chunks"` // 搜索到的所有分片
}

// ChunkData 分片数据
type ChunkData struct {
	ChunkID                      string  `json:"chunk_id"`                                  // 分片ID（hash后）
	ChunkType                    string  `json:"chunk_type"`                                // 分片类型
	Content                      string  `json:"content"`                                   // 内容预览
	FileID                       string  `json:"file_id"`                                   // 文件ID（hash后）
	FileName                     string  `json:"file_name"`                                 // 文件名
	LibraryID                    string  `json:"library_id"`                                // 知识库ID（hash后）
	LibraryName                  string  `json:"library_name"`                              // 知识库名称
	LibraryIcon                  string  `json:"library_icon"`                              // 知识库图标
	SpaceID                      string  `json:"space_id"`                                  // 空间ID（hash后）
	SpaceName                    string  `json:"space_name"`                                // 空间名称
	Score                        float64 `json:"score"`                                     // 相关性分数
	FilePath                     string  `json:"file_path"`                                 // 文件路径
	SourceKey                    string  `json:"source_key"`                                // 来源标识
	EntityCount                  int     `json:"entity_count,omitempty"`                    // 实体数量
	EntitySupportingChunkCount   int     `json:"entity_supporting_chunk_count,omitempty"`   // 实体关联语料分片数
	RelationSupportingChunkCount int     `json:"relation_supporting_chunk_count,omitempty"` // 关系关联语料分片数
	SupportingChunkCountTotal    int     `json:"supporting_chunk_count_total,omitempty"`    // 关联语料分片总数
}

// PerformanceData 性能数据
type PerformanceData struct {
	ProcessingTimeMs int64 `json:"processing_time_ms"` // 处理时间（毫秒）
}

// generateRAGStats 生成 RAG 统计数据（统一处理所有类型）
func generateRAGStats(
	ctx context.Context,
	eid int64,
	sources []rag.SourceReference,
	responseContent string,
	knowledgeType int,
) *RAGStatsData {
	// 1. 提取实际引用的 source IDs
	quotedSourceIDs := extractQuotedSourceIDs(responseContent)
	logger.Debugf(ctx, "从回答中提取到 %d 个引用标记", len(quotedSourceIDs))

	// 2. 构建分片数据列表
	chunks := make([]ChunkData, 0, len(sources))

	for _, source := range sources {
		contentPreview := truncateContent(source.Content, MAX_DESC_WORD)

		chunk := ChunkData{
			ChunkID:     hashInt64(source.ChunkID),
			ChunkType:   source.ChunkType,
			Content:     contentPreview,
			FileID:      hashInt64(source.FileID),
			FileName:    source.FileName,
			LibraryID:   hashInt64(source.KnowledgeBaseID),
			LibraryName: source.KnowledgeBaseName,
			LibraryIcon: source.KnowledgeBaseLogo,
			SpaceID:     source.SpaceID,
			SpaceName:   source.SpaceName,
			Score:       source.Score,
			FilePath:    source.FilePath,
			SourceKey:   source.SourceKey,
		}
		if source.ChunkType == rag.GraphAggregateChunkType || source.EntityCount > 0 || source.EntitySupportingChunkCount > 0 || source.RelationSupportingChunkCount > 0 || source.SupportingChunkCountTotal > 0 {
			chunk.EntityCount = source.EntityCount
			chunk.EntitySupportingChunkCount = source.EntitySupportingChunkCount
			chunk.RelationSupportingChunkCount = source.RelationSupportingChunkCount
			chunk.SupportingChunkCountTotal = source.SupportingChunkCountTotal
		}
		chunks = append(chunks, chunk)
	}

	// 3. 生成实际引用的分片ID和文件ID列表
	documentQuotations, fileQuotations := resolveQuotedSourceIDs(quotedSourceIDs, sources, false, true)

	logger.Debugf(ctx, "实际引用统计: 分片数=%d, 文件数=%d",
		len(documentQuotations), len(fileQuotations))

	// 根据知识类型和来源确定统计类型标识
	ragType := determineRAGType(knowledgeType, sources)

	// 4. 构建最终统计数据
	return &RAGStatsData{
		DocumentSearch: &DocumentSearchData{
			Chunks: chunks,
		},
		DocumentQuotations: documentQuotations,
		FileQuotations:     fileQuotations,
		Performance: &PerformanceData{
			ProcessingTimeMs: 0, // 可选：需要时记录实际处理时间
		},
		Type: ragType,
	}
}

func determineRAGType(knowledgeType int, sources []rag.SourceReference) string {
	if knowledgeType == model.KnowledgeTypeWeb {
		return "web_search"
	}
	if knowledgeType == model.KnowledgeTypeSingleFile {
		return "rag_search"
	}

	hasKB := false
	hasWeb := false

	for _, s := range sources {
		if s.KnowledgeBaseID > 0 {
			hasKB = true
		}
		if strings.HasPrefix(s.ReferenceID, "B-") {
			hasWeb = true
		}
	}

	if hasKB && hasWeb {
		return "mixed_search"
	}
	if hasWeb {
		return "web_search"
	}
	return "rag_search"
}

// sendReferenceAnalysisStep 发送引用分析步骤（使用 StepSender）
func sendReferenceAnalysisStep(
	c *gin.Context,
	ctx context.Context,
	messageStatus *MessageStatsInfo,
	responseContent string,
) {
	// 1. 从 Context 获取 sources
	sourcesValue, exists := c.Get("rag_sources")
	if !exists {
		return
	}

	sources, ok := sourcesValue.([]rag.SourceReference)
	if !ok {
		logger.Warnf(ctx, "sources 类型转换失败")
		return
	}

	if len(sources) == 0 {
		return
	}

	// 2. 发送引用分析开始步骤
	messageStatus.StepSender.SendStartStep(
		STEP_REF_ANALYSIS,
		"正在分析回答中的文档引用...",
		nil,
	)

	// 3. 生成引用数据
	quotationsData := createQuotationsData(ctx, sources, responseContent)
	quotedCount := len(quotationsData["document_quotations"].([]string))
	logger.Debugf(ctx, "【引用分析】生成后引用数据: request_id=%s, document_quotations=%v, file_quotations=%v",
		helper.GetRequestID(ctx), quotationsData["document_quotations"], quotationsData["file_quotations"])

	// 4. 发送引用分析完成步骤（包含引用数据）
	message := fmt.Sprintf("引用分析完成，回答中引用了 %d 篇文档", quotedCount)
	messageStatus.StepSender.SendEndStep(
		STEP_REF_ANALYSIS,
		message,
		quotationsData, // ⭐ 关键：包含引用数据
	)
}
