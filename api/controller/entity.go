package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CreateEntityRequest struct {
	Type   string `json:"type" binding:"required"`
	Name   string `json:"name" binding:"required"`
	Status string `json:"status"`
}

type UpdateEntityRequest struct {
	Type   *string `json:"type"`
	Name   *string `json:"name"`
	Status *string `json:"status"`
}

type EntityListResponse struct {
	Items  []model.Entity `json:"items"`
	Total  int64          `json:"total"`
	Offset int            `json:"offset"`
	Limit  int            `json:"limit"`
}

type BatchLinkItem struct {
	ChunkID   int64  `json:"chunk_id"`
	FileID    int64  `json:"file_id"`
	LibraryID int64  `json:"library_id"`
	Type      string `json:"type" binding:"required"`
	Name      string `json:"name" binding:"required"`
}

type BatchLinkEntityRequest struct {
	Items []BatchLinkItem `json:"items" binding:"required,dive"`
}

type BatchLinkEntityResponse struct {
	SuccessCount int `json:"success_count"`
	FailureCount int `json:"failure_count"`
}

// BatchLinkEntities godoc
// @Summary 批量关联实体
// @Description 批量为分块/文件/知识库创建并关联实体。如果实体不存在则创建，如果关联已存在则跳过。
// @Tags 实体管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchLinkEntityRequest true "批量关联信息"
// @Success 200 {object} model.CommonResponse{data=BatchLinkEntityResponse}
// @Router /api/entities/batch-link [post]
func BatchLinkEntities(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	var req BatchLinkEntityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if len(req.Items) == 0 {
		c.JSON(http.StatusOK, model.Success.ToResponse(BatchLinkEntityResponse{0, 0}))
		return
	}

	chunkCache := make(map[int64]*model.DocumentChunk)
	fileCache := make(map[int64]*model.File)
	libraryCache := make(map[int64]*model.Library)
	successCount := 0
	failureCount := 0
	createdEntities := make(map[int64]*model.Entity)

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		for _, item := range req.Items {
			item.Type = strings.TrimSpace(item.Type)
			item.Name = strings.TrimSpace(item.Name)
			if item.Type == "" || item.Name == "" {
				failureCount++
				continue
			}
			if item.ChunkID <= 0 && item.FileID <= 0 && item.LibraryID <= 0 {
				failureCount++
				continue
			}

			// 1. 获取/创建实体
			entity, created, err := model.GetOrCreateEntityWithDBAndCreated(tx, eid, item.Type, item.Name)
			if err != nil {
				failureCount++
				continue
			}
			if created {
				createdEntities[entity.ID] = entity
			}

			var spaceID int64
			var chunkID int64
			var fileID int64
			var libraryID int64
			chunkType := "knowledge"

			switch {
			case item.ChunkID > 0:
				chunk, ok := chunkCache[item.ChunkID]
				if !ok {
					var err error
					chunk, err = model.GetDocumentChunkByID(eid, item.ChunkID)
					if err != nil {
						failureCount++
						continue
					}
					chunkCache[item.ChunkID] = chunk
				}
				chunkID = chunk.ID
				fileID = chunk.FileID
				libraryID = chunk.LibraryID
				chunkType = chunk.ChunkType
			case item.FileID > 0:
				file, ok := fileCache[item.FileID]
				if !ok {
					var fileModel model.File
					if err := tx.Where("eid = ? AND id = ?", eid, item.FileID).First(&fileModel).Error; err != nil {
						failureCount++
						continue
					}
					file = &fileModel
					fileCache[item.FileID] = file
				}
				chunkID = 0
				fileID = file.ID
				libraryID = file.LibraryID
				chunkType = "knowledge"
			default:
				lib, ok := libraryCache[item.LibraryID]
				if !ok {
					var libraryModel model.Library
					if err := tx.Where("eid = ? AND id = ?", eid, item.LibraryID).First(&libraryModel).Error; err != nil {
						failureCount++
						continue
					}
					lib = &libraryModel
					libraryCache[item.LibraryID] = lib
				}
				spaceID = lib.SpaceID
				chunkID = 0
				fileID = 0
				libraryID = lib.ID
				chunkType = "knowledge"
			}

			if spaceID <= 0 {
				lib, ok := libraryCache[libraryID]
				if !ok {
					var libraryModel model.Library
					if err := tx.Select("id", "space_id").Where("eid = ? AND id = ?", eid, libraryID).First(&libraryModel).Error; err != nil {
						failureCount++
						continue
					}
					lib = &libraryModel
					libraryCache[libraryID] = lib
				}
				spaceID = lib.SpaceID
			}

			// 2. 建立关联
			relation := &model.EntityChunkRelation{
				Eid:        eid,
				EntityID:   entity.ID,
				SpaceID:    spaceID,
				LibraryID:  libraryID,
				FileID:     fileID,
				ChunkID:    chunkID,
				ChunkType:  chunkType,
				Status:     model.EntityRelationStatusActive,
				Confidence: 1.0,
				Source:     model.EntityRelationSourceManual,
			}

			var existing model.EntityChunkRelation
			err = tx.Where("eid = ? AND entity_id = ? AND space_id = ? AND library_id = ? AND file_id = ? AND chunk_id = ?",
				eid, entity.ID, spaceID, libraryID, fileID, chunkID).
				First(&existing).Error
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					if err := tx.Create(relation).Error; err != nil {
						failureCount++
						continue
					}
				} else {
					failureCount++
					continue
				}
			} else {
				if err := tx.Model(&model.EntityChunkRelation{}).
					Where("id = ? AND eid = ?", existing.ID, eid).
					Updates(map[string]interface{}{
						"status":     model.EntityRelationStatusActive,
						"confidence": 1.0,
						"source":     model.EntityRelationSourceManual,
					}).Error; err != nil {
					failureCount++
					continue
				}
			}

			successCount++
		}
		return nil
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if len(createdEntities) > 0 {
		go func(enterpriseID int64, entities map[int64]*model.Entity) {
			svc := rag.NewEntityVectorService(model.DB)
			for _, e := range entities {
				_ = svc.IndexEntity(enterpriseID, e)
			}
		}(eid, createdEntities)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(BatchLinkEntityResponse{
		SuccessCount: successCount,
		FailureCount: failureCount,
	}))
}

// GetEntityTypes godoc
// @Summary 获取实体类型列表
// @Description 获取系统支持的所有实体类型及其描述
// @Tags 实体管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=map[string]string}
// @Router /api/entities/types [get]
func GetEntityTypes(c *gin.Context) {
	c.JSON(http.StatusOK, model.Success.ToResponse(model.GetAllEntityTypes()))
}

// ListEntities godoc
// @Summary 获取实体列表
// @Description 分页获取当前企业的实体列表，支持关键字和类型过滤
// @Tags 实体管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(20)
// @Param keyword query string false "名称搜索关键词"
// @Param type query string false "实体类型"
// @Param status query string false "状态"
// @Success 200 {object} model.CommonResponse{data=EntityListResponse}
// @Router /api/entities [get]
func ListEntities(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	offset, err := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if err != nil || offset < 0 {
		offset = 0
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if err != nil || limit <= 0 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}

	keyword := strings.TrimSpace(c.Query("keyword"))
	entityType := strings.TrimSpace(c.Query("type"))
	status := strings.TrimSpace(c.Query("status"))

	db := model.DB.Model(&model.Entity{}).Where("eid = ?", eid)
	if entityType != "" {
		db = db.Where("type = ?", entityType)
	}
	if status != "" {
		db = db.Where("status = ?", status)
	}
	if keyword != "" {
		svc := rag.NewEntityVectorService(model.DB)
		ids, err := svc.SearchEntities(eid, keyword, offset+limit)
		if err == nil && len(ids) > 0 {
			var filtered []model.Entity
			q := model.DB.Model(&model.Entity{}).Where("eid = ?", eid).Where("id IN ?", ids)
			if entityType != "" {
				q = q.Where("type = ?", entityType)
			}
			if status != "" {
				q = q.Where("status = ?", status)
			}
			if err := q.Find(&filtered).Error; err != nil {
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
				return
			}
			index := make(map[int64]*model.Entity, len(filtered))
			for i := range filtered {
				index[filtered[i].ID] = &filtered[i]
			}
			var ordered []model.Entity
			for _, id := range ids {
				if e := index[id]; e != nil {
					ordered = append(ordered, *e)
				}
			}
			total := int64(len(ordered))
			start := offset
			if start < 0 {
				start = 0
			}
			if start > len(ordered) {
				start = len(ordered)
			}
			end := start + limit
			if end > len(ordered) {
				end = len(ordered)
			}
			items := ordered[start:end]
			c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
				"items":  items,
				"total":  total,
				"offset": offset,
				"limit":  limit,
			}))
			return
		} else {
			db = db.Where("name LIKE ?", "%"+keyword+"%")
		}
	}

	var total int64
	if err := db.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var entities []model.Entity
	if err := db.Order("updated_time desc").Offset(offset).Limit(limit).Find(&entities).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"items":  entities,
		"total":  total,
		"offset": offset,
		"limit":  limit,
	}))
}

// GetEntity godoc
// @Summary 获取实体详情
// @Description 根据 ID 获取实体的详细信息
// @Tags 实体管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "实体 ID"
// @Success 200 {object} model.CommonResponse{data=model.Entity}
// @Failure 404 {object} model.CommonResponse
// @Router /api/entities/{id} [get]
func GetEntity(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	id, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	var entity model.Entity
	if err := model.DB.Where("eid = ? AND id = ?", eid, id).First(&entity).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("实体不存在")))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(entity))
}

// CreateEntity godoc
// @Summary 创建实体
// @Description 手动创建一个新的实体
// @Tags 实体管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateEntityRequest true "实体信息"
// @Success 200 {object} model.CommonResponse{data=model.Entity}
// @Failure 409 {object} model.CommonResponse
// @Router /api/entities [post]
func CreateEntity(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	var req CreateEntityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	req.Type = strings.TrimSpace(req.Type)
	req.Name = strings.TrimSpace(req.Name)
	req.Status = strings.TrimSpace(req.Status)
	if req.Type == "" || req.Name == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("type 或 name 不能为空")))
		return
	}

	status := req.Status
	if status == "" {
		status = "active"
	}

	entity := &model.Entity{
		Eid:    eid,
		Type:   req.Type,
		Name:   req.Name,
		Status: status,
	}

	if err := model.DB.Create(entity).Error; err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") || strings.Contains(strings.ToLower(err.Error()), "unique") {
			c.JSON(http.StatusConflict, model.RecordAlreadyExists.ToNewErrorResponse("实体已存在"))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(entity))

	// 异步更新向量库
	go func(e model.Entity, enterpriseID int64) {
		svc := rag.NewEntityVectorService(model.DB)
		_ = svc.IndexEntity(enterpriseID, &e)
	}(*entity, eid)
}

// UpdateEntity godoc
// @Summary 更新实体
// @Description 更新现有实体的详细信息
// @Tags 实体管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "实体 ID"
// @Param request body UpdateEntityRequest true "更新字段"
// @Success 200 {object} model.CommonResponse{data=model.Entity}
// @Failure 404 {object} model.CommonResponse
// @Failure 409 {object} model.CommonResponse
// @Router /api/entities/{id} [put]
func UpdateEntity(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	id, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	var req UpdateEntityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Type == nil && req.Name == nil && req.Status == nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无可更新字段")))
		return
	}

	var entity model.Entity
	if err := model.DB.Where("eid = ? AND id = ?", eid, id).First(&entity).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("实体不存在")))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	nextType := entity.Type
	nextName := entity.Name
	nextStatus := entity.Status
	if req.Type != nil {
		nextType = strings.TrimSpace(*req.Type)
	}
	if req.Name != nil {
		nextName = strings.TrimSpace(*req.Name)
	}
	if req.Status != nil {
		nextStatus = strings.TrimSpace(*req.Status)
	}
	if nextType == "" || nextName == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("type 或 name 不能为空")))
		return
	}
	if nextStatus == "" {
		nextStatus = "active"
	}

	var dupCount int64
	if err := model.DB.Model(&model.Entity{}).
		Where("eid = ? AND id <> ? AND type = ? AND name = ?", eid, entity.ID, nextType, nextName).
		Count(&dupCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	if dupCount > 0 {
		c.JSON(http.StatusConflict, model.RecordAlreadyExists.ToNewErrorResponse("实体已存在"))
		return
	}

	if err := model.DB.Model(&entity).Where("eid = ? AND id = ?", eid, id).Updates(map[string]interface{}{
		"type":   nextType,
		"name":   nextName,
		"status": nextStatus,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if err := model.DB.Where("eid = ? AND id = ?", eid, id).First(&entity).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(entity))

	// 异步更新向量库
	go func(e model.Entity, enterpriseID int64) {
		svc := rag.NewEntityVectorService(model.DB)
		_ = svc.IndexEntity(enterpriseID, &e)
	}(entity, eid)
}

// DeleteEntity godoc
// @Summary 删除实体
// @Description 删除实体及其所有的知识切片关联关系
// @Tags 实体管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "实体 ID"
// @Success 200 {object} model.CommonResponse{data=bool}
// @Failure 404 {object} model.CommonResponse
// @Router /api/entities/{id} [delete]
func DeleteEntity(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	id, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var entity model.Entity
		if err := tx.Where("eid = ? AND id = ?", eid, id).First(&entity).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND entity_id = ?", eid, id).Delete(&model.EntityChunkRelation{}).Error; err != nil {
			return err
		}
		return tx.Where("eid = ? AND id = ?", eid, id).Delete(&model.Entity{}).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("实体不存在")))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(true))
}

// SearchEntityFilesRequest 实体向量库搜索请求
type SearchEntityFilesRequest struct {
	Name string `form:"name" binding:"required"`
	TopK int    `form:"top_k" default:"10"`
}

// SearchEntityFiles godoc
// @Summary 根据实体名称搜索文件
// @Description 根据实体名称在向量库中检索，返回命中的实体信息、分数及关联的文件ID列表
// @Tags 实体管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param name query string true "实体名称"
// @Param top_k query int false "返回结果数量" default(10)
// @Success 200 {object} model.CommonResponse{data=[]rag.EntitySearchHit}
// @Router /api/entities/search-files [get]
func SearchEntityFiles(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}

	var req SearchEntityFilesRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := rag.NewEntityVectorService(model.DB)
	hits, err := svc.SearchEntityFiles(eid, req.Name, req.TopK)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(hits))
}
