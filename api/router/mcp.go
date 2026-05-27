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
}
