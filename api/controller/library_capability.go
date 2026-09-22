package controller

import (
	"errors"
	"net/http"

	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetLibraryCapabilities godoc
// @Summary 获取知识库能力
// @Description 判断当前用户是否在知识库下拥有至少一个可管理语料的文件或文件夹
// @Tags 知识库管理
// @Produce json
// @Security BearerAuth
// @Param library_id path string true "知识库ID"
// @Success 200 {object} model.CommonResponse{data=object{has_edit_corpus_scope=bool}}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/capabilities [get]
func GetLibraryCapabilities(c *gin.Context) {
	libraryID, ok := middleware.MustParseIDParam(c, "library_id")
	if !ok {
		return
	}

	hasEditCorpusScope, err := service.HasEditCorpusScope(c.Request.Context(), config.GetEID(c), libraryID, config.GetUserId(c))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("知识库不存在")))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	resp := model.Success.ToResponse(gin.H{
		"has_edit_corpus_scope": hasEditCorpusScope,
	})
	resp.RequestID = c.GetString(helper.RequestIdKey)
	c.JSON(http.StatusOK, resp)
}
