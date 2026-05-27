package controller

import (
	"net/http"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// ExternalKnowledgeRequest Dify外部知识库请求
type ExternalKnowledgeRequest struct {
	KnowledgeID       string                   `json:"knowledge_id" binding:"required" example:"knowledge_123"`
	Query             string                   `json:"query" binding:"required" example:"什么是人工智能"`
	RetrievalSetting  RetrievalSetting         `json:"retrieval_setting" binding:"required"`
	MetadataCondition *MetadataConditionFilter `json:"metadata_condition,omitempty"`
}

// RetrievalSetting 检索设置
type RetrievalSetting struct {
	TopK           int     `json:"top_k" example:"3"`
	ScoreThreshold float64 `json:"score_threshold" example:"0.5"`
}

// MetadataConditionFilter 元数据条件筛选
type MetadataConditionFilter struct {
	LogicalOperator string              `json:"logical_operator,omitempty" example:"and"`
	Conditions      []MetadataCondition `json:"conditions" binding:"required"`
}

// MetadataCondition 元数据条件
type MetadataCondition struct {
	Name               []string `json:"name" binding:"required" example:"file_id"`
	ComparisonOperator string   `json:"comparison_operator" binding:"required" example:"equal"`
	Value              string   `json:"value,omitempty" example:"file_123"`
}

// ExternalKnowledgeResponse Dify外部知识库响应
type ExternalKnowledgeResponse struct {
	Records []ExternalKnowledgeRecord `json:"records"`
}

// ExternalKnowledgeRecord Dify外部知识库记录
type ExternalKnowledgeRecord struct {
	Content  string                 `json:"content" example:"人工智能是计算机科学的一个分支..."`
	Score    float64                `json:"score" example:"0.85"`
	Title    string                 `json:"title" example:"人工智能简介"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// ExternalKnowledgeErrorResponse 外部知识库错误响应
type ExternalKnowledgeErrorResponse struct {
	ErrorCode int    `json:"error_code" example:"400"`
	ErrorMsg  string `json:"error_msg" example:"参数错误: missing required field"`
}

// ExternalKnowledgeController 外部知识库控制器
type ExternalKnowledgeController struct {
	searchService        *rag.SearchService
	librarySearchService *rag.LibrarySearchService
}

// NewExternalKnowledgeController 创建外部知识库控制器
func NewExternalKnowledgeController() *ExternalKnowledgeController {
	return &ExternalKnowledgeController{
		searchService:        rag.NewSearchService(model.DB),
		librarySearchService: rag.NewLibrarySearchService(model.DB),
	}
}

// Retrieval 处理外部知识库检索请求
// @Summary 外部知识库检索
// @Description 通过API密钥认证访问外部知识库进行检索
// @Tags 外部知识库
// @Accept json
// @Produce json
// @Security ExternalAPIKeyAuth
// @Param request body ExternalKnowledgeRequest true "外部知识库检索请求"
// @Success 200 {object} ExternalKnowledgeResponse "成功检索知识库"
// @Failure 400 {object} ExternalKnowledgeErrorResponse "参数错误"
// @Failure 401 {object} ExternalKnowledgeErrorResponse "未授权访问"
// @Failure 500 {object} ExternalKnowledgeErrorResponse "服务器内部错误"
// @Router /api/external-knowledge/retrieval [post]
func (ctrl *ExternalKnowledgeController) Retrieval(c *gin.Context) {
	startTime := time.Now()

	// 记录请求开始
	logger.SysLogf("外部知识库检索请求开始 - Method: %s, Path: %s", c.Request.Method, c.Request.URL.Path)

	// 解析请求体
	var req ExternalKnowledgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logger.SysLogf("外部知识库检索参数解析失败 - Error: %s", err.Error())
		c.JSON(http.StatusBadRequest, gin.H{
			"error_code": 400,
			"error_msg":  "参数错误: " + err.Error(),
		})
		return
	}

	// 设置默认值
	if req.RetrievalSetting.TopK <= 0 {
		req.RetrievalSetting.TopK = 10
	}
	// ScoreThreshold为0时表示不限制分数，保持为0即可

	// 记录检索参数
	logger.SysLogf("外部知识库检索参数 - KnowledgeID: %s, TopK: %d, ScoreThreshold: %f",
		req.KnowledgeID, req.RetrievalSetting.TopK, req.RetrievalSetting.ScoreThreshold)

	// 获取企业ID（从API密钥认证中间件中解析）
	eid := c.GetInt64("eid")
	if eid == 0 {
		// 如果没有通过API密钥认证，使用默认配置
		eid = config.GetEID(c)
		if eid == 0 {
			eid = 1
		}
	}

	// 从 KnowledgeID 获取 library
	library, err := model.GetLibraryByUUID(eid, req.KnowledgeID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error_code": 400,
			"error_msg":  "参数错误: 无效的 knowledge_id",
		})
		return
	}

	// 检查上下文中的 library_id 与通过 KnowledgeID 获取的 library ID 是否匹配
	if libraryIDValue, exists := c.Get("library_id"); exists {
		libraryID, ok := libraryIDValue.(int64)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error_code": 500,
				"error_msg":  "服务器内部错误: library_id 类型不正确",
			})
			return
		}
		if library.ID != libraryID {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error_code": 401,
				"error_msg":  "未授权访问: API key 与请求的知识库不匹配",
			})
			return
		}
	}

	// 构建 LibrarySearchParams
	searchParams := &rag.LibrarySearchParams{
		EID:       eid,
		UserID:    0, // 外部API调用，使用0表示系统调用
		LibraryID: library.ID,
		Query:     req.Query,
		SearchConfig: &model.SearchConfigData{
			TopK:                  req.RetrievalSetting.TopK,
			ScoreThreshold:        req.RetrievalSetting.ScoreThreshold,
			ScoreThresholdEnabled: true,
			Vector:                true,
			Fulltext:              false,
			Hybrid:                false,
		},
	}

	// 执行搜索
	searchResult, err := ctrl.librarySearchService.Search(c.Request.Context(), searchParams)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error_code": 500,
			"error_msg":  "服务器内部错误: " + err.Error(),
		})
		return
	}

	// 转换结果格式
	var records []ExternalKnowledgeRecord
	for _, result := range searchResult.Results {
		// 获取文件信息以填充标题和元数据
		var title string
		metadata := map[string]interface{}{
			"chunk_id":   result.ChunkID,
			"file_id":    result.FileID,
			"library_id": result.LibraryID,
		}

		// 获取文件信息
		if result.FileID > 0 {
			file, err := model.GetFileByID(eid, result.FileID)
			if err == nil {
				// 使用文件路径作为标题
				title = file.Path
				// 在元数据中添加文件路径
				metadata["path"] = file.Path
			}
		}

		// 如果无法获取文件路径，使用默认标题
		if title == "" {
			title = result.FileName
			if title == "" {
				title = "unknown"
			}
		}

		record := ExternalKnowledgeRecord{
			Content:  result.Content,
			Score:    result.Score,
			Title:    title,
			Metadata: metadata,
		}
		records = append(records, record)
	}

	// 如果没有任何记录，确保返回空数组而非 null
	if records == nil {
		records = []ExternalKnowledgeRecord{}
	}

	// 限制内容长度（Dify建议不超过4000字符）
	// for i := range records {
	// 	if len(records[i].Content) > 4000 {
	// 		records[i].Content = records[i].Content[:4000]
	// 	}
	// }

	response := ExternalKnowledgeResponse{
		Records: records,
	}

	// 检查处理时间是否超过5秒
	processingTime := time.Since(startTime)
	if processingTime > 5*time.Second {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error_code": 500,
			"error_msg":  "服务器内部错误: 检索超时",
		})
		return
	}

	c.JSON(http.StatusOK, response)
}
