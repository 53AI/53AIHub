CREATE TABLE IF NOT EXISTS action_source_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_id TEXT NOT NULL,
  eid INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  legacy_source_type TEXT NOT NULL,
  legacy_source_id TEXT NOT NULL,
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_source_identities_canonical ON action_source_identities (canonical_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_source_identities_legacy ON action_source_identities (eid, source_type, legacy_source_type, legacy_source_id);
CREATE INDEX IF NOT EXISTS idx_action_source_identities_scope ON action_source_identities (eid, source_type);

CREATE TABLE IF NOT EXISTS action_source_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eid INTEGER NOT NULL,
  parent_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  role TEXT NOT NULL,
  source_type TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  source_version TEXT NOT NULL DEFAULT '',
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_source_refs_parent ON action_source_refs (eid, parent_type, parent_id, role);
CREATE INDEX IF NOT EXISTS idx_action_source_refs_source ON action_source_refs (eid, source_type, canonical_id);
