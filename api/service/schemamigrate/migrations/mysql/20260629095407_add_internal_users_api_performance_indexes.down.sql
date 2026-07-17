SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND index_name = 'idx_users_eid_type'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE users DROP INDEX idx_users_eid_type, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND index_name = 'idx_users_eid'
);

SET @sql_stmt := IF(
    @idx_exists = 0,
    'ALTER TABLE users ADD INDEX idx_users_eid (eid), ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'member_bindings'
      AND index_name = 'idx_eid_bindvalue'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE member_bindings DROP INDEX idx_eid_bindvalue, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'member_bindings'
      AND index_name = 'idx_mid_eid'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE member_bindings DROP INDEX idx_mid_eid, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'member_department_relations'
      AND index_name = 'idx_did_eid_from'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE member_department_relations DROP INDEX idx_did_eid_from, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'member_department_relations'
      AND index_name = 'idx_bid_eid'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE member_department_relations DROP INDEX idx_bid_eid, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'resource_permissions'
      AND index_name = 'idx_type_resource'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE resource_permissions DROP INDEX idx_type_resource, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'departments'
      AND index_name = 'idx_departments_eid'
);

SET @sql_stmt := IF(
    @idx_exists > 0,
    'ALTER TABLE departments DROP INDEX idx_departments_eid, ALGORITHM=INPLACE, LOCK=NONE',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;