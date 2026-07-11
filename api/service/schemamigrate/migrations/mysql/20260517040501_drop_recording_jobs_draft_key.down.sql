SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_jobs'
      AND column_name = 'draft_key'
);

SET @sql_stmt := IF(
    @col_exists = 0,
    CONCAT('ALTER TABLE recording_jobs ADD COLUMN draft_key VARCHAR(512) NOT NULL DEFAULT ', QUOTE(''), ', ALGORITHM=INPLACE, LOCK=NONE'),
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
