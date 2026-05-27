package rag

import (
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// CreateChunkRelations 创建分块关联关系
func (s *ChunkerService) CreateChunkRelations(eid int64, fileID int64, libraryID int64, knowledgeChunks []model.DocumentChunk, retrievalChunks []model.DocumentChunk) error {
	if len(knowledgeChunks) == 0 || len(retrievalChunks) == 0 {
		return nil
	}

	var relations []model.ChunkRelation

	// 为每个知识点分块找到最相关的检索块
	for _, knowledgeChunk := range knowledgeChunks {
		relatedRetrievalChunks := s.findRelatedRetrievalChunks(knowledgeChunk, retrievalChunks)

		for _, retrievalChunk := range relatedRetrievalChunks {
			// 计算关联权重
			weight := s.calculateRelationWeight(knowledgeChunk, retrievalChunk)

			// 创建关联元数据
			metadata := &model.RelationMetadataData{
				CreatedReason:  "auto_generated",
				SemanticScore:  weight,
				PositionScore:  s.calculatePositionScore(knowledgeChunk, retrievalChunk),
				ContentOverlap: s.calculateContentOverlap(knowledgeChunk, retrievalChunk),
			}

			relation := model.ChunkRelation{
				Eid:              eid,
				FileID:           fileID,
				LibraryID:        libraryID,
				KnowledgeChunkID: knowledgeChunk.ID,
				RetrievalChunkID: retrievalChunk.ID,
				RelationType:     "auto",
				RelationWeight:   weight,
				Status:           "active",
			}

			err := relation.SetRelationMetadata(metadata)
			if err != nil {
				return fmt.Errorf("设置关联元数据失败: %v", err)
			}

			relations = append(relations, relation)
		}
	}

	// 批量创建关联关系
	if len(relations) > 0 {
		err := model.BatchCreateChunkRelations(relations)
		if err != nil {
			return fmt.Errorf("批量创建关联关系失败: %v", err)
		}
	}

	return nil
}

// findRelatedRetrievalChunks 找到与知识点分块相关的检索块
func (s *ChunkerService) findRelatedRetrievalChunks(knowledgeChunk model.DocumentChunk, retrievalChunks []model.DocumentChunk) []model.DocumentChunk {
	var relatedChunks []model.DocumentChunk

	// 基于位置的关联策略：找到位置重叠或相邻的检索块
	for _, retrievalChunk := range retrievalChunks {
		if s.isPositionRelated(knowledgeChunk, retrievalChunk) {
			relatedChunks = append(relatedChunks, retrievalChunk)
		}
	}

	// 如果没有找到位置相关的，则基于内容相似度
	if len(relatedChunks) == 0 {
		for _, retrievalChunk := range retrievalChunks {
			similarity := s.calculateContentSimilarity(knowledgeChunk, retrievalChunk)
			if similarity > 0.3 { // 相似度阈值
				relatedChunks = append(relatedChunks, retrievalChunk)
			}
		}
	}

	return relatedChunks
}

// isPositionRelated 判断两个分块是否在位置上相关
func (s *ChunkerService) isPositionRelated(chunk1, chunk2 model.DocumentChunk) bool {
	// 检查位置重叠
	if chunk1.StartPosition <= chunk2.EndPosition && chunk2.StartPosition <= chunk1.EndPosition {
		return true
	}

	// 检查相邻（允许一定的间隔）
	gap := 100 // 允许的间隔字符数
	if abs(chunk1.EndPosition-chunk2.StartPosition) <= gap || abs(chunk2.EndPosition-chunk1.StartPosition) <= gap {
		return true
	}

	return false
}

// calculateRelationWeight 计算关联权重
func (s *ChunkerService) calculateRelationWeight(knowledgeChunk, retrievalChunk model.DocumentChunk) float64 {
	// 位置权重 (40%)
	positionWeight := s.calculatePositionScore(knowledgeChunk, retrievalChunk) * 0.4

	// 内容相似度权重 (40%)
	contentWeight := s.calculateContentSimilarity(knowledgeChunk, retrievalChunk) * 0.4

	// 长度匹配权重 (20%)
	lengthWeight := s.calculateLengthMatchScore(knowledgeChunk, retrievalChunk) * 0.2

	return positionWeight + contentWeight + lengthWeight
}

// calculatePositionScore 计算位置相关性分数
func (s *ChunkerService) calculatePositionScore(chunk1, chunk2 model.DocumentChunk) float64 {
	// 计算重叠度
	overlapStart := max(chunk1.StartPosition, chunk2.StartPosition)
	overlapEnd := min(chunk1.EndPosition, chunk2.EndPosition)

	if overlapEnd <= overlapStart {
		// 没有重叠，计算距离分数
		distance := min(abs(chunk1.EndPosition-chunk2.StartPosition), abs(chunk2.EndPosition-chunk1.StartPosition))
		if distance > 1000 {
			return 0.0
		}
		return 1.0 - float64(distance)/1000.0
	}

	// 有重叠，计算重叠比例
	overlapLength := overlapEnd - overlapStart
	totalLength := max(chunk1.EndPosition-chunk1.StartPosition, chunk2.EndPosition-chunk2.StartPosition)

	return float64(overlapLength) / float64(totalLength)
}

// calculateContentOverlap 计算内容重叠度
func (s *ChunkerService) calculateContentOverlap(chunk1, chunk2 model.DocumentChunk) float64 {
	// 简单的字符串相似度计算
	content1 := strings.ToLower(chunk1.Content)
	content2 := strings.ToLower(chunk2.Content)

	// 计算公共子串
	commonLength := 0
	minLength := min(len(content1), len(content2))

	for i := 0; i < minLength; i++ {
		if content1[i] == content2[i] {
			commonLength++
		}
	}

	return float64(commonLength) / float64(max(len(content1), len(content2)))
}

// calculateContentSimilarity 计算内容相似度
func (s *ChunkerService) calculateContentSimilarity(chunk1, chunk2 model.DocumentChunk) float64 {
	// 基于词汇重叠的简单相似度计算
	words1 := strings.Fields(strings.ToLower(chunk1.Content))
	words2 := strings.Fields(strings.ToLower(chunk2.Content))

	wordSet1 := make(map[string]bool)
	for _, word := range words1 {
		wordSet1[word] = true
	}

	commonWords := 0
	for _, word := range words2 {
		if wordSet1[word] {
			commonWords++
		}
	}

	totalWords := len(words1) + len(words2) - commonWords
	if totalWords == 0 {
		return 0.0
	}

	return float64(commonWords) / float64(totalWords)
}

// calculateLengthMatchScore 计算长度匹配分数
func (s *ChunkerService) calculateLengthMatchScore(chunk1, chunk2 model.DocumentChunk) float64 {
	len1 := float64(chunk1.TokenCount)
	len2 := float64(chunk2.TokenCount)

	if len1 == 0 || len2 == 0 {
		return 0.0
	}

	ratio := minFloat(len1, len2) / maxFloat(len1, len2)
	return ratio
}

// 辅助函数
func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
