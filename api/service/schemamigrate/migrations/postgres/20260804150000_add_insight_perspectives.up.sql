ALTER TABLE files
    ADD COLUMN IF NOT EXISTS insight_perspective VARCHAR(32) NOT NULL DEFAULT 'internal_meeting';

ALTER TABLE recording_jobs
    ADD COLUMN IF NOT EXISTS insight_perspective VARCHAR(32) NOT NULL DEFAULT 'internal_meeting';
