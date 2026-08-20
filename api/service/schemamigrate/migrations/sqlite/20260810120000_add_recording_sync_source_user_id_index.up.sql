-- Backfill user_id from the owning file.
UPDATE recording_sync_sources
SET user_id = (SELECT user_id FROM files WHERE files.id = recording_sync_sources.file_id)
WHERE user_id = 0
  AND EXISTS (SELECT 1 FROM files WHERE files.id = recording_sync_sources.file_id);

-- Switch the unique index to (eid, user_id, provider, remote_id).
DROP INDEX IF EXISTS uniq_eid_provider_remote;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_eid_user_provider_remote
    ON recording_sync_sources (eid, user_id, provider, remote_id);
