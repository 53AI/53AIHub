CREATE TABLE IF NOT EXISTS action_quality_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id TEXT NOT NULL,
  eid INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  checked_at INTEGER NOT NULL DEFAULT 0,
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_quality_reviews_id ON action_quality_reviews (review_id);
CREATE INDEX IF NOT EXISTS idx_action_quality_reviews_scope ON action_quality_reviews (eid, owner_id, status);
CREATE INDEX IF NOT EXISTS idx_action_quality_reviews_plan ON action_quality_reviews (eid, plan_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_action_quality_reviews_run ON action_quality_reviews (eid, run_id);

CREATE TABLE IF NOT EXISTS action_quality_review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eid INTEGER NOT NULL,
  review_id TEXT NOT NULL,
  criterion_order INTEGER NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_quality_review_items_review ON action_quality_review_items (eid, review_id, criterion_order);

CREATE TABLE IF NOT EXISTS action_result_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_asset_id TEXT NOT NULL,
  eid INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  source_insight_id TEXT NOT NULL,
  source_meeting_id TEXT NOT NULL,
  title TEXT NOT NULL,
  result_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_result_assets_id ON action_result_assets (result_asset_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_result_assets_plan ON action_result_assets (eid, plan_id);
CREATE INDEX IF NOT EXISTS idx_action_result_assets_scope ON action_result_assets (eid, owner_id, status);

CREATE TABLE IF NOT EXISTS action_result_asset_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eid INTEGER NOT NULL,
  result_asset_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_result_asset_artifacts_asset ON action_result_asset_artifacts (eid, result_asset_id);
CREATE INDEX IF NOT EXISTS idx_action_result_asset_artifacts_artifact ON action_result_asset_artifacts (eid, artifact_id);

CREATE TABLE IF NOT EXISTS action_result_asset_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eid INTEGER NOT NULL,
  result_asset_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  segment_id TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL DEFAULT '',
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_result_asset_evidence_asset ON action_result_asset_evidence (eid, result_asset_id);
