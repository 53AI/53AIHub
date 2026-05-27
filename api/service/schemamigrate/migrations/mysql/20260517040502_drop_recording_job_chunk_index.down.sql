SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_job_chunks'
      AND index_name = 'idx_recording_job_chunks_job_owner_segment'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE recording_job_chunks DROP INDEX idx_recording_job_chunks_job_owner_segment, ALGORITHM=INPLACE, LOCK=NONE',
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
      AND column_name = 'chunk_index'
);

SET @sql_stmt := IF(
    @col_exists = 0,
    'ALTER TABLE recording_job_chunks ADD COLUMN chunk_index INT NOT NULL DEFAULT 0, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @old_idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_job_chunks'
      AND index_name = 'idx_recording_job_chunks_job_chunk'
);

SET @sql_stmt := IF(
    @old_idx_exists = 0,
    'ALTER TABLE recording_job_chunks ADD INDEX idx_recording_job_chunks_job_chunk(eid, job_id, segment_index, chunk_index), ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
