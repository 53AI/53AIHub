-- Backfill user_id from the owning file. The sync source marker is redundant;
-- files are never deleted, so file.user_id is the authoritative owner.
UPDATE recording_sync_sources AS r
INNER JOIN files AS f ON f.id = r.file_id
SET r.user_id = f.user_id
WHERE r.user_id = 0;

-- Switch the unique index to (eid, user_id, provider, remote_id) so the same
-- device key can be re-bound to a different user (换 key 场景). Must drop the
-- legacy 3-column index first, otherwise the new user's INSERT collides.
SET @table_exists := (
    SELECT COUNT(1)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_sync_sources'
);

SET @old_index_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_sync_sources'
      AND index_name = 'uniq_eid_provider_remote'
);

SET @sql_stmt := IF(
    @table_exists > 0 AND @old_index_exists > 0,
    'ALTER TABLE recording_sync_sources DROP INDEX uniq_eid_provider_remote',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @new_index_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_sync_sources'
      AND index_name = 'uniq_eid_user_provider_remote'
);

SET @sql_stmt := IF(
    @table_exists > 0 AND @new_index_exists = 0,
    'ALTER TABLE recording_sync_sources ADD UNIQUE INDEX uniq_eid_user_provider_remote (eid, user_id, provider, remote_id)',
    'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
