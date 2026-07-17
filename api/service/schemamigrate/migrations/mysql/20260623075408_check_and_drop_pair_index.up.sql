SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_access_keys'
      AND index_name = 'uk_agent_access_key_pair'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE agent_access_keys DROP INDEX uk_agent_access_key_pair',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
