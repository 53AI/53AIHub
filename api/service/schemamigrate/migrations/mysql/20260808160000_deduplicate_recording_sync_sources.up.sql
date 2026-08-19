-- Keep the source attached to an active file. If none is active, keep the
-- latest source row. The source marker is redundant; files are never deleted.
DELETE stale
FROM recording_sync_sources AS stale
INNER JOIN recording_sync_sources AS preferred
    ON preferred.eid = stale.eid
   AND preferred.provider = stale.provider
   AND preferred.remote_id = stale.remote_id
LEFT JOIN files AS stale_file
    ON stale_file.id = stale.file_id
   AND stale_file.is_deleted = FALSE
LEFT JOIN files AS preferred_file
    ON preferred_file.id = preferred.file_id
   AND preferred_file.is_deleted = FALSE
WHERE
    CASE WHEN preferred_file.id IS NULL THEN 0 ELSE 1 END
        > CASE WHEN stale_file.id IS NULL THEN 0 ELSE 1 END
    OR (
        CASE WHEN preferred_file.id IS NULL THEN 0 ELSE 1 END
            = CASE WHEN stale_file.id IS NULL THEN 0 ELSE 1 END
        AND preferred.id > stale.id
    );

SET @table_exists := (
    SELECT COUNT(1)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_sync_sources'
);

SET @nonunique_index_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_sync_sources'
      AND index_name = 'uniq_eid_provider_remote'
      AND non_unique = 1
);

SET @sql_stmt := IF(
    @table_exists > 0 AND @nonunique_index_exists > 0,
    'ALTER TABLE recording_sync_sources DROP INDEX uniq_eid_provider_remote',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @unique_index_exists := (
    SELECT COUNT(1)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'recording_sync_sources'
      AND index_name = 'uniq_eid_provider_remote'
      AND non_unique = 0
);

SET @sql_stmt := IF(
    @table_exists > 0 AND @unique_index_exists = 0,
    'ALTER TABLE recording_sync_sources ADD UNIQUE INDEX uniq_eid_provider_remote (eid, provider, remote_id)',
    'SELECT 1'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
