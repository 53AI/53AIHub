//go:build !saas

package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

func SyncOrganization(c *gin.Context) {
	c.JSON(http.StatusNotFound, model.FeatureNotAvailableError.ToNewErrorResponse(model.FeatureNotAvailable))
}

func GetSyncProgress(c *gin.Context) {
	c.JSON(http.StatusNotFound, model.FeatureNotAvailableError.ToNewErrorResponse(model.FeatureNotAvailable))
}

func GetAllSyncProgress(c *gin.Context) {
	c.JSON(http.StatusNotFound, model.FeatureNotAvailableError.ToNewErrorResponse(model.FeatureNotAvailable))
}

func GetSyncProgressByFrom(c *gin.Context) {
	c.JSON(http.StatusNotFound, model.FeatureNotAvailableError.ToNewErrorResponse(model.FeatureNotAvailable))
}

