SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_jobs'
      AND column_name = 'resume_token'
);

SET @sql_stmt := IF(
    @col_exists = 0,
    CONCAT('ALTER TABLE recording_jobs ADD COLUMN resume_token VARCHAR(128) NOT NULL DEFAULT ', QUOTE(''), ', ALGORITHM=INPLACE, LOCK=NONE'),
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_jobs'
      AND index_name = 'idx_recording_jobs_resume_token'
);

SET @sql_stmt := IF(
    @idx_exists = 0,
    'ALTER TABLE recording_jobs ADD INDEX idx_recording_jobs_resume_token(resume_token), ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
