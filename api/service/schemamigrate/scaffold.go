package schemamigrate

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var (
	errMigrationNameRequired = errors.New("migration name is required")
	errInvalidMigrationName  = errors.New("invalid migration name: only lowercase letters, numbers and underscore are allowed")
	errInvalidVersion        = errors.New("invalid migration version: only digits are allowed")
)

var migrationNamePattern = regexp.MustCompile(`^[a-z0-9_]+$`)
var migrationVersionPattern = regexp.MustCompile(`^[0-9]+$`)

type ScaffoldResult struct {
	Version string
	Name    string
	Files   []string
}

// GenerateScaffold creates mysql/postgres/sqlite templates.
func GenerateScaffold(baseDir, version, name string) (ScaffoldResult, error) {
	res := ScaffoldResult{}

	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return res, errMigrationNameRequired
	}
	if !migrationNamePattern.MatchString(trimmedName) {
		return res, errInvalidMigrationName
	}

	trimmedVersion := strings.TrimSpace(version)
	if trimmedVersion == "" {
		trimmedVersion = time.Now().UTC().Format("20060102150405")
	}
	if !migrationVersionPattern.MatchString(trimmedVersion) {
		return res, errInvalidVersion
	}

	mysqlDir := filepath.Join(baseDir, "service", "schemamigrate", "migrations", "mysql")
	postgresDir := filepath.Join(baseDir, "service", "schemamigrate", "migrations", "postgres")
	if err := os.MkdirAll(mysqlDir, 0o755); err != nil {
		return res, err
	}
	if err := os.MkdirAll(postgresDir, 0o755); err != nil {
		return res, err
	}
	sqliteDir := filepath.Join(baseDir, "service", "schemamigrate", "migrations", "sqlite")
	if err := os.MkdirAll(sqliteDir, 0o755); err != nil {
		return res, err
	}

	fileBase := fmt.Sprintf("%s_%s", trimmedVersion, trimmedName)

	files := []struct {
		path    string
		content string
	}{
		{
			path: filepath.Join(mysqlDir, fileBase+".up.sql"),
			content: fmt.Sprintf("-- TODO(mysql up): %s\n-- Write idempotent SQL here.\n",
				trimmedName),
		},
		{
			path: filepath.Join(mysqlDir, fileBase+".down.sql"),
			content: fmt.Sprintf("-- TODO(mysql down): %s\n-- Write rollback SQL here. If irreversible, keep noop.\nSELECT 1;\n",
				trimmedName),
		},
		{
			path: filepath.Join(postgresDir, fileBase+".up.sql"),
			content: fmt.Sprintf("-- TODO(postgres up): %s\n-- Write idempotent SQL here.\n",
				trimmedName),
		},
		{
			path: filepath.Join(postgresDir, fileBase+".down.sql"),
			content: fmt.Sprintf("-- TODO(postgres down): %s\n-- Write rollback SQL here. If irreversible, keep noop.\nSELECT 1;\n",
				trimmedName),
		},
	}
	files = append(files,
		struct {
			path    string
			content string
		}{
			path: filepath.Join(sqliteDir, fileBase+".up.sql"),
			content: fmt.Sprintf("-- TODO(sqlite up): %s\n-- Write idempotent SQL here.\n",
				trimmedName),
		},
		struct {
			path    string
			content string
		}{
			path: filepath.Join(sqliteDir, fileBase+".down.sql"),
			content: fmt.Sprintf("-- TODO(sqlite down): %s\n-- Write rollback SQL here. If irreversible, keep noop.\nSELECT 1;\n",
				trimmedName),
		},
	)

	for _, f := range files {
		if _, err := os.Stat(f.path); err == nil {
			return res, fmt.Errorf("scaffold file already exists: %s", f.path)
		}
	}

	created := make([]string, 0, len(files))
	for _, f := range files {
		if err := os.WriteFile(f.path, []byte(f.content), 0o644); err != nil {
			return res, err
		}
		created = append(created, f.path)
	}

	res.Version = trimmedVersion
	res.Name = trimmedName
	res.Files = created
	return res, nil
}
