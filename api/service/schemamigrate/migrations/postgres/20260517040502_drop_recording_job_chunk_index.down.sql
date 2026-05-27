DROP INDEX CONCURRENTLY IF EXISTS idx_recording_job_chunks_job_owner_segment;
ALTER TABLE recording_job_chunks ADD COLUMN IF NOT EXISTS chunk_index INTEGER NOT NULL DEFAULT 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recording_job_chunks_job_chunk ON recording_job_chunks(eid, job_id, segment_index, chunk_index);
