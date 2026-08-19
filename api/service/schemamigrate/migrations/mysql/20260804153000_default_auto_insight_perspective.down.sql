ALTER TABLE files MODIFY COLUMN insight_perspective VARCHAR(32) NOT NULL DEFAULT 'internal_meeting';
ALTER TABLE recording_jobs MODIFY COLUMN insight_perspective VARCHAR(32) NOT NULL DEFAULT 'internal_meeting';
