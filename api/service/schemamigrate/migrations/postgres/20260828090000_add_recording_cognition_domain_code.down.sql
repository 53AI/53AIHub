DROP INDEX IF EXISTS idx_recording_cognition_candidates_domain_code;
ALTER TABLE recording_cognition_candidates DROP COLUMN IF EXISTS domain_code;
DROP INDEX IF EXISTS idx_recording_cognition_versions_domain_code;
ALTER TABLE recording_cognition_versions DROP COLUMN IF EXISTS domain_code;
