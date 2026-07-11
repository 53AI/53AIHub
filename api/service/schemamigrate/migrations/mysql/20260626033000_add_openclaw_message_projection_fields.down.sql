SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'messages'
      AND column_name = 'openclaw_projection_json'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE messages DROP COLUMN openclaw_projection_json, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'messages'
      AND column_name = 'openclaw_status'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE messages DROP COLUMN openclaw_status, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'messages'
      AND column_name = 'openclaw_seq_end'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE messages DROP COLUMN openclaw_seq_end, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'messages'
      AND column_name = 'openclaw_seq_start'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE messages DROP COLUMN openclaw_seq_start, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'messages'
      AND column_name = 'openclaw_turn_id'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE messages DROP COLUMN openclaw_turn_id, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'messages'
      AND column_name = 'openclaw_projection_key'
);

SET @sql_stmt := IF(
    @col_exists > 0,
    'ALTER TABLE messages DROP COLUMN openclaw_projection_key, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
