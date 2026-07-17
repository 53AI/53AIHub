package router

import (
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/wsmanager"
	"github.com/53AI/53AIHub/controller"
	"github.com/53AI/53AIHub/controller/relay"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

func SetApiRouter(router *gin.Engine) {
	apiRouter := router.Group("/api")
	// apiRouter.Use(middleware.CORS())
	apiRouter.Use(middleware.Logger())
	apiRouter.Use(middleware.SlowAPILogger())

	maybeUseSaasEnv(apiRouter)

	// 添加Hashids中间件，统一处理ID编解码
	apiRouter.Use(middleware.HashidsDecoder())  // 路由参数解码
	apiRouter.Use(middleware.RequestDecoder())  // 请求体解码
	apiRouter.Use(middleware.ResponseEncoder()) // 响应数据编码

	// 初始化 RAG 控制器
	ragQAController := controller.NewRAGQAController()

	// 添加版本API路由
	versionRoute := apiRouter.Group("/version")
	{
		versionRoute.GET("", controller.GetVersion)
	}

	// 添加企业信息相关接口
	enterpriseInfoRoute := apiRouter.Group("/enterprise-info")
	enterpriseInfoRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		enterpriseInfoRoute.GET("", controller.GetEnterpriseInfo)
		enterpriseInfoRoute.PUT("", controller.UpdateEnterpriseInfo)
	}

	// 添加公共企业信息相关接口
	publicEnterpriseInfoRoute := apiRouter.Group("/public/enterprise-info")
	{
		publicEnterpriseInfoRoute.GET("", controller.GetPublicEnterpriseInfo)
	}

	envConfigRoute := apiRouter.Group("/env-config")
	{
		envConfigRoute.GET("", controller.GetEnvConfig)
	}

	enterpriseRoute := apiRouter.Group("/enterprises")
	{
		enterpriseRoute.GET("/is_saas", controller.GetIsSaas)
		enterpriseRoute.GET("/homepage", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetHomePage)

		enterpriseRoute.GET("/current", controller.GetCurrentEnterprise)

		enterpriseRoute.GET("/:id", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetEnterprise)
		enterpriseRoute.PUT("/:id", controller.UpdateEnterprise)
		enterpriseRoute.PATCH("/:id", middleware.UserTokenAuth(model.RoleAdminUser), controller.UpdateEnterpriseAttribute)
		enterpriseRoute.DELETE("/:id", middleware.UserTokenAuth(model.RoleAdminUser), controller.DeleteEnterprise)
		enterpriseRoute.POST("", middleware.UserTokenAuth(model.RoleAdminUser), controller.CreateEnterprise)
		enterpriseRoute.GET("/banner", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetEnterpriseBanner)
		enterpriseRoute.PUT("/banner", middleware.UserTokenAuth(model.RoleAdminUser), controller.UpdateEnterpriseBanner)
		enterpriseRoute.GET("/template_type", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetEnterpriseTemplateType)
		enterpriseRoute.PUT("/template_type", middleware.UserTokenAuth(model.RoleAdminUser), controller.UpdateEnterpriseTemplateType)

		// 添加获取企业功能限制的路由
		enterpriseRoute.GET("/features", controller.GetEnterpriseFeatureLimits)
	}

	enterpriseConfigRoute := apiRouter.Group("/enterprise-configs")
	{
		enterpriseConfigRoute.GET("", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetEnterpriseConfigTypes)
		enterpriseConfigRoute.GET("/:type", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetEnterpriseConfig)
		enterpriseConfigRoute.GET("/:type/enabled", controller.IsEnterpriseConfigEnabled)
		enterpriseConfigRoute.POST("/:type", middleware.UserTokenAuth(model.RoleAdminUser), controller.SaveEnterpriseConfig)
		enterpriseConfigRoute.PUT("/:type/toggle", middleware.UserTokenAuth(model.RoleAdminUser), controller.ToggleEnterpriseConfig)
	}

	commonRoute := apiRouter.Group("")
	{
		commonRoute.POST("/register", controller.PasswordRegister)
		commonRoute.POST("/init", controller.InitInstallation)
		commonRoute.POST("/login", controller.Login)
		commonRoute.POST("/logout", middleware.UserTokenAuth(model.RoleGuestUser), controller.Logout)
		commonRoute.POST("/sms_login", controller.SmsLogin)
		commonRoute.POST("/check_account", controller.CheckAccountExists)
		commonRoute.POST("/upload", middleware.UserTokenAuth(model.RoleGuestUser), controller.Upload)
		commonRoute.GET("/is_init", controller.IsInit)
		commonRoute.GET("/preview/*key", controller.PreviewFile)
		commonRoute.GET("/response_codes", controller.GetAllResponseCodes)
		commonRoute.POST("/reset_password", controller.ResetPassword)
		commonRoute.POST("/auth/sso_login", controller.ApiSSOSSOLogin) // 原有SSO登录接口迁移到非SAAS

		// 将新增的公共接口移动到 commonRoute 组内
		commonRoute.GET("/system/redis-stats", controller.GetRedisPoolStatus)
		commonRoute.GET("/health", controller.HealthCheck)
		commonRoute.GET("/files/:file_id/preview", controller.PreviewRawFileContent)
		commonRoute.GET("/files/:file_id/preview/*filename", controller.PreviewRawFileContent)
		commonRoute.GET("/file-version/:file_body_id", controller.GetFileBodyContent)
		commonRoute.GET("/file-version/:file_body_id/*filename", controller.GetFileBodyContent)
	}

	agentH5Route := apiRouter.Group("/agents/h5")
	{
		agentH5Route.POST("/login", controller.AgentH5Login)
		agentH5Route.POST("/info", controller.GetAgentH5Info)
		agentH5Route.DELETE("/token", middleware.UserTokenAuth(model.RoleCommonUser), controller.AgentH5Logout)
		agentH5Route.POST("/fixed-token", middleware.UserTokenAuth(model.RoleAdminUser), controller.CreateAgentH5FixedToken)
		agentH5Route.GET("/fixed-token", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetAgentH5FixedTokenList)
	}

	// Agent OpenAPI 管理端路由
	agentOpenAPIManageRoute := apiRouter.Group("/agents")
	agentOpenAPIManageRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		agentAPIKeyRoute := agentOpenAPIManageRoute.Group("/api/keys")
		{
			agentAPIKeyRoute.POST("", controller.CreateAgentAPIKey)
			agentAPIKeyRoute.GET("", controller.ListAgentAPIKey)
			agentAPIKeyRoute.POST("/:id/rotate", controller.RotateAgentAPIKey)
			agentAPIKeyRoute.DELETE("/:id", controller.RevokeAgentAPIKey)
		}

		agentOpenAPIDocsRoute := agentOpenAPIManageRoute.Group("/openapi")
		{
			agentOpenAPIDocsRoute.GET("/docs-template", controller.GetAgentOpenAPIDocsTemplate)
		}
	}

	// Agent OpenAPI 路由（使用 API Key 认证）
	// 挂在 router 直接（无 /api 前缀），符合 Spec §4.1
	openAPIRoute := router.Group("/openapi/v1")
	openAPIRoute.Use(middleware.CORS())
	openAPIRoute.Use(middleware.Logger())
	openAPIRoute.Use(middleware.SlowAPILogger())
	openAPIRoute.Use(middleware.HashidsDecoder())
	openAPIRoute.Use(middleware.RequestDecoder())
	openAPIRoute.Use(middleware.ResponseEncoder())
	openAPIRoute.Use(middleware.AgentAPIAuth())
	openAPIRoute.Use(middleware.AgentAPIRateLimit())
	{
		openAPIRoute.POST("/chat/completions", relay.HandleAgentAPIChatCompletions)
		openAPIRoute.POST("/chat/completions/:run_id/cancel", controller.CancelOpenAPIChatCompletion)
		openAPIRoute.GET("/conversations", controller.GetOpenAPIConversations)
		openAPIRoute.POST("/conversations", controller.CreateOpenAPIConversation)
		openAPIRoute.GET("/conversations/:id", controller.GetOpenAPIConversationDetail)
		openAPIRoute.DELETE("/conversations/:id", controller.DeleteOpenAPIConversation)
		openAPIRoute.PATCH("/conversations/:id", controller.UpdateOpenAPIConversation)
		openAPIRoute.POST("/files", controller.UploadOpenAPIFile)
		openAPIRoute.GET("/files/:id", controller.GetOpenAPIFileInfo)
		openAPIRoute.GET("/agent", controller.GetOpenAPIAgentInfo)
		openAPIRoute.GET("/agent/skills", controller.GetOpenAPIAgentSkills)
		openAPIRoute.POST("/messages/:id/rating", controller.RateOpenAPIMessage)
	}

	// Agent API 健康检查（无需认证）
	router.GET("/openapi/v1/health", middleware.CORS(), controller.AgentAPIHealth)

	mySpaceRoute := apiRouter.Group("/my-space")
	mySpaceRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		mySpaceRoute.GET("/context", controller.GetMySpaceContext)
		mySpaceRoute.GET("/ai-generated", controller.GetMySpaceAIGenerated)
		mySpaceRoute.GET("/uploads", controller.GetMySpaceUploads)
		mySpaceRoute.GET("/favorites", controller.GetMySpaceFavorites)
		mySpaceRoute.POST("/favorites/check", controller.CheckFavorites)
		mySpaceRoute.GET("/recently", controller.GetMySpaceRecently)
		mySpaceRoute.GET("/recordings", controller.GetMySpaceRecordings)
		mySpaceRoute.POST("/recordings/folders", controller.CreateMySpaceRecordingFolder)
		mySpaceRoute.POST("/recordings/import", controller.CreateMySpaceRecordingImportBatch)
	}

	// 录音健康检查接口（无需登录）
	apiRouter.GET("/recordings/ffmpeg-health", controller.GetFFmpegHealth)
	apiRouter.GET("/recordings/system-status", controller.GetRecordingSystemStatus)

	// 录音业务接口（需要登录）
	recordingRoute := apiRouter.Group("/recordings")
	recordingRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		recordingRoute.GET("/config", controller.GetRecordingConfigForUser)
		recordingRoute.POST("", controller.CreateRecordingJob)
		recordingRoute.GET("/active", controller.GetActiveRecordingJob)
		recordingRoute.GET("/:job_id", controller.GetRecordingJob)
		recordingRoute.PATCH("/:job_id/state", controller.UpdateRecordingJobState)
		recordingRoute.POST("/:job_id/heartbeat", controller.HeartbeatRecordingJob)
		recordingRoute.POST("/:job_id/segments", controller.UploadRecordingSegment)
		recordingRoute.GET("/:job_id/segments", controller.GetRecordingSegmentManifest)
		recordingRoute.GET("/:job_id/segments/missing", controller.GetRecordingMissingSegments)
		recordingRoute.POST("/:job_id/finalize", controller.FinalizeRecordingJob)
	}

	// 录音管理接口（管理员权限）— 独立前缀避免与用户路由冲突
	recordingAdmin := apiRouter.Group("/admin/recordings")
	recordingAdmin.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		recordingAdmin.GET("/config", controller.GetRecordingConfig)
		recordingAdmin.PUT("/config", controller.UpdateRecordingConfig)
		recordingAdmin.GET("/parser-platforms", controller.ListParserPlatforms)
		recordingAdmin.GET("/stats", controller.GetRecordingStats)
		recordingAdmin.GET("", controller.ListAllRecordings)
	}

	emailRoute := apiRouter.Group("/email")
	{
		emailRoute.POST("/send_verification", controller.SendVerificationEmail)
		emailRoute.POST("/send_test", middleware.UserTokenAuth(model.RoleAdminUser), controller.SendTestEmail)
	}

	smsRoute := apiRouter.Group("/sms")
	{
		smsRoute.POST("/sendcode", controller.SendSMSCode)
		smsRoute.GET("/verify", controller.VerifySMSCode)
		smsRoute.GET("/status", controller.GetSMSStatus)
	}

	userRoute := apiRouter.Group("/users")
	userRoute.GET("/me", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetCurrentUser)
	userRoute.PUT("/password", middleware.UserTokenAuth(model.RoleCommonUser), controller.UpdateUserPassword)
	userRoute.PATCH("/:id/mobile", middleware.UserTokenAuth(model.RoleCommonUser), controller.UpdateUserMobile)
	userRoute.PATCH("/:id/email", middleware.UserTokenAuth(model.RoleCommonUser), controller.UpdateUserEmail)
	userRoute.PUT("/me", middleware.UserTokenAuth(model.RoleCommonUser), controller.UpdateCurrentUser)
	userRoute.POST("/system_log", middleware.UserTokenAuth(model.RoleCommonUser), controller.CreateSystemLogs)
	userRoute.PUT("/:id/default_subscription", middleware.UserTokenAuth(model.RoleCommonUser), controller.SetUserToDefaultSubscription)
	userRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		userRoute.POST("", controller.EnterpriseAddUser)
		userRoute.GET("", controller.EnterpriseUsers)
		userRoute.DELETE("/:id", controller.DeleteEnterpriseUser)
		userRoute.PUT("/:id", controller.UpdateEnterpriseUser)
		userRoute.GET("/:user_id/agents/:agent_id/messages", controller.GetUserMessages)
		userRoute.GET("/:user_id/conversations", controller.GetUserConversations)
		userRoute.PUT("/batch/admin", controller.SetUserAsAdmin)
		userRoute.DELETE("/batch/admin", controller.UnsetUserAsAdmin)
		userRoute.POST("/internal/batch", controller.BatchAddInternalUsers)
		userRoute.PUT("/register/to/internal", controller.RegisterUserToInternal)
		userRoute.GET("/internal", controller.GetInternalUsers)
		userRoute.PATCH("/:id/status", controller.UpdateUserStatus)
		userRoute.PUT("/internal/:id", controller.UpdateInternalUser)
		userRoute.GET("/admin", controller.EnterpriseUsers)
		userRoute.GET("/organization", controller.GetOrganizationUserList)
	}

	groupRoute := apiRouter.Group("/groups")
	groupRoute.GET("type/current/:group_type", controller.GetGroups)
	groupRoute.POST("/prompt", middleware.UserTokenAuth(model.RoleCommonUser), controller.CreateGroup)
	groupRoute.GET("type/:group_type", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetGroups)
	groupRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		groupRoute.POST("", controller.CreateGroup)
		groupRoute.GET("/:id", controller.GetGroup)
		groupRoute.PUT("/:id", controller.UpdateGroup)
		groupRoute.DELETE("/:id", controller.DeleteGroup)
		groupRoute.POST("type/:group_type", controller.BatchSubmitGroups)
		groupRoute.POST("/:id/agents", controller.AddAgentsToGroup)
		groupRoute.DELETE("/:id/agents", controller.RemoveAgentsFromGroup)
		groupRoute.GET("/:id/agents", controller.GetGroupAgents)
		groupRoute.POST("/:id/resources", controller.AddResourcesToGroup)
		groupRoute.DELETE("/:id/resources", controller.RemoveResourcesFromGroup)
		groupRoute.GET("/:id/resources", controller.GetGroupResources)
		groupRoute.DELETE("/:id/users", controller.RemoveUsersFromGroup)
		groupRoute.GET("/:id/users", controller.GetGroupUsers)
		groupRoute.POST("/:id/users/batch", controller.BatchAddUsersToGroup)
	}

	// 技能库探索列表 - 无需登录，但已登录时返回绑定状态
	apiRouter.GET("/skill-library/explore", middleware.OptionalUserTokenAuth(), controller.GetSkillExploreList)

	skillLibraryRoute := apiRouter.Group("/skill-library")
	skillLibraryRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		skillLibraryRoute.GET("/:id", controller.GetSkillDetail)
		skillLibraryRoute.GET("/:id/env-vars", controller.GetMySkillEnvVars)
		skillLibraryRoute.POST("/:id/env-vars", controller.CreateMySkillEnvVar)
		skillLibraryRoute.PUT("/:id/env-vars/:env_var_id", controller.UpdateMySkillEnvVar)
		skillLibraryRoute.DELETE("/:id/env-vars/:env_var_id", controller.DeleteMySkillEnvVar)
		skillLibraryRoute.PUT("/:id/env-vars/batch", controller.BatchUpdateMySkillEnvVars)
		skillLibraryRoute.GET("/:id/skill-md", controller.GetSkillMD)
		skillLibraryRoute.GET("/:id/download", controller.DownloadSkillZip)
	}

	agentSkillRoute := apiRouter.Group("/agent")
	agentSkillRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		agentSkillRoute.GET("/:agent_id/skills", controller.ListAgentSkills)
		agentSkillRoute.POST("/:agent_id/skills", controller.AddAgentSkill)
		agentSkillRoute.DELETE("/:agent_id/skills/:binding_id", controller.DeleteAgentSkill)
	}

	adminSkillLibraryRoute := apiRouter.Group("/admin/skill-library")
	adminSkillLibraryRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		adminSkillLibraryRoute.POST("/import", controller.AdminImportSkillLibrary)
		adminSkillLibraryRoute.POST("/import/force", controller.AdminForceImportSkillLibrary)
		adminSkillLibraryRoute.GET("/import/jobs/:id", controller.AdminGetSkillLibraryImportJob)
		adminSkillLibraryRoute.POST("/reload", controller.AdminReloadSkillManager)
		adminSkillLibraryRoute.GET("/list", controller.AdminListSkillLibraries)
		adminSkillLibraryRoute.GET("/:id", controller.AdminGetSkillLibrary)
		adminSkillLibraryRoute.PUT("/:id", controller.AdminUpdateSkillLibrary)
		adminSkillLibraryRoute.PATCH("/:id/status", controller.AdminUpdateSkillLibraryStatus)
		adminSkillLibraryRoute.POST("/:id/publish", controller.AdminPublishSkillLibrary)
		adminSkillLibraryRoute.DELETE("/:id", controller.AdminDeleteSkillLibrary)
		adminSkillLibraryRoute.POST("/:id/ai-generate", controller.AdminGenerateSkillLibraryContent)
		adminSkillLibraryRoute.GET("/:id/files", controller.GetSkillFileTree)
		adminSkillLibraryRoute.PUT("/:id/files", controller.UpdateSkillFiles)
		adminSkillLibraryRoute.GET("/:id/files/*path", controller.GetSkillFileContent)
		adminSkillLibraryRoute.GET("/:id/files-preview/*path", controller.PreviewSkillFile)
		adminSkillLibraryRoute.GET("/:id/env-vars", controller.AdminListSkillEnvVars)
		adminSkillLibraryRoute.POST("/:id/env-vars", controller.AdminCreateSkillEnvVar)
		adminSkillLibraryRoute.PUT("/:id/env-vars/:env_var_id", controller.AdminUpdateSkillEnvVar)
		adminSkillLibraryRoute.DELETE("/:id/env-vars/:env_var_id", controller.AdminDeleteSkillEnvVar)
		adminSkillLibraryRoute.PUT("/:id/env-vars/batch", controller.AdminBatchUpdateSkillEnvVars)
	}

	adminAgentSkillRoute := apiRouter.Group("/admin/agent")
	adminAgentSkillRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		adminAgentSkillRoute.GET("/:agent_id/skills/builtin", controller.ListAgentBuiltinSkills)
		adminAgentSkillRoute.POST("/:agent_id/skills/builtin", controller.AddAgentBuiltinSkill)
		adminAgentSkillRoute.DELETE("/:agent_id/skills/builtin/:binding_id", controller.DeleteAgentBuiltinSkill)
	}

	aiLinkRoute := apiRouter.Group("/ai_links")
	aiLinkRoute.GET("/current", controller.GetCurrentSiteAILinks)
	aiLinkRoute.GET("/default", controller.GetDefaultAILinks)
	aiLinkRoute.GET("/:id", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetAILink)
	aiLinkRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		aiLinkRoute.POST("", controller.CreateAILink)
		aiLinkRoute.GET("", controller.GetAILinks)
		aiLinkRoute.PUT("/:id", controller.UpdateAILink)
		aiLinkRoute.DELETE("/:id", controller.DeleteAILink)
		aiLinkRoute.POST("/batch/sort", controller.BatchSortAILinks)
	}

	settingRoute := apiRouter.Group("/settings")
	{
		settingRoute.POST("", middleware.UserTokenAuth(model.RoleGuestUser), controller.CreateSetting)
		settingRoute.GET("/:id", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetSetting)
		settingRoute.PUT("/:id", middleware.UserTokenAuth(model.RoleGuestUser), controller.UpdateSetting)
		settingRoute.DELETE("/:id", middleware.UserTokenAuth(model.RoleGuestUser), controller.DeleteSetting)
		settingRoute.GET("", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetSettings)
		settingRoute.GET("/group/:group_name", controller.GetSettingsByGroup)
		settingRoute.GET("/key/:key", controller.GetSettingByKey)
		settingRoute.POST("/default_links", middleware.UserTokenAuth(model.RoleGuestUser), controller.BatchUpdateDefaultPromptLinks) // 批量更新默认提示词链接
		settingRoute.GET("/default_links", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetDefaultPromptLinks)          // 获取默认提示词链接
		settingRoute.GET("/by-key", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetSettingsByKey)                      // 获取默认提示词链接
	}

	platformSettingRoute := apiRouter.Group("/platform-settings")
	// platformSettingRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		platformSettingRoute.POST("", middleware.UserTokenAuth(model.RoleAdminUser), controller.CreatePlatformSetting)
		platformSettingRoute.GET("", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetPlatformSettings)
		platformSettingRoute.GET("/default-metas", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetDefaultPlatformSettings)
		platformSettingRoute.GET("/:id", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetPlatformSetting)
		platformSettingRoute.PUT("/:id", middleware.UserTokenAuth(model.RoleAdminUser), controller.UpdatePlatformSetting)
		platformSettingRoute.DELETE("/:id", middleware.UserTokenAuth(model.RoleAdminUser), controller.DeletePlatformSetting)
		platformSettingRoute.POST("/:id/test-bochaai-search", middleware.UserTokenAuth(model.RoleAdminUser), controller.TestBochaAISearch) // 添加测试博查AI搜索功能接口
		platformSettingRoute.POST("/:id/toggle", middleware.UserTokenAuth(model.RoleAdminUser), controller.TogglePlatformSettingStatus)    // 添加切换状态接口
	}

	// WPS状态检查接口（所有登录用户可访问）
	platformSettingPublicRoute := apiRouter.Group("/platform-settings")
	platformSettingPublicRoute.GET("/wps/status", middleware.UserTokenAuth(model.RoleCommonUser), controller.CheckWPSIntegrationStatus)

	channelGroup := apiRouter.Group("/channels")
	channelGroup.GET("", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetChannels)
	channelGroup.GET("/public", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetChannelsForFrontend) // 为前端提供安全的通道信息，不含敏感信息
	channelGroup.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		channelGroup.POST("", controller.CreateChannel)
		channelGroup.GET("/:channel_id", controller.GetChannel)
		channelGroup.PUT("/:channel_id", controller.UpdateChannel)
		channelGroup.DELETE("/:channel_id", controller.DeleteChannel)
		channelGroup.GET("/test/:channel_id", controller.TestChannel)
		channelGroup.GET("/models", controller.ListAllModels)
		channelGroup.GET("/km/models", controller.GetKmModels)
	}

	agentGroup := apiRouter.Group("/agents")
	agentGroup.GET("/current", controller.GetCurrentAgents)
	agentGroup.GET("/available", controller.GetAvailableAgents)
	agentGroup.Use(middleware.UserTokenAuth(model.RoleGuestUser))
	{
		agentGroup.POST("", controller.CreateAgent)
		agentGroup.GET("", controller.GetAgents)
		agentGroup.GET("/group", controller.GetAgentsByGroup)
		agentGroup.GET("/:agent_id", controller.GetAgent)
		agentGroup.PUT("/:agent_id", controller.UpdateAgent)
		agentGroup.POST("/:agent_id/reset-secret", controller.ResetEnterpriseAgentSecret)
		agentGroup.DELETE("/:agent_id", controller.DeleteAgent)
		agentGroup.GET("/:agent_id/messages", controller.GetMessagesByUserAndAgent)
		agentGroup.PATCH("/:agent_id/status", controller.UpdateAgentStatus)
		agentGroup.GET("/internal_users", controller.GetInternalUserAgents)
		agentGroup.GET("/:agent_id/conversations", controller.GetAgentConversations)
		agentGroup.GET("/:agent_id/models", controller.GetAgentModels)
		agentGroup.POST("/:agent_id/models", controller.CreateAgentModel)
		agentGroup.PUT("/:agent_id/models/:model_id", controller.UpdateAgentModel)
		agentGroup.DELETE("/:agent_id/models/:model_id", controller.DeleteAgentModel)
		agentGroup.POST("/models/batch", controller.BatchCreateAgentModels)
	}

	personalAgentGroup := apiRouter.Group("/my/agents")
	personalAgentGroup.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		personalAgentGroup.GET("", controller.GetAgents)
		personalAgentGroup.POST("", controller.CreatePersonalAgent)
		personalAgentGroup.GET("/:agent_id", controller.GetAgent)
		personalAgentGroup.PUT("/:agent_id", controller.UpdateAgent)
		personalAgentGroup.DELETE("/:agent_id", controller.DeleteAgent)
		personalAgentGroup.POST("/:agent_id/reset-secret", controller.ResetPersonalAgentSecret)

		// Agent 记忆（MEMORY.md）
		personalAgentGroup.GET("/:agent_id/memory-list", controller.GetAgentMemoryList)
		personalAgentGroup.GET("/:agent_id/memory", controller.GetAgentMemory)
		personalAgentGroup.PUT("/:agent_id/memory", controller.UpdateAgentMemory)
		personalAgentGroup.POST("/:agent_id/memory/compress", controller.CompressAgentMemory)
		personalAgentGroup.POST("/:agent_id/memory/items", controller.AppendAgentMemoryItem)
		personalAgentGroup.DELETE("/:agent_id/memory/items/:index", controller.DeleteAgentMemoryItem)

		// Agent 工具教训（TOOLS.md）
		personalAgentGroup.GET("/:agent_id/tool-lessons", controller.GetAgentToolLessons)
		personalAgentGroup.PUT("/:agent_id/tool-lessons", controller.UpdateAgentToolLessons)
		personalAgentGroup.POST("/:agent_id/tool-lessons/append", controller.AppendAgentToolLesson)
		personalAgentGroup.DELETE("/:agent_id/tool-lessons/:index", controller.DeleteAgentToolLessonItem)
	}

	// 用户快捷 Agent 列表
	agentShortcutGroup := apiRouter.Group("/my/agent-shortcuts")
	agentShortcutGroup.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		agentShortcutGroup.POST("", controller.CreateUserAgentShortcut)
		agentShortcutGroup.GET("", controller.GetUserAgentShortcuts)
		agentShortcutGroup.GET("/ids", controller.GetUserAgentShortcutIDs)
		agentShortcutGroup.DELETE("/:agent_id", controller.DeleteUserAgentShortcut)
		agentShortcutGroup.PATCH("/:agent_id/pin", controller.UpdateUserAgentShortcutPin)
	}

	// 用户全局记忆
	myMemoryGroup := apiRouter.Group("/my/memory")
	myMemoryGroup.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		myMemoryGroup.GET("", controller.GetMyMemory)
		myMemoryGroup.PUT("", controller.UpdateMyMemory)
		myMemoryGroup.POST("/merge", controller.MergeMyMemory)
		myMemoryGroup.POST("/import", controller.ImportMyMemory)
		myMemoryGroup.DELETE("/smart-memory/:index", controller.DeleteSmartMemoryItem)
		myMemoryGroup.DELETE("/custom-memory/:index", controller.DeleteCustomMemoryItem)
	}

	// 资源范围（通用，不绑定具体资源类型）
	resourceScopeGroup := apiRouter.Group("/resource-scopes")
	resourceScopeGroup.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	logger.SysDebugf("resource-scopes group registered with required_role=%d", model.RoleCommonUser)
	{
		resourceScopeGroup.GET("", controller.GetResourceScopes)
		resourceScopeGroup.PUT("", controller.ReplaceResourceScopes)
		resourceScopeGroup.GET("/check", controller.CheckResourceScopeAccess)
	}
	conversationGroup := apiRouter.Group("/conversations")
	conversationGroup.Use(middleware.UserTokenAuth(model.RoleGuestUser))
	{
		conversationGroup.POST("", controller.CreateConversation)
		conversationGroup.GET("", controller.GetConversations)
		conversationGroup.GET("/:conversation_id", controller.GetConversation)
		conversationGroup.GET("/:conversation_id/latest-run", controller.GetLatestConversationRun)
		conversationGroup.GET("/:conversation_id/agent-runs", controller.GetConversationAgentRuns)
		conversationGroup.PUT("/:conversation_id", controller.UpdateConversation)
		conversationGroup.DELETE("/:conversation_id", controller.DeleteConversation)
		//conversationGroup.POST("/:conversation_id/messages", controller.CreateMessage)
		conversationGroup.GET("/:conversation_id/messages", controller.GetMessagesByConversation)
	}

	agentRunGroup := apiRouter.Group("/agent-runs")
	agentRunGroup.Use(middleware.UserTokenAuth(model.RoleGuestUser))
	{
		agentRunGroup.GET("/:run_id", controller.GetAgentRun)
		agentRunGroup.GET("/:run_id/events", controller.GetAgentRunEvents)
		agentRunGroup.GET("/:run_id/replay", controller.GetAgentRunReplay)
		agentRunGroup.GET("/:run_id/subscribe", controller.SubscribeAgentRunEvents)
		agentRunGroup.POST("/:run_id/cancel", controller.CancelAgentRun)
	}

	// Messages routes
	messagesGroup := apiRouter.Group("/messages")
	messagesGroup.Use(middleware.UserTokenAuth(model.RoleGuestUser))
	{
		messagesGroup.GET("/:id", controller.GetMessageByID)
		messagesGroup.GET("/list", controller.GetMessagesList)
		messagesGroup.GET("/:id/files", controller.GetMessageAIUploadFiles)
	}

	// AI upload files download route
	uploadFilesRoute := apiRouter.Group("/upload-files")
	uploadFilesRoute.Use(middleware.UserTokenAuth(model.RoleGuestUser))
	{
		uploadFilesRoute.GET("/:id/download", controller.DownloadAIUploadFile)
	}
	// Signed AI upload file download (no login required, token verified in handler)
	apiRouter.GET("/upload-files/:id/download/:filename", controller.DownloadAIUploadFile)

	// Message stats routes
	messageStatsGroup := apiRouter.Group("/message_stats")
	messageStatsGroup.Use(middleware.UserTokenAuth(model.RoleGuestUser))
	{
		messageStatsGroup.GET("/sum", controller.GetMessageStatsSum)
	}

	knowledgeMapStatsGroup := apiRouter.Group("/knowledge_map_stats")
	knowledgeMapStatsGroup.Use(middleware.UserTokenAuth(model.RoleGuestUser))
	{
		knowledgeMapStatsGroup.GET("/sum", controller.GetKnowledgeMapStatsSum)
	}

	subscription := apiRouter.Group("/subscriptions")
	{
		subscription.GET("/settings", controller.GetSubscriptionList)
		subscription.
			POST("/batch", middleware.UserTokenAuth(model.RoleAdminUser), controller.BatchSubscriptionOperation)
	}

	providerRouter := apiRouter.Group("/providers")
	providerRouter.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		providerRouter.POST("", controller.CreateProvider)
		providerRouter.GET("", controller.GetProviders)
		providerRouter.PUT("/:id", controller.UpdateProvider)
		providerRouter.DELETE("/:id", controller.DeleteProvider)
	}

	callbackRouter := apiRouter.Group("/callback")
	{
		callbackRouter.GET("/cozecn/auth/:eid", controller.CozeCallBack)
		callbackRouter.GET("/cozecom/auth/:eid", controller.CozeCallBack)
	}

	cozeRouter := apiRouter.Group("/coze")
	cozeRouter.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		cozeRouter.GET("/workspaces", controller.GetCozeAllWorkspaces)
		cozeRouter.GET("/workspaces/:workspace_id/bots", controller.GetCozeAllBots)
	}

	tencentRouter := apiRouter.Group("/tencent")
	tencentRouter.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		tencentRouter.GET("/apps", controller.GetTencentAllApps)
		tencentRouter.GET("/apps/:app_id", controller.GetTencentAppDetail)
	}

	AppBuilderRouter := apiRouter.Group("/appbuilder")
	AppBuilderRouter.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		AppBuilderRouter.GET("/bots", controller.GetAppBuilderAllBots)
	}

	ai53Router := apiRouter.Group("/53ai")
	ai53Router.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		ai53Router.GET("/bots", controller.Get53AIAllBots)
		ai53Router.GET("/workflows", controller.Get53AIAllWorkflows)
		ai53Router.GET("/parameters/:botId", controller.Get53AIAppParameters)
	}

	openclawWSRouter := apiRouter.Group("/v1/openclaw/ws")
	{
		openclawWSRouter.GET("/connect", wsmanager.HandleOpenClawWS)
	}

	openclawPluginRouter := apiRouter.Group("/v1/openclaw")
	{
		openclawPluginRouter.POST("/artifacts", controller.UploadOpenClawArtifact)
		openclawPluginRouter.GET("/skills/:skill_id/package", controller.DownloadOpenClawSkillPackage)
	}

	openclawRouter := apiRouter.Group("/openclaw/agents/:agent_id")
	openclawRouter.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		openclawRouter.GET("/conversations", controller.GetOpenClawConversations)
		openclawRouter.GET("/conversations/current", controller.GetOpenClawCurrentConversation)
		openclawRouter.GET("/conversations/:openclaw_session_id/messages", controller.GetOpenClawConversationMessages)
		openclawRouter.GET("/conversations/:openclaw_session_id/events", controller.GetOpenClawConversationEvents)
		openclawRouter.GET("/conversations/:openclaw_session_id/snapshot", controller.GetOpenClawConversationSnapshot)
		openclawRouter.POST("/conversations/:openclaw_session_id/control", controller.ControlOpenClawConversation)
		openclawRouter.GET("/status", controller.GetOpenClawStatus)
		openclawRouter.GET("/config", controller.GetOpenClawConfig)
		openclawRouter.GET("/skills", controller.GetOpenClawSkills)
		openclawRouter.POST("/skills/:skill_id/ensure", controller.EnsureOpenClawSkill)
		openclawRouter.GET("/artifacts/:artifact_id/preview", controller.PreviewOpenClawArtifact)
		openclawRouter.GET("/artifacts/:artifact_id/download", controller.DownloadOpenClawArtifact)
		openclawRouter.GET("/cron-tasks", controller.GetOpenClawCronTasks)
	}

	apiV1Router := router.Group("/v1")
	apiV1Router.Use(middleware.CORS())
	apiV1Router.Use(middleware.Logger())
	apiV1Router.Use(middleware.SlowAPILogger())
	apiV1Router.Use(middleware.HashidsDecoder()) // 路由参数解码
	apiV1Router.Use(middleware.RequestDecoder()) // 请求体解码
	apiV1Router.Use(middleware.RelayTokenAuth())
	{
		apiV1Router.POST("/chat/completions", relay.Relay)
		apiV1Router.POST("/workflow/run", relay.WorkflowRun)
		apiV1Router.POST("/rerank", controller.Rerank)
	}

	feedback := apiRouter.Group("/feedback")
	{
		feedback.GET("/config", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetFeedbackConfig)
		feedback.POST("/config", middleware.UserTokenAuth(model.RoleAdminUser), controller.CreateFeedbackConfig)

		feedback.POST("", middleware.UserTokenAuth(model.RoleGuestUser), controller.CreateFeedback)
		feedback.GET("", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetFeedbackByMessageAndUser)
		feedback.PUT("/:id", middleware.UserTokenAuth(model.RoleGuestUser), controller.UpdateFeedback)
		feedback.DELETE("/:id", middleware.UserTokenAuth(model.RoleGuestUser), controller.DeleteFeedback)
		feedback.GET("/stats", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetFeedbackStats)
	}

	// 管理员反馈路由
	adminFeedback := apiRouter.Group("/admin/feedback")
	adminFeedback.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		adminFeedback.GET("", controller.GetFeedbackList)
		adminFeedback.GET("/stats", controller.GetFeedbackStats)
	}

	paySettingRouter := apiRouter.Group("/pay_settings")
	paySettingRouter.GET("/type/:type", controller.GetPaySettingByType)
	{
		paySettingRouter.GET("", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetPaySettings)
		paySettingRouter.GET("/:id", middleware.UserTokenAuth(model.RoleGuestUser), controller.GetPaySetting)
		paySettingRouter.POST("", middleware.UserTokenAuth(model.RoleAdminUser), controller.CreatePaySetting)
		// paySettingRouter.PUT("/:id", controller.UpdatePaySetting)
		paySettingRouter.DELETE("/:id", middleware.UserTokenAuth(model.RoleAdminUser), controller.DeletePaySetting)
		paySettingRouter.PATCH("/:id/config", middleware.UserTokenAuth(model.RoleAdminUser), controller.UpdatePayConfig)
		paySettingRouter.PATCH("/:id/status", middleware.UserTokenAuth(model.RoleAdminUser), controller.UpdatePayStatus)
	}

	orderRouter := apiRouter.Group("/orders")
	{
		orderRouter.POST("", middleware.UserTokenAuth(model.RoleCommonUser), controller.CreateOrder)
		orderRouter.PUT("/:id/manual", middleware.UserTokenAuth(model.RoleAdminUser), controller.UpdateManualTransferOrder)
		orderRouter.GET("", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetOrders)
		orderRouter.GET("/me", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetOrders)
		orderRouter.GET("/:id", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetOrder)
		orderRouter.PATCH("/:id/status", middleware.UserTokenAuth(model.RoleAdminUser), controller.UpdateOrderStatus) // Only manual transfers can be marked as paid
		orderRouter.DELETE("/:id", middleware.UserTokenAuth(model.RoleAdminUser), controller.DeleteOrder)             // Only manual transfers can be deleted, but paid ones cannot be deleted
		orderRouter.GET("/status/:order_id", middleware.UserTokenAuth(model.RoleCommonUser), controller.QueryOrderStatus)
		orderRouter.POST("/:id/confirm", middleware.UserTokenAuth(model.RoleCommonUser), controller.ConfirmManualPayment)
		orderRouter.GET("/user", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetUserOrders)
		orderRouter.POST("/:id/close", middleware.UserTokenAuth(model.RoleCommonUser), controller.CloseOrder)
		orderRouter.GET("/trade/:order_id", middleware.UserTokenAuth(model.RoleAdminUser), controller.QueryTradeOrder)
		orderRouter.POST("/trade/:order_id/refund", middleware.UserTokenAuth(model.RoleAdminUser), controller.RefunTradeOrder)
	}

	paymentRouter := apiRouter.Group("/payment")
	{
		paymentRouter.GET("/available", controller.GetAvailablePayTypes)
		// Payment notification routes
		paymentRouter.POST("/wechat/notify/:id", controller.WechatPayNotify)
		paymentRouter.POST("/alipay/notify/:id", controller.AlipayNotify)
	}

	// 同步进度相关路由组
	syncProgressRouter := apiRouter.Group("/sync-progress")
	syncProgressRouter.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		syncProgressRouter.GET("/:from", controller.GetSyncProgress)           // 获取指定来源的同步进度
		syncProgressRouter.GET("/:from/all", controller.GetSyncProgressByFrom) // 获取指定来源的所有企业同步进度
		syncProgressRouter.GET("", controller.GetAllSyncProgress)              // 获取所有来源的所有同步进度
	}

	// Department routes
	departmentGroup := apiRouter.Group("/departments")
	departmentGroup.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		departmentGroup.POST("", controller.CreateDepartment)
		departmentGroup.GET("", controller.GetDepartments)
		departmentGroup.GET("/:did", controller.GetDepartment)
		departmentGroup.PUT("/:did", controller.UpdateDepartment)
		departmentGroup.DELETE("/:did", controller.DeleteDepartment)
		departmentGroup.GET("/children/:pdid", controller.GetChildDepartments)
		departmentGroup.GET("/tree", controller.GetDepartmentTree)
		departmentGroup.POST("/sync/:from", controller.SyncOrganization)
		departmentGroup.POST("/bind-member", controller.DepartmentBindMember)
		departmentGroup.DELETE("/bind-member", controller.DepartmentUnbindMember)
	}

	promptGroup := apiRouter.Group("/prompts")
	{
		promptGroup.GET("", controller.GetPrompts)
		promptGroup.GET("/admin", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetPrompts)
		promptGroup.POST("/system", middleware.UserTokenAuth(model.RoleAdminUser), controller.CreatePrompt)
		promptGroup.POST("/personal", middleware.UserTokenAuth(model.RoleCommonUser), controller.CreatePrompt)
		promptGroup.GET("/:pid", controller.GetPrompt)
		promptGroup.PUT("/:pid", middleware.UserTokenAuth(model.RoleCommonUser), controller.UpdatePrompt)
		promptGroup.DELETE("/:pid", middleware.UserTokenAuth(model.RoleCommonUser), controller.DeletePrompt)
		promptGroup.PATCH("/:pid/like", middleware.UserTokenAuth(model.RoleCommonUser), controller.UpdatePromptLike)
		promptGroup.GET("/:pid/groups", middleware.UserTokenAuth(model.RoleCommonUser), controller.GetPromptGroups)
		promptGroup.PATCH("/:pid/status", middleware.UserTokenAuth(model.RoleCommonUser), controller.UpdatePromptStatus)
	}

	navigationRoute := apiRouter.Group("/navigations")
	navigationRoute.GET("", controller.GetNavigations)
	navigationRoute.GET("/icons", controller.GetNavigationIcons)
	navigationRoute.POST("/init", controller.InitSystemNavigation)
	navigationRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		navigationRoute.GET("/:nav_id", controller.GetNavigation)
		navigationRoute.POST("", controller.CreateNavigation)
		navigationRoute.PUT("/:nav_id", controller.UpdateNavigation)
		navigationRoute.DELETE("/:nav_id", controller.DeleteNavigation)
		navigationRoute.PATCH("/:nav_id/status", controller.UpdateNavigationStatus)
		navigationRoute.POST("/sort", controller.SortNavigations)
		navigationRoute.POST("/:nav_id/content", controller.CreateNavigationContent)
		navigationRoute.GET("/:nav_id/content", controller.GetNavigationContent)
	}

	systemLogRouter := apiRouter.Group("/system_logs")
	apiRouter.GET("/system_logs/file_logs/ui", controller.GetFileLogsUI)
	apiRouter.GET("/system_logs/file_logs/search", middleware.FileLogViewerAuth(), controller.SearchFileLogs)
	apiRouter.POST("/system_logs/file_logs/archive", middleware.FileLogViewerAuth(), controller.ArchiveFileLogs)
	apiRouter.GET("/system_logs/slow_logs/ui", controller.GetSlowLogsUI)
	apiRouter.GET("/system_logs/slow_logs", middleware.FileLogViewerAuth(), controller.GetSlowLogs)
	apiRouter.POST("/system_logs/slow_logs/:id/resolve", middleware.FileLogViewerAuth(), controller.ResolveSlowLog)
	apiRouter.POST("/system_logs/slow_logs/:id/ignore", middleware.FileLogViewerAuth(), controller.IgnoreSlowLog)
	systemLogRouter.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		systemLogRouter.GET("/modules", controller.GetModules)
		systemLogRouter.GET("/actions", controller.GetActions)
		systemLogRouter.GET("", controller.GetSystemLogs)
	}

	maxKB := apiRouter.Group("/maxkb")
	{
		maxKB.GET("/application/profile", middleware.UserTokenAuth(model.RoleAdminUser), controller.GetMaxKBApplicationProfile)
	}

	difyRouter := apiRouter.Group("/dify")
	difyRouter.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		difyRouter.GET("/info/:channelId", controller.GetDifyAppInfo)
		difyRouter.GET("/parameters/:channelId", controller.GetDifyAppParameters)
	}

	sharesAuth := apiRouter.Group("/shares")
	sharesAuth.Use(middleware.UserTokenAuth(model.RoleGuestUser))
	{
		sharesAuth.POST("", controller.CreateShare)
	}

	sharesPublic := apiRouter.Group("/shares")
	{
		sharesPublic.GET("/:share_id", controller.GetShare)
	}
	// 空间管理路由
	spaceRoute := apiRouter.Group("/spaces")
	spaceRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		spaceRoute.POST("", controller.CreateSpace)
		spaceRoute.GET("", controller.GetSpaces)
		spaceRoute.GET("/:space_id", controller.GetSpace)
		spaceRoute.PUT("/:space_id", controller.UpdateSpace)
		spaceRoute.DELETE("/:space_id", controller.DeleteSpace)
		spaceRoute.POST("/sort", controller.BatchUpdateSpaceSort)
	}

	// 通用权限管理路由
	permissionRoute := apiRouter.Group("/permissions")
	permissionRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		permissionRoute.GET("", controller.GetPermissions)
		permissionRoute.GET("/detail", controller.GetDetailPermissions)
		permissionRoute.GET("/my", controller.GetMyPermissions)
		permissionRoute.POST("/my/batch", controller.GetMyPermissionsBatch)
		permissionRoute.POST("/:resource_type/:resource_id", controller.CreatePermissions)
		permissionRoute.PUT("/:permission_id", controller.UpdatePermission)
		permissionRoute.DELETE("/:permission_id", controller.DeletePermission)
	}

	// 知识库管理路由
	libraryRoute := apiRouter.Group("/libraries")
	libraryRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		libraryRoute.POST("", controller.CreateLibrary)
		libraryRoute.GET("", controller.GetLibraries)
		libraryRoute.GET("/recently", controller.GetRecentlyLLibraries)
		libraryRoute.GET("/search", controller.SearchLibrariesByName) // 搜索全部知识库根据名字
		libraryRoute.GET("/:library_id", controller.GetLibrary)
		libraryRoute.PUT("/:library_id", controller.UpdateLibrary)
		libraryRoute.DELETE("/:library_id", controller.DeleteLibrary)
		libraryRoute.POST("/sort", controller.BatchUpdateLibrarySort)
		// 知识库查询历史管理
		libraryRoute.GET("/:library_id/queries", controller.GetLibraryQueries) // 获取知识库的查询历史

		// 知识库搜索接口
		libraryRoute.POST("/:library_id/search", controller.LibrarySearch) // 在指定知识库中进行搜索
	}

	// 数据清理相关接口
	cleanupRoute := apiRouter.Group("/cleanup")
	cleanupRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		cleanupRoute.GET("/stats", controller.GetCleanupStats)
		cleanupRoute.POST("/orphaned", controller.CleanupOrphanedData)
		cleanupRoute.POST("/file/:file_id", controller.CleanupFileData)
		cleanupRoute.GET("/file/:file_id/stats", controller.GetFileDeletionStatsAPI)
		cleanupRoute.POST("/entity-vectors/repair", controller.RepairEntityVectorsByEID)
	}

	fileRoute := apiRouter.Group("/files")
	fileRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		fileRoute.POST("", controller.CreateFile)
		fileRoute.GET("", controller.GetFileList)
		fileRoute.GET("/children", controller.GetFileChildrenList)
		fileRoute.GET("/all", controller.GetAllFileList)
		fileRoute.GET("/all/stats", controller.GetRagFileRunStats)
		fileRoute.GET("/:file_id", controller.GetFile)
		fileRoute.PUT("/:file_id/raw", controller.UpdateRawFileContent)
		fileRoute.GET("/:file_id/parent-exists", controller.ParentExists)
		fileRoute.GET("/recently", controller.GetRecentlyFileList)
		fileRoute.GET("/recently-updated", controller.GetRecentlyUpdatedFileList)
		fileRoute.POST("/sort", controller.BatchUpdateSort)
		fileRoute.PUT("/rename", controller.RenameFile)
		fileRoute.PUT("/:file_id/generated-content", controller.UpdateFileGeneratedContent)
		fileRoute.PUT("/:file_id/index-status", controller.UpdateFileIndexingStatus)
		fileRoute.DELETE("/:file_id", controller.DeleteFile)

		// 文件统计接口
		fileRoute.GET("/stats", controller.GetFileStats)
		fileRoute.GET("/libraries/:library_id/stats", controller.GetFileStats)

		// 文件名搜索接口 - 整合到搜索子路由组中
		searchFileRoute := fileRoute.Group("/search")
		{
			searchFileRoute.GET("/by-name", controller.FileNameSearch)
			searchFileRoute.POST("/by-name", controller.FileNameSearch)
			searchFileRoute.GET("/autocomplete", controller.FileNameAutoComplete)
		}

		// 回收站与恢复接口
		fileRoute.GET("/recycle-bin", controller.ListRecycleBin)
		fileRoute.POST("/:file_id/restore", controller.RestoreFile)
		// 恢复文件解析接口
		fileRoute.POST("/:file_id/recover-chunking", controller.RecoverFileChunking)

		// 管理员彻底删除接口
		fileRoute.DELETE("/:file_id/hard-delete", controller.HardDeleteFile)

		// 新的删除相关接口
		fileRoute.GET("/:file_id/deletion-preview", controller.GetFileDeletionPreview)
		fileRoute.DELETE("/:file_id/delete-async", controller.DeleteFileAsync)

		// 文件编辑锁接口
		fileRoute.POST(":file_id/edit-lock", controller.FileEditLock)

		// 生成问题和简介接口
		fileRoute.POST("/:file_id/generate-questions-and-summary", controller.GenerateQuestionsAndSummary)

		// 知识地图生成接口
		fileRoute.POST("/:file_id/generate-knowledge-map", controller.GenerateKnowledgeMap)
		fileRoute.POST("/:file_id/knowledge-map/record-query", controller.RecordKnowledgeMapQuery)

		// 实体关联接口
		fileRoute.GET("/:file_id/entities", controller.GetFileEntities)
		fileRoute.POST("/:file_id/entities", controller.AddEntityToFile)
		fileRoute.DELETE("/:file_id/entities", controller.RemoveEntityFromFile)

		// 图谱数据接口
		fileRoute.GET("/:file_id/graph", controller.GetFileGraph)

	}

	// 批量上传接口使用独立鉴权，支持普通登录态和 MCP 换发的短期委派 token。
	batchUploadController := controller.NewBatchUploadController()
	batchUploadRoute := apiRouter.Group("/files/upload/batch")
	batchUploadRoute.Use(middleware.BatchUploadAuth(model.RoleCommonUser))
	{
		// 初始化批量上传
		batchUploadRoute.POST("/init", batchUploadController.InitBatchUpload)

		// 文件上传
		batchUploadRoute.POST("/:batch_id/file", batchUploadController.UploadFile)

		// 进度查询（轮询）
		batchUploadRoute.GET("/:batch_id/progress", batchUploadController.GetProgress)

		// 取消上传
		batchUploadRoute.DELETE("/:batch_id", batchUploadController.CancelBatch)
	}

	fileBodyRoute := apiRouter.Group("/file-bodies")
	fileBodyRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		fileBodyRoute.POST("", controller.CreateFileBody)
		fileBodyRoute.GET("/last/:file_id", controller.GetLastFileBody)
		fileBodyRoute.GET("/:file_id", controller.GetFileBodyList)
		fileBodyRoute.GET("/:file_id/chunking-status", controller.GetChunkingStatus)
		fileBodyRoute.GET("/:file_id/chunks", controller.GetFileChunksDetail)
		fileBodyRoute.POST("/:file_id/chunks/merge", controller.MergeFileChunks)
		fileBodyRoute.POST("/:file_id/chunks/:chunk_id/split", controller.SplitFileChunk)
		fileBodyRoute.POST("/:file_id/reconvert", controller.ReConvert)
		// 测试路由，用于测试 processEmbeddingForNewChunks 函数
		fileBodyRoute.POST("/test-embedding-process", controller.ProcessEmbeddingForNewChunksTest)
	}

	// 分块配置路由
	chunkConfigRoute := apiRouter.Group("/chunk-settings")
	chunkConfigRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		chunkConfigRoute.GET("", controller.GetChunkSettings)
		chunkConfigRoute.GET("/default", controller.GetDefaultChunkingConfig)

		// 保留原有的完整配置接口
		chunkConfigRoute.GET("/channels", controller.GetAvailableChannels)
		chunkConfigRoute.POST("/validate-channels", controller.ValidateChannels)
		chunkConfigRoute.GET("/embedding-models", controller.GetEmbeddingModelsForConfig)
		chunkConfigRoute.POST("/validate-embedding-model", controller.ValidateEmbeddingModelForConfig)

		// 模型配置JSON专用接口
		modelConfigRoute := chunkConfigRoute.Group("/model-config")
		{
			// 站点级模型配置
			modelConfigRoute.GET("/site", controller.GetSiteModelConfig)
			modelConfigRoute.PUT("/site", controller.UpdateSiteModelConfig)

			// 知识库级模型配置
			modelConfigRoute.GET("/library/:library_id", controller.GetLibraryModelConfig)
			modelConfigRoute.PUT("/library/:library_id", controller.UpdateLibraryModelConfig)
		}

		// 资料拆分配置JSON专用接口
		chunkingConfigRoute := chunkConfigRoute.Group("/chunking-config")
		{
			// 站点级资料拆分配置
			chunkingConfigRoute.GET("/site", controller.GetSiteChunkingConfig)
			chunkingConfigRoute.PUT("/site", controller.UpdateSiteChunkingConfig)

			// 知识库级资料拆分配置
			chunkingConfigRoute.GET("/library/:library_id", controller.GetLibraryChunkingConfig)
			chunkingConfigRoute.PUT("/library/:library_id", controller.UpdateLibraryChunkingConfig)

			// 文档级资料拆分配置
			chunkingConfigRoute.GET("/document/:file_id", controller.GetDocumentChunkingConfig)
			chunkingConfigRoute.PUT("/document/:file_id", controller.UpdateDocumentChunkingConfig)
		}

		// 文档扩展名映射信息接口
		chunkConfigRoute.GET("/document-extension-map", controller.GetDocumentExtensionMapping)
	}

	// 文档分块路由
	chunkRoute := apiRouter.Group("/chunks")
	chunkRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		// 知识点分块管理
		chunkRoute.POST("/files/:file_id", controller.CreateFileChunks)
		chunkRoute.GET("/files/:file_id", controller.GetFileChunks)
		chunkRoute.POST("/files/:file_id/batch", controller.BatchUpdateSegments)
		chunkRoute.POST("/knowledge", controller.SaveKnowledgeChunk)
		chunkRoute.POST("/batch-get", controller.BatchGetChunks)
		chunkRoute.GET("/:id", controller.GetChunk)
		chunkRoute.PUT("/:id", controller.UpdateChunk)
		chunkRoute.DELETE("/:id", controller.DeleteChunk)
		chunkRoute.POST("/merge", controller.MergeChunks)
		chunkRoute.POST("/:id/split", controller.SplitChunk)
		chunkRoute.POST("/restore", controller.RestoreDocument)
		chunkRoute.POST("/sync", controller.SyncChunksToDocument)
		chunkRoute.POST("/status", controller.CheckDocumentStatus)

		// 检索块管理
		chunkRoute.GET("/knowledge/:knowledge_id/retrieval", controller.GetKnowledgeRetrievalChunks)
		chunkRoute.POST("/knowledge/:knowledge_id/retrieval", controller.CreateRetrievalChunk)
		chunkRoute.PUT("/retrieval/:retrieval_id", controller.UpdateRetrievalChunk)
		chunkRoute.DELETE("/retrieval/:retrieval_id", controller.DeleteRetrievalChunk)
		chunkRoute.POST("/retrieval/merge", controller.MergeRetrievalChunks)
		chunkRoute.POST("/retrieval/:retrieval_id/split", controller.SplitRetrievalChunk)

		// 关联关系统计
		chunkRoute.GET("/relations/stats/:file_id", controller.GetChunkRelationStats)

		// 分块启用/停用功能
		chunkRoute.POST("/:id/enable", controller.EnableChunk)
		chunkRoute.POST("/:id/disable", controller.DisableChunk)
		chunkRoute.POST("/batch/enable", controller.BatchEnableChunks)
		chunkRoute.POST("/batch/disable", controller.BatchDisableChunks)

		chunkRoute.POST("/reindex", controller.ReindexDocument)

		// 预览功能
		chunkRoute.POST("/preview", controller.PreviewChunking)
	}

	// 文档分块统计路由
	documentChunkStatsRoute := apiRouter.Group("/document-chunks")
	documentChunkStatsRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		documentChunkStatsRoute.GET("/stats", controller.GetDocumentChunkStats)
		documentChunkStatsRoute.GET("/libraries/:library_id/stats", controller.GetDocumentChunkStats)
	}

	// 检索块统计路由
	retrievalChunkStatsRoute := apiRouter.Group("/retrieval-chunks")
	retrievalChunkStatsRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		retrievalChunkStatsRoute.GET("/stats", controller.GetRetrievalChunkStats)
		retrievalChunkStatsRoute.GET("/libraries/:library_id/stats", controller.GetRetrievalChunkStats)
	}

	entitiesRoute := apiRouter.Group("/entities")
	entitiesRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		entitiesRoute.GET("/types", controller.GetEntityTypes)
		entitiesRoute.GET("", controller.ListEntities)
		entitiesRoute.GET("/:id", controller.GetEntity)
		entitiesRoute.POST("", controller.CreateEntity)
		entitiesRoute.POST("/batch-link", controller.BatchLinkEntities)
		entitiesRoute.GET("/search-files", controller.SearchEntityFiles)
		entitiesRoute.PUT("/:id", controller.UpdateEntity)
		entitiesRoute.DELETE("/:id", controller.DeleteEntity)
	}

	// 图谱模板路由
	graphTemplateRoute := apiRouter.Group("/graph-templates")
	graphTemplateRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		graphTemplateRoute.GET("", controller.GetGraphTemplateList)
		graphTemplateRoute.GET("/:id", controller.GetGraphTemplateDetail)
		graphTemplateRoute.POST("", controller.CreateGraphTemplate)
		graphTemplateRoute.PUT("/:id", controller.UpdateGraphTemplate)
		graphTemplateRoute.DELETE("/:id", controller.DeleteGraphTemplate)
		graphTemplateRoute.POST("/suggest-template-params", controller.SuggestTemplateParams)
		graphTemplateRoute.POST("/suggest-relations", controller.SuggestRelations)
	}

	// 搜索路由
	searchRoute := apiRouter.Group("/search")
	searchRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		searchRoute.POST("", controller.Search)
		searchRoute.POST("/vector", controller.VectorSearch)
		searchRoute.POST("/fulltext", controller.FulltextSearch)
		searchRoute.POST("/hybrid", controller.HybridSearch)
		searchRoute.GET("/suggestions", controller.SearchSuggestions)
		searchRoute.GET("/history", controller.GetSearchHistory)
	}

	// 向量化处理路由
	embeddingRoute := apiRouter.Group("/embedding")
	embeddingRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		embeddingRoute.POST("/process", controller.ProcessEmbedding)
		embeddingRoute.GET("/models", controller.GetAvailableEmbeddingModels)
		embeddingRoute.GET("/models/groups", controller.GetEmbeddingModelGroups)
		embeddingRoute.GET("/models/default", controller.GetDefaultEmbeddingModel)
		embeddingRoute.GET("/models/rerank", controller.GetDefaultRerankModel)
		embeddingRoute.GET("/models/:model_name", controller.GetEmbeddingModelInfo)
		embeddingRoute.GET("/channels/:channel_id/models", controller.GetChannelEmbeddingModels)
		embeddingRoute.POST("/models/validate", controller.ValidateEmbeddingModel)
	}

	// RAG 路由组
	ragRoute := apiRouter.Group("/rag")
	ragRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		// ragRoute.POST("/ask", ragQAController.Ask)
		ragRoute.POST("/search", ragQAController.SearchKnowledge)
		ragRoute.POST("/migrate/questions-summary-entities", controller.GenerateQuestionsSummaryAndEntitiesMigration)
		ragRoute.GET("/config", ragQAController.GetRAGConfig)
		ragRoute.GET("/stats", ragQAController.GetRAGStats)
		ragRoute.GET("/conversations/:conversation_id/history", ragQAController.GetConversationHistory)

		// RAG任务管理路由
		ragRoute.GET("/jobs/:job_id", controller.GetRAGJob)
		ragRoute.GET("/jobs", controller.ListRAGJobs)
		ragRoute.PUT("/jobs/:job_id/cancel", controller.CancelRAGJob)
	}

	// RAG V2 路由组 - 统一挂载在 /api/rag/v2 下
	ragV2Route := ragRoute.Group("/v2")
	ragV2Route.Use(middleware.Logger())
	ragV2Route.Use(middleware.SlowAPILogger())
	ragV2Route.Use(middleware.HashidsDecoder())
	ragV2Route.Use(middleware.RequestDecoder())
	ragV2Route.Use(middleware.ResponseEncoder())

	ragV2CommonRoute := ragV2Route.Group("")
	ragV2CommonRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		ragV2CommonRoute.GET("/jobs/by-related", controller.GetRagJobsByRelatedIDV2)
		ragV2CommonRoute.PUT("/jobs/:job_id/cancel", controller.CancelRagJobV2)
		ragV2CommonRoute.POST("/jobs/:job_id/retry", controller.RetryRagJobStepV2)
		ragV2CommonRoute.POST("/jobs/batch-retry", controller.BatchRetryRagJobStepV2)
	}

	ragV2AdminRoute := ragV2Route.Group("")
	ragV2AdminRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		pc := controller.NewRagPipelineController(model.DB)

		ragV2AdminRoute.GET("/pipelines", pc.ListPipelines)
		ragV2AdminRoute.GET("/pipelines/:id", pc.GetPipeline)
		ragV2AdminRoute.POST("/pipelines", pc.CreatePipeline)
		ragV2AdminRoute.PUT("/pipelines/:id", pc.UpdatePipeline)
		ragV2AdminRoute.DELETE("/pipelines/:id", pc.DeletePipeline)

		ragV2AdminRoute.GET("/strategies", pc.ListStrategies)
		ragV2AdminRoute.POST("/strategies", pc.CreateStrategy)
		ragV2AdminRoute.PUT("/strategies/:id", pc.UpdateStrategy)
		ragV2AdminRoute.POST("/strategies/reorder", pc.ReorderStrategies)
		ragV2AdminRoute.DELETE("/strategies/:id", pc.DeleteStrategy)
	}

	// 外部知识库API路由（用于Dify等外部系统集成）
	externalKnowledgeController := controller.NewExternalKnowledgeController()
	externalKnowledgeRoute := apiRouter.Group("/external-knowledge")
	externalKnowledgeRoute.Use(middleware.ExternalAPIKeyAuth())
	{
		externalKnowledgeRoute.POST("/retrieval", externalKnowledgeController.Retrieval)
	}

	// API密钥管理路由
	apiKeyController := controller.NewAPIKeyController()
	apiKeyRoute := apiRouter.Group("/api-keys")
	apiKeyRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		apiKeyRoute.POST("", apiKeyController.CreateAPIKey)
		apiKeyRoute.GET("", apiKeyController.GetAPIKeys)
		apiKeyRoute.DELETE("/:id", apiKeyController.DeleteAPIKey)
		apiKeyRoute.POST("/:id/disable", apiKeyController.DisableAPIKey)
		apiKeyRoute.POST("/:id/enable", apiKeyController.EnableAPIKey)
	}

	// 新增：知识库相关的API密钥管理路由（供有权限的用户访问特定知识库的API密钥）
	libraryApiKeyRoute := apiRouter.Group("/libraries/:library_id/api-keys")
	libraryApiKeyRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		libraryApiKeyRoute.POST("", apiKeyController.CreateAPIKey)
		libraryApiKeyRoute.GET("", apiKeyController.GetAPIKeys)
		libraryApiKeyRoute.DELETE("/:key_id", apiKeyController.DeleteAPIKey)
		libraryApiKeyRoute.POST("/:key_id/disable", apiKeyController.DisableAPIKey)
		libraryApiKeyRoute.POST("/:key_id/enable", apiKeyController.EnableAPIKey)
	}

	// 快捷方式路由
	shortcutsRoute := apiRouter.Group("/shortcuts")
	shortcutsRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		shortcutsRoute.POST("", controller.CreateShortcut)
		shortcutsRoute.GET("", controller.ListShortcuts)
		shortcutsRoute.GET("/by_related", controller.GetShortcutByTypeRelatedID)
		shortcutsRoute.DELETE("/:id", controller.DeleteShortcut)
	}

	// 收藏路由
	favoritesRoute := apiRouter.Group("/favorites")
	favoritesRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		favoritesRoute.POST("/toggle", controller.ToggleFavorite)
		favoritesRoute.GET("", controller.ListFavorites)
	}

	// Elasticsearch 管理路由
	adminESRoute := apiRouter.Group("/admin/elasticsearch")
	adminESRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		adminESRoute.GET("/status", controller.GetElasticsearchStatus)
		adminESRoute.POST("/refresh", controller.RefreshElasticsearchIndex)
	}

	// 平台管理员文件管理路由
	adminFileRoute := apiRouter.Group("/admin/files")
	adminFileRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		// 批量导入现有文档到 Elasticsearch
		adminFileRoute.POST("/import-to-es", controller.BatchImportToES)
	}

	fileVersionRoute := apiRouter.Group("/file-body-versions")
	fileVersionRoute.Use(middleware.UserTokenAuth(model.RoleCommonUser))
	{
		// 文件版本管理
		// 创建/保存版本
		fileVersionRoute.POST("/file-body/:file_body_id", controller.CreateFileBodyVersion)
		// 获取版本列表（关联查出对应版本的file_bodies）
		fileVersionRoute.GET("/:file_id", controller.GetFileBodyVersionList)
		// 编辑版本名
		fileVersionRoute.PUT("/:id", controller.UpdateFileBodyVersion)
		// 删除版本
		fileVersionRoute.DELETE("/:id", controller.DeleteFileBodyVersion)
	}

	// WebSocket 管理路由（仅管理员可访问）
	wsAdminRoute := apiRouter.Group("/admin/ws")
	wsAdminRoute.Use(middleware.UserTokenAuth(model.RoleAdminUser))
	{
		wsAdminRoute.GET("/connections", controller.GetWSConnections)
		wsAdminRoute.GET("/metrics", controller.GetWSMetrics)
		wsAdminRoute.POST("/agents/:id/ban", controller.BanWSAgent)
		wsAdminRoute.POST("/agents/:id/unban", controller.UnbanWSAgent)
	}

	SetKmApiRouter(apiRouter)

	// WPS 集成路由
	wpsRouter := apiRouter.Group("/wps")
	{
		// 文件基础信息接口
		wpsRouter.GET("/v3/3rd/files/:file_id", controller.GetWPSFile)
		wpsRouter.GET("/v3/3rd/files/:file_id/download", controller.GetWPSFileDownload)
		wpsRouter.GET("/v3/3rd/files/:file_id/permission", controller.GetWPSFilePermission)
		// // 用户信息接口
		wpsRouter.GET("/v3/3rd/users", controller.GetWPSUsers)
		// // 水印接口
		// wpsRouter.GET("/v3/3rd/files/:file_id/watermark", controller.GetWPSFileWatermark)
		// // 文件编辑接口
		// wpsRouter.POST("/v3/3rd/files/:file_id/upload", controller.UpdateWPSFile)
		wpsRouter.PUT("/v3/3rd/files/:file_id/name", controller.RenameWPSFile)
		// 三阶段上传接口
		wpsRouter.GET("/v3/3rd/files/:file_id/upload/prepare", controller.PrepareWPSFileUpload)
		wpsRouter.POST("/v3/3rd/files/:file_id/upload/address", controller.GetWPSFileUploadAddress)
		wpsRouter.PUT("/v3/3rd/files/:file_id/upload/execute", controller.ExecuteWPSFileUpload)
		wpsRouter.POST("/v3/3rd/files/:file_id/upload/complete", controller.CompleteWPSFileUpload)
		wpsRouter.GET("/ticket", controller.GenerateTicket)
		// // 文件版本管理接口
		// wpsRouter.GET("/v3/3rd/files/:file_id/versions", controller.GetWPSFileVersions)
		// wpsRouter.GET("/v3/3rd/files/:file_id/versions/:version", controller.GetWPSFileVersion)
		// wpsRouter.GET("/v3/3rd/files/:file_id/versions/:version/download", controller.GetWPSFileVersionDownload)
	}

}
