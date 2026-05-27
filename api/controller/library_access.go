package controller

import (
	"errors"
	"net/http"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

func requireLibraryPermission(c *gin.Context, eid int64, userID int64, libraryID int64, minPermission int, deniedMessage string) (*model.Library, bool) {
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库不存在")))
		return nil, false
	}

	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil || permission < minPermission {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New(deniedMessage)))
		return nil, false
	}

	return library, true
}

func requireFilePermission(c *gin.Context, eid int64, userID int64, fileID int64, minPermission int, deniedMessage string) (*model.File, bool) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件不存在")))
		return nil, false
	}

	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < minPermission {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New(deniedMessage)))
		return nil, false
	}

	return file, true
}
