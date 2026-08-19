-- Backfill user_id from the owning file.
UPDATE recording_sync_sources AS r
SET user_id = f.user_id
FROM files AS f
WHERE f.id = r.file_id
  AND r.user_id = 0;

-- Switch the unique index to (eid, user_id, provider, remote_id).
DROP INDEX IF EXISTS uniq_eid_provider_remote;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_eid_user_provider_remote
    ON recording_sync_sources (eid, user_id, provider, remote_id);
