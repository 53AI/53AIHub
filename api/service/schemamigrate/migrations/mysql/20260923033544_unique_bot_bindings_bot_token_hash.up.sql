-- bot_token_hash：由普通索引升级为唯一索引（每条绑定的 bot_token 全局唯一）。
-- 幂等：仅当存在同名非唯一索引时删除；仅当不存在同名唯一索引时创建。
SET @table_exists := (
    SELECT COUNT(1)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'bot_bindings'
);

SET @non_unique_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'bot_bindings'
      AND index_name = 'idx_bot_bindings_bot_token_hash'
      AND non_unique = 1
);
SET @sql_stmt := IF(
    @table_exists > 0 AND @non_unique_exists > 0,
    'ALTER TABLE bot_bindings DROP INDEX idx_bot_bindings_bot_token_hash',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @unique_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'bot_bindings'
      AND index_name = 'idx_bot_bindings_bot_token_hash'
      AND non_unique = 0
);
SET @sql_stmt := IF(
    @table_exists > 0 AND @unique_exists = 0,
    'ALTER TABLE bot_bindings ADD UNIQUE INDEX idx_bot_bindings_bot_token_hash (bot_token_hash)',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
