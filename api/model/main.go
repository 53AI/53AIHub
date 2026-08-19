package model

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"

	"github.com/53AI/53AIHub/common/dbgormlogger"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

type LongText string

func (LongText) DataType(db *gorm.DB) string {
	if db != nil && db.Dialector != nil && db.Dialector.Name() == "mysql" {
		return "longtext"
	}
	return "text"
}

func InitDB() {
	logger.SysLog("database init started")
	var err error
	DB, err = GetDbConn()
	if err != nil {
		logger.FatalLog("failed to initialize database: " + err.Error())
		return
	}

	setDBConns(DB)
	logger.Debug(context.TODO(), "database init end")

	if config.MigrateDBEnabled {
		logger.Debug(context.TODO(), "database migration started")
		if err = migrateDBWithLock(); err != nil {
			logger.FatalLog("failed to migrate database: " + err.Error())
			return
		}
		logger.SysLog("database migrated")
	} else {
		logger.SysLog("database migration skipped (MIGRATE_DB_ENABLED=false)")
	}

	// 注册 GORM 慢查询回调，输出到独立的 slow.log
	dbgormlogger.RegisterSlowQueryCallback(DB)
}

func GetDbConn() (*gorm.DB, error) {
	dsn := os.Getenv("SQL_DSN")
	switch {
	case strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://"):
		// Use PostgreSQL
		return openPostgreSQL(dsn)
	case dsn != "":
		// Use MySQL
		return openMySQL(dsn)
	default:
		// Use SQLite
		return openSQLite()
	}
}

func openSQLite() (*gorm.DB, error) {
	logger.SysLog("SQL_DSN not set, using SQLite as database")
	config.UsingSQLite = true
	dsn := fmt.Sprintf("%s?_busy_timeout=%d", config.SQLitePath, config.SQLiteBusyTimeout)
	return gorm.Open(sqlite.Open(dsn), &gorm.Config{
		PrepareStmt: true,
	})
}

func openMySQL(dsn string) (*gorm.DB, error) {
	logger.SysLog("using MySQL as database")
	config.UsingMySQL = true

	gormLogger := dbgormlogger.BuildFromEnv("[MAIN_DB] ")

	return gorm.Open(mysql.Open(dsn), &gorm.Config{
		PrepareStmt: true, // precompile SQL
		Logger:      gormLogger,
	})
}

func openPostgreSQL(dsn string) (*gorm.DB, error) {
	logger.SysLog("using PostgreSQL as database")
	config.UsingPostgreSQL = true

	gormLogger := dbgormlogger.BuildFromEnv("[MAIN_DB] ")

	return gorm.Open(postgres.Open(dsn), &gorm.Config{
		PrepareStmt: true, // precompile SQL
		Logger:      gormLogger,
	})
}

func setDBConns(db *gorm.DB) *sql.DB {
	if config.DebugSQLEnabled {
		db = db.Debug()
	}

	sqlDB, err := db.DB()
	if err != nil {
		logger.FatalLog("failed to connect database: " + err.Error())
		return nil
	}

	// 使用 config/database.go 中统一的配置
	if err := config.ConfigureConnectionPool(db); err != nil {
		logger.FatalLog("failed to configure database connection pool: " + err.Error())
		return nil
	}

	logger.SysLog("database connection pool configured")
	return sqlDB
}

func migrateDB() error {
	var err error
	if err = DB.AutoMigrate(&Enterprise{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&User{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&UploadFile{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OpenClawArtifact{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OpenClawConversationMirror{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Group{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&SubscriptionSetting{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&SubscriptionRelation{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&AILink{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Setting{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Channel{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(
		&SkillLibrary{},
		&AgentSkillBinding{},
		&SkillScanJob{},
		&SkillEnvVarRecord{},
		&SkillUserEnvVarRecord{},
	); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Agent{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&ResourcePermission{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Message{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&MessageToolCall{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Conversation{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Provider{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&AgentAccessKey{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&UserChannel{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&UserChannelToken{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(
		&PaySetting{},
		&Order{},
		&Department{},
		&MemberDepartmentRelation{},
		&MemberBinding{},
		&Prompt{},
		&Like{},
		&Navigation{},
		&NavigationContent{},
		&VerificationCode{},
		&SystemLog{},
		&WecomSuite{},
		&WecomCorp{},
		&Space{},
		&Library{},
		&File{},
		&RecordingJob{},
		&RecordingJobSegment{},
		&RagFileRunStats{},
		&EmbeddingReindexRun{},
		&FileBody{},
		&FileBodyVersion{},
		&Permission{},
	); err != nil {
		return err
	}
	if err = DB.AutoMigrate(
		&ChannelFileMapping{},
		&AgentModels{}); err != nil {
		return err
	}

	if err = repairRecordingJobStatusValues(); err != nil {
		return err
	}

	// 索引删除/重命名等破坏性变更不要放在启动迁移里执行。
	// 统一通过标准 schema migration（service/schemamigrate）处理，避免与启动链路耦合。
	if err = DB.AutoMigrate(
		&ChunkSetting{},
		&DocumentChunk{},
		&ChunkOperationLog{},
		&ChunkRelation{},
		&RetrievalChunk{},
		&KnowledgeRelation{},
		&Entity{},
		&EntityChunkRelation{},
		&LibraryQuery{},
	); err != nil {
		return err
	}

	if err = DB.AutoMigrate(&APIKey{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&EnterpriseConfig{}); err != nil {
		return err
	}
	if err := DB.AutoMigrate(&ShareRecord{}); err != nil {
		return err
	}
	if err := DB.AutoMigrate(
		&Notification{},
		&ShareFile{},
		&Approval{},
		&Favorite{},
		&Shortcut{},
		&PlatformSetting{},
	); err != nil {
		return err
	}

	// Pre-migration: handle space_id column addition for existing user_recent_useds table.
	// GORM's Migrator().AddColumn reads the struct tag (not null) and generates
	// ADD column bigint NOT NULL, which PostgreSQL rejects on a non-empty table.
	// Add as nullable first, then let AutoMigrate add the NOT NULL constraint.
	if DB.Migrator().HasTable(&UserRecentUsed{}) && !DB.Migrator().HasColumn(&UserRecentUsed{}, "SpaceID") {
		if err := DB.Exec("ALTER TABLE user_recent_useds ADD COLUMN space_id bigint").Error; err != nil {
			return err
		}
		// Backfill existing rows — 0 is a safe sentinel ("no space")
		DB.Model(&UserRecentUsed{}).Where("space_id IS NULL").Update("space_id", 0)
	}

	if err := DB.AutoMigrate(&UserBrowseHistory{}); err != nil {
		return err
	}

	if err := DB.AutoMigrate(&UserRecentUsed{}); err != nil {
		return err
	}

	// Add Feedback model for message feedback feature
	if err := DB.AutoMigrate(
		&Feedback{},
		&MessageStats{},
		&KmKnowledgeMapStats{},
	); err != nil {
		return err
	}

	if err := DB.AutoMigrate(
		&DingtalkSuite{},
		&DingtalkCorp{},
	); err != nil {
		return err
	}

	// Add RagJob and RagJobStep models for RAG pipeline
	if err := DB.AutoMigrate(
		&RagJob{},
		&RagJobStep{},
		&RagPipelineProfile{},
		&RagRoutingStrategy{},
	); err != nil {
		return err
	}

	// Add GraphTemplate model for graph template feature
	if err := DB.AutoMigrate(&GraphTemplate{}); err != nil {
		return err
	}

	// Add GraphInstance and GraphRelationInstance models for graph generation feature
	if err := DB.AutoMigrate(
		&GraphInstance{},
		&GraphRelationInstance{},
	); err != nil {
		return err
	}

	// Add MessageProcessStep model for conversation history process records
	if err := DB.AutoMigrate(&MessageProcessStep{}); err != nil {
		return err
	}
	// Add AgentRun and AgentRunEvent models for durable run state and event replay
	if err := DB.AutoMigrate(&AgentRun{}, &AgentRunEvent{}); err != nil {
		return err
	}
	if err := DB.AutoMigrate(&RecordingJobAssembly{}); err != nil {
		return err
	}
	if err := DB.AutoMigrate(&RecordingJobChunk{}); err != nil {
		return err
	}
	if err := DB.AutoMigrate(&UserAgentShortcut{}); err != nil {
		return err
	}
	if err := DB.AutoMigrate(
		&WikiPage{},
		&WikiPageSource{},
		&WikiPageLink{},
		&WikiFolder{},
		&WikiLogEntry{},
		&WikiPendingOp{},
		&WikiDeadLetter{},
		&WikiPageRedirect{},
		&WikiPageChunk{},
	); err != nil {
		return err
	}
	if err := DB.AutoMigrate(&WikiPageVersion{}); err != nil {
		return err
	}

	// 用户记忆系统：全局记忆 + Agent记忆 + 工具教训
	if err := DB.AutoMigrate(
		&UserMemory{},
		&AgentUserMemory{},
		&AgentToolLesson{},
	); err != nil {
		return err
	}

	// Agent 资源范围隔离
	if err := DB.AutoMigrate(&ResourceScope{}); err != nil {
		return err
	}

	// 慢日志记录表
	if err := DB.AutoMigrate(&SlowLogRecord{}); err != nil {
		return err
	}

	// 安心录 V2 语音模型
	if err := DB.AutoMigrate(
		&RecordingSummaryTemplate{},
		&RecordingShare{},
		&RecordingFileSummary{},
		&RecordingFileInsightPage{},
		&RecordingMemoryClaim{},
		&RecordingMemoryEntity{},
		&RecordingMemoryFact{},
		&RecordingMemoryEntityRelation{},
		&RecordingDeviceConfig{},
		&RecordingSyncSource{},
		&RecordingSyncJob{},
	); err != nil {
		return err
	}

	return nil
}

// MigrateTestDatabase 初始化仅供测试使用的 SQLite 完整 schema。
//
// 测试包可能会创建独立的 SQLite 数据库，不能依赖 model 包的 TestMain。
// 统一从这里复用应用的模型清单，避免新增模型后只更新生产迁移而遗漏测试表。
// 该入口明确拒绝非 SQLite 数据库，正式的 PostgreSQL/MySQL 测试仍应使用真实迁移。
func MigrateTestDatabase(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("test database is nil")
	}
	if db.Dialector == nil {
		return fmt.Errorf("test database has no dialector")
	}
	if dialect := db.Dialector.Name(); dialect != "sqlite" {
		return fmt.Errorf("test database must use sqlite, got %q", dialect)
	}

	previousDB := DB
	DB = db
	defer func() { DB = previousDB }()
	return migrateDB()
}

func repairRecordingJobStatusValues() error {
	if DB == nil {
		return nil
	}
	return DB.Model(&RecordingJob{}).
		Where("status = ?", "finalizing_processin").
		Update("status", RecordingJobStatusFinalizingProcessing).Error
}

// migrateDBWithLock 使用数据库级 advisory lock 防止多个实例并发执行 AutoMigrate，
// 避免 MySQL Error 1213 (deadlock) 或 PostgreSQL 表锁冲突。
//
// - MySQL:  SELECT GET_LOCK('53aihub:automigrate', 0) — 非阻塞，锁被占用时跳过迁移
// - PostgreSQL: SELECT pg_try_advisory_lock(hashtext('53aihub_automigrate')) — 同上
// - SQLite: 文件级锁，无跨进程死锁风险，直接执行
func migrateDBWithLock() error {
	// 使用 dedicated connection 持有 advisory lock，避免连接池回收导致锁释放
	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("get underlying sql.DB: %w", err)
	}

	switch {
	case config.UsingMySQL:
		return migrateDBWithMySQLLock(context.Background(), sqlDB)
	case config.UsingPostgreSQL:
		return migrateDBWithPGLock(context.Background(), sqlDB)
	default:
		// SQLite: 文件级锁，无跨实例并发死锁风险
		logger.SysLog("SQLite: running migration directly (no advisory lock needed)")
		return migrateDB()
	}
}

func migrateDBWithMySQLLock(ctx context.Context, sqlDB *sql.DB) error {
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get dedicated connection for MySQL GET_LOCK: %w", err)
	}
	defer conn.Close()

	var gotLock int
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK(?, 0)", "53aihub:automigrate").Scan(&gotLock); err != nil {
		return fmt.Errorf("acquire MySQL GET_LOCK: %w", err)
	}
	if gotLock != 1 {
		logger.SysLog("AutoMigrate skipped: another instance holds the MySQL GET_LOCK('53aihub:automigrate')")
		return nil
	}

	logger.SysLog("AutoMigrate lock acquired (MySQL GET_LOCK)")
	defer func() {
		if _, err := conn.ExecContext(ctx, "SELECT RELEASE_LOCK(?)", "53aihub:automigrate"); err != nil {
			logger.SysErrorf("release MySQL GET_LOCK: %v", err)
		}
	}()

	return migrateDB()
}

func migrateDBWithPGLock(ctx context.Context, sqlDB *sql.DB) error {
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get dedicated connection for pg_try_advisory_lock: %w", err)
	}
	defer conn.Close()

	// pg_try_advisory_lock 使用 64-bit key，用 hashtext 将字符串转为 int4
	var gotLock bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(hashtext('53aihub_automigrate'))").Scan(&gotLock); err != nil {
		return fmt.Errorf("acquire pg_try_advisory_lock: %w", err)
	}
	if !gotLock {
		logger.SysLog("AutoMigrate skipped: another instance holds the pg_advisory_lock")
		return nil
	}

	logger.SysLog("AutoMigrate lock acquired (pg_advisory_lock)")
	defer func() {
		if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_unlock(hashtext('53aihub_automigrate'))"); err != nil {
			logger.SysErrorf("release pg_advisory_lock: %v", err)
		}
	}()

	return migrateDB()
}
