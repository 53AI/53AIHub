ALTER TABLE recording_jobs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_recording_jobs_is_deleted ON recording_jobs(is_deleted);

ALTER TABLE recording_job_segments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_recording_job_segments_is_deleted ON recording_job_segments(is_deleted);

ALTER TABLE recording_job_assemblies ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_recording_job_assemblies_is_deleted ON recording_job_assemblies(is_deleted);

ALTER TABLE recording_job_chunks ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
