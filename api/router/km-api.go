package router

import (
	"github.com/53AI/53AIHub/controller"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func WireNotifications(r *gin.RouterGroup, db *gorm.DB) {
	nsvc := service.NewNotificationService(db)
	RegisterNotificationRoutes(r, nsvc)
}

func RegisterNotificationRoutes(r *gin.RouterGroup, svc service.NotificationService) {
	ctl := controller.NewNotificationController(svc)
	g := r.Group("/notifications")
	g.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		g.GET("", ctl.List)
		g.GET("/stats", ctl.Stats)
		g.PUT("/read-all", ctl.MarkAllRead)
		g.PUT("/:id/read", ctl.MarkOneRead)
		g.POST("/batch", ctl.AddBatch)
	}
}

// SetKmApiRouter is expected to be called where KM-specific routes are wired.
// If there is already an Init/SetKmApiRouter, merge accordingly.
func SetKmApiRouter(apiRouter *gin.RouterGroup) {
	WireNotifications(apiRouter, model.DB)

	// 文档分享路由
	fileShareCtl := controller.NewFileShareController(model.DB)
	fileSharesRoute := apiRouter.Group("/file-shares")
	fileSharesRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		fileSharesRoute.POST("", fileShareCtl.CreateFileShare)
		fileSharesRoute.GET("/:share_id", fileShareCtl.GetFileShare)
	}

	// approvals routes
	approvalRoute := apiRouter.Group("/approvals")
	approvalRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		ac := controller.NewApprovalController(service.NewApprovalService())
		approvalRoute.POST("", ac.Create)
		approvalRoute.POST("/:id/approve", ac.Approve)
		approvalRoute.POST("/:id/reject", ac.Reject)
		approvalRoute.GET("/detail", ac.GetDetail)
		approvalRoute.GET("/latest-pending", ac.LatestPending)
	}
}
