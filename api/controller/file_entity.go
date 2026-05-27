package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AddEntityRequest struct {
	Type string `json:"type" binding:"required"`
	Name string `json:"name" binding:"required"`
}

// AddEntityToFile godoc
// @Summary 添加实体到文件
// @Description 为指定文件添加实体关联。如果实体不存在则创建。允许自定义 Type。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param request body AddEntityRequest true "实体信息"
// @Success 200 {object} model.CommonResponse{data=map[string]interface{}}
// @Router /api/files/{file_id}/entities [post]
func AddEntityToFile(c *gin.Context) {
	eid := config.GetEID(c)
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	var req AddEntityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	req.Type = strings.TrimSpace(req.Type)
	req.Name = strings.TrimSpace(req.Name)
	if req.Type == "" || req.Name == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("实体类型和名称不能为空")))
		return
	}

	var createdEntity *model.Entity
	shouldIndex := false

	// 使用事务保证一致性
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		// 1. 获取文件信息
		var file model.File
		if err := tx.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("文件不存在")
			}
			return err
		}

		// 2. 获取库和空间信息
		var library model.Library
		if err := tx.Where("eid = ? AND id = ?", eid, file.LibraryID).First(&library).Error; err != nil {
			return errors.New("关联的知识库不存在")
		}

		// 3. 获取/创建实体
		entity, created, err := model.GetOrCreateEntityWithDBAndCreated(tx, eid, req.Type, req.Name)
		if err != nil {
			return err
		}
		if created {
			createdEntity = entity
			shouldIndex = true
		}

		// 4. 创建关联
		relation := &model.EntityChunkRelation{
			Eid:        eid,
			EntityID:   entity.ID,
			SpaceID:    library.SpaceID,
			LibraryID:  file.LibraryID,
			FileID:     file.ID,
			ChunkID:    0, // 文件级关联，ChunkID 为 0
			ChunkType:  "knowledge",
			Status:     model.EntityRelationStatusActive,
			Confidence: 1.0,
			Source:     model.EntityRelationSourceManual,
		}

		// 检查关联是否已存在
		var existing model.EntityChunkRelation
		err = tx.Where("eid = ? AND entity_id = ? AND file_id = ? AND chunk_id = 0", eid, entity.ID, file.ID).First(&existing).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.Create(relation).Error; err != nil {
					return err
				}
			} else {
				return err
			}
		} else {
			// 如果已存在但状态不是 active，更新为 active
			if existing.Status != model.EntityRelationStatusActive {
				existing.Status = model.EntityRelationStatusActive
				if err := tx.Save(&existing).Error; err != nil {
					return err
				}
			}
		}

		return nil
	})

	if err != nil {
		if err.Error() == "文件不存在" {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		} else {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		}
		return
	}

	if shouldIndex && createdEntity != nil {
		go func(e *model.Entity, enterpriseID int64) {
			svc := rag.NewEntityVectorService(model.DB)
			_ = svc.IndexEntity(enterpriseID, e)
		}(createdEntity, eid)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{"message": "添加成功"}))
}

// RemoveEntityFromFile godoc
// @Summary 从文件移除实体
// @Description 解除文件与实体的关联。如果实体没有其他关联，则删除实体。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param type query string true "实体类型"
// @Param name query string true "实体名称"
// @Success 200 {object} model.CommonResponse{data=map[string]interface{}}
// @Router /api/files/{file_id}/entities [delete]
func RemoveEntityFromFile(c *gin.Context) {
	eid := config.GetEID(c)
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	entityType := strings.TrimSpace(c.Query("type"))
	entityName := strings.TrimSpace(c.Query("name"))
	if entityType == "" || entityName == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("实体类型和名称不能为空")))
		return
	}

	err = model.DB.Transaction(func(tx *gorm.DB) error {
		// 1. 查找实体
		var entity model.Entity
		if err := tx.Where("eid = ? AND type = ? AND name = ?", eid, entityType, entityName).First(&entity).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("实体不存在")
			}
			return err
		}

		// 2. 删除关联
		result := tx.Where("eid = ? AND entity_id = ? AND file_id = ?", eid, entity.ID, fileID).Delete(&model.EntityChunkRelation{})
		if result.Error != nil {
			return result.Error
		}

		// 3. 检查实体是否还有其他关联
		var count int64
		if err := tx.Model(&model.EntityChunkRelation{}).Where("eid = ? AND entity_id = ?", eid, entity.ID).Count(&count).Error; err != nil {
			return err
		}

		// 4. 如果没有关联，删除实体
		if count == 0 {
			if err := tx.Delete(&entity).Error; err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		if err.Error() == "实体不存在" {
			// 如果实体不存在，也算删除成功
			c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{"message": "移除成功"}))
		} else {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		}
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{"message": "移除成功"}))
}

// GetFileEntities godoc
// @Summary 获取文件关联的实体列表
// @Description 获取指定文件关联的所有实体列表
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=[]model.Entity}
// @Router /api/files/{file_id}/entities [get]
func GetFileEntities(c *gin.Context) {
	eid := config.GetEID(c)
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	var entities []model.Entity
	err = model.DB.Table("entities").
		Select("entities.*").
		Joins("JOIN entity_chunk_relations ON entity_chunk_relations.entity_id = entities.id").
		Where("entity_chunk_relations.eid = ? AND entity_chunk_relations.file_id = ? AND entity_chunk_relations.status = ?", eid, fileID, model.EntityRelationStatusActive).
		Group("entities.id").
		Find(&entities).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(entities))
}
