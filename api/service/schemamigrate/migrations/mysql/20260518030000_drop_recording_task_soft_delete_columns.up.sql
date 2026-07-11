SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_jobs'
      AND index_name = 'idx_recording_jobs_is_deleted'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE recording_jobs DROP INDEX idx_recording_jobs_is_deleted, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_jobs'
      AND column_name = 'is_deleted'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE recording_jobs DROP COLUMN is_deleted, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_job_segments'
      AND index_name = 'idx_recording_job_segments_is_deleted'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE recording_job_segments DROP INDEX idx_recording_job_segments_is_deleted, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_job_segments'
      AND column_name = 'is_deleted'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE recording_job_segments DROP COLUMN is_deleted, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_job_assemblies'
      AND index_name = 'idx_recording_job_assemblies_is_deleted'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE recording_job_assemblies DROP INDEX idx_recording_job_assemblies_is_deleted, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_job_assemblies'
      AND column_name = 'is_deleted'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE recording_job_assemblies DROP COLUMN is_deleted, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_job_chunks'
      AND column_name = 'is_deleted'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE recording_job_chunks DROP COLUMN is_deleted, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
