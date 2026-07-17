package relay

import (
	"strings"

	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

func resolveRequestSource(c *gin.Context) string {
	if v, exists := c.Get(session.SESSION_REQUEST_SOURCE); exists {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func ApplyVisitorIdentityToConversation(c *gin.Context, conversation *model.Conversation) {
	if conversation == nil {
		return
	}
	conversation.VisitorID = strings.TrimSpace(session.GetVisitorID(c))
	source := resolveRequestSource(c)
	if source != "" {
		conversation.Source = source
		return
	}
	if conversation.VisitorID != "" {
		conversation.Source = model.MessageRequestSourceH5
		return
	}
}

func applyVisitorIdentityToMessage(c *gin.Context, message *model.Message) {
	if message == nil {
		return
	}
	message.VisitorID = strings.TrimSpace(session.GetVisitorID(c))
	source := resolveRequestSource(c)
	if source != "" {
		message.RequestSource = source
		return
	}
	if message.VisitorID != "" {
		message.RequestSource = model.MessageRequestSourceH5
		return
	}
}
