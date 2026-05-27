ALTER TABLE recording_jobs ADD COLUMN IF NOT EXISTS resume_token VARCHAR(128) NOT NULL DEFAULT '';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recording_jobs_resume_token ON recording_jobs(resume_token);
