package router

import (
	"embed"
	"io/fs"
	"net/http"
	"os"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/controller"
	_ "github.com/53AI/53AIHub/docs"
	"github.com/53AI/53AIHub/middleware"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	"github.com/swaggo/swag"
)

// @title 53AIHub API
// @version 0.1
// @description This is the API documentation for 53AIHub
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Type "Bearer" followed by a space and JWT token. Example: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
// @securityDefinitions.apikey ExternalAPIKeyAuth
// @in header
// @name Authorization
// @description Type "Bearer" followed by a space and API key. Example: "Bearer km-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
func SetRouter(router *gin.Engine, buildFS embed.FS) {
	router.GET("/health", controller.HealthCheck)
	router.Use(middleware.Recovery())
	router.Use(middleware.CORS())
	// 启用 gzip 压缩（swagger.json 从 1.3MB 压缩到约 150KB）
	// 放在 Recovery 之后，确保 gzip 内部 panic 能被捕获
	router.Use(gzip.Gzip(gzip.DefaultCompression))

	if os.Getenv("HUB_SERVER") != "prod" {
		router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
		setDocsRouter(router, buildFS)
	}

	setStaticImagesRouter(router, buildFS)
	setStaticLibsRouter(router, buildFS)
	SetMCPRouter(router)
	SetApiRouter(router)
	registerSaasRoutes(router)
	// SetWebRouter(router, buildFS)
	if !config.IS_SAAS && os.Getenv("DEPLOYMENT_MODE") == "local" {
		SetStaticRouter(router, buildFS)
	}
}

func setStaticImagesRouter(router *gin.Engine, buildFS embed.FS) {
	subFS, _ := fs.Sub(buildFS, "static/images")
	router.StaticFS("/api/images", http.FS(subFS))
}

func setStaticLibsRouter(router *gin.Engine, buildFS embed.FS) {
	subFS, _ := fs.Sub(buildFS, "static/libs")
	router.StaticFS("/api/libs", http.FS(subFS))
}

func setDocsRouter(router *gin.Engine, buildFS embed.FS) {
	router.GET("/docs", func(c *gin.Context) {
		subFS, _ := fs.Sub(buildFS, "static/docs")
		content, err := fs.ReadFile(subFS, "index.html")
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to read docs page"})
			return
		}
		c.Data(200, "text/html; charset=utf-8", content)
	})

	router.GET("/docs/swagger.json", func(c *gin.Context) {
		doc, err := swag.ReadDoc()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to read swagger doc"})
			return
		}
		c.Data(200, "application/json; charset=utf-8", []byte(doc))
	})
}
