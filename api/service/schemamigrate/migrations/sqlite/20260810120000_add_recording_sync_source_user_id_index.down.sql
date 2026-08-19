DROP INDEX IF EXISTS uniq_eid_user_provider_remote;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_eid_provider_remote
    ON recording_sync_sources (eid, provider, remote_id);
