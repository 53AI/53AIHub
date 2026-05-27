package middleware

import (
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// ExternalAPIKeyAuth 用于外部API的API密钥认证中间件
func ExternalAPIKeyAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 从请求头获取API密钥
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error_code": 1001,
				"error_msg":  "缺少Authorization头。预期格式为 `Bearer <api-key>`",
			})
			c.Abort()
			return
		}

		// 解析Bearer token
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == authHeader {
			// 如果没有Bearer前缀，直接使用整个值作为API密钥
			token = authHeader
		}

		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error_code": 1001,
				"error_msg":  "无效的Authorization头格式。预期格式为 `Bearer <api-key>`",
			})
			c.Abort()
			return
		}

		// 验证API密钥
		apiKey, err := model.ValidateAPIKey(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error_code": 1002,
				"error_msg":  "授权失败: " + err.Error(),
			})
			c.Abort()
			return
		}

		// 设置企业ID和API密钥到上下文
		c.Set("eid", apiKey.Eid)
		c.Set("api_key", apiKey)

		// 如果API密钥关联了特定知识库，则设置知识库ID
		if apiKey.LibraryID != nil {
			c.Set("library_id", *apiKey.LibraryID)
		}

		c.Next()
	}
}
