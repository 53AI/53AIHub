SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_jobs'
      AND column_name = 'output_upload_file_id'
);

SET @sql_stmt := IF(
    @col_exists = 0,
    CONCAT('ALTER TABLE recording_jobs ADD COLUMN output_upload_file_id BIGINT NOT NULL DEFAULT ', 0, ', ALGORITHM=INPLACE, LOCK=NONE'),
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
