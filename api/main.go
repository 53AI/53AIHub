package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/53AI/53AIHub/controller"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/keystone"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/router"
	"github.com/53AI/53AIHub/service"
	hub_openai "github.com/53AI/53AIHub/service/hub_adaptor/openai"
	"github.com/53AI/53AIHub/service/image_asset"
	"github.com/53AI/53AIHub/service/sms"
	"github.com/53AI/53AIHub/service/sonicnote"
	"github.com/53AI/53AIHub/service/tools"
	"github.com/53AI/53AIHub/service/vectorstore"

	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/schemamigrate"
	"github.com/53AI/53AIHub/service/skill"
	"github.com/53AI/53AIHub/tasks"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"gorm.io/gorm"
)

// buildFS 由构建标签控制的文件定义 (embed_local.go 或 embed_saas.go)
// 本地部署版本包含前端资源, SaaS 版本仅包含基础静态资源

func main() {
	common.Init()

	// 初始化 Keystone 上报客户端
	keystoneCfg := keystone.LoadConfig()
	keystoneCfg.Endpoint = config.KEYSTONE_ENDPOINT
	keystoneCfg.IntegrationKey = config.KEYSTONE_INTEGRATION_KEY
	keystoneCfg.Secret = config.KEYSTONE_SECRET
	keystoneCfg.ProductKey = config.KEYSTONE_PRODUCT_KEY
	keystoneCfg.ServiceKey = config.KEYSTONE_SERVICE_KEY
	keystoneCfg.EnvironmentKey = config.KEYSTONE_ENVIRONMENT_KEY
	keystoneCfg.Enabled = config.KEYSTONE_ENABLED
	keystoneClient := keystoneCfg.ToClient()
	keystone.GlobalClient = keystoneClient
	if keystoneClient != nil {
		logger.SysLogf("Keystone 上报客户端已初始化: endpoint=%s product=%s service=%s", config.KEYSTONE_ENDPOINT, config.KEYSTONE_PRODUCT_KEY, config.KEYSTONE_SERVICE_KEY)
	} else {
		logger.SysLogf("Keystone 上报客户端未启用 (设置 KEYSTONE_ENABLED=true 和 KEYSTONE_ENDPOINT/KEYSTONE_SECRET)")
	}
	model.InitDB()
	appCtx, appCancel := context.WithCancel(context.Background())
	defer appCancel()
	service.StartAgentRunRecoveryWorker(appCtx)
	model.StartAIUploadFileCleanupWorker(appCtx)
	if err := service.InitRecordingStorageLayout(); err != nil {
		logger.SysWarn(fmt.Sprintf("录音存储目录检查或修复失败: root=%s spool=%s err=%v", config.RecordingLocalRoot(), config.RecordingAssemblySpoolRoot(), err))
	} else {
		logger.SysLogf("录音存储目录检查通过: root=%s spool=%s", config.RecordingLocalRoot(), config.RecordingAssemblySpoolRoot())
	}
	if summary, err := service.RunRecordingRecoveryAfterBoot(appCtx); err != nil {
		logger.SysWarn(fmt.Sprintf("录音启动恢复失败: assemblies=%d finalizing=%d err=%v", summary.AssembliesRecovered, summary.FinalizingRecovered, err))
	} else {
		logger.SysLogf("录音启动恢复完成: assemblies=%d finalizing=%d", summary.AssembliesRecovered, summary.FinalizingRecovered)
	}
	// 同步启动恢复：标记当前实例中断的 SonicNote 同步任务（多实例安全）
	if err := sonicnote.RecoverSyncState(appCtx); err != nil {
		logger.SysWarn(fmt.Sprintf("SonicNote 同步启动恢复失败: %v", err))
	}
	chunkTempDir := config.ChunkUploadTempDir()
	if err := os.MkdirAll(chunkTempDir, 0o755); err != nil {
		logger.SysWarn(fmt.Sprintf("Chunk 上传临时目录检查失败: path=%s err=%v", chunkTempDir, err))
	} else {
		logger.SysLogf("Chunk 上传临时目录检查通过: path=%s", chunkTempDir)
	}
	service.StartRecordingResidualCleanupWorker(appCtx)
	service.StartRecordingFinalizeWorker(appCtx)
	service.InitLibraryFileCountCacheInvalidator()
	service.InitLibraryCacheInvalidator()
	// 启动全局统计定时推送（推送到 Keystone）
	controller.StartGlobalStatsPushWorker(appCtx, 5*time.Minute)


	// 检查并执行数据迁移
	// needMigration, err := model.CheckMigrationNeeded()
	// if err != nil {
	// 	logger.FatalLog("failed to check migration status: " + err.Error())
	// }
	// if needMigration {
	// 	if err := model.MigrateToSpaceLibraryStructure(); err != nil {
	// 		logger.FatalLog("failed to migrate to space-library structure: " + err.Error())
	// 	}
	// }

	// 执行UUID迁移
	if err := addUUIDToLibrary(model.DB); err != nil {
		logger.FatalLog("failed to migrate library UUID: " + err.Error())
	}

	client.Init()
	// 异步初始化 token encoders，避免阻塞启动
	go openai.InitTokenEncoders()
	hub_openai.InitTokenEncoders()

	// 初始化SMS服务
	smsConfig := sms.SMSConfig{
		Enabled:    config.SMS_ENABLED,
		Provider:   config.SMS_PROVIDER,
		Account:    config.SMS_ACCOUNT,
		Password:   config.SMS_PASSWORD,
		SignName:   config.SMS_SIGN_NAME,
		Template:   config.SMS_TEMPLATE,
		CodeLength: config.SMS_CODE_LENGTH,
		ExpiryTime: config.SMS_EXPIRY_TIME,
	}
	if err := sms.InitSMSManager(smsConfig); err != nil {
		logger.SysWarn(fmt.Sprintf("Failed to initialize SMS service: %v", err))
	}

	service.InitRuntimeMode(context.Background())

	tasks.Start()
	// rag.InitChunkSaveIntegration(model.DB)

	// 初始化自动分块服务
	service.InitAutoChunkingService(model.DB)
	logger.SysLogf("auto chunking service initialized successfully")

	// 初始化 Skill Manager
	if err := skill.GetManager().Init("data/skills"); err != nil {
		logger.SysWarn(fmt.Sprintf("Failed to initialize Skill Manager: %v", err))
	} else {
		logger.SysLogf("Skill Manager initialized successfully")
		// 预热技能环境变量缓存
		go service.WarmupSkillEnvVarCache(context.Background())
	}

	// 初始化图片资源服务
	image_asset.InitImageAssetService()

	// 初始化 Elasticsearch 客户端
	if err := elasticsearch.InitGlobalClient(); err != nil {
		logger.SysLogf("初始化 Elasticsearch 客户端失败: %v", err)
	} else {
		logger.SysLogf("Elasticsearch 客户端初始化成功")
	}

	// 初始化全局向量存储实例
	if err := vectorstore.InitGlobalVectorStore(); err != nil {
		logger.SysLogf("初始化全局向量存储实例失败: %v", err)
	} else {
		logger.SysLogf("全局向量存储实例初始化成功")
	}

	// 初始化RAG任务引擎
	service.InitRAGJobEngine()

	// 初始化并注入Embedding队列（使用懒启动消费者）
	if common.RedisEnabled {
		// 使用 common 包中的全局 Redis 客户端；如你的变量名不同请调整
		rdb := common.RDB
		if rdb != nil {
			q := rag.NewEmbeddingQueue(rdb, rag.WorkerOptions{
				DefaultConcurrency: 5,
				MaxRetries:         5,                // 增加重试次数
				DedupTTL:           2 * time.Hour,    // 延长去重TTL到2小时
				LockTTL:            5 * time.Minute,  // 延长锁TTL到5分钟
				ReadBlock:          2 * time.Second,  // 减少阻塞时间到2秒
				RetryBackoff:       10 * time.Second, // 增加重试间隔到10秒
				StreamPrefix:       "rag:emb:stream",
				GroupName:          "rag:emb:group",
				PendingIdleFor:     5 * time.Minute, // 增加待处理空闲时间
			})
			rag.SetDefaultEmbeddingQueue(q)

			// 启动分块AI增益异步worker
			service.StartChunkEnrichmentWorker(rdb, model.DB)

			// 可选：预热某个 EID 的 worker；若不需要可依赖懒启动
			// _ = q.StartOrUpdateWorkers(context.Background(), 1)
			logger.SysLogf("embedding queue initialized with optimized parameters")

			// 启动Redis连接池状态监控
			/*
				go func() {
					ticker := time.NewTicker(5 * time.Minute) // 每5分钟记录一次
					defer ticker.Stop()
					for {
						select {
						case <-ticker.C:
							common.LogRedisPoolStats()
						}
					}
				}()
			*/
		} else {
			logger.SysLogf("embedding queue skipped: redis client not initialized")
		}
	}

	// 启动图片下载工作器（降低并发，避免 DB 1040）
	ctx := context.Background()
	go image_asset.StartImageDownloadWorkers(ctx, 4, 10) // 4个worker，10/s限流（可按压测调优）

	// 启动时恢复未完成的解析任务
	if config.Server != "local" {
		go func() {
			// 等待系统完全启动
			time.Sleep(5 * time.Second)
			logger.SysLogf("开始恢复解析状态为parsing的文件任务...")

			if err := service.RecoverParsingFiles(); err != nil {
				logger.SysLogf("恢复解析状态为parsing的文件任务失败: %v", err)
			} else {
				logger.SysLogf("解析状态为parsing的文件任务恢复完成")
			}
		}()
	}

	logger.SetLogLevel(config.LOG_LEVEL)
	if config.LOG_LEVEL == "DEBUG" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}
	logger.SysLogf("server started on http://localhost:%s", config.SERVER_PORT)
	server := gin.New()

	// 设置multipart表单的最大内存限制，支持大文件上传，流式处理可以小点
	server.MaxMultipartMemory = 64 << 20

	router.SetRouter(server, buildFS)
	logger.SysLogf("mcp server mounted on http://localhost:%s/mcp", config.SERVER_PORT)

	// 使用优雅关闭
	if err := runServerWithGracefulShutdown(server, config.SERVER_PORT); err != nil {
		logger.FatalLog("failed to start HTTP server: " + err.Error())
	}
}

// runServerWithGracefulShutdown 启动服务器并支持优雅关闭
func runServerWithGracefulShutdown(server *gin.Engine, port string) error {
	// 创建 HTTP server
	httpServer := &http.Server{
		Addr:    ":" + port,
		Handler: server,
	}

	// 启动服务器（非阻塞）
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.FatalLog("HTTP server error: " + err.Error())
		}
	}()

	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.SysLogf("正在关闭服务器...")

	// 关闭全局向量存储实例（停止缓冲器）
	if err := vectorstore.CloseGlobalVectorStore(); err != nil {
		logger.SysLogf("关闭向量存储失败: %v", err)
	}

	// 创建关闭超时上下文
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := tools.ShutdownSandboxRuntime(ctx); err != nil {
		logger.SysLogf("关闭沙盒运行时失败: %v", err)
	}

	// 优雅关闭 HTTP server
	if err := httpServer.Shutdown(ctx); err != nil {
		logger.SysLogf("服务器强制关闭: %v", err)
		return err
	}

	logger.SysLogf("服务器已优雅关闭")
	return nil
}

func scheduleSchemaMigrateAfterBoot() {
	if !config.MigrateDBEnabled {
		logger.SysLogf("【工具执行】Schema 迁移跳过: MIGRATE_DB_ENABLED=false")
		return
	}
	if !config.SchemaMigrateAutoEnabled {
		logger.SysLogf("【工具执行】Schema 迁移跳过: SCHEMA_MIGRATE_AUTO_ENABLED=false")
		return
	}

	delay := time.Duration(config.SchemaMigrateAutoDelaySeconds) * time.Second
	logger.SysLogf("【工具执行】Schema 迁移已调度: delay=%s", delay)
	go func() {
		if delay > 0 {
			time.Sleep(delay)
		}

		sqlDB, err := model.DB.DB()
		if err != nil {
			logger.SysErrorf("【工具执行】Schema 迁移执行失败: %v", err)
			return
		}

		runOpts := schemamigrate.BuildRunOptions(
			config.SchemaMigrateGuardEnabled,
			config.SchemaMigrateGuardMaxWaitSeconds,
			config.SchemaMigrateGuardPollSeconds,
		)
		result, err := schemamigrate.RunUpWithOptions(sqlDB, model.DB.Dialector.Name(), runOpts)
		if err != nil {
			logger.SysErrorf("【工具执行】Schema 迁移执行失败: %v", err)
			return
		}

		logger.SysLogf(
			"【工具执行】Schema 迁移执行完成: dialect=%s, applied=%v, version=%d, dirty=%v",
			result.Dialect, result.Applied, result.Version, result.Dirty,
		)
	}()
}

// addUUIDToLibrary 为Library表添加UUID字段并填充已有数据
func addUUIDToLibrary(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("database connection is nil")
	}

	migrator := db.Migrator()
	if migrator == nil {
		return fmt.Errorf("database migrator is nil")
	}

	if !migrator.HasTable(&model.Library{}) {
		return nil
	}

	if err := db.AutoMigrate(&model.Library{}); err != nil {
		return fmt.Errorf("auto migrate library table: %w", err)
	}

	var count int64
	db.Model(&model.Library{}).Where("uuid IS NULL OR uuid = ''").Count(&count)
	if count > 0 {
		db.Model(&model.Library{}).Where("uuid = ''").Update("uuid", gorm.Expr("NULL"))

		var libraries []model.Library
		result := db.Model(&model.Library{}).Where("uuid IS NULL").Find(&libraries)
		if result.Error != nil {
			return result.Error
		}

		for _, library := range libraries {
			uuidValue := uuid.New().String()
			result := db.Model(&model.Library{}).Where("id = ?", library.ID).Update("uuid", uuidValue)
			if result.Error != nil {
				return result.Error
			}
		}
	}

	return nil
}
