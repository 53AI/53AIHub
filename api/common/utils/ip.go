package utils

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// GetClientIP 获取请求客户端真实IP
// 优先级：X-Real-Ip > X-Forwarded-For > RemoteAddr
func GetClientIP(c *gin.Context) string {
	// 尝试从X-Real-Ip获取
	ip := c.GetHeader("X-Real-Ip")
	if ip != "" {
		return ip
	}

	// 尝试从X-Forwarded-For获取（取最后一个IP：nginx 的 $proxy_add_x_forwarded_for 把真实 IP 追加在链尾，取第一个可被客户端伪造）
	xForwardedFor := c.GetHeader("X-Forwarded-For")
	if xForwardedFor != "" {
		ips := strings.Split(xForwardedFor, ",")
		if len(ips) > 0 {
			ip = strings.TrimSpace(ips[len(ips)-1])
			if ip != "" {
				return ip
			}
		}
	}

	// 尝试从X-Client-Ip获取（兼容部分代理）
	ip = c.GetHeader("X-Client-Ip")
	if ip != "" {
		return ip
	}

	// 最后使用RemoteAddr（可能包含端口，需要解析）
	remoteAddr := c.Request.RemoteAddr
	if idx := strings.LastIndex(remoteAddr, ":"); idx > 0 {
		return remoteAddr[:idx]
	}
	return remoteAddr
}
