ALTER TABLE recording_jobs ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_recording_jobs_is_deleted ON recording_jobs(is_deleted);

ALTER TABLE recording_job_segments ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_recording_job_segments_is_deleted ON recording_job_segments(is_deleted);

ALTER TABLE recording_job_assemblies ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_recording_job_assemblies_is_deleted ON recording_job_assemblies(is_deleted);

ALTER TABLE recording_job_chunks ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
