package middleware

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowCredentials = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"}
	config.AllowHeaders = []string{"*"}
	// 暴露 X-Request-ID：跨域前端（fetch/XHR）默认读不到自定义响应头，
	// SSE 流式响应只能靠该头归因 request_id。
	config.ExposeHeaders = []string{"Content-Length", "X-Request-ID"}
	return cors.New(config)
}
