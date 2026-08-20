ALTER TABLE files ADD COLUMN insight_perspective TEXT NOT NULL DEFAULT 'internal_meeting';
ALTER TABLE recording_jobs ADD COLUMN insight_perspective TEXT NOT NULL DEFAULT 'internal_meeting';
