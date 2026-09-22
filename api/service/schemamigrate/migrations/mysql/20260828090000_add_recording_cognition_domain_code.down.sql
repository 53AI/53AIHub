SET @index_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_cognition_candidates'
      AND index_name = 'idx_recording_cognition_candidates_domain_code'
);
SET @sql_stmt := IF(
    @index_exists > 0,
    'ALTER TABLE recording_cognition_candidates DROP INDEX idx_recording_cognition_candidates_domain_code',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_cognition_candidates'
      AND column_name = 'domain_code'
);
SET @sql_stmt := IF(
    @column_exists > 0,
    'ALTER TABLE recording_cognition_candidates DROP COLUMN domain_code',
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
    @index_exists > 0,
    'ALTER TABLE recording_cognition_versions DROP INDEX idx_recording_cognition_versions_domain_code',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_cognition_versions'
      AND column_name = 'domain_code'
);
SET @sql_stmt := IF(
    @column_exists > 0,
    'ALTER TABLE recording_cognition_versions DROP COLUMN domain_code',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
