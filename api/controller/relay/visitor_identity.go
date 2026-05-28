package relay

import (
	"github.com/gin-gonic/gin"
	"github.com/53AI/53AIHub/model"
)

func applyVisitorIdentityToConversation(c *gin.Context, conversation *model.Conversation) {}

func applyVisitorIdentityToMessage(c *gin.Context, message *model.Message) {}
