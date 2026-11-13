-- 回滚：唯一索引退回普通索引。
DROP INDEX IF EXISTS idx_bot_bindings_bot_token_hash;
CREATE INDEX IF NOT EXISTS idx_bot_bindings_bot_token_hash
    ON bot_bindings (bot_token_hash);
