CREATE TABLE IF NOT EXISTS recording_memory_claims (
    id BIGSERIAL PRIMARY KEY,
    eid BIGINT NOT NULL,
    owner_id BIGINT NOT NULL,
    file_id BIGINT NOT NULL,
    minutes_hash VARCHAR(64) NOT NULL,
    source_item_type VARCHAR(32) NOT NULL,
    source_item_id VARCHAR(128) NOT NULL,
    source_key_hash VARCHAR(64) NOT NULL,
    claim_kind VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    detail_json TEXT,
    assertion_state VARCHAR(32) NOT NULL,
    epistemic_type VARCHAR(32) NOT NULL,
    lifecycle_state VARCHAR(32) NOT NULL,
    review_state VARCHAR(32) NOT NULL,
    source_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    evidence_available BOOLEAN NOT NULL DEFAULT FALSE,
    source_segment_count INTEGER NOT NULL DEFAULT 0,
    source_segment_ids TEXT,
    due_at BIGINT NOT NULL DEFAULT 0,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    created_time BIGINT NOT NULL,
    updated_time BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_scope ON recording_memory_claims (eid, owner_id, claim_kind, lifecycle_state, review_state);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_file ON recording_memory_claims (file_id);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_assertion_state ON recording_memory_claims (assertion_state);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_epistemic_type ON recording_memory_claims (epistemic_type);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_evidence_available ON recording_memory_claims (evidence_available);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_due_at ON recording_memory_claims (due_at);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_is_current ON recording_memory_claims (is_current);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recording_memory_claim ON recording_memory_claims (eid, owner_id, file_id, minutes_hash, source_key_hash);
