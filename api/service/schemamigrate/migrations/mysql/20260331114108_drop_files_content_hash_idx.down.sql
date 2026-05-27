SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'files'
      AND index_name = 'idx_files_content_hash'
);

SET @sql_stmt := IF(
    @idx_exists = 0,
    'ALTER TABLE files ADD INDEX idx_files_content_hash(content_hash), ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
