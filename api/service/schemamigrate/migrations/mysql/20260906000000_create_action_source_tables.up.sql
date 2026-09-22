CREATE TABLE IF NOT EXISTS action_source_identities (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  canonical_id VARCHAR(128) NOT NULL,
  eid BIGINT NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  legacy_source_type VARCHAR(64) NOT NULL,
  legacy_source_id VARCHAR(128) NOT NULL,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_action_source_identities_canonical (canonical_id),
  UNIQUE KEY uk_action_source_identities_legacy (eid, source_type, legacy_source_type, legacy_source_id),
  KEY idx_action_source_identities_scope (eid, source_type)
);

CREATE TABLE IF NOT EXISTS action_source_refs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  eid BIGINT NOT NULL,
  parent_type VARCHAR(32) NOT NULL,
  parent_id VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  canonical_id VARCHAR(128) NOT NULL,
  source_version VARCHAR(64) NOT NULL DEFAULT '',
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  KEY idx_action_source_refs_parent (eid, parent_type, parent_id, role),
  KEY idx_action_source_refs_source (eid, source_type, canonical_id)
);
