package router

import (
	"github.com/53AI/53AIHub/controller"
	"github.com/gin-gonic/gin"
)

func setWorkBuddyCallbackRouter(router *gin.Engine) {
	router.GET("/workbuddy/callback", controller.WorkBuddyCallback)
	router.HEAD("/workbuddy/callback", controller.WorkBuddyCallback)
}
