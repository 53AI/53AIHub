SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'files'
      AND column_name = 'insight_perspective'
);
SET @sql_stmt := IF(
    @col_exists = 0,
    'ALTER TABLE files ADD COLUMN insight_perspective VARCHAR(32) NOT NULL DEFAULT ''internal_meeting''',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_jobs'
      AND column_name = 'insight_perspective'
);
SET @sql_stmt := IF(
    @col_exists = 0,
    'ALTER TABLE recording_jobs ADD COLUMN insight_perspective VARCHAR(32) NOT NULL DEFAULT ''internal_meeting''',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
