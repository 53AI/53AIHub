package controller

import (
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

func Search(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req rag.SearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误",
			"error":   err.Error(),
		})
		return
	}

	// 创建搜索服务
	searchService := rag.NewSearchService(model.DB)

	// 执行搜索（传入 userID 进行 File ACL 过滤）
	response, err := searchService.Search(eid, &req, &userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "搜索失败",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "搜索成功",
		"data":    response,
	})
}

func VectorSearch(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req rag.SearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误",
			"error":   err.Error(),
		})
		return
	}

	// 强制设置为向量搜索
	req.SearchType = "vector"

	// 创建搜索服务
	searchService := rag.NewSearchService(model.DB)

	// 执行搜索（传入 userID 进行 File ACL 过滤）
	response, err := searchService.Search(eid, &req, &userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "向量搜索失败",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "向量搜索成功",
		"data":    response,
	})
}

func FulltextSearch(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req rag.SearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误",
			"error":   err.Error(),
		})
		return
	}

	// 强制设置为全文搜索
	req.SearchType = "fulltext"

	// 创建搜索服务
	searchService := rag.NewSearchService(model.DB)

	// 执行搜索（传入 userID 进行 File ACL 过滤）
	response, err := searchService.Search(eid, &req, &userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "全文搜索失败",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "全文搜索成功",
		"data":    response,
	})
}

func HybridSearch(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req rag.SearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误",
			"error":   err.Error(),
		})
		return
	}

	// 强制设置为混合搜索
	req.SearchType = "hybrid"

	// 创建搜索服务
	searchService := rag.NewSearchService(model.DB)

	// 执行搜索（传入 userID 进行 File ACL 过滤）
	response, err := searchService.Search(eid, &req, &userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "混合搜索失败",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "混合搜索成功",
		"data":    response,
	})
}

// SearchSuggestions 搜索建议
func SearchSuggestions(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取查询参数
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "查询参数不能为空",
		})
		return
	}

	limitStr := c.DefaultQuery("limit", "5")
	limit, err := strconv.Atoi(limitStr)
	if err != nil {
		limit = 5
	}

	// 简单的搜索建议实现：基于分块内容的关键词提取
	var suggestions []string

	// 查询包含查询词的分块
	var chunks []model.DocumentChunk
	err = model.DB.Where("eid = ? AND content LIKE ?", eid, "%"+query+"%").
		Limit(limit * 2).Find(&chunks).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "获取搜索建议失败",
			"error":   err.Error(),
		})
		return
	}

	// 提取建议词（简单实现）
	suggestionMap := make(map[string]bool)
	for _, chunk := range chunks {
		// 这里可以实现更复杂的关键词提取逻辑
		words := extractKeywords(chunk.Content, query)
		for _, word := range words {
			if len(suggestionMap) >= limit {
				break
			}
			if !suggestionMap[word] {
				suggestions = append(suggestions, word)
				suggestionMap[word] = true
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "获取搜索建议成功",
		"data":    suggestions,
	})
}

// GetSearchHistory 获取搜索历史
func GetSearchHistory(c *gin.Context) {
	// eid := config.GetEID(c)
	// userID := config.GetUserId(c)

	// 获取查询参数
	// limitStr := c.DefaultQuery("limit", "10")
	// limit, err := strconv.Atoi(limitStr)
	// if err != nil {
	// 	limit = 10
	// }

	// 这里可以实现搜索历史记录功能
	// 暂时返回空数组
	history := []map[string]interface{}{}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "获取搜索历史成功",
		"data": gin.H{
			"history": history,
			"total":   0,
		},
	})
}

// ProcessEmbeddingRequest 向量化任务请求
type ProcessEmbeddingRequest struct {
	ChunkID   *int64 `json:"chunk_id" example:"123"`  // 指定单个检索块时使用 retrieval_chunks.id
	BatchSize int    `json:"batch_size" example:"10"` // 未指定 chunk_id 时的批量处理大小
}

// ProcessEmbedding 处理向量化任务
// @Summary 处理向量化任务
// @Description 指定 chunk_id 时仅重新入队一个检索块；未指定时批量入队待处理检索块
// @Tags 向量化处理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body ProcessEmbeddingRequest true "向量化任务请求"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "无权限操作检索块"
// @Failure 404 {object} model.CommonResponse "检索块不存在"
// @Failure 500 {object} model.CommonResponse "向量化任务入队失败"
// @Router /api/embedding/process [post]
func ProcessEmbedding(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req ProcessEmbeddingRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误",
			"error":   err.Error(),
		})
		return
	}

	// 改为入队，由队列消费者异步处理
	if req.ChunkID != nil {
		// 查询 chunk 获取 fileID 与 libraryID
		chunk, err := model.GetRetrievalChunkByID(eid, *req.ChunkID)
		if err != nil {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse("指定的检索块不存在"))
			return
		}

		permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, chunk.LibraryID, userID)
		if err != nil || permission < model.PERMISSION_EDIT_KNOWLEDGE {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse("无权限重新索引该检索块"))
			return
		}

		updatedChunk, err := rag.NewRetrievalChunkService(model.DB).RetryRetrievalChunkEmbedding(
			c.Request.Context(),
			eid,
			chunk,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(updatedChunk))
		return
	}

	// 批量入队 Pending 分块（按 batchSize 限制数量）
	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = 10
	}
	var pending []model.RetrievalChunk
	if err := model.DB.
		Where("eid = ? AND embedding_status = ?", eid, model.RetrievalChunkEmbeddingStatusPending).
		Order("id ASC").
		Limit(batchSize).
		Find(&pending).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "查询待处理分块失败",
			"error":   err.Error(),
		})
		return
	}
	for _, ch := range pending {
		rag.EnqueueRetrievalChunk(eid, ch.FileID, ch.LibraryID, ch.ID)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "待处理分块已入队，等待异步向量化",
		"data":    gin.H{"count": len(pending)},
	})
}

// extractKeywords 提取关键词（简单实现）
func extractKeywords(content, query string) []string {
	// 这里可以实现更复杂的关键词提取算法
	// 暂时返回简单的词汇分割
	words := []string{}

	// 简单的实现：返回包含查询词的短语
	if len(content) > len(query) {
		// 查找查询词前后的词汇
		// 这里可以使用更复杂的NLP算法
		words = append(words, query+" 相关内容")
	}

	return words
}
