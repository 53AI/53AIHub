SET @table_exists := (
    SELECT COUNT(1)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_cognition_candidates'
);
SET @column_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_cognition_candidates'
      AND column_name = 'domain_code'
);
SET @sql_stmt := IF(
    @table_exists > 0 AND @column_exists = 0,
    'ALTER TABLE recording_cognition_candidates ADD COLUMN domain_code VARCHAR(64) NULL',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_cognition_candidates'
      AND index_name = 'idx_recording_cognition_candidates_domain_code'
);
SET @sql_stmt := IF(
    @table_exists > 0 AND @index_exists = 0,
    'ALTER TABLE recording_cognition_candidates ADD INDEX idx_recording_cognition_candidates_domain_code (domain_code)',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @table_exists := (
    SELECT COUNT(1)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_cognition_versions'
);
SET @column_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_cognition_versions'
      AND column_name = 'domain_code'
);
SET @sql_stmt := IF(
    @table_exists > 0 AND @column_exists = 0,
    'ALTER TABLE recording_cognition_versions ADD COLUMN domain_code VARCHAR(64) NULL',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_cognition_versions'
      AND index_name = 'idx_recording_cognition_versions_domain_code'
);
SET @sql_stmt := IF(
    @table_exists > 0 AND @index_exists = 0,
    'ALTER TABLE recording_cognition_versions ADD INDEX idx_recording_cognition_versions_domain_code (domain_code)',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
