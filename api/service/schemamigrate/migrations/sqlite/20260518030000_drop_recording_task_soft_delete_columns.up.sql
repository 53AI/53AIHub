DROP INDEX IF EXISTS idx_recording_jobs_is_deleted;
ALTER TABLE recording_jobs DROP COLUMN is_deleted;

DROP INDEX IF EXISTS idx_recording_job_segments_is_deleted;
ALTER TABLE recording_job_segments DROP COLUMN is_deleted;

DROP INDEX IF EXISTS idx_recording_job_assemblies_is_deleted;
ALTER TABLE recording_job_assemblies DROP COLUMN is_deleted;

ALTER TABLE recording_job_chunks DROP COLUMN is_deleted;
