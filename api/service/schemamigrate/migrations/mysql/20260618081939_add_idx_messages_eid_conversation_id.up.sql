SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'messages'
      AND index_name = 'idx_messages_eid_conversation_id'
);

SET @sql_stmt := IF(
    @idx_exists = 0,
    'ALTER TABLE messages ADD INDEX idx_messages_eid_conversation_id (eid, conversation_id, id), ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;