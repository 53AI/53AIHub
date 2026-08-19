-- Revert to the legacy 3-column unique index (single-owner semantics).
SET @unique_index_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_sync_sources'
      AND index_name = 'uniq_eid_user_provider_remote'
);
SET @sql_stmt := IF(
    @unique_index_exists > 0,
    'ALTER TABLE recording_sync_sources DROP INDEX uniq_eid_user_provider_remote',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @old_index_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_sync_sources'
      AND index_name = 'uniq_eid_provider_remote'
);
SET @sql_stmt := IF(
    @old_index_exists = 0,
    'ALTER TABLE recording_sync_sources ADD UNIQUE INDEX uniq_eid_provider_remote (eid, provider, remote_id)',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
