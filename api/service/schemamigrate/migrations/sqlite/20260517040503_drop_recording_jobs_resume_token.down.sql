ALTER TABLE recording_jobs ADD COLUMN resume_token TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_recording_jobs_resume_token ON recording_jobs(resume_token);
