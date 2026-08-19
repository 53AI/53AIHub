-- Keep the source attached to an active file. If none is active, keep the
-- latest source row. The source marker is redundant; files are never deleted.
DELETE FROM recording_sync_sources AS stale
WHERE EXISTS (
    SELECT 1
    FROM recording_sync_sources AS preferred
    LEFT JOIN files AS preferred_file
        ON preferred_file.id = preferred.file_id
       AND preferred_file.is_deleted = FALSE
    LEFT JOIN files AS stale_file
        ON stale_file.id = stale.file_id
       AND stale_file.is_deleted = FALSE
    WHERE preferred.eid = stale.eid
      AND preferred.provider = stale.provider
      AND preferred.remote_id = stale.remote_id
      AND (
          CASE WHEN preferred_file.id IS NULL THEN 0 ELSE 1 END
              > CASE WHEN stale_file.id IS NULL THEN 0 ELSE 1 END
          OR (
              CASE WHEN preferred_file.id IS NULL THEN 0 ELSE 1 END
                  = CASE WHEN stale_file.id IS NULL THEN 0 ELSE 1 END
              AND preferred.id > stale.id
          )
      )
);

DROP INDEX IF EXISTS uniq_eid_provider_remote;
CREATE UNIQUE INDEX uniq_eid_provider_remote
    ON recording_sync_sources (eid, provider, remote_id);
