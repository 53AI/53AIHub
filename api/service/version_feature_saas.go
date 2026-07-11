//go:build saas

package service

import (
	"github.com/53AI/53AIHub/config"
	saas_service "github.com/53AI/53AIHub/saas/service"
	"github.com/gin-gonic/gin"
)

func IsFeatureAvailable(c *gin.Context, featureKey string, params map[string]interface{}) (bool, error) {
	if config.IS_SAAS {
		return saas_service.IsFeatureAvailable(c, featureKey, params)
	}
	return true, nil
}
