package schemamigrate

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database"
	migratemysql "github.com/golang-migrate/migrate/v4/database/mysql"
	migratepostgres "github.com/golang-migrate/migrate/v4/database/postgres"
	migratesqlite "github.com/golang-migrate/migrate/v4/database/sqlite3"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed migrations/mysql/*.sql migrations/postgres/*.sql migrations/sqlite/*.sql
var migrationFS embed.FS

type RunResult struct {
	Dialect string
	Applied bool
	Version uint
	Dirty   bool
}

type HealthResult struct {
	Dialect                string `json:"dialect"`
	Supported              bool   `json:"supported"`
	GuardEnabled           bool   `json:"guardEnabled"`
	GuardBusy              bool   `json:"guardBusy"`
	GuardReason            string `json:"guardReason"`
	SchemaMigrationsExists bool   `json:"schemaMigrationsExists"`
	Version                uint   `json:"version"`
	HasVersion             bool   `json:"hasVersion"`
	Dirty                  bool   `json:"dirty"`
}

type RunOptions struct {
	GuardEnabled      bool
	GuardMaxWait      time.Duration
	GuardPollInterval time.Duration
}

// BuildRunOptions builds and normalizes guard options from second-based configs.
func BuildRunOptions(guardEnabled bool, guardMaxWaitSeconds, guardPollSeconds int) RunOptions {
	return normalizeRunOptions(RunOptions{
		GuardEnabled:      guardEnabled,
		GuardMaxWait:      time.Duration(guardMaxWaitSeconds) * time.Second,
		GuardPollInterval: time.Duration(guardPollSeconds) * time.Second,
	})
}

func DefaultRunOptions() RunOptions {
	return RunOptions{
		GuardEnabled:      true,
		GuardMaxWait:      10 * time.Minute,
		GuardPollInterval: 10 * time.Second,
	}
}

func RunUp(sqlDB *sql.DB, dialect string) (RunResult, error) {
	return RunUpWithOptions(sqlDB, dialect, DefaultRunOptions())
}

func CheckHealth(sqlDB *sql.DB, dialect string, opts RunOptions) (HealthResult, error) {
	dialect = canonicalDialect(dialect)
	res := HealthResult{
		Dialect:      dialect,
		Supported:    isSupportedDialect(dialect),
		GuardEnabled: opts.GuardEnabled,
	}
	if sqlDB == nil {
		return res, errors.New("sql db is nil")
	}
	opts = normalizeRunOptions(opts)
	res.GuardEnabled = opts.GuardEnabled

	if !res.Supported {
		return res, nil
	}

	if opts.GuardEnabled {
		busy, reason, err := hasIndexDDLInProgress(sqlDB, dialect)
		if err != nil {
			return res, err
		}
		res.GuardBusy = busy
		res.GuardReason = reason
	}

	exists, err := schemaMigrationsExists(sqlDB, dialect)
	if err != nil {
		return res, err
	}
	res.SchemaMigrationsExists = exists
	if !exists {
		return res, nil
	}

	version, dirty, found, err := readSchemaMigrationsVersion(sqlDB)
	if err != nil {
		return res, err
	}
	res.HasVersion = found
	res.Version = version
	res.Dirty = dirty
	return res, nil
}

func RunUpWithOptions(sqlDB *sql.DB, dialect string, opts RunOptions) (RunResult, error) {
	dialect = canonicalDialect(dialect)
	result := RunResult{Dialect: dialect}

	if sqlDB == nil {
		return result, errors.New("sql db is nil")
	}
	opts = normalizeRunOptions(opts)

	if err := waitForSafeWindow(sqlDB, dialect, opts); err != nil {
		return result, err
	}

	sourcePath := ""
	var (
		driver database.Driver
		err    error
	)
	var migrationDB *sql.DB

	switch dialect {
	case "mysql":
		sourcePath = "migrations/mysql"
		// golang-migrate mysql.WithInstance 依赖 multiStatements=true。
		// 使用专用连接执行迁移，避免复用业务连接导致多语句 SQL 失败。
		migrationDB, err = openMySQLMigrationDBFromEnv()
		if err != nil {
			return result, err
		}
		driver, err = migratemysql.WithInstance(migrationDB, &migratemysql.Config{})
	case "postgres":
		sourcePath = "migrations/postgres"
		driver, err = migratepostgres.WithInstance(sqlDB, &migratepostgres.Config{})
	case "sqlite":
		sourcePath = "migrations/sqlite"
		driver, err = migratesqlite.WithInstance(sqlDB, &migratesqlite.Config{})
	default:
		// 其他方言不在当前 migration 覆盖范围内，直接跳过。
		return result, nil
	}
	if err != nil {
		if migrationDB != nil {
			_ = migrationDB.Close()
		}
		return result, err
	}
	defer func() {
		if migrationDB != nil {
			_ = migrationDB.Close()
		}
	}()

	sourceDriver, err := iofs.New(migrationFS, sourcePath)
	if err != nil {
		return result, err
	}

	m, err := migrate.NewWithInstance("iofs", sourceDriver, dialect, driver)
	if err != nil {
		return result, err
	}
	defer func() {
		_, _ = m.Close()
	}()

	err = m.Up()
	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return result, fmt.Errorf("schema migrate up failed: %w", err)
	}
	result.Applied = !errors.Is(err, migrate.ErrNoChange)

	version, dirty, versionErr := m.Version()
	if versionErr == nil {
		result.Version = version
		result.Dirty = dirty
	}
	if versionErr != nil && !errors.Is(versionErr, migrate.ErrNilVersion) {
		return result, versionErr
	}

	return result, nil
}

func openMySQLMigrationDBFromEnv() (*sql.DB, error) {
	dsn := strings.TrimSpace(os.Getenv("SQL_DSN"))
	if dsn == "" {
		return nil, errors.New("mysql migration requires SQL_DSN env")
	}

	cfg, err := mysqldriver.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse SQL_DSN failed: %w", err)
	}
	cfg.MultiStatements = true

	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping mysql migration db failed: %w", err)
	}
	return db, nil
}

func normalizeRunOptions(opts RunOptions) RunOptions {
	if opts.GuardMaxWait <= 0 {
		opts.GuardMaxWait = 10 * time.Minute
	}
	if opts.GuardPollInterval <= 0 {
		opts.GuardPollInterval = 10 * time.Second
	}
	return opts
}

func isSupportedDialect(dialect string) bool {
	switch canonicalDialect(dialect) {
	case "mysql", "postgres", "sqlite":
		return true
	default:
		return false
	}
}

func canonicalDialect(dialect string) string {
	switch strings.ToLower(strings.TrimSpace(dialect)) {
	case "postgresql":
		return "postgres"
	case "sqlite3":
		return "sqlite"
	default:
		return strings.ToLower(strings.TrimSpace(dialect))
	}
}

func waitForSafeWindow(sqlDB *sql.DB, dialect string, opts RunOptions) error {
	if !opts.GuardEnabled {
		return nil
	}

	start := time.Now()
	for {
		busy, reason, err := hasIndexDDLInProgress(sqlDB, dialect)
		if err != nil {
			// 检测失败按“忙碌”处理，避免在未知状态下直接执行迁移。
			busy = true
			reason = fmt.Sprintf("guard_check_failed: %v", err)
		}
		if !busy {
			return nil
		}

		elapsed := time.Since(start)
		if elapsed >= opts.GuardMaxWait {
			return fmt.Errorf("schema migrate guard timeout after %s, last_reason=%s", opts.GuardMaxWait, reason)
		}

		logger.SysWarnf(
			"【工具执行】Schema 迁移推迟: dialect=%s, reason=%s, elapsed=%s, retry_in=%s",
			dialect, reason, elapsed.Truncate(time.Second), opts.GuardPollInterval,
		)
		time.Sleep(opts.GuardPollInterval)
	}
}

func hasIndexDDLInProgress(sqlDB *sql.DB, dialect string) (bool, string, error) {
	switch canonicalDialect(dialect) {
	case "mysql":
		return hasMySQLIndexDDLInProgress(sqlDB)
	case "postgres":
		return hasPostgresIndexDDLInProgress(sqlDB)
	case "sqlite":
		return hasSQLiteWriteLockInProgress(sqlDB)
	default:
		return false, "", nil
	}
}

func schemaMigrationsExists(sqlDB *sql.DB, dialect string) (bool, error) {
	var query string
	switch canonicalDialect(dialect) {
	case "mysql":
		query = `
SELECT COUNT(1)
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'schema_migrations'
`
	case "postgres":
		return queryBool(sqlDB, "SELECT to_regclass('schema_migrations') IS NOT NULL")
	case "sqlite":
		query = `
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'table'
  AND name = 'schema_migrations'
`
	default:
		return false, nil
	}

	count, err := queryCount(sqlDB, query)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func readSchemaMigrationsVersion(sqlDB *sql.DB) (uint, bool, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var version uint
	var dirty bool
	err := sqlDB.QueryRowContext(ctx, "SELECT version, dirty FROM schema_migrations LIMIT 1").Scan(&version, &dirty)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, false, nil
	}
	if err != nil {
		return 0, false, false, err
	}
	return version, dirty, true, nil
}

func hasMySQLIndexDDLInProgress(sqlDB *sql.DB) (bool, string, error) {
	query := `
SELECT COUNT(1)
FROM information_schema.processlist
WHERE ID <> CONNECTION_ID()
  AND DB = DATABASE()
  AND COMMAND <> 'Sleep'
  AND INFO IS NOT NULL
  AND (
      UPPER(INFO) REGEXP '(^|[[:space:]])CREATE[[:space:]]+INDEX'
      OR UPPER(INFO) REGEXP '(^|[[:space:]])ALTER[[:space:]]+INDEX'
      OR UPPER(INFO) REGEXP '(^|[[:space:]])DROP[[:space:]]+INDEX'
      OR UPPER(INFO) REGEXP '(^|[[:space:]])ALTER[[:space:]]+TABLE'
  )
	`
	count, err := queryCount(sqlDB, query)
	if err != nil {
		return false, "", fmt.Errorf(
			"mysql guard query failed (need processlist visibility, or set SCHEMA_MIGRATE_GUARD_ENABLED=false): %w",
			err,
		)
	}
	if count > 0 {
		return true, "mysql_active_index_or_alter_table_ddl", nil
	}
	return false, "", nil
}

func hasPostgresIndexDDLInProgress(sqlDB *sql.DB) (bool, string, error) {
	query := `
SELECT COUNT(1)
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND datname = current_database()
  AND state <> 'idle'
  AND query IS NOT NULL
  AND (
      query ~* '(^|\\s)create\\s+index'
      OR query ~* '(^|\\s)alter\\s+index'
      OR query ~* '(^|\\s)drop\\s+index'
      OR query ~* '(^|\\s)alter\\s+table'
  )
`
	count, err := queryCount(sqlDB, query)
	if err != nil {
		return false, "", err
	}
	if count > 0 {
		return true, "postgres_active_index_or_alter_table_ddl", nil
	}
	return false, "", nil
}

func hasSQLiteWriteLockInProgress(sqlDB *sql.DB) (bool, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return false, "", err
	}
	defer conn.Close()

	if _, err = conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		if isSQLiteBusyErr(err) {
			return true, "sqlite_database_locked", nil
		}
		return false, "", err
	}

	if _, err = conn.ExecContext(ctx, "ROLLBACK"); err != nil {
		return false, "", err
	}

	return false, "", nil
}

func queryCount(sqlDB *sql.DB, query string, args ...any) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var count int64
	if err := sqlDB.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func queryBool(sqlDB *sql.DB, query string, args ...any) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var value bool
	if err := sqlDB.QueryRowContext(ctx, query, args...).Scan(&value); err != nil {
		return false, err
	}
	return value, nil
}

func isSQLiteBusyErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "database is locked") || strings.Contains(msg, "database is busy")
}
