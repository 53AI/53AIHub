package controller

import (
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// RAGQAController RAG问答控制器
type RAGQAController struct {
	qaService *rag.QAService
}

// NewRAGQAController 创建RAG问答控制器
func NewRAGQAController() *RAGQAController {
	return &RAGQAController{
		qaService: rag.NewQAService(model.DB),
	}
}

// RAGQARequest RAG问答请求
type RAGQARequest struct {
	Question       string                  `json:"question" binding:"required" example:"什么是人工智能？"`
	LibraryIDs     []int64                 `json:"library_ids,omitempty" example:"1,2,3"`
	ConversationID *int64                  `json:"conversation_id,omitempty" example:"123"`
	SearchConfig   *model.SearchConfigData `json:"search_config,omitempty"`
	ContextLength  int                     `json:"context_length,omitempty" example:"4000"`
	IncludeSources bool                    `json:"include_sources" example:"true"`
	StreamResponse bool                    `json:"stream_response" example:"false"`
	Temperature    float64                 `json:"temperature,omitempty" example:"0.7"`
	MaxTokens      int                     `json:"max_tokens,omitempty" example:"1000"`
}

// RAGQAResponse RAG问答响应
type RAGQAResponse struct {
	Answer           string                   `json:"answer" example:"人工智能是计算机科学的一个分支..."`
	Sources          []rag.SourceReference    `json:"sources,omitempty"`
	SearchResults    []rag.QASearchResultItem `json:"search_results,omitempty"`
	ProcessingTime   int64                    `json:"processing_time_ms" example:"1500"`
	TokenUsage       *rag.TokenUsageInfo      `json:"token_usage,omitempty"`
	Confidence       float64                  `json:"confidence" example:"0.85"`
	RetrievalContext string                   `json:"retrieval_context,omitempty"`
}

// Ask godoc
// @Summary RAG问答
// @Description 基于知识库内容进行智能问答
// @Tags RAG问答
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body RAGQARequest true "问答请求"
// @Success 200 {object} model.CommonResponse{data=RAGQAResponse} "问答成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/ask [post]
// func (ctrl *RAGQAController) Ask(c *gin.Context) {
// 	eid := config.GetEID(c)
// 	userID := config.GetUserId(c)

// 	var req RAGQARequest
// 	if err := c.ShouldBindJSON(&req); err != nil {
// 		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
// 		return
// 	}

// 	// 转换为服务层请求
// 	qaReq := &rag.QARequest{
// 		Question:       req.Question,
// 		LibraryIDs:     req.LibraryIDs,
// 		ConversationID: req.ConversationID,
// 		SearchConfig:   req.SearchConfig,
// 		ContextLength:  req.ContextLength,
// 		IncludeSources: req.IncludeSources,
// 		StreamResponse: req.StreamResponse,
// 		Temperature:    req.Temperature,
// 		MaxTokens:      req.MaxTokens,
// 	}

// 	// 执行问答
// 	response, err := ctrl.qaService.Answer(eid, userID, qaReq)
// 	if err != nil {
// 		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
// 		return
// 	}

// 	// 转换响应
// 	qaResponse := RAGQAResponse{
// 		Answer:           response.Answer,
// 		Sources:          response.Sources,
// 		SearchResults:    response.SearchResults,
// 		ProcessingTime:   response.ProcessingTime,
// 		TokenUsage:       response.TokenUsage,
// 		Confidence:       response.Confidence,
// 		RetrievalContext: response.RetrievalContext,
// 	}

// 	c.JSON(http.StatusOK, model.Success.ToResponse(qaResponse))
// }

// GetConversationHistory godoc
// @Summary 获取对话历史
// @Description 获取指定对话的历史记录
// @Tags RAG问答
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param conversation_id path int true "对话ID"
// @Param limit query int false "限制数量" default(20)
// @Param offset query int false "偏移量" default(0)
// @Success 200 {object} model.CommonResponse{data=ConversationHistoryResponse} "获取成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "对话不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/conversations/{conversation_id}/history [get]
func (ctrl *RAGQAController) GetConversationHistory(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析路径参数
	conversationIDStr := c.Param("conversation_id")
	conversationID, err := strconv.ParseInt(conversationIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的对话ID"))
		return
	}

	// 解析查询参数
	limitStr := c.DefaultQuery("limit", "20")
	limit, err := strconv.Atoi(limitStr)
	if err != nil {
		limit = 20
	}

	offsetStr := c.DefaultQuery("offset", "0")
	offset, err := strconv.Atoi(offsetStr)
	if err != nil {
		offset = 0
	}

	// 获取对话历史
	count, messages, err := model.GetMessagesByConversationID(eid, conversationID, "", limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	response := ConversationHistoryResponse{
		ConversationID: conversationID,
		Total:          count,
		Messages:       messages,
		Limit:          limit,
		Offset:         offset,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// ConversationHistoryResponse 对话历史响应
type ConversationHistoryResponse struct {
	ConversationID int64            `json:"conversation_id"`
	Total          int64            `json:"total"`
	Messages       []*model.Message `json:"messages"`
	Limit          int              `json:"limit"`
	Offset         int              `json:"offset"`
}

// SearchKnowledge godoc
// @Summary 知识库搜索
// @Description 在知识库中搜索相关内容
// @Tags RAG问答
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body SearchKnowledgeRequest true "搜索请求"
// @Success 200 {object} model.CommonResponse{data=SearchKnowledgeResponse} "搜索成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/search [post]
func (ctrl *RAGQAController) SearchKnowledge(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req SearchKnowledgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 校验 LibraryIDs 归属权限
	if len(req.LibraryIDs) > 0 {
		for _, libraryID := range req.LibraryIDs {
			library, err := model.GetLibraryByID(eid, libraryID)
			if err != nil || library == nil || library.Eid != eid {
				c.JSON(http.StatusForbidden, model.CommonResponse{
					Code:    403,
					Message: "无权限访问指定的知识库",
					Data:    nil,
				})
				return
			}
		}
	}

	// 创建搜索服务
	searchService := rag.NewSearchService(model.DB)

	// 构建搜索请求
	searchReq := &rag.SearchRequest{
		Query:      req.Query,
		SearchType: req.SearchType,
		TopK:       req.TopK,
		LibraryIDs: req.LibraryIDs,
		FileIDs:    req.FileIDs,
		ChunkTypes: req.ChunkTypes,
	}

	// 执行搜索（传入userID用于保存查询记录）
	searchResponse, err := searchService.Search(eid, searchReq, &userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 转换响应
	response := SearchKnowledgeResponse{
		Results: searchResponse.Results,
		Total:   searchResponse.Total,
		Time:    searchResponse.Time,
		Type:    searchResponse.Type,
		QueryID: searchResponse.QueryID,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// SearchKnowledgeRequest 知识库搜索请求
type SearchKnowledgeRequest struct {
	Query      string   `json:"query" binding:"required" example:"人工智能"`
	SearchType string   `json:"search_type" example:"hybrid"`
	TopK       int      `json:"top_k" example:"10"`
	LibraryIDs []int64  `json:"library_ids,omitempty"`
	FileIDs    []int64  `json:"file_ids,omitempty"`
	ChunkTypes []string `json:"chunk_types,omitempty"`
}

// SearchKnowledgeResponse 知识库搜索响应
type SearchKnowledgeResponse struct {
	Results []rag.SearchResultItem `json:"results"`
	Total   int                    `json:"total"`
	Time    int64                  `json:"time_ms"`
	Type    string                 `json:"search_type"`
	QueryID *int64                 `json:"query_id,omitempty"` // 查询记录ID（仅在save_query=true时返回）
}

// GetRAGConfig godoc
// @Summary 获取RAG配置
// @Description 获取当前的RAG配置信息
// @Tags RAG问答
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id query int false "知识库ID"
// @Success 200 {object} model.CommonResponse{data=RAGConfigResponse} "获取成功"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/config [get]
func (ctrl *RAGQAController) GetRAGConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析查询参数
	var libraryID *int64
	if libraryIDStr := c.Query("library_id"); libraryIDStr != "" {
		if id, err := strconv.ParseInt(libraryIDStr, 10, 64); err == nil {
			libraryID = &id
		}
	}

	// 获取配置
	configService := rag.NewChunkConfigService(model.DB)
	config, err := configService.GetConfig(eid, libraryID, model.ChunkTypeDefault)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	response := RAGConfigResponse{
		Config: config,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// RAGConfigResponse RAG配置响应
type RAGConfigResponse struct {
	Config *rag.ChunkConfig `json:"config"`
}

// GetRAGStats godoc
// @Summary 获取RAG统计信息
// @Description 获取RAG系统的统计信息
// @Tags RAG问答
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id query int false "知识库ID"
// @Success 200 {object} model.CommonResponse{data=RAGStatsResponse} "获取成功"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/stats [get]
func (ctrl *RAGQAController) GetRAGStats(c *gin.Context) {
	// eid := config.GetEID(c)

	// // 解析查询参数
	// var libraryID *int64
	// if libraryIDStr := c.Query("library_id"); libraryIDStr != "" {
	// 	if id, err := strconv.ParseInt(libraryIDStr, 10, 64); err == nil {
	// 		libraryID = &id
	// 	}
	// }

	// 获取统计信息（简化实现）
	stats := RAGStatsResponse{
		TotalDocuments:     100, // 示例数据
		TotalChunks:        1500,
		EmbeddedChunks:     1200,
		TotalConversations: 50,
		TotalQuestions:     200,
		AvgResponseTime:    1200,
		SuccessRate:        0.95,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(stats))
}

// RAGStatsResponse RAG统计响应
type RAGStatsResponse struct {
	TotalDocuments     int64   `json:"total_documents"`
	TotalChunks        int64   `json:"total_chunks"`
	EmbeddedChunks     int64   `json:"embedded_chunks"`
	TotalConversations int64   `json:"total_conversations"`
	TotalQuestions     int64   `json:"total_questions"`
	AvgResponseTime    int64   `json:"avg_response_time_ms"`
	SuccessRate        float64 `json:"success_rate"`
}
