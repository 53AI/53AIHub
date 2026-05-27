DROP INDEX CONCURRENTLY IF EXISTS idx_recording_job_chunks_job_chunk;
ALTER TABLE recording_job_chunks DROP COLUMN IF EXISTS chunk_index;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recording_job_chunks_job_owner_segment ON recording_job_chunks(job_id, owner_instance, segment_index);
