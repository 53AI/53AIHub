//go:build saas

package router

import (
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	saas_router "github.com/53AI/53AIHub/saas/router"
	"github.com/gin-gonic/gin"
)

func registerSaasRoutes(router *gin.Engine) {
	if config.IS_SAAS {
		apiRouter := router.Group("/api")
		// apiRouter.Use(middleware.CORS())
		apiRouter.Use(middleware.Logger())
		apiRouter.Use(middleware.SlowAPILogger())


		maybeUseSaasEnv(apiRouter)

		// 添加Hashids中间件，统一处理ID编解码
		apiRouter.Use(middleware.HashidsDecoder())  // 路由参数解码
		apiRouter.Use(middleware.RequestDecoder())  // 请求体解码
		apiRouter.Use(middleware.ResponseEncoder()) // 响应数据编码

		// commonRoute := apiRouter.Group("")
		// {
		// API SSO 登录 迁移到本地接口
		// commonRoute.POST("/auth/sso_login", controller.ApiSSOSSOLogin)
		// }
		saas_router.SetSaasApiRouter(router)
	}
}
