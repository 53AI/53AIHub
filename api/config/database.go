package config

import (
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/utils/env"
	"gorm.io/gorm"
)

var UsingSQLite = false
var UsingPostgreSQL = false
var UsingMySQL = false
var DebugSQLEnabled = env.Bool("DEBUG_SQL", false)

var SQLitePath = "53ai-hub.db"
var SQLiteBusyTimeout = env.Int("SQLITE_BUSY_TIMEOUT", 3000)

// 数据库连接池配置
var (
	// 最大打开连接数
	MaxOpenConns = env.Int("SQL_MAX_OPEN_CONNS", 50)
	// 最大空闲连接数
	MaxIdleConns = env.Int("SQL_MAX_IDLE_CONNS", 20)
	// 连接最大生存时间（秒）
	ConnMaxLifetimeSeconds = env.Int("SQL_MAX_LIFETIME", 1800) // 默认30分钟
	// 连接最大空闲时间（秒）
	ConnMaxIdleTimeSeconds = env.Int("DB_CONN_MAX_IDLE_TIME_SECONDS", 600) // 默认10分钟
	// MySQL锁等待超时时间（秒）
	LockWaitTimeoutSeconds = env.Int("MYSQL_LOCK_WAIT_TIMEOUT", 5) // 默认5秒
)

// GetConnMaxLifetime 获取连接最大生存时间
func GetConnMaxLifetime() time.Duration {
	return time.Duration(ConnMaxLifetimeSeconds) * time.Second
}

// GetConnMaxIdleTime 获取连接最大空闲时间
func GetConnMaxIdleTime() time.Duration {
	return time.Duration(ConnMaxIdleTimeSeconds) * time.Second
}

// ConfigureConnectionPool 配置数据库连接池
func ConfigureConnectionPool(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}

	// 设置连接池参数
	sqlDB.SetMaxOpenConns(MaxOpenConns)
	sqlDB.SetMaxIdleConns(MaxIdleConns)
	sqlDB.SetConnMaxLifetime(GetConnMaxLifetime())
	sqlDB.SetConnMaxIdleTime(GetConnMaxIdleTime())

	return nil
}

// SetLockWaitTimeout 设置数据库锁等待超时（会话级别）
func SetLockWaitTimeout(tx *gorm.DB) error {
	if UsingMySQL {
		// MySQL 使用 innodb_lock_wait_timeout
		return tx.Exec(fmt.Sprintf("SET innodb_lock_wait_timeout = %d", LockWaitTimeoutSeconds)).Error
	} else if UsingPostgreSQL {
		// PostgreSQL 使用 lock_timeout
		return tx.Exec(fmt.Sprintf("SET lock_timeout = '%dms'", LockWaitTimeoutSeconds*1000)).Error
	}
	// 对于其他数据库，不设置锁等待超时
	return nil
}
