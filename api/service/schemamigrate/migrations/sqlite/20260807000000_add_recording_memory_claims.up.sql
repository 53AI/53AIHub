CREATE TABLE IF NOT EXISTS recording_memory_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eid INTEGER NOT NULL,
    owner_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    minutes_hash TEXT NOT NULL,
    source_item_type TEXT NOT NULL,
    source_item_id TEXT NOT NULL,
    source_key_hash TEXT NOT NULL,
    claim_kind TEXT NOT NULL,
    content TEXT NOT NULL,
    detail_json TEXT,
    assertion_state TEXT NOT NULL,
    epistemic_type TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,
    review_state TEXT NOT NULL,
    source_confidence REAL NOT NULL DEFAULT 0,
    evidence_available BOOLEAN NOT NULL DEFAULT FALSE,
    source_segment_count INTEGER NOT NULL DEFAULT 0,
    source_segment_ids TEXT,
    due_at INTEGER NOT NULL DEFAULT 0,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    created_time INTEGER NOT NULL,
    updated_time INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_scope ON recording_memory_claims (eid, owner_id, claim_kind, lifecycle_state, review_state);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_file ON recording_memory_claims (file_id);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_assertion_state ON recording_memory_claims (assertion_state);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_epistemic_type ON recording_memory_claims (epistemic_type);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_evidence_available ON recording_memory_claims (evidence_available);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_due_at ON recording_memory_claims (due_at);
CREATE INDEX IF NOT EXISTS idx_recording_memory_claims_is_current ON recording_memory_claims (is_current);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recording_memory_claim ON recording_memory_claims (eid, owner_id, file_id, minutes_hash, source_key_hash);
