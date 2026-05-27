package middleware

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/gin-gonic/gin"
)

// RequestDebugMiddleware 打印所有请求的详细信息，包括header、URL、body和query参数
func RequestDebugMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 打印请求方法和URL
		fmt.Printf("\n=== DEBUG REQUEST ===\n")
		fmt.Printf("Method: %s\n", c.Request.Method)
		fmt.Printf("URL: %s\n", c.Request.URL.String())
		fmt.Printf("Host: %s\n", c.Request.Host)
		fmt.Printf("RemoteAddr: %s\n", c.Request.RemoteAddr)

		// 打印所有Header
		fmt.Printf("\n--- Headers ---\n")
		for key, values := range c.Request.Header {
			for _, value := range values {
				fmt.Printf("%s: %s\n", key, value)
			}
		}

		// 打印Query参数
		if len(c.Request.URL.RawQuery) > 0 {
			fmt.Printf("\n--- Query Parameters ---\n")
			for key, values := range c.Request.URL.Query() {
				for _, value := range values {
					fmt.Printf("%s: %s\n", key, value)
				}
			}
		}

		// 读取并打印Body内容
		if c.Request.Body != nil {
			// 读取Body内容
			bodyBytes, err := io.ReadAll(c.Request.Body)
			if err == nil {
				// 恢复Body，以便后续处理
				c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

				// 尝试格式化JSON
				var prettyJSON bytes.Buffer
				if err := json.Indent(&prettyJSON, bodyBytes, "", "  "); err == nil {
					fmt.Printf("\n--- Body (JSON) ---\n%s\n", prettyJSON.String())
				} else {
					// 如果不是JSON，直接打印原始内容
					fmt.Printf("\n--- Body (Raw) ---\n%s\n", string(bodyBytes))
				}
			} else {
				fmt.Printf("\n--- Body ---\nError reading body: %v\n", err)
			}
		}

		// 打印表单数据（如果是表单提交）
		if c.Request.Method == "POST" || c.Request.Method == "PUT" || c.Request.Method == "PATCH" {
			contentType := c.GetHeader("Content-Type")
			if strings.Contains(contentType, "multipart/form-data") || strings.Contains(contentType, "application/x-www-form-urlencoded") {
				c.Request.ParseForm()
				if len(c.Request.Form) > 0 {
					fmt.Printf("\n--- Form Data ---\n")
					for key, values := range c.Request.Form {
						for _, value := range values {
							fmt.Printf("%s: %s\n", key, value)
						}
					}
				}
			}
		}

		fmt.Printf("====================\n\n")

		// 继续处理请求
		c.Next()
	}
}
