CREATE TABLE IF NOT EXISTS action_source_identities (
  id BIGSERIAL PRIMARY KEY,
  canonical_id VARCHAR(128) NOT NULL,
  eid BIGINT NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  legacy_source_type VARCHAR(64) NOT NULL,
  legacy_source_id VARCHAR(128) NOT NULL,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_source_identities_canonical ON action_source_identities (canonical_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_source_identities_legacy ON action_source_identities (eid, source_type, legacy_source_type, legacy_source_id);
CREATE INDEX IF NOT EXISTS idx_action_source_identities_scope ON action_source_identities (eid, source_type);

CREATE TABLE IF NOT EXISTS action_source_refs (
  id BIGSERIAL PRIMARY KEY,
  eid BIGINT NOT NULL,
  parent_type VARCHAR(32) NOT NULL,
  parent_id VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  canonical_id VARCHAR(128) NOT NULL,
  source_version VARCHAR(64) NOT NULL DEFAULT '',
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_source_refs_parent ON action_source_refs (eid, parent_type, parent_id, role);
CREATE INDEX IF NOT EXISTS idx_action_source_refs_source ON action_source_refs (eid, source_type, canonical_id);
