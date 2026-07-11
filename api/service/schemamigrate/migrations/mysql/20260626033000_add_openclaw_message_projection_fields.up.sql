SET @col_exists := (
    SELECT COUNT(1)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'messages'
      AND column_name = 'openclaw_projection_key'
);

SET @sql_stmt := IF(
    @col_exists = 0,
    CONCAT('ALTER TABLE messages ADD COLUMN openclaw_projection_key VARCHAR(255) NOT NULL DEFAULT ', QUOTE(''), ', ALGORITHM=INPLACE, LOCK=NONE'),
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
    @col_exists = 0,
    CONCAT('ALTER TABLE messages ADD COLUMN openclaw_turn_id VARCHAR(255) NOT NULL DEFAULT ', QUOTE(''), ', ALGORITHM=INPLACE, LOCK=NONE'),
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
    @col_exists = 0,
    'ALTER TABLE messages ADD COLUMN openclaw_seq_start BIGINT NOT NULL DEFAULT 0, ALGORITHM=INPLACE, LOCK=NONE',
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
    @col_exists = 0,
    'ALTER TABLE messages ADD COLUMN openclaw_seq_end BIGINT NOT NULL DEFAULT 0, ALGORITHM=INPLACE, LOCK=NONE',
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
    @col_exists = 0,
    CONCAT('ALTER TABLE messages ADD COLUMN openclaw_status VARCHAR(32) NOT NULL DEFAULT ', QUOTE(''), ', ALGORITHM=INPLACE, LOCK=NONE'),
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
      AND column_name = 'openclaw_projection_json'
);

SET @sql_stmt := IF(
    @col_exists = 0,
    'ALTER TABLE messages ADD COLUMN openclaw_projection_json LONGTEXT, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
