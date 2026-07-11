package service

import (
	"github.com/53AI/53AIHub/saas/model"
	"github.com/gin-gonic/gin"
)

func GetSessionEnvVersion(c *gin.Context) (string, map[string]model.FeatureLimit) {
	return "local", nil
}

func GetProductByVersion(version string, isSaas bool) (*model.Product, error) {
	return &model.Product{ID: 1, Name: "Local Edition"}, nil
}
