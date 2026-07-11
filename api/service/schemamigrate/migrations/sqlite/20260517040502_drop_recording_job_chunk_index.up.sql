DROP INDEX IF EXISTS idx_recording_job_chunks_job_chunk;
ALTER TABLE recording_job_chunks DROP COLUMN chunk_index;
CREATE INDEX IF NOT EXISTS idx_recording_job_chunks_job_owner_segment ON recording_job_chunks(job_id, owner_instance, segment_index);
