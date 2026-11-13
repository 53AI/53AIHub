-- bot_token_hash：由普通索引升级为唯一索引。
DROP INDEX IF EXISTS idx_bot_bindings_bot_token_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_bindings_bot_token_hash
    ON bot_bindings (bot_token_hash);
