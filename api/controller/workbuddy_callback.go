package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// WorkBuddyCallback 仅用于提供 Buddy 应用配置时可填写的回调地址，不处理 OAuth 授权。
func WorkBuddyCallback(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	if c.Request.Method == http.MethodHead {
		c.Status(http.StatusOK)
		return
	}
	c.String(http.StatusOK, "WorkBuddy callback endpoint available (OAuth not configured).")
}
