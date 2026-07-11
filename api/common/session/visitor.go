package session

import (
	"strings"

	"github.com/gin-gonic/gin"
)

func SetVisitorID(c *gin.Context, visitorID string) {
	if c == nil {
		return
	}
	visitorID = strings.TrimSpace(visitorID)
	if visitorID == "" {
		return
	}
	c.Set(SESSION_VISITOR_ID, visitorID)
}

func GetVisitorID(c *gin.Context) string {
	if c == nil {
		return ""
	}
	if value, exists := c.Get(SESSION_VISITOR_ID); exists {
		if visitorID, ok := value.(string); ok {
			return strings.TrimSpace(visitorID)
		}
	}
	return ""
}
