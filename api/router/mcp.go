package router

import (
	"net/http"

	"github.com/53AI/53AIHub/controller"
	"github.com/53AI/53AIHub/middleware"
	"github.com/gin-gonic/gin"
)

// SetMCPRouter mounts the independent MCP entrypoint outside of the /api middleware chain.
func SetMCPRouter(router *gin.Engine) {
	mcpHandler := middleware.MCPAuth(controller.GetMCPServer().Handler())
	router.Match([]string{http.MethodGet, http.MethodPost, http.MethodDelete}, "/mcp", gin.WrapH(mcpHandler))

	// 2CEO has an isolated, read-only tool catalog. Keep general /mcp tools private.
	twoCEOHandler := middleware.MCP2CEOAuth(controller.Get2CEOMCPServer().Handler())
	router.Match([]string{http.MethodGet, http.MethodPost, http.MethodDelete}, "/mcp/2ceo", gin.WrapH(twoCEOHandler))
	router.GET("/.well-known/oauth-protected-resource/mcp/2ceo", gin.WrapH(http.HandlerFunc(middleware.TwoCEOProtectedResourceMetadata)))
    // In-process go-oauth2/v4 issuer: disabled unless explicitly configured.
    router.GET("/.well-known/oauth-authorization-server", controller.TwoCEOOAuthMetadata)
    router.GET("/.well-known/oauth-protected-resource", gin.WrapH(http.HandlerFunc(middleware.TwoCEOProtectedResourceMetadata)))
    router.GET("/oauth/2ceo/authorize", controller.TwoCEOOAuthAuthorize)
    router.POST("/oauth/2ceo/authorize", controller.TwoCEOOAuthAuthorize)
    router.POST("/oauth/2ceo/token", controller.TwoCEOOAuthToken)
}
