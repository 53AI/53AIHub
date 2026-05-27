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
		if err = migrateDB(); err != nil {
			logger.FatalLog("failed to migrate database: " + err.Error())
			return
		}
		logger.SysLog("database migrated")
	} else {
		logger.SysLog("database migration skipped (MIGRATE_DB_ENABLED=false)")
	}
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
		&UserSkillBinding{},
		&SkillScanJob{},
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

	if err := DB.AutoMigrate(&UserBrowseHistory{}); err != nil {
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
	return nil
}

func repairRecordingJobStatusValues() error {
	if DB == nil {
		return nil
	}
	return DB.Model(&RecordingJob{}).
		Where("status = ?", "finalizing_processin").
		Update("status", RecordingJobStatusFinalizingProcessing).Error
}
