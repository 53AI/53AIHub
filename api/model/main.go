package model

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/config"
	"gorm.io/driver/mysql"

	"gorm.io/driver/sqlite"
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
	logger.Debug(nil, "database init end")

	if config.MigrateDBEnabled {
		logger.Debug(nil, "database migration started")
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
	// case strings.HasPrefix(dsn, "postgres://"):
	// 	// TODO Use PostgreSQL
	// 	// return openPostgreSQL(dsn)
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
	return gorm.Open(mysql.Open(dsn), &gorm.Config{
		PrepareStmt: true, // precompile SQL
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

	sqlDB.SetMaxIdleConns(env.Int("SQL_MAX_IDLE_CONNS", 100))
	sqlDB.SetMaxOpenConns(env.Int("SQL_MAX_OPEN_CONNS", 1000))
	sqlDB.SetConnMaxLifetime(time.Second * time.Duration(env.Int("SQL_MAX_LIFETIME", 60)))
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
	if err = DB.AutoMigrate(&Agent{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&ResourcePermission{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Message{}); err != nil {
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
	); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&ChannelFileMapping{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&EnterpriseConfig{}); err != nil {
		return err
	}
	if err := DB.AutoMigrate(&ShareRecord{}); err != nil {
		return err
	}
	if err := DB.AutoMigrate(
		&DingtalkSuite{},
		&DingtalkCorp{},
	); err != nil {
		return err
	}
	return nil
}
