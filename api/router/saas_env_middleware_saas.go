//go:build saas

package router

import (
	"github.com/53AI/53AIHub/config"
	saas_middleware "github.com/53AI/53AIHub/saas/middleware"
	"github.com/gin-gonic/gin"
)

func maybeUseSaasEnv(apiRouter *gin.RouterGroup) {
	if config.IS_SAAS {
		apiRouter.Use(saas_middleware.SaasEnv())
	}
}

