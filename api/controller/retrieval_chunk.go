package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"

	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// GetKnowledgeRetrievalChunksRequest 获取知识点检索块请求
type GetKnowledgeRetrievalChunksRequest struct {
	KnowledgeChunkID int64 `uri:"knowledge_id" binding:"required" example:"1"` // 知识点分块ID
}

// GetKnowledgeRetrievalChunksResponse 获取知识点检索块响应
type GetKnowledgeRetrievalChunksResponse struct {
	KnowledgeChunk  *model.DocumentChunk   `json:"knowledge_chunk"`  // 知识点分块信息
	RetrievalChunks []model.RetrievalChunk `json:"retrieval_chunks"` // 检索块列表
	TotalCount      int                    `json:"total_count"`      // 总数量
	Stats           *RetrievalStatsInfo    `json:"stats"`            // 统计信息
}

// RetrievalStatsInfo 检索块统计信息
type RetrievalStatsInfo struct {
	TotalTokens   int64   `json:"total_tokens"`
	AvgTokens     float64 `json:"avg_tokens"`
	EmbeddedCount int     `json:"embedded_count"`
	PendingCount  int     `json:"pending_count"`
	IndexingCount int     `json:"indexing_count"`
	FailedCount   int     `json:"failed_count"`
}

// GetKnowledgeRetrievalChunks godoc
// @Summary 获取知识点的检索块列表
// @Description 根据知识点分块ID获取其所有关联的检索块
// @Tags 检索块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param knowledge_id path int true "知识点分块ID"
// @Success 200 {object} model.CommonResponse{data=GetKnowledgeRetrievalChunksResponse} "成功获取检索块列表"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "知识点分块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/knowledge/{knowledge_id}/retrieval [get]
func GetKnowledgeRetrievalChunks(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析路径参数
	knowledgeChunkIDStr := c.Param("knowledge_id")
	knowledgeChunkID, err := strconv.ParseInt(knowledgeChunkIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的知识点分块ID"))
		return
	}

	// 获取知识点分块信息
	knowledgeChunk, err := model.GetDocumentChunkByID(eid, knowledgeChunkID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("知识点分块不存在"))
		return
	}

	if knowledgeChunk.ChunkType != "knowledge" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("指定的分块不是知识点分块"))
		return
	}

	// 获取检索块列表
	retrievalChunks, err := model.GetRetrievalChunksByKnowledgeID(eid, knowledgeChunkID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 计算统计信息
	var totalTokens int64
	var embeddedCount, pendingCount, indexingCount, failedCount int
	for _, chunk := range retrievalChunks {
		totalTokens += int64(chunk.TokenCount)
		switch {
		case model.IsRetrievalChunkEmbeddingSucceeded(chunk.EmbeddingStatus):
			embeddedCount++
		case chunk.EmbeddingStatus == model.RetrievalChunkEmbeddingStatusPending:
			pendingCount++
		case chunk.EmbeddingStatus == model.RetrievalChunkEmbeddingStatusIndexing:
			indexingCount++
		case chunk.EmbeddingStatus == model.RetrievalChunkEmbeddingStatusFailed:
			failedCount++
		}
	}

	var avgTokens float64
	if len(retrievalChunks) > 0 {
		avgTokens = float64(totalTokens) / float64(len(retrievalChunks))
	}

	stats := &RetrievalStatsInfo{
		TotalTokens:   totalTokens,
		AvgTokens:     avgTokens,
		EmbeddedCount: embeddedCount,
		PendingCount:  pendingCount,
		IndexingCount: indexingCount,
		FailedCount:   failedCount,
	}

	response := GetKnowledgeRetrievalChunksResponse{
		KnowledgeChunk:  knowledgeChunk,
		RetrievalChunks: retrievalChunks,
		TotalCount:      len(retrievalChunks),
		Stats:           stats,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// CreateRetrievalChunkRequest 创建检索块请求
type CreateRetrievalChunkRequest struct {
	KnowledgeChunkID int64    `json:"knowledge_chunk_id" binding:"required" example:"1"` // 知识点分块ID
	Content          string   `json:"content" binding:"required" example:"检索块内容"`        // 检索块内容
	ChunkType        string   `json:"chunk_type" example:"retrieval"`                    // 分块类型
	SearchKeywords   []string `json:"search_keywords" example:"[\"关键词1\", \"关键词2\"]"`    // 搜索关键词
	SearchWeight     float64  `json:"search_weight" example:"1.0"`                       // 检索权重
}

// CreateRetrievalChunk godoc
// @Summary 为知识点创建新的检索块
// @Description 为指定的知识点分块创建新的检索块
// @Tags 检索块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateRetrievalChunkRequest true "创建检索块请求"
// @Success 200 {object} model.CommonResponse{data=model.RetrievalChunk} "成功创建检索块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "知识点分块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/knowledge/{knowledge_id}/retrieval [post]
func CreateRetrievalChunk(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析路径参数
	knowledgeChunkIDStr := c.Param("knowledge_id")
	knowledgeChunkID, err := strconv.ParseInt(knowledgeChunkIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的知识点分块ID"))
		return
	}

	// 解析请求体
	var req CreateRetrievalChunkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 验证知识点分块ID一致性
	if req.KnowledgeChunkID != knowledgeChunkID {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("知识点分块ID不一致"))
		return
	}

	// 获取知识点分块信息
	knowledgeChunk, err := model.GetDocumentChunkByID(eid, knowledgeChunkID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("知识点分块不存在"))
		return
	}

	// 创建Token计算服务
	tokenizer := rag.NewTokenizerService()

	// 计算Token数量
	tokenCount, err := tokenizer.CountTokens(req.Content)
	if err != nil {
		tokenCount = len(req.Content) / 4 // 简单估算
	}

	// 获取下一个索引
	existingChunks, err := model.GetRetrievalChunksByKnowledgeID(eid, knowledgeChunkID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	nextIndex := len(existingChunks)

	// 创建检索块
	retrievalChunk := &model.RetrievalChunk{
		Eid:              eid,
		FileID:           knowledgeChunk.FileID,
		LibraryID:        knowledgeChunk.LibraryID,
		KnowledgeChunkID: knowledgeChunkID,
		Content:          req.Content,
		ChunkIndex:       nextIndex,
		ChunkType:        req.ChunkType,
		TokenCount:       tokenCount,
		Status:           "enabled",
		IsManualEdited:   true,
		EmbeddingStatus:  model.RetrievalChunkEmbeddingStatusPending,
		SearchWeight:     req.SearchWeight,
	}

	if req.ChunkType == "" {
		retrievalChunk.ChunkType = "retrieval"
	}
	if req.SearchWeight == 0 {
		retrievalChunk.SearchWeight = 1.0
	}

	// 设置搜索关键词
	if len(req.SearchKeywords) > 0 {
		err = retrievalChunk.SetSearchKeywords(req.SearchKeywords)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
	}

	// 保存检索块（使用统一的带冲突与重试实现）
	maxRetries := config.CHUNK_SAVE_MAX_RETRIES
	retryDelay := time.Duration(config.CHUNK_SAVE_RETRY_DELAY) * time.Millisecond
	err = rag.SaveRetrievalChunkWithRetry(model.DB, retrievalChunk, maxRetries, retryDelay)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 入队检索块 embedding（测试模式下跳过）
	if !isTestMode() {
		rag.EnqueueRetrievalChunk(eid, retrievalChunk.FileID, retrievalChunk.LibraryID, retrievalChunk.ID)
	}

	// 创建关联关系元数据
	metadata := &model.RelationMetadataData{
		CreatedBy:     userID,
		CreatedReason: "manual_created",
		SemanticScore: 1.0,
		PositionScore: 1.0,
	}

	_, err = model.CreateChunkRelation(
		eid,
		knowledgeChunk.FileID,
		knowledgeChunk.LibraryID,
		knowledgeChunkID,
		retrievalChunk.ID,
		"manual",
		req.SearchWeight,
		metadata,
	)
	if err != nil {
		// 关联关系创建失败不影响主流程
		// 但应该记录日志
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(retrievalChunk))
}

// UpdateRetrievalChunkRequest 更新检索块请求
type UpdateRetrievalChunkRequest struct {
	Content        string   `json:"content" binding:"required" example:"更新后的检索块内容"` // 检索块内容
	SearchKeywords []string `json:"search_keywords" example:"[\"关键词1\", \"关键词2\"]"` // 搜索关键词
	SearchWeight   float64  `json:"search_weight" example:"1.5"`                    // 检索权重
}

// UpdateRetrievalChunk godoc
// @Summary 更新检索块内容
// @Description 更新指定检索块的内容和元数据
// @Tags 检索块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param retrieval_id path int true "检索块ID"
// @Param request body UpdateRetrievalChunkRequest true "更新检索块请求"
// @Success 200 {object} model.CommonResponse{data=model.RetrievalChunk} "成功更新检索块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "检索块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/retrieval/{retrieval_id} [put]
func UpdateRetrievalChunk(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析路径参数
	retrievalChunkIDStr := c.Param("retrieval_id")
	retrievalChunkID, err := strconv.ParseInt(retrievalChunkIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的检索块ID"))
		return
	}

	// 解析请求体
	var req UpdateRetrievalChunkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取检索块信息以检查文档锁定状态
	retrievalChunk, err := model.GetRetrievalChunkByID(eid, retrievalChunkID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("检索块不存在"))
		return
	}

	// 检查文档是否被锁定
	chunkerService := rag.NewChunkerService(model.DB)
	if chunkerService.IsDocumentLocked(eid, retrievalChunk.FileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，无法编辑检索块",
		})
		return
	}

	// 检查检索块是否被锁定
	if chunkerService.IsRetrievalChunkLocked(eid, retrievalChunkID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "检索块正在被编辑，请稍后再试",
		})
		return
	}

	// 锁定检索块
	if !chunkerService.TryLockRetrievalChunk(eid, retrievalChunkID, userID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "无法获取检索块编辑锁，请稍后再试",
		})
		return
	}
	defer chunkerService.UnlockRetrievalChunk(eid, retrievalChunkID)

	// 创建检索块服务
	retrievalService := rag.NewRetrievalChunkService(model.DB)

	// 更新检索块
	updatedChunk, err := retrievalService.UpdateRetrievalChunk(eid, retrievalChunkID, req.Content, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 更新搜索关键词和权重
	if len(req.SearchKeywords) > 0 {
		err = updatedChunk.SetSearchKeywords(req.SearchKeywords)
		if err == nil {
			updatedChunk.Update()
		}
	}

	if req.SearchWeight > 0 {
		updatedChunk.SearchWeight = req.SearchWeight
		updatedChunk.Update()
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(updatedChunk))
}

// DeleteRetrievalChunk godoc
// @Summary 删除检索块
// @Description 删除指定的检索块及其关联关系
// @Tags 检索块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param retrieval_id path int true "检索块ID"
// @Success 200 {object} model.CommonResponse "成功删除检索块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "检索块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/retrieval/{retrieval_id} [delete]
func DeleteRetrievalChunk(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析路径参数
	retrievalChunkIDStr := c.Param("retrieval_id")
	retrievalChunkID, err := strconv.ParseInt(retrievalChunkIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的检索块ID"))
		return
	}

	// 获取检索块信息以检查文档锁定状态
	retrievalChunk, err := model.GetRetrievalChunkByID(eid, retrievalChunkID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("检索块不存在"))
		return
	}

	// 检查文档是否被锁定
	chunkerService := rag.NewChunkerService(model.DB)
	if chunkerService.IsDocumentLocked(eid, retrievalChunk.FileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，无法删除检索块",
		})
		return
	}

	// 检查检索块是否被锁定
	if chunkerService.IsRetrievalChunkLocked(eid, retrievalChunkID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "检索块正在被编辑，请稍后再试",
		})
		return
	}

	// 锁定检索块
	if !chunkerService.TryLockRetrievalChunk(eid, retrievalChunkID, userID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "无法获取检索块编辑锁，请稍后再试",
		})
		return
	}
	defer chunkerService.UnlockRetrievalChunk(eid, retrievalChunkID)

	// 创建检索块服务
	retrievalService := rag.NewRetrievalChunkService(model.DB)

	// 删除检索块
	err = retrievalService.DeleteRetrievalChunk(eid, retrievalChunkID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("检索块已成功删除"))
}

// MergeRetrievalChunksRequest 合并检索块请求
type MergeRetrievalChunksRequest struct {
	ChunkIDs []int64 `json:"chunk_ids" binding:"required,min=2" example:"1,2,3"` // 要合并的检索块ID列表
}

// MergeRetrievalChunks godoc
// @Summary 合并检索块
// @Description 将多个检索块合并为一个检索块
// @Tags 检索块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body MergeRetrievalChunksRequest true "合并检索块请求"
// @Success 200 {object} model.CommonResponse{data=model.RetrievalChunk} "成功合并检索块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "检索块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/retrieval/merge [post]
func MergeRetrievalChunks(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req MergeRetrievalChunksRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取第一个检索块信息以检查文档锁定状态
	if len(req.ChunkIDs) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("检索块ID列表不能为空"))
		return
	}

	firstChunk, err := model.GetRetrievalChunkByID(eid, req.ChunkIDs[0])
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("检索块不存在"))
		return
	}

	// 检查文档是否被锁定
	chunkerService := rag.NewChunkerService(model.DB)
	if chunkerService.IsDocumentLocked(eid, firstChunk.FileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，无法合并检索块",
		})
		return
	}

	// 检查所有检索块是否被锁定
	for _, chunkID := range req.ChunkIDs {
		if chunkerService.IsRetrievalChunkLocked(eid, chunkID) {
			c.JSON(http.StatusLocked, model.CommonResponse{
				Code:    423,
				Message: fmt.Sprintf("检索块 %d 正在被编辑，请稍后再试", chunkID),
			})
			return
		}
	}

	// 锁定所有检索块
	var lockedChunks []int64
	defer func() {
		// 解锁所有已锁定的检索块
		for _, chunkID := range lockedChunks {
			chunkerService.UnlockRetrievalChunk(eid, chunkID)
		}
	}()

	for _, chunkID := range req.ChunkIDs {
		if !chunkerService.TryLockRetrievalChunk(eid, chunkID, userID) {
			c.JSON(http.StatusLocked, model.CommonResponse{
				Code:    423,
				Message: fmt.Sprintf("无法获取检索块 %d 的编辑锁，请稍后再试", chunkID),
			})
			return
		}
		lockedChunks = append(lockedChunks, chunkID)
	}

	// 创建检索块服务
	retrievalService := rag.NewRetrievalChunkService(model.DB)

	// 合并检索块
	mergedChunk, err := retrievalService.MergeRetrievalChunks(eid, req.ChunkIDs, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 发布embedding事件（测试模式下跳过）
	if !isTestMode() {
		// 入队合并后的检索块，由异步消费者执行 embedding
		rag.EnqueueRetrievalChunk(eid, mergedChunk.FileID, mergedChunk.LibraryID, mergedChunk.ID)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(mergedChunk))
}

// SplitRetrievalChunkRequest 拆分检索块请求
type SplitRetrievalChunkRequest struct {
	SplitContents []string `json:"split_contents" binding:"required,min=2" example:"[\"第一部分内容\",\"第二部分内容\"]"` // 拆分后的内容列表
}

// SplitRetrievalChunk godoc
// @Summary 拆分检索块
// @Description 将一个检索块拆分为多个检索块
// @Tags 检索块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param retrieval_id path int true "检索块ID"
// @Param request body SplitRetrievalChunkRequest true "拆分检索块请求"
// @Success 200 {object} model.CommonResponse{data=[]model.RetrievalChunk} "成功拆分检索块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "检索块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/retrieval/{retrieval_id}/split [post]
func SplitRetrievalChunk(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析路径参数
	retrievalChunkIDStr := c.Param("retrieval_id")
	retrievalChunkID, err := strconv.ParseInt(retrievalChunkIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的检索块ID"))
		return
	}

	// 解析请求体
	var req SplitRetrievalChunkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取检索块信息以检查文档锁定状态
	retrievalChunk, err := model.GetRetrievalChunkByID(eid, retrievalChunkID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("检索块不存在"))
		return
	}

	// 检查文档是否被锁定
	chunkerService := rag.NewChunkerService(model.DB)
	if chunkerService.IsDocumentLocked(eid, retrievalChunk.FileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，无法拆分检索块",
		})
		return
	}

	// 检查检索块是否被锁定
	if chunkerService.IsRetrievalChunkLocked(eid, retrievalChunkID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "检索块正在被编辑，请稍后再试",
		})
		return
	}

	// 锁定检索块
	if !chunkerService.TryLockRetrievalChunk(eid, retrievalChunkID, userID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "无法获取检索块编辑锁，请稍后再试",
		})
		return
	}
	defer chunkerService.UnlockRetrievalChunk(eid, retrievalChunkID)

	// 创建检索块服务
	retrievalService := rag.NewRetrievalChunkService(model.DB)

	// 拆分检索块
	newChunks, err := retrievalService.SplitRetrievalChunk(eid, retrievalChunkID, req.SplitContents, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 发布embedding事件（测试模式下跳过）
	if !isTestMode() {
		// 入队拆分后的每个检索块
		for _, chunk := range newChunks {
			rag.EnqueueRetrievalChunk(eid, chunk.FileID, chunk.LibraryID, chunk.ID)
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(newChunks))
}

// GetChunkRelationStatsRequest 获取关联关系统计请求
type GetChunkRelationStatsRequest struct {
	FileID int64 `uri:"file_id" binding:"required" example:"1"` // 文件ID
}

// GetChunkRelationStatsResponse 获取关联关系统计响应
type GetChunkRelationStatsResponse struct {
	FileInfo            *model.File                `json:"file_info"`             // 文件信息
	KnowledgeChunkCount int64                      `json:"knowledge_chunk_count"` // 知识点分块数量
	RetrievalChunkCount int64                      `json:"retrieval_chunk_count"` // 检索块数量
	RelationStats       *model.ChunkRelationStats  `json:"relation_stats"`        // 关联关系统计
	RetrievalStats      *model.RetrievalChunkStats `json:"retrieval_stats"`       // 检索块统计
}

// GetChunkRelationStats godoc
// @Summary 获取文件的关联关系统计
// @Description 获取指定文件的分块关联关系统计信息
// @Tags 检索块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=GetChunkRelationStatsResponse} "成功获取统计信息"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/relations/stats/{file_id} [get]
func GetChunkRelationStats(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析路径参数
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的文件ID"))
		return
	}

	// 获取文件信息
	var file model.File
	err = model.DB.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("文件不存在"))
		return
	}

	// 获取知识点分块数量
	var knowledgeChunkCount int64
	err = model.DB.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND chunk_type = ?", eid, fileID, "knowledge").
		Count(&knowledgeChunkCount).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 获取检索块数量
	var retrievalChunkCount int64
	err = model.DB.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ?", eid, fileID).
		Count(&retrievalChunkCount).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 获取关联关系统计
	relationStats, err := model.GetChunkRelationStats(eid, fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 获取检索块统计
	retrievalStats, err := model.GetRetrievalChunkStats(eid, fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	response := GetChunkRelationStatsResponse{
		FileInfo:            &file,
		KnowledgeChunkCount: knowledgeChunkCount,
		RetrievalChunkCount: retrievalChunkCount,
		RelationStats:       relationStats,
		RetrievalStats:      retrievalStats,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}
