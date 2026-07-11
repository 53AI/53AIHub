SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'entity_chunk_relations'
      AND index_name = 'idx_entity_chunk_unique'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE entity_chunk_relations DROP INDEX idx_entity_chunk_unique',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

