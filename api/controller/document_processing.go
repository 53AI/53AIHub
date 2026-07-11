package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type GenerateQuestionsSummaryAndEntitiesMigrationRequest struct {
	FileID    int64 `json:"file_id" example:"0"`
	LibraryID int64 `json:"library_id" example:"0"`
	SpaceID   int64 `json:"space_id" example:"0"`
	Batch     int   `json:"batch" example:"100"`
	Force     bool  `json:"force" example:"false"`
}

type GenerateQuestionsSummaryAndEntitiesMigrationResponse struct {
	Total   int `json:"total"`
	Success int `json:"success"`
	Failed  int `json:"failed"`
}

// ReindexDocument godoc
// @Summary 重新索引文档
// @Description 根据现有分块和配置重新生成检索块，不影响原有分块
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body ReindexDocumentRequest true "重新索引请求"
// @Success 200 {object} model.CommonResponse "成功重新索引文档"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/reindex [post]
func ReindexDocument(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req ReindexDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Mode == "" {
		req.Mode = "reindex_retrieval"
	}

	// 使用统一的服务管理器
	serviceManager := service.GetServiceManager()
	if serviceManager == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("服务管理器未初始化"))
		return
	}

	// 检查文档是否被锁定
	if serviceManager.IsDocumentLocked(eid, req.FileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，无法重新索引",
		})
		return
	}

	// 执行重新索引（支持两种模式）
	err := serviceManager.ReindexDocument(eid, req.FileID, req.Mode, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 根据模式返回不同的成功消息
	var message string
	switch req.Mode {
	case "rechunk_and_reindex":
		message = "文档重新分块和索引成功"
	case "reindex_retrieval":
		fallthrough
	default:
		message = "文档重新索引成功"
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(message))
}

// GenerateQuestionsSummaryAndEntitiesMigration godoc
// @Summary 迁移生成问答、摘要与实体
// @Description 对指定文件/知识库/空间批量生成问答、摘要并抽取实体，支持 force 强制重新生成；后台异步执行，单次最多并发3个文件
// @Tags RAG迁移
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body GenerateQuestionsSummaryAndEntitiesMigrationRequest true "迁移请求"
// @Success 200 {object} model.CommonResponse "已提交后台任务"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "对象不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/migrate/questions-summary-entities [post]
func GenerateQuestionsSummaryAndEntitiesMigration(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req GenerateQuestionsSummaryAndEntitiesMigrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Batch == 0 {
		req.Batch = 100
	}
	if req.Batch < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("batch 不能小于 0"))
		return
	}

	scopeCount := 0
	if req.FileID > 0 {
		scopeCount++
	}
	if req.LibraryID > 0 {
		scopeCount++
	}
	if req.SpaceID > 0 {
		scopeCount++
	}
	if scopeCount != 1 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("必须且只能指定一个范围：file_id / library_id / space_id"))
		return
	}

	runForFileID := func(fileID int64) error {
		// var oldEntityIDs []int64
		if req.Force {
			// 如果强制重新生成，先将状态重置为 pending，以便流水线重新处理
			if err := model.UpdateFileAIGenerateSQStatus(fileID, model.AIGenerateSQStatusPending); err != nil {
				return fmt.Errorf("重置文件状态失败: %v", err)
			}

			// 注意：旧实体清理逻辑在此处暂时无法执行，因为任务转为异步执行。
			// 实体关系将在 ExtractEntitiesStep 中被替换。
			// 孤儿实体的清理可能需要另外的定时任务处理。
			/*
				if err := model.DB.Model(&model.EntityChunkRelation{}).
					Distinct("entity_id").
					Where("eid = ? AND file_id = ? AND source IN ?", eid, fileID, []string{model.EntityRelationSourceAutoLLM, model.EntityRelationSourceAutoMeta}).
					Pluck("entity_id", &oldEntityIDs).Error; err != nil {
					return fmt.Errorf("查询旧实体失败: %v", err)
				}
			*/
		}

		step := steps.NewTriggerGenerateQuestionsAndSummaryStep(model.DB)
		step.SetJob(&model.RagJob{Eid: eid})
		step.SetStep(&model.RagJobStep{
			Eid:       eid,
			StepOrder: 1,
			Status:    model.RagJobStepStatusPending,
		})
		if err := step.Execute(steps.TriggerGenerateQuestionsAndSummaryParameters{
			Eid:      eid,
			FileID:   fileID,
			UserID:   userID,
			Metadata: "migration",
		}); err != nil {
			return err
		}

		/*
			if req.Force && len(oldEntityIDs) > 0 {
				if err := model.DeleteOrphanEntitiesByIDsWithDB(model.DB, eid, oldEntityIDs); err != nil {
					return fmt.Errorf("清理旧实体失败: %v", err)
				}
			}
		*/
		return nil
	}

	const maxConcurrentFiles = 3
	startAsync := func(produce func(ctx context.Context, enqueue func(fileID int64) bool) error) {
		go func() {
			ctx := context.Background()
			var total int64
			var success int64
			var failed int64

			workCh := make(chan int64, maxConcurrentFiles*2)
			var workersWG sync.WaitGroup

			worker := func() {
				defer workersWG.Done()
				for fileID := range workCh {
					if err := runForFileID(fileID); err != nil {
						atomic.AddInt64(&failed, 1)
						logger.Errorf(ctx, "后台生成问答、摘要与实体失败: eid=%d file_id=%d err=%v", eid, fileID, err)
					} else {
						atomic.AddInt64(&success, 1)
					}
					done := atomic.LoadInt64(&success) + atomic.LoadInt64(&failed)
					t := atomic.LoadInt64(&total)
					logger.SysLogf("后台生成问答、摘要与实体进度: eid=%d, 已完成=%d, 剩余=%d, 总数=%d", eid, done, t-done, t)
				}
			}

			for i := 0; i < maxConcurrentFiles; i++ {
				workersWG.Add(1)
				go worker()
			}

			enqueue := func(fileID int64) bool {
				if fileID <= 0 {
					return false
				}
				atomic.AddInt64(&total, 1)
				workCh <- fileID
				return true
			}

			if err := produce(ctx, enqueue); err != nil {
				logger.Errorf(ctx, "后台生成问答、摘要与实体任务初始化失败: eid=%d err=%v", eid, err)
			}

			close(workCh)
			workersWG.Wait()
			logger.SysLogf("后台生成问答、摘要与实体完成: eid=%d total=%d success=%d failed=%d", eid, total, success, failed)
		}()
	}

	if req.FileID > 0 {
		var file model.File
		if err := model.DB.Where("eid = ? AND id = ? AND type = ? AND is_deleted = ?", eid, req.FileID, model.FILE_TYPE_FILE, false).First(&file).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, model.NotFound.ToResponse("文件不存在"))
				return
			}
			logger.Errorf(c.Request.Context(), "查询文件失败: eid=%d file_id=%d err=%v", eid, req.FileID, err)
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}

		logger.SysLogf("提交后台生成问答、摘要与实体任务: eid=%d file_id=%d force=%v", eid, file.ID, req.Force)
		startAsync(func(ctx context.Context, enqueue func(fileID int64) bool) error {
			enqueue(file.ID)
			return nil
		})
		c.JSON(http.StatusOK, model.Success.ToResponse("已提交后台任务"))
		return
	}

	if req.LibraryID > 0 {
		if _, err := model.GetLibraryByID(eid, req.LibraryID); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, model.NotFound.ToResponse("知识库不存在"))
				return
			}
			logger.Errorf(c.Request.Context(), "查询知识库失败: eid=%d library_id=%d err=%v", eid, req.LibraryID, err)
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}

		logger.SysLogf("提交后台生成问答、摘要与实体任务: eid=%d library_id=%d batch=%d force=%v", eid, req.LibraryID, req.Batch, req.Force)
		startAsync(func(ctx context.Context, enqueue func(fileID int64) bool) error {
			offset := 0
			for {
				var fileIDs []int64
				if err := model.DB.Model(&model.File{}).
					Select("id").
					Where("eid = ? AND library_id = ? AND type = ? AND is_deleted = ?", eid, req.LibraryID, model.FILE_TYPE_FILE, false).
					Order("id asc").
					Offset(offset).
					Limit(req.Batch).
					Pluck("id", &fileIDs).Error; err != nil {
					return err
				}
				if len(fileIDs) == 0 {
					break
				}
				for _, fid := range fileIDs {
					enqueue(fid)
				}
				offset += len(fileIDs)
			}
			return nil
		})
		c.JSON(http.StatusOK, model.Success.ToResponse("已提交后台任务"))
		return
	}

	space, err := model.GetSpaceByID(eid, req.SpaceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse("空间不存在"))
			return
		}
		logger.Errorf(c.Request.Context(), "查询空间失败: eid=%d space_id=%d err=%v", eid, req.SpaceID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	libraries, err := model.GetLibrariesBySpaceID(eid, space.ID)
	if err != nil {
		logger.Errorf(c.Request.Context(), "查询空间知识库列表失败: eid=%d space_id=%d err=%v", eid, req.SpaceID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	logger.SysLogf("提交后台生成问答、摘要与实体任务: eid=%d space_id=%d libraries=%d batch=%d force=%v", eid, req.SpaceID, len(libraries), req.Batch, req.Force)
	startAsync(func(ctx context.Context, enqueue func(fileID int64) bool) error {
		for _, lib := range libraries {
			offset := 0
			for {
				var fileIDs []int64
				if err := model.DB.Model(&model.File{}).
					Select("id").
					Where("eid = ? AND library_id = ? AND type = ? AND is_deleted = ?", eid, lib.ID, model.FILE_TYPE_FILE, false).
					Order("id asc").
					Offset(offset).
					Limit(req.Batch).
					Pluck("id", &fileIDs).Error; err != nil {
					return err
				}
				if len(fileIDs) == 0 {
					break
				}
				for _, fid := range fileIDs {
					enqueue(fid)
				}
				offset += len(fileIDs)
			}
		}
		return nil
	})
	c.JSON(http.StatusOK, model.Success.ToResponse("已提交后台任务"))
}

// PreviewChunking 预览文档分块
// @Summary 预览文档分块
// @Description 传入文档ID和拆分规则，返回文档的预览分块结果，不会保存到数据库
// @Tags 分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body PreviewChunkingRequest true "预览分块请求"
// @Success 200 {object} PreviewChunkingResponse "预览分块响应"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/chunks/preview [post]
func PreviewChunking(c *gin.Context) {
	eid := config.GetEID(c)

	var req PreviewChunkingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	req.ChunkingConfig.KnowledgeChunk.ResetBySystemDefault()
	req.ChunkingConfig.IndexChunk.ResetBySystemDefault()

	// 获取文件信息
	var file model.File
	err := model.DB.Where("eid = ? AND id = ?", eid, req.FileID).First(&file).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse("文件不存在"))
		} else {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		}
		return
	}

	// 获取文件内容
	var fileBody model.FileBody
	err = model.DB.Where("file_id = ?", req.FileID).Last(&fileBody).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse("文件内容不存在"))
		} else {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		}
		return
	}
	content, err := fileBody.GetContent()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 创建分块服务
	chunkerService := rag.NewChunkerService(model.DB)

	// 根据ChunkType选择分块策略
	var result *rag.ChunkResult
	var configId int64
	var chunkConfig *rag.ChunkConfig
	if req.ChunkingConfig.Type == "" || req.ChunkingConfig.Type == model.ChunkTypeDefault {
		// 执行预览分块（直接使用配置进行分块，不保存到数据库）
		result, err = chunkerService.PreviewChunkingWithConfig(eid, req.FileID, content, &req.ChunkingConfig)
	} else {
		// 使用指定的分块类型进行分块
		configService := rag.NewChunkConfigService(model.DB)
		chunkConfig, err = configService.GetConfigByType(0, req.ChunkingConfig.Type)
		if err != nil {
			fmt.Printf("获取指定分块配置失败: %v\n", err)
		}
		configId = chunkConfig.ID
		result, err = chunkerService.ChunkDocument(eid, req.FileID, content, &configId)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Sprintf("预览分块失败: %v", err)))
		return
	}

	// 转换为响应格式
	var previewChunks []PreviewChunkInfo
	retrievalService := rag.NewRetrievalChunkService(model.DB)

	// 准备分块配置用于生成检索块

	if req.ChunkingConfig.Type == "" || req.ChunkingConfig.Type == model.ChunkTypeDefault {
		// 使用请求中的分块配置创建ChunkConfig对象
		chunkConfig = &rag.ChunkConfig{
			KnowledgeChunk: req.ChunkingConfig.KnowledgeChunk,
			IndexChunk:     req.ChunkingConfig.IndexChunk,
		}
		// 设置默认值
		chunkConfig.KnowledgeChunk.ResetBySystemDefault()
		chunkConfig.IndexChunk.ResetBySystemDefault()
	}

	for _, chunk := range result.Chunks {
		previewChunk := PreviewChunkInfo{
			Index:      chunk.Index,
			Type:       chunk.Type,
			Content:    chunk.Content,
			TokenCount: chunk.TokenCount,
			StartPos:   chunk.StartPos,
			EndPos:     chunk.EndPos,
		}

		// 生成检索块预览数据
		if chunkConfig != nil {
			// 创建模拟的DocumentChunk对象用于生成检索块
			docChunk := &model.DocumentChunk{
				Content:   chunk.Content,
				FileID:    req.FileID,
				LibraryID: file.LibraryID,
			}

			// 只预览检索块，不保存到数据库
			retrievalChunks := retrievalService.CreateRetrievalChunksForPreview(eid, docChunk, chunkConfig)

			// 转换为预览格式
			var previewRetrievalChunks []PreviewRetrievalChunkInfo
			for j, retrievalChunk := range retrievalChunks {
				previewRetrievalChunks = append(previewRetrievalChunks, PreviewRetrievalChunkInfo{
					KnowledgeChunkIndex: chunk.Index,
					Index:               j,
					Type:                retrievalChunk.Type,
					Content:             retrievalChunk.Content,
					TokenCount:          retrievalChunk.TokenCount,
				})
			}
			previewChunk.RetrievalChunks = previewRetrievalChunks
		}

		previewChunks = append(previewChunks, previewChunk)
	}

	// 转换元数据
	averageTokens := 0
	if result.Metadata.TotalChunks > 0 {
		averageTokens = result.Metadata.TotalTokens / result.Metadata.TotalChunks
	}

	metadata := ChunkMetadata{
		TotalChunks:    result.Metadata.TotalChunks,
		TotalTokens:    result.Metadata.TotalTokens,
		AverageTokens:  averageTokens,
		ProcessingTime: result.Metadata.ProcessingTime,
		ConfigUsed:     "preview", // 预览模式
	}

	if previewChunks == nil {
		previewChunks = make([]PreviewChunkInfo, 0)
	}
	response := PreviewChunkingResponse{
		Chunks:   previewChunks,
		Metadata: metadata,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}
