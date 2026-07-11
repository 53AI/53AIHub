package controller

import (
	"os"

	"github.com/gin-gonic/gin"
)

// isTestMode 检查是否在测试模式下运行
func isTestMode() bool {
	return os.Getenv("GO_ENV") == "test" || gin.Mode() == gin.TestMode
}
