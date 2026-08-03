SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'wiki_page_versions'
      AND index_name = 'idx_wiki_page_versions_unique'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE wiki_page_versions DROP INDEX idx_wiki_page_versions_unique',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
