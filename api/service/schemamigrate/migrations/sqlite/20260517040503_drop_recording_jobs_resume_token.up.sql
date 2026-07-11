DROP INDEX IF EXISTS idx_recording_jobs_resume_token;
ALTER TABLE recording_jobs DROP COLUMN resume_token;
