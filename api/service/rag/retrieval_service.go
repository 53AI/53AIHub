package rag

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/vectorstore"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// RetrievalChunkService 检索块管理服务
type RetrievalChunkService struct {
	db        *gorm.DB
	tokenizer *TokenizerService
}

// NewRetrievalChunkService 创建检索块服务实例
func NewRetrievalChunkService(db *gorm.DB) *RetrievalChunkService {
	return &RetrievalChunkService{
		db:        db,
		tokenizer: NewTokenizerService(),
	}
}

// CreateRetrievalChunksForKnowledge 为知识点分块创建检索块
func (s *RetrievalChunkService) CreateRetrievalChunksForKnowledge(eid int64, knowledgeChunk *model.DocumentChunk, config *ChunkConfig) ([]model.RetrievalChunk, error) {
	// 获取文档标题（如果需要）
	var documentTitle string
	var fileName string
	if config.IndexIncludeTitle || config.IndexIncludeFileName {
		file, err := model.GetFileByID(eid, knowledgeChunk.FileID)
		if err == nil {
			// 从文件内容中提取第一个大标题作为标题
			if config.IndexIncludeTitle {
				documentTitle = s.extractDocumentTitle(eid, knowledgeChunk.FileID, file.Path)
			}
			// 获取文件名（从路径中提取，不带后缀）
			if config.IndexIncludeFileName {
				fileName = s.extractFileNameFromPath(file.Path)
			}
		}
	}

	// 根据配置对知识点内容进行检索块分割
	retrievalChunks := s.splitContentForRetrieval(knowledgeChunk.Content, config, documentTitle, fileName)

	var dbChunks []model.RetrievalChunk
	for i, content := range retrievalChunks {
		tokenCount, _ := s.tokenizer.CountTokens(content)

		embStatus := model.RetrievalChunkEmbeddingStatusPending
		errorReason := ""
		if config == nil || config.EmbeddingChannelID == nil {
			embStatus = model.RetrievalChunkEmbeddingStatusFailed
			errorReason = "未配置向量化渠道"
		}

		chunk := model.RetrievalChunk{
			Eid:              eid,
			FileID:           knowledgeChunk.FileID,
			LibraryID:        knowledgeChunk.LibraryID,
			KnowledgeChunkID: knowledgeChunk.ID,
			Content:          content,
			ChunkIndex:       i,
			ChunkType:        "retrieval",
			TokenCount:       tokenCount,
			Status:           "enabled",
			EmbeddingStatus:  embStatus,
			ErrorReason:      errorReason,
			SearchWeight:     1.0,
		}

		// 计算位置信息（简化处理）
		if i == 0 {
			chunk.StartPosition = knowledgeChunk.StartPosition
		}
		if i == len(retrievalChunks)-1 {
			chunk.EndPosition = knowledgeChunk.EndPosition
		}

		dbChunks = append(dbChunks, chunk)
	}

	// 批量保存（使用统一保存实现）
	err := SaveRetrievalChunksWithDB(s.db, eid, knowledgeChunk.FileID, dbChunks)
	if err != nil {
		return nil, fmt.Errorf("保存检索块失败: %v", err)
	}

	// 不再自动进行 embedding 处理，由调用方决定何时处理
	// 这样可以避免在批量操作中反复调用embedding处理，提升性能
	// embedding失败也不会影响分块操作的主流程

	return dbChunks, nil
}

// CreateRetrievalChunksForPreview 为知识点分块创建检索块预览（不保存到数据库）
func (s *RetrievalChunkService) CreateRetrievalChunksForPreview(eid int64, knowledgeChunk *model.DocumentChunk, config *ChunkConfig) []PreviewRetrievalChunk {
	// 获取文档标题（如果需要）
	var documentTitle string
	var fileName string
	if config.IndexIncludeTitle || config.IndexIncludeFileName {
		// 从文件内容中提取第一个大标题作为标题
		if config.IndexIncludeTitle {
			documentTitle = s.extractDocumentTitle(eid, knowledgeChunk.FileID, "") // 空路径表示预览模式
		}
		// 获取文件名（从路径中提取，不带后缀）
		if config.IndexIncludeFileName {
			fileName = s.extractFileNameFromPath("") // 空路径表示预览模式
		}
	}

	// 根据配置对知识点内容进行检索块分割
	retrievalChunks := s.splitContentForRetrieval(knowledgeChunk.Content, config, documentTitle, fileName)

	var previewChunks []PreviewRetrievalChunk
	for i, content := range retrievalChunks {
		tokenCount, _ := s.tokenizer.CountTokens(content)

		chunk := PreviewRetrievalChunk{
			Index:      i,
			Type:       "retrieval",
			Content:    content,
			TokenCount: tokenCount,
		}

		previewChunks = append(previewChunks, chunk)
	}

	return previewChunks
}

// splitContentForRetrieval 将内容分割为检索块 - 按配置规则拆分，不丢失任何内容
func (s *RetrievalChunkService) splitContentForRetrieval(content string, config *ChunkConfig, documentTitle string, fileName string) []string {
	// 如果是 QA 类型的分块配置，只保留问题部分作为检索块内容
	if config.Type == model.ChunkTypeQA {
		// 使用正则表达式提取问题部分
		question := s.extractQuestionFromQA(content)
		if question != "" {
			content = question
		}
	}

	config.KnowledgeMaxLength = config.KnowledgeChunk.MaxLength
	config.IndexMaxLength = config.IndexChunk.MaxLength
	maxLength := config.IndexMaxLength
	splitRules := config.IndexChunk.GetSplitRules()
	subtitle := ""
	if config.IndexIncludeSubtitle {
		subtitle = extractMarkdownSubtitle(content)
	}

	// 如果需要包含标题或文件名，先计算前缀的token数
	prefix := buildChunkContextPrefix(fileName, documentTitle, subtitle, config.IndexIncludeFileName, config.IndexIncludeTitle, config.IndexIncludeSubtitle)
	var prefixTokens int

	if prefix != "" {
		prefixTokens, _ = s.tokenizer.CountTokens(prefix)
		// 调整最大长度，为前缀预留空间
		maxLength = maxLength - prefixTokens
		if maxLength < 100 { // 确保至少有100个token用于内容
			maxLength = 100
		}
	}

	// 使用 ChunkerService 的统一分块逻辑
	chunkerService := NewChunkerService(s.db)
	chunks := chunkerService.ChunkByRulesForRetrieval(content, config.IndexChunk.ChunkMode, splitRules, maxLength)

	// 如果需要包含前缀，为分块添加前缀
	if prefix != "" {
		originalPrefix := prefix
		for i, chunk := range chunks {
			chunkPrefix := originalPrefix
			if i == 0 {
				effectiveTitle := documentTitle
				if effectiveTitle != "" && s.chunkContainsTitle(chunk, effectiveTitle) {
					effectiveTitle = ""
				}
				chunkPrefix = buildChunkContextPrefix(fileName, effectiveTitle, subtitle, config.IndexIncludeFileName, config.IndexIncludeTitle, config.IndexIncludeSubtitle)
			}
			if chunkPrefix != "" {
				chunks[i] = chunkPrefix + chunk
			}
		}
	}

	return chunks
}

// splitByRules 根据多个规则拆分内容，递归模式
func (s *RetrievalChunkService) splitByRules(content string, rules []string, maxLength int, overlapSize int) []string {
	if len(rules) == 0 {
		return []string{content}
	}

	if len(rules) == 1 {
		// 只有一个规则时，使用原有的单规则函数
		return s.splitByRule(content, rules[0], maxLength, overlapSize)
	}

	// 递归模式：依次使用每个分隔符对已有分块进行进一步分割
	// 从整个内容开始
	currentChunks := []string{content}

	// 依次对每个分隔符进行分块处理
	for _, separator := range rules {
		currentChunks = s.applySeparatorToStrings(currentChunks, separator, maxLength, overlapSize)
	}

	return currentChunks
}

// applySeparatorToStrings 对字符串列表中的每个字符串应用指定分隔符进行拆分
func (s *RetrievalChunkService) applySeparatorToStrings(chunks []string, separator string, maxLength int, overlapSize int) []string {
	var result []string

	// 循环处理 currentChunks 中的每个字符串
	for _, chunk := range chunks {
		// 对每个 chunk 应用 splitByRule 方法重新拆分
		splittedChunks := s.splitByRule(chunk, separator, maxLength, overlapSize)
		// 将拆分后的结果添加到最终结果中
		result = append(result, splittedChunks...)
	}

	return result
}

// splitByRule 根据规则拆分内容，确保不丢失任何内容
func (s *RetrievalChunkService) splitByRule(content string, rule string, maxLength int, overlapSize int) []string {
	if strings.HasPrefix(rule, "\\n") {
		rule = strings.ReplaceAll(rule, "\\n", "\n")
	}

	switch rule {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		return s.splitByHeaders(content, rule, maxLength, overlapSize)
	case "paragraph":
		return s.splitByParagraphs(content, maxLength, overlapSize)
	case "\n", "\\n":
		return s.splitByLines(content, maxLength, overlapSize)
	case "sentence":
		return s.splitBySentences(content, maxLength, overlapSize)
	case "", "none", "no_split":
		// 空字符串、"none"或"no_split"都表示不拆分
		return []string{content}
	default:
		// 默认按自定义分隔符拆分
		return s.splitByCustomSeparator(content, rule, maxLength, overlapSize)
	}
}

// getOverlapContent 获取重叠内容
func (s *RetrievalChunkService) getOverlapContent(content string, overlapSize int) string {
	words := strings.Fields(content)
	if len(words) <= overlapSize {
		return content
	}

	// 取最后的overlapSize个词
	overlapWords := words[len(words)-overlapSize:]
	return strings.Join(overlapWords, " ")
}

// UpdateRetrievalChunk 更新检索块
func (s *RetrievalChunkService) UpdateRetrievalChunk(eid int64, chunkID int64, content string, userID int64) (*model.RetrievalChunk, error) {
	// 获取检索块
	chunk, err := model.GetRetrievalChunkByID(eid, chunkID)
	if err != nil {
		return nil, fmt.Errorf("获取检索块失败: %v", err)
	}

	oldContent := chunk.Content

	// 更新内容
	chunk.Content = content
	chunk.IsManualEdited = true

	// 重新计算Token数量
	tokenCount, err := s.tokenizer.CountTokens(content)
	if err == nil {
		chunk.TokenCount = tokenCount
	}

	// 如果内容发生变化，重置向量化状态
	if oldContent != content {
		chunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
		chunk.VectorID = ""
	}

	// 保存更新
	err = chunk.Update()
	if err != nil {
		return nil, fmt.Errorf("更新检索块失败: %v", err)
	}

	// 记录操作日志
	err = model.CreateEditLog(eid, chunk.FileID, userID, chunkID, oldContent, content)
	if err != nil {
		// 日志记录失败不影响主流程
		fmt.Printf("记录检索块编辑日志失败: %v", err)
	}

	return chunk, nil
}

// DeleteRetrievalChunk 删除检索块
func (s *RetrievalChunkService) DeleteRetrievalChunk(eid int64, chunkID int64, userID int64) error {
	// 获取检索块信息
	chunk, err := model.GetRetrievalChunkByID(eid, chunkID)
	if err != nil {
		return fmt.Errorf("获取检索块失败: %v", err)
	}

	// 开启事务
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 删除关联关系元数据
	err = tx.Where("eid = ? AND retrieval_chunk_id = ?", eid, chunkID).
		Delete(&model.ChunkRelation{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除关联关系失败: %v", err)
	}

	// 删除检索块
	err = tx.Where("eid = ? AND id = ?", eid, chunkID).
		Delete(&model.RetrievalChunk{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除检索块失败: %v", err)
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("提交事务失败: %v", err)
	}

	// 更新同一知识点下其他检索块的索引
	err = model.UpdateRetrievalChunkIndexes(eid, chunk.KnowledgeChunkID)
	if err != nil {
		fmt.Printf("更新检索块索引失败: %v", err)
	}

	return nil
}

// MergeRetrievalChunks 合并检索块
func (s *RetrievalChunkService) MergeRetrievalChunks(eid int64, chunkIDs []int64, userID int64) (*model.RetrievalChunk, error) {
	if len(chunkIDs) < 2 {
		return nil, fmt.Errorf("至少需要2个检索块才能合并")
	}

	// 获取要合并的检索块
	var chunks []model.RetrievalChunk
	err := s.db.Where("eid = ? AND id IN ?", eid, chunkIDs).
		Order("chunk_index asc").Find(&chunks).Error
	if err != nil {
		return nil, fmt.Errorf("获取检索块失败: %v", err)
	}

	if len(chunks) != len(chunkIDs) {
		return nil, fmt.Errorf("部分检索块不存在")
	}

	// 检查是否属于同一知识点
	knowledgeChunkID := chunks[0].KnowledgeChunkID
	for _, chunk := range chunks {
		if chunk.KnowledgeChunkID != knowledgeChunkID {
			return nil, fmt.Errorf("只能合并同一知识点下的检索块")
		}
	}

	// 合并内容
	var mergedContent strings.Builder
	for i, chunk := range chunks {
		if i > 0 {
			mergedContent.WriteString("\n\n")
		}
		mergedContent.WriteString(chunk.Content)
	}

	mergedContentStr := mergedContent.String()
	mergedTokenCount, _ := s.tokenizer.CountTokens(mergedContentStr)

	// 确定合并后的类型
	// 如果所有块都是相同类型，则使用该类型；否则使用默认类型
	mergedType := chunks[0].ChunkType
	for _, chunk := range chunks {
		if chunk.ChunkType != mergedType {
			mergedType = "retrieval" // 默认类型
			break
		}
	}

	// 开启事务
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 创建合并后的检索块
	mergedChunk := &model.RetrievalChunk{
		Eid:              chunks[0].Eid,
		FileID:           chunks[0].FileID,
		LibraryID:        chunks[0].LibraryID,
		KnowledgeChunkID: chunks[0].KnowledgeChunkID,
		Content:          mergedContentStr,
		ChunkIndex:       chunks[0].ChunkIndex,
		ChunkType:        mergedType, // 使用确定的类型
		StartPosition:    chunks[0].StartPosition,
		EndPosition:      chunks[len(chunks)-1].EndPosition,
		TokenCount:       mergedTokenCount,
		Status:           "enabled",
		IsManualEdited:   true,
		EmbeddingStatus:  model.RetrievalChunkEmbeddingStatusPending,
		SearchWeight:     chunks[0].SearchWeight,
	}

	if err := tx.Create(mergedChunk).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("创建合并检索块失败: %v", err)
	}

	// 删除原检索块和关联关系
	for _, chunkID := range chunkIDs {
		err = tx.Where("eid = ? AND retrieval_chunk_id = ?", eid, chunkID).
			Delete(&model.ChunkRelation{}).Error
		if err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("删除关联关系失败: %v", err)
		}
	}

	err = tx.Where("eid = ? AND id IN ?", eid, chunkIDs).
		Delete(&model.RetrievalChunk{}).Error
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("删除原检索块失败: %v", err)
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("提交事务失败: %v", err)
	}

	// 更新检索块索引
	err = model.UpdateRetrievalChunkIndexes(eid, knowledgeChunkID)
	if err != nil {
		fmt.Printf("更新检索块索引失败: %v", err)
	}

	// 记录操作日志
	err = model.CreateMergeLog(eid, mergedChunk.FileID, userID, chunkIDs, mergedChunk.ID)
	if err != nil {
		fmt.Printf("记录合并日志失败: %v", err)
	}

	return mergedChunk, nil
}

// SplitRetrievalChunk 拆分检索块
func (s *RetrievalChunkService) SplitRetrievalChunk(eid int64, chunkID int64, splitContents []string, userID int64) ([]model.RetrievalChunk, error) {
	if len(splitContents) < 2 {
		return nil, fmt.Errorf("至少需要拆分为2个检索块")
	}

	// 获取原检索块
	chunk, err := model.GetRetrievalChunkByID(eid, chunkID)
	if err != nil {
		return nil, fmt.Errorf("获取检索块失败: %v", err)
	}

	// 开启事务
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 创建新的检索块
	var newChunks []model.RetrievalChunk
	for i, content := range splitContents {
		tokenCount, _ := s.tokenizer.CountTokens(content)

		newChunk := model.RetrievalChunk{
			Eid:              chunk.Eid,
			FileID:           chunk.FileID,
			LibraryID:        chunk.LibraryID,
			KnowledgeChunkID: chunk.KnowledgeChunkID,
			Content:          content,
			ChunkIndex:       chunk.ChunkIndex + i,
			ChunkType:        chunk.ChunkType, // 保持原类型
			TokenCount:       tokenCount,
			Status:           "enabled",
			IsManualEdited:   true,
			EmbeddingStatus:  model.RetrievalChunkEmbeddingStatusPending,
			SearchWeight:     chunk.SearchWeight,
		}

		if err := tx.Create(&newChunk).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("创建拆分检索块失败: %v", err)
		}

		newChunks = append(newChunks, newChunk)
	}

	// 删除原检索块和关联关系
	err = tx.Where("eid = ? AND retrieval_chunk_id = ?", eid, chunkID).
		Delete(&model.ChunkRelation{}).Error
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("删除关联关系失败: %v", err)
	}

	err = tx.Where("eid = ? AND id = ?", eid, chunkID).
		Delete(&model.RetrievalChunk{}).Error
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("删除原检索块失败: %v", err)
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("提交事务失败: %v", err)
	}

	// 更新检索块索引
	err = model.UpdateRetrievalChunkIndexes(eid, chunk.KnowledgeChunkID)
	if err != nil {
		fmt.Printf("更新检索块索引失败: %v", err)
	}

	// 记录操作日志
	var newChunkIDs []int64
	for _, newChunk := range newChunks {
		newChunkIDs = append(newChunkIDs, newChunk.ID)
	}
	err = model.CreateSplitLog(eid, chunk.FileID, userID, chunkID, newChunkIDs)
	if err != nil {
		fmt.Printf("记录拆分日志失败: %v", err)
	}

	return newChunks, nil
}

// ProcessEmbeddingForRetrievalChunk 为单个检索块处理 embedding (公开方法)
func (s *RetrievalChunkService) ProcessEmbeddingForRetrievalChunk(eid int64, chunk *model.RetrievalChunk) error {
	// 复用批量处理逻辑，传入单元素数组
	return s.processEmbeddingForRetrievalChunks(eid, []model.RetrievalChunk{*chunk}, nil)
}

// processEmbeddingForRetrievalChunks 为检索块处理 embedding
func (s *RetrievalChunkService) processEmbeddingForRetrievalChunks(eid int64, chunks []model.RetrievalChunk, config *ChunkConfig) error {
	if len(chunks) == 0 {
		return nil
	}

	// 收集需要更新状态的DocumentChunk ID，用于后续批量更新
	docChunkUpdateMap := make(map[int64]int64) // knowledgeChunkID -> fileID

	// 如果没有提供配置，则获取第一个块的配置
	if config == nil {
		configService := NewChunkConfigService(s.db)
		chunkConfig, err := configService.GetConfigWithFileID(eid, &chunks[0].LibraryID, &chunks[0].FileID)
		if err != nil {
			// 当获取配置失败时，更新所有相关块为失败状态
			var failedChunkIDs []int64
			for _, chunk := range chunks {
				s.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
				docChunkUpdateMap[chunk.KnowledgeChunkID] = chunk.FileID
				failedChunkIDs = append(failedChunkIDs, chunk.ID)
			}
			// 批量更新DocumentChunk状态
			s.batchUpdateDocumentChunkEmbeddingStatus(docChunkUpdateMap)
			return fmt.Errorf("获取分块配置失败: %v", err)
		}
		config = chunkConfig
	}

	// 在进入循环前检查向量化渠道配置，提前失败避免逐块报错
	if config.EmbeddingChannelID == nil {
		// 当未配置向量化渠道时，更新所有相关块为失败状态
		var failedChunkIDs []int64
		for _, chunk := range chunks {
			s.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", "未配置向量化渠道")
			docChunkUpdateMap[chunk.KnowledgeChunkID] = chunk.FileID
			failedChunkIDs = append(failedChunkIDs, chunk.ID)
		}
		// 批量更新DocumentChunk状态
		s.batchUpdateDocumentChunkEmbeddingStatus(docChunkUpdateMap)
		return fmt.Errorf("未配置向量化渠道")
	}

	// 创建 embedding 服务
	embeddingService := NewEmbeddingService(s.db)

	// 为每个检索块生成 embedding
	for _, chunk := range chunks {
		err := s.processSingleRetrievalChunkEmbedding(eid, &chunk, embeddingService, config, docChunkUpdateMap)
		if err != nil {
			fmt.Printf("处理检索块 %d embedding 失败: %v\n", chunk.ID, err)
			// 更新检索块状态为失败
			updateErr := s.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
			if updateErr != nil {
				fmt.Printf("更新检索块 %d 状态为失败时出错: %v\n", chunk.ID, updateErr)
			}
			docChunkUpdateMap[chunk.KnowledgeChunkID] = chunk.FileID
			// 继续处理其他分块，不因单个失败而中断
			continue
		}
	}

	// 批量更新所有相关的DocumentChunk状态
	s.batchUpdateDocumentChunkEmbeddingStatus(docChunkUpdateMap)
	return nil
}

// processSingleRetrievalChunkEmbedding 处理单个检索块的 embedding
func (s *RetrievalChunkService) processSingleRetrievalChunkEmbedding(eid int64, chunk *model.RetrievalChunk, embeddingService *EmbeddingService, config *ChunkConfig, docChunkUpdateMap map[int64]int64) error {
	// 检查是否已经有向量
	if chunk.VectorID != "" && model.IsRetrievalChunkEmbeddingSucceeded(chunk.EmbeddingStatus) {
		return nil // 已经处理过
	}

	// 标记为索引中
	if err := s.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusIndexing, "", ""); err != nil {
		fmt.Printf("更新检索块 %d 状态为索引中失败: %v\n", chunk.ID, err)
	} else {
		// 提前记录需要更新的DocumentChunk，使其状态能及时反映为索引中
		docChunkUpdateMap[chunk.KnowledgeChunkID] = chunk.FileID
		_ = s.updateDocumentChunkEmbeddingStatus(chunk.KnowledgeChunkID, chunk.FileID)
	}

	// 获取文档分块以获取chunkConfigID
	var documentChunk model.DocumentChunk
	chunkConfigID := int64(0)
	if err := s.db.Where("id = ?", chunk.KnowledgeChunkID).First(&documentChunk).Error; err == nil {
		chunkConfigID = documentChunk.ChunkConfigID
	}

	// 生成 embedding - 使用上下文进行停止信号检查
	ctx := NewEmbeddingContext(chunk.LibraryID, chunk.FileID)
	vector, err := s.generateEmbeddingForChunkWithContext(eid, chunk.Content, config, chunkConfigID, ctx)
	CheckEmbeddingStepStatusSave(eid, chunk.FileID, fmt.Sprintf("time:%drid:%d,生成embedding向量:err:%v", chunk.ID, chunk.ID, err))
	if err != nil {
		// 更新状态为失败
		updateErr := s.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
		if updateErr != nil {
			fmt.Printf("更新检索块 %d 状态为失败时出错: %v\n", chunk.ID, updateErr)
		}

		// 记录需要更新的DocumentChunk
		docChunkUpdateMap[chunk.KnowledgeChunkID] = chunk.FileID

		return fmt.Errorf("生成 embedding 失败: %v", err)
	}

	// 存储到向量数据库
	vectorID, err := s.storeRetrievalChunkToVectorDB(eid, chunk, vector)
	CheckEmbeddingStepStatusSave(eid, chunk.FileID, fmt.Sprintf("time:%drid:%d,保存向量:err:%v", chunk.ID, chunk.ID, err))
	if err != nil {
		// 更新状态为失败
		updateErr := s.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
		if updateErr != nil {
			fmt.Printf("更新检索块 %d 状态为失败时出错: %v\n", chunk.ID, updateErr)
		}

		// 记录需要更新的DocumentChunk
		docChunkUpdateMap[chunk.KnowledgeChunkID] = chunk.FileID

		return fmt.Errorf("存储向量失败: %v", err)
	}

	// 更新检索块的向量信息
	err = s.updateRetrievalChunkVectorInfo(chunk.ID, vectorID)
	if err != nil {
		// 即使更新向量信息失败，也要更新状态
		updateErr := s.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
		if updateErr != nil {
			fmt.Printf("更新检索块 %d 状态为失败时出错: %v\n", chunk.ID, updateErr)
		}

		// 记录需要更新的DocumentChunk
		docChunkUpdateMap[chunk.KnowledgeChunkID] = chunk.FileID

		return fmt.Errorf("更新向量信息失败: %v", err)
	}

	fmt.Printf("检索块 %d embedding 处理完成，向量ID: %s\n", chunk.ID, vectorID)
	// 记录需要更新的DocumentChunk
	docChunkUpdateMap[chunk.KnowledgeChunkID] = chunk.FileID
	return nil
}

// generateEmbeddingForChunkWithContext 为分块生成 embedding - 使用上下文进行停止信号检查
func (s *RetrievalChunkService) generateEmbeddingForChunkWithContext(eid int64, content string, config *ChunkConfig, chunkConfigID int64, ctx *EmbeddingContext) ([]float64, error) {
	if config == nil || config.EmbeddingChannelID == nil {
		return nil, fmt.Errorf("未配置向量化渠道")
	}

	// 如果提供了chunkConfigID且大于0，则根据配置类型进行特殊处理
	if chunkConfigID > 0 {
		configService := NewChunkConfigService(s.db)
		// 只有系统的 qa，才需要
		chunkConfig, err := configService.GetConfigByID(0, chunkConfigID)
		if err == nil {
			// 对于QA类型，只提取问题部分用于向量化
			if chunkConfig.Type == model.ChunkTypeQA {
				// 使用正则表达式提取问题部分。如"问题：相机精度能达到多少？\n回答：不同项目、不同场景下，相机精度不同。"
				// 只捕获问题和回答之间的所有内容直到遇到"回答："或文本结尾
				re := regexp.MustCompile(`问题：([^\n]*?)\n?回答：`)
				matches := re.FindStringSubmatch(content)
				if len(matches) > 1 {
					content = strings.TrimSpace(matches[1])
				}
			}
		}
	}

	availableChannel, err := model.GetChannelByID(*config.EmbeddingChannelID)
	if err != nil {
		return nil, fmt.Errorf("获取渠道失败: %v", err)
	}

	if availableChannel == nil {
		return nil, fmt.Errorf("没有可用的 embedding 渠道")
	}

	// 创建 embedding 服务
	embeddingService := NewEmbeddingService(s.db)

	// 使用上下文版本的 embedding API
	return embeddingService.GenerateEmbeddingWithContext(eid, content, availableChannel, config, ctx)
}

// generateEmbeddingForChunkWithStop 为分块生成 embedding - 支持停止信号检查（保持向后兼容）
func (s *RetrievalChunkService) generateEmbeddingForChunkWithStop(eid int64, content string, config *ChunkConfig, chunkConfigID int64, ctx *EmbeddingContext) ([]float64, error) {
	return s.generateEmbeddingForChunkWithContext(eid, content, config, chunkConfigID, ctx)
}

// generateEmbeddingForChunk 为分块生成 embedding
func (s *RetrievalChunkService) generateEmbeddingForChunk(eid int64, content string, config *ChunkConfig, chunkConfigID int64, ctx *EmbeddingContext) ([]float64, error) {
	// 调用支持停止信号的版本，传递 0,0 表示不检查停止信号
	return s.generateEmbeddingForChunkWithStop(eid, content, config, chunkConfigID, ctx)
}

// CheckGenerateEmbeddingForChunk 检查生成 embedding 是否成功
func (s *RetrievalChunkService) CheckGenerateEmbeddingForChunk(eid int64, libraryID *int64, fileID *int64, content string) error {
	configService := NewChunkConfigService(s.db)
	chunkConfig, err := configService.GetConfigWithFileID(eid, libraryID, fileID)
	if err != nil {
		// 当获取配置失败时，更新所有相关块为失败状态
		return fmt.Errorf("获取分块配置失败: %v", err)
	}
	ctx := NewEmbeddingContext(*libraryID, *fileID)

	_, err = s.generateEmbeddingForChunk(eid, content, chunkConfig, 0, ctx)
	return err
}

// storeRetrievalChunkToVectorDB 将检索块存储到向量数据库
func (s *RetrievalChunkService) storeRetrievalChunkToVectorDB(eid int64, chunk *model.RetrievalChunk, vector []float64) (string, error) {
	// 获取全局向量存储实例
	store, err := vectorstore.GetGlobalVectorStore()
	if err != nil {
		return "", fmt.Errorf("获取向量存储实例失败: %v", err)
	}

	ctx := context.Background()

	// 构建向量记录
	vectorID := uuid.New().String()
	// 获取库信息构建集合名
	library, err := model.GetLibraryByID(eid, chunk.LibraryID)
	if err != nil {
		return "", fmt.Errorf("获取库信息失败: %v", err)
	}
	resolver := VectorCollectionResolver{Mode: GetVectorCollectionMode()}
	collections := resolver.ResolveDocumentWriteCollections(chunk.Eid, *library)
	logger.SysLogf("【诊断-检索块写入】eid=%d, chunk_id=%d, library_id=%d, mode=%s, collections=%v", eid, chunk.ID, chunk.LibraryID, resolver.Mode, collections)

	// 将float64转换为float32
	vector32 := make([]float32, len(vector))
	for i, v := range vector {
		vector32[i] = float32(v)
	}

	// 构建元数据（使用统一的企业级 metadata 构建函数）
	metadata := buildDocumentVectorMetadata(DocumentVectorMetadataInput{
		Eid:                chunk.Eid,
		SpaceID:            library.SpaceID,
		LibraryID:          chunk.LibraryID,
		FileID:             chunk.FileID,
		ChunkID:            chunk.ID,
		KnowledgeChunkID:   chunk.KnowledgeChunkID,
		ChunkType:          "retrieval",
		Content:            chunk.Content,
		TokenCount:         chunk.TokenCount,
		Status:             "enabled",
		EmbeddingModel:     "",
		EmbeddingChannelID: 0,
	})
	// 保留 search_weight 字段（兼容旧代码查询）
	metadata["search_weight"] = chunk.SearchWeight

	record := vectorstore.VectorRecord{
		ID:       vectorID,
		Vector:   vector32,
		Metadata: metadata,
	}

	// 获取配置中的距离度量
	config := vectorstore.LoadFromEnv()

	// 根据模式向每个目标集合写入向量
	for _, collection := range collections {
		if err := s.insertRetrievalVectorWithAutoCreate(ctx, store, collection, record, len(vector32), config.DistanceMetric); err != nil {
			return "", fmt.Errorf("写入集合 %s 失败: %v", collection, err)
		}
	}

	return vectorID, nil
}

// insertRetrievalVectorWithAutoCreateCollection 插入检索向量，如果集合不存在则自动创建
func (s *RetrievalChunkService) insertRetrievalVectorWithAutoCreate(ctx context.Context, store vectorstore.VectorStore, collection string, record vectorstore.VectorRecord, dimension int, metric string) error {
	// 尝试直接插入
	err := store.Insert(ctx, collection, []vectorstore.VectorRecord{record})
	if err == nil {
		return nil
	}

	// 检查是否是集合不存在的错误
	if vsErr, ok := err.(*vectorstore.VectorStoreError); ok {
		combined := strings.ToLower(vsErr.Message + " " + vsErr.Details)
		looksLikeNotFound := strings.Contains(combined, "not found") ||
			strings.Contains(combined, "does not exist") ||
			strings.Contains(combined, "doesn't exist") ||
			strings.Contains(combined, "collection not found")

		if vsErr.Code == vectorstore.ErrCodeCollectionNotFound ||
			vsErr.Code == vectorstore.ErrCodeUnknown ||
			(vsErr.Code == vectorstore.ErrCodeInsertFailed && looksLikeNotFound) {
			// 尝试创建集合
			collectionConfig := vectorstore.CollectionConfig{
				Name:      collection,
				Dimension: dimension,
				Metric:    metric,
			}

			fmt.Printf("集合不存在，正在创建集合: %s\n", collection)
			if createErr := store.CreateCollection(ctx, collectionConfig); createErr != nil && !vectorstore.IsExistsError(createErr) {
				return fmt.Errorf("创建集合失败: %v", createErr)
			}

			// 重新尝试插入
			if insertErr := store.Insert(ctx, collection, []vectorstore.VectorRecord{record}); insertErr != nil {
				return fmt.Errorf("创建集合后插入向量失败: %v", insertErr)
			}
			return nil
		}
	}

	// 其他错误，使用重试机制
	return s.insertRetrievalVectorWithRetry(ctx, store, collection, record)
}

// insertRetrievalVectorWithRetry 带重试机制的插入
func (s *RetrievalChunkService) insertRetrievalVectorWithRetry(ctx context.Context, store vectorstore.VectorStore, collection string, record vectorstore.VectorRecord) error {
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			fmt.Printf("检索向量插入重试第%d次\n", attempt)
			time.Sleep(time.Duration(attempt) * time.Second)
		}

		err := store.Insert(ctx, collection, []vectorstore.VectorRecord{record})
		if err == nil {
			return nil
		}

		// 如果是最后一次尝试或非网络错误，直接返回
		if attempt == maxRetries || !isRetrievalRetryableError(err) {
			return err
		}
	}
	return fmt.Errorf("插入检索向量失败，已重试%d次", maxRetries)
}

// isRetrievalRetryableError 判断检索向量存储错误是否可重试
func isRetrievalRetryableError(err error) bool {
	// 网络相关错误可重试
	if strings.Contains(err.Error(), "connection") ||
		strings.Contains(err.Error(), "timeout") ||
		strings.Contains(err.Error(), "network") {
		return true
	}

	// VectorStore连接错误可重试
	if vsErr, ok := err.(*vectorstore.VectorStoreError); ok {
		return vsErr.Code == vectorstore.ErrCodeConnectionFailed
	}

	return false
}

// updateRetrievalChunkVectorInfo 更新检索块的向量信息
func (s *RetrievalChunkService) updateRetrievalChunkVectorInfo(chunkID int64, vectorID string) error {
	return s.db.Model(&model.RetrievalChunk{}).
		Where("id = ?", chunkID).
		Updates(map[string]interface{}{
			"vector_id":        vectorID,
			"embedding_status": model.RetrievalChunkEmbeddingStatusNormal,
			"error_reason":     "",
		}).Error
}

// UpdateRetrievalChunkEmbeddingStatus 更新检索块向量化状态
func (s *RetrievalChunkService) UpdateRetrievalChunkEmbeddingStatus(chunkID int64, status string, vectorID string, errorReason string) error {
	updates := map[string]interface{}{
		"embedding_status": status,
	}

	if vectorID != "" {
		updates["vector_id"] = vectorID
	}
	if errorReason != "" || model.IsRetrievalChunkEmbeddingSucceeded(status) {
		updates["error_reason"] = errorReason
	}

	fmt.Printf("[UpdateRetrievalChunkEmbeddingStatus] chunkID=%d status=%s vectorID=%s errorReason=%s\n", chunkID, status, vectorID, errorReason)

	return s.db.Model(&model.RetrievalChunk{}).
		Where("id = ?", chunkID).
		Updates(updates).Error
}

// batchUpdateDocumentChunkEmbeddingStatus 批量更新文档分块的向量化状态
func (s *RetrievalChunkService) batchUpdateDocumentChunkEmbeddingStatus(docChunkUpdateMap map[int64]int64) {
	for knowledgeChunkID, fileID := range docChunkUpdateMap {
		err := s.updateDocumentChunkEmbeddingStatus(knowledgeChunkID, fileID)
		if err != nil {
			fmt.Printf("批量更新文档分块 %d 状态时出错: %v\n", knowledgeChunkID, err)
		}
	}
}

// UpdateDocumentChunkEmbeddingStatus 更新文档分块的向量化状态
// 当所有检索块都完成时，文档分块状态更新为completed
// 当有任何一个检索块失败时，文档分块状态更新为failed
func (s *RetrievalChunkService) updateDocumentChunkEmbeddingStatus(knowledgeChunkID int64, fileID int64) error {
	// 获取该知识点分块下的所有检索块
	var retrievalChunks []model.RetrievalChunk
	err := s.db.Where("knowledge_chunk_id = ? AND file_id = ?", knowledgeChunkID, fileID).Find(&retrievalChunks).Error
	if err != nil {
		return err
	}

	// 如果没有检索块，不需要更新
	if len(retrievalChunks) == 0 {
		return nil
	}

	// 检查检索块状态
	allSucceeded := true
	hasFailed := false
	hasIndexing := false

	for _, chunk := range retrievalChunks {
		switch {
		case chunk.EmbeddingStatus == model.RetrievalChunkEmbeddingStatusFailed:
			hasFailed = true
			allSucceeded = false
		case model.IsRetrievalChunkEmbeddingSucceeded(chunk.EmbeddingStatus):
			// 已完成，保持 allSucceeded=true
		case chunk.EmbeddingStatus == model.RetrievalChunkEmbeddingStatusIndexing:
			allSucceeded = false
			hasIndexing = true
		default:
			// pending 或其他中间态
			allSucceeded = false
		}

		if hasFailed {
			break
		}
	}

	// 确定文档分块应该更新为什么状态
	var documentChunkStatus string
	switch {
	case hasFailed:
		documentChunkStatus = model.DocumentChunkEmbeddingStatusFailed
	case allSucceeded:
		documentChunkStatus = model.DocumentChunkEmbeddingStatusNormal
	case hasIndexing:
		documentChunkStatus = model.DocumentChunkEmbeddingStatusIndexing
	default:
		documentChunkStatus = model.DocumentChunkEmbeddingStatusPending
	}

	// 更新文档分块状态
	return s.db.Model(&model.DocumentChunk{}).
		Where("id = ?", knowledgeChunkID).
		Update("embedding_status", documentChunkStatus).Error
}

// ==================== 拆分方法实现 ====================

// splitByHeaders 按标题拆分，确保不丢失前面的内容
func (s *RetrievalChunkService) splitByHeaders(content string, headerLevel string, maxLength int, overlapSize int) []string {
	targetLevel := s.getHeaderLevel(headerLevel)
	lines := strings.Split(content, "\n")

	// 查找所有目标级别的标题位置
	var headerPositions []int
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			level := s.countHeaderLevel(line)
			if level == targetLevel {
				headerPositions = append(headerPositions, i)
			}
		}
	}

	// 如果没有找到目标级别的标题，尝试更高级别的标题
	if len(headerPositions) == 0 {
		for level := 1; level < targetLevel; level++ {
			for i, line := range lines {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "#") {
					if s.countHeaderLevel(line) == level {
						headerPositions = append(headerPositions, i)
					}
				}
			}
			if len(headerPositions) > 0 {
				break
			}
		}
	}

	// 如果仍然没有找到标题，按段落拆分
	if len(headerPositions) == 0 {
		return s.splitByParagraphs(content, maxLength, overlapSize)
	}

	var chunks []string

	// 处理第一个标题前的内容（重要：不能丢失）
	if headerPositions[0] > 0 {
		preContent := strings.Join(lines[0:headerPositions[0]], "\n")
		preContent = strings.TrimSpace(preContent)
		if preContent != "" {
			// 检查前置内容是否需要拆分
			tokenCount, _ := s.tokenizer.CountTokens(preContent)
			if tokenCount > maxLength {
				subChunks := s.splitByParagraphs(preContent, maxLength, overlapSize)
				chunks = append(chunks, subChunks...)
			} else {
				chunks = append(chunks, preContent)
			}
		}
	}

	// 处理每个标题段落
	for i := 0; i < len(headerPositions); i++ {
		startLine := headerPositions[i]
		endLine := len(lines)
		if i+1 < len(headerPositions) {
			endLine = headerPositions[i+1]
		}

		sectionLines := lines[startLine:endLine]
		sectionContent := strings.Join(sectionLines, "\n")
		sectionContent = strings.TrimSpace(sectionContent)

		if sectionContent != "" {
			// 检查段落是否需要进一步拆分
			tokenCount, _ := s.tokenizer.CountTokens(sectionContent)
			if tokenCount > maxLength {
				subChunks := s.splitByParagraphs(sectionContent, maxLength, overlapSize)
				chunks = append(chunks, subChunks...)
			} else {
				chunks = append(chunks, sectionContent)
			}
		}
	}

	return chunks
}

// getHeaderLevel 获取标题级别
func (s *RetrievalChunkService) getHeaderLevel(headerLevel string) int {
	switch headerLevel {
	case "h1":
		return 1
	case "h2":
		return 2
	case "h3":
		return 3
	case "h4":
		return 4
	case "h5":
		return 5
	case "h6":
		return 6
	default:
		return 2 // 默认h2
	}
}

// countHeaderLevel 计算标题级别
func (s *RetrievalChunkService) countHeaderLevel(line string) int {
	level := 0
	for _, char := range line {
		if char == '#' {
			level++
		} else {
			break
		}
	}
	return level
}

// splitByParagraphs 按段落拆分
func (s *RetrievalChunkService) splitByParagraphs(content string, maxLength int, overlapSize int) []string {
	return s.splitBySeparator(content, "\n\n", maxLength, overlapSize)
}

// splitByLines 按行拆分
func (s *RetrievalChunkService) splitByLines(content string, maxLength int, overlapSize int) []string {
	return s.splitBySeparator(content, "\n", maxLength, overlapSize)
}

// splitByCustomSeparator 按自定义分隔符拆分
func (s *RetrievalChunkService) splitByCustomSeparator(content string, separator string, maxLength int, overlapSize int) []string {
	return s.splitBySeparator(content, separator, maxLength, overlapSize)
}

// splitBySeparator 按分隔符拆分的通用方法
func (s *RetrievalChunkService) splitBySeparator(content string, separator string, maxLength int, overlapSize int) []string {
	segments := strings.Split(content, separator)
	if len(segments) <= 1 {
		// 即使只有一个段落，也要检查是否超过最大长度
		segmentTokens, _ := s.tokenizer.CountTokens(segments[0])
		if segmentTokens > maxLength {
			// 如果超过最大长度，强制拆分
			return s.forceSplitLargeContent(segments[0], maxLength)
		}
		return []string{segments[0]}
	}

	var chunks []string

	for _, segment := range segments {
		// 清理片段内容：去除前后空白，并检查是否为空
		segment = strings.TrimSpace(segment)
		if segment == "" {
			continue
		}

		segmentTokens, _ := s.tokenizer.CountTokens(segment)

		// 如果单个段落就超过最大长度，需要强制拆分
		if segmentTokens > maxLength {
			// 对超大段落进行强制拆分
			subChunks := s.forceSplitLargeContent(segment, maxLength)
			chunks = append(chunks, subChunks...)
		} else {
			// 保持原有分段，即使没有超过最大长度也不合并
			chunks = append(chunks, segment)
		}
	}

	// 应用重叠逻辑
	if overlapSize > 0 {
		chunks = s.applyOverlap(chunks, overlapSize)
	}

	return chunks
}

// splitBySentences 按句子拆分
func (s *RetrievalChunkService) splitBySentences(content string, maxLength int, overlapSize int) []string {
	sentences := s.splitIntoSentences(content)
	if len(sentences) <= 1 {
		return []string{content}
	}

	var chunks []string
	var currentChunk strings.Builder

	for _, sentence := range sentences {
		// 清理句子内容：去除前后空白，并检查是否为空
		sentence = strings.TrimSpace(sentence)
		if sentence == "" {
			continue
		}

		sentenceTokens, _ := s.tokenizer.CountTokens(sentence)

		// 如果单个句子就超过最大长度，强制拆分
		if sentenceTokens > maxLength {
			// 先保存当前分块（如果有内容）
			if currentChunk.Len() > 0 {
				chunks = append(chunks, currentChunk.String())
				currentChunk.Reset()
			}

			// 对超大句子进行强制拆分
			subChunks := s.forceSplitLargeContent(sentence, maxLength)
			chunks = append(chunks, subChunks...)
			continue
		}

		// 检查加入当前句子后是否超过最大长度
		testContent := currentChunk.String()
		if currentChunk.Len() > 0 {
			testContent += " "
		}
		testContent += sentence
		testTokens, _ := s.tokenizer.CountTokens(testContent)

		if testTokens > maxLength && currentChunk.Len() > 0 {
			chunks = append(chunks, currentChunk.String())
			currentChunk.Reset()
		}

		// 添加当前句子
		if currentChunk.Len() > 0 {
			currentChunk.WriteString(" ")
		}
		currentChunk.WriteString(sentence)
	}

	// 添加最后一个分块
	if currentChunk.Len() > 0 {
		chunks = append(chunks, currentChunk.String())
	}

	// 应用重叠逻辑
	if overlapSize > 0 {
		chunks = s.applyOverlap(chunks, overlapSize)
	}

	return chunks
}

// forceSplitLargeContent 强制拆分超大内容
func (s *RetrievalChunkService) forceSplitLargeContent(content string, maxLength int) []string {
	// 系统指定的分隔符优先级（从高到低）
	separators := []string{
		"\n\n", // 段落分隔符
		"\n",   // 行分隔符
		"。",    // 中文句号
		".",    // 英文句号
		"！",    // 中文感叹号
		"!",    // 英文感叹号
		"？",    // 中文问号
		"?",    // 英文问号
		"；",    // 中文分号
		";",    // 英文分号
		"，",    // 中文逗号
		",",    // 英文逗号
		" ",    // 空格
	}

	// 尝试每个分隔符
	for _, separator := range separators {
		if strings.Contains(content, separator) {
			chunks := s.splitBySeparator(content, separator, maxLength, 0)
			// 检查是否所有分块都在合理范围内
			allValid := true
			for _, chunk := range chunks {
				chunkTokens, _ := s.tokenizer.CountTokens(chunk)
				if chunkTokens > maxLength*2 { // 允许一定的超出
					allValid = false
					break
				}
			}
			if allValid {
				return chunks
			}
		}
	}

	// 如果所有分隔符都无效，按字符强制拆分
	return s.splitByCharacters(content, maxLength)
}

// splitByCharacters 按字符拆分（最后的保底方案）
func (s *RetrievalChunkService) splitByCharacters(content string, maxLength int) []string {
	var chunks []string
	runes := []rune(content)

	for i := 0; i < len(runes); {
		end := i + maxLength
		if end > len(runes) {
			end = len(runes)
		}

		chunk := string(runes[i:end])
		chunks = append(chunks, chunk)

		i = end // 不重叠，确保不丢失内容
	}

	return chunks
}

// splitIntoSentences 将文本拆分为句子
func (s *RetrievalChunkService) splitIntoSentences(content string) []string {
	// 支持中英文句号、问号、感叹号
	sentenceEnders := []string{"。", "！", "？", ".", "!", "?"}

	var sentences []string
	var currentSentence strings.Builder

	runes := []rune(content)
	for i, r := range runes {
		currentSentence.WriteRune(r)

		// 检查是否是句子结束符
		char := string(r)
		for _, ender := range sentenceEnders {
			if char == ender {
				// 检查下一个字符是否是空白或结束
				if i+1 >= len(runes) || isWhitespace(runes[i+1]) {
					sentence := strings.TrimSpace(currentSentence.String())
					if sentence != "" {
						sentences = append(sentences, sentence)
					}
					currentSentence.Reset()
					break
				}
			}
		}
	}

	// 添加最后一个句子
	if currentSentence.Len() > 0 {
		sentence := strings.TrimSpace(currentSentence.String())
		if sentence != "" {
			sentences = append(sentences, sentence)
		}
	}

	return sentences
}

// applyOverlap 应用重叠逻辑
func (s *RetrievalChunkService) applyOverlap(chunks []string, overlapSize int) []string {
	if len(chunks) <= 1 || overlapSize <= 0 {
		return chunks
	}

	var overlappedChunks []string

	for i, chunk := range chunks {
		if i == 0 {
			// 第一个分块直接添加
			overlappedChunks = append(overlappedChunks, chunk)
		} else {
			// 从前一个分块获取重叠内容
			prevChunk := chunks[i-1]
			overlapContent := s.getOverlapContent(prevChunk, overlapSize)

			// 将重叠内容添加到当前分块前面
			overlappedChunk := overlapContent + chunk
			overlappedChunks = append(overlappedChunks, overlappedChunk)
		}
	}

	return overlappedChunks
}

// isWhitespace 检查字符是否为空白字符
func isWhitespace(r rune) bool {
	return r == ' ' || r == '\t' || r == '\n' || r == '\r'
}

// extractDocumentTitle 从文档内容中提取第一个大标题
func (s *RetrievalChunkService) extractDocumentTitle(eid int64, fileID int64, filePath string) string {
	// 预览模式下无法获取文件标题
	if filePath == "" {
		return ""
	}

	// 尝试从文件内容中提取第一个大标题
	fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil || fileBody == nil {
		// 如果获取文件内容失败，返回空字符串
		return ""
	}
	content, err := fileBody.GetContent()
	if err != nil {
		return ""
	}

	// 从文件内容中提取第一个大标题
	title := s.extractFirstHeader(content)
	if title != "" {
		return title
	}

	// 如果没有找到标题，返回空字符串
	return ""
}

// extractFirstHeader 从文档内容中提取第一个大标题
func (s *RetrievalChunkService) extractFirstHeader(content string) string {
	if content == "" {
		return ""
	}

	lines := strings.Split(content, "\n")

	// 遍历每一行，寻找第一个标题
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// 检查是否是 Markdown 标题格式 (# ## ### 等)
		if strings.HasPrefix(line, "#") {
			// 计算标题级别
			level := 0
			for _, char := range line {
				if char == '#' {
					level++
				} else {
					break
				}
			}

			// 提取标题文本（去掉 # 号和前后空格）
			titleText := strings.TrimSpace(line[level:])
			if titleText != "" {
				return titleText
			}
		}

		// 检查是否是其他常见的大标题格式
		// 例如：全大写、加粗、下划线等
		if s.isLikelyTitle(line) {
			return line
		}

		// 如果遇到非空行且不是标题，可能正文开始了，停止搜索
		// 但我们可以继续搜索几行，以防标题格式不标准
		// 这里简化处理，继续搜索
	}

	return ""
}

// isLikelyTitle 判断一行文字是否可能是标题
func (s *RetrievalChunkService) isLikelyTitle(line string) bool {
	if len(line) == 0 {
		return false
	}

	// 去除前后空格
	line = strings.TrimSpace(line)

	// 检查长度，标题通常不会太长也不会太短
	if len(line) > 100 || len(line) < 3 {
		return false
	}

	// 检查是否全大写（英文）
	if line == strings.ToUpper(line) && s.containsEnglish(line) {
		return true
	}

	// 检查是否包含常见的标题关键词
	titleKeywords := []string{
		"第", "章", "节", "部分", "概述", "介绍", "总结", "结论",
		"Chapter", "Section", "Part", "Overview", "Introduction", "Summary", "Conclusion",
	}

	for _, keyword := range titleKeywords {
		if strings.Contains(line, keyword) {
			return true
		}
	}

	// 检查是否是加粗格式（**标题**）
	if strings.HasPrefix(line, "**") && strings.HasSuffix(line, "**") {
		title := strings.TrimSpace(line[2 : len(line)-2])
		return title != ""
	}

	return false
}

// containsEnglish 检查字符串是否包含英文字符
func (s *RetrievalChunkService) containsEnglish(text string) bool {
	for _, r := range text {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return true
		}
	}
	return false
}

// chunkContainsTitle 检查分块内容是否已经包含指定的标题
func (s *RetrievalChunkService) chunkContainsTitle(chunk, title string) bool {
	if chunk == "" || title == "" {
		return false
	}

	// 去除标题和分块内容的前后空格
	title = strings.TrimSpace(title)
	chunk = strings.TrimSpace(chunk)

	// 检查分块的开头是否包含标题（支持多种格式）
	lines := strings.Split(chunk, "\n")

	// 检查前几行，看是否包含标题
	checkLines := 3
	if len(lines) < checkLines {
		checkLines = len(lines)
	}

	for i := 0; i < checkLines; i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}

		// 检查是否直接匹配标题
		if line == title {
			return true
		}

		// 检查是否是 Markdown 标题格式包含该标题
		if strings.HasPrefix(line, "#") {
			// 提取标题文本
			headerText := s.extractHeaderText(line)
			if headerText == title {
				return true
			}
		}

		// 检查是否包含标题文本（不要求完全匹配）
		if strings.Contains(line, title) {
			return true
		}
	}

	return false
}

// extractHeaderText 从 Markdown 标题行中提取标题文本
func (s *RetrievalChunkService) extractHeaderText(line string) string {
	if !strings.HasPrefix(line, "#") {
		return ""
	}

	// 计算标题级别
	level := 0
	for _, char := range line {
		if char == '#' {
			level++
		} else {
			break
		}
	}

	// 提取标题文本（去掉 # 号和前后空格）
	titleText := strings.TrimSpace(line[level:])
	return titleText
}

// extractFileNameFromPath 从文件路径中提取文件名（不带后缀）
func (s *RetrievalChunkService) extractFileNameFromPath(filePath string) string {
	// 预览模式下无法获取文件名
	if filePath == "" {
		return "预览文档"
	}

	if filePath == "" {
		return ""
	}

	// 使用 path.Base 获取文件名（包含后缀）
	fileNameWithExt := strings.TrimPrefix(filePath, "/")
	lastSlash := strings.LastIndex(fileNameWithExt, "/")
	if lastSlash >= 0 {
		fileNameWithExt = fileNameWithExt[lastSlash+1:]
	}

	// 去掉文件后缀
	lastDot := strings.LastIndex(fileNameWithExt, ".")
	if lastDot > 0 {
		fileName := fileNameWithExt[:lastDot]
		return fileName
	}

	return fileNameWithExt
}

// extractQuestionFromQA 从问答内容中提取问题部分
func (s *RetrievalChunkService) extractQuestionFromQA(content string) string {
	// 查找"问题："开头的部分，并提取到第一个换行符或字符串结尾
	pattern := `问题：[^\n]*`
	re := regexp.MustCompile(pattern)
	matches := re.FindStringSubmatch(content)
	if len(matches) > 0 {
		return matches[0]
	}

	// 如果没有找到"问题："开头的格式，返回原内容
	return content
}

// createAdditionalRetrievalChunks 创建摘要和问题类型的检索块
func (s *RetrievalChunkService) CreateAdditionalRetrievalChunks(
	eid int64,
	knowledgeChunk *model.DocumentChunk,
	summaries []string,
	questions []string,
	config *ChunkConfig,
	baseIndex int,
) []model.RetrievalChunk {
	var additionalChunks []model.RetrievalChunk

	// 创建摘要检索块
	for i, summary := range summaries {
		tokenCount, _ := s.tokenizer.CountTokens(summary)
		chunk := model.RetrievalChunk{
			Eid:              eid,
			FileID:           knowledgeChunk.FileID,
			LibraryID:        knowledgeChunk.LibraryID,
			KnowledgeChunkID: knowledgeChunk.ID,
			Content:          summary,
			ChunkIndex:       baseIndex + i,
			ChunkType:        "summary",
			TokenCount:       tokenCount,
			Status:           "enabled",
			EmbeddingStatus:  s.getEmbeddingStatus(config),
			SearchWeight:     1.0,
		}
		additionalChunks = append(additionalChunks, chunk)
	}

	// 创建问题检索块
	summaryCount := len(summaries)
	for i, question := range questions {
		tokenCount, _ := s.tokenizer.CountTokens(question)
		chunk := model.RetrievalChunk{
			Eid:              eid,
			FileID:           knowledgeChunk.FileID,
			LibraryID:        knowledgeChunk.LibraryID,
			KnowledgeChunkID: knowledgeChunk.ID,
			Content:          question,
			ChunkIndex:       baseIndex + summaryCount + i,
			ChunkType:        "question",
			TokenCount:       tokenCount,
			Status:           "enabled",
			EmbeddingStatus:  s.getEmbeddingStatus(config),
			SearchWeight:     1.0,
		}
		additionalChunks = append(additionalChunks, chunk)
	}

	return additionalChunks
}

// getEmbeddingStatus 获取向量化状态
func (s *RetrievalChunkService) getEmbeddingStatus(config *ChunkConfig) string {
	if config == nil || config.EmbeddingChannelID == nil {
		return model.RetrievalChunkEmbeddingStatusFailed
	}
	return model.RetrievalChunkEmbeddingStatusPending
}
