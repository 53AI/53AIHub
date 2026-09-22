ALTER TABLE recording_cognition_candidates ADD COLUMN domain_code VARCHAR(64) NULL;
CREATE INDEX IF NOT EXISTS idx_recording_cognition_candidates_domain_code
    ON recording_cognition_candidates (domain_code);
ALTER TABLE recording_cognition_versions ADD COLUMN domain_code VARCHAR(64) NULL;
CREATE INDEX IF NOT EXISTS idx_recording_cognition_versions_domain_code
    ON recording_cognition_versions (domain_code);
