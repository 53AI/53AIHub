CREATE TABLE IF NOT EXISTS action_quality_reviews (
  id BIGSERIAL PRIMARY KEY,
  review_id VARCHAR(64) NOT NULL,
  eid BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  summary TEXT NOT NULL,
  checked_at BIGINT NOT NULL DEFAULT 0,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_quality_reviews_id ON action_quality_reviews (review_id);
CREATE INDEX IF NOT EXISTS idx_action_quality_reviews_scope ON action_quality_reviews (eid, owner_id, status);
CREATE INDEX IF NOT EXISTS idx_action_quality_reviews_plan ON action_quality_reviews (eid, plan_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_action_quality_reviews_run ON action_quality_reviews (eid, run_id);

CREATE TABLE IF NOT EXISTS action_quality_review_items (
  id BIGSERIAL PRIMARY KEY,
  eid BIGINT NOT NULL,
  review_id VARCHAR(64) NOT NULL,
  criterion_order INTEGER NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  evidence TEXT NOT NULL,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_quality_review_items_review ON action_quality_review_items (eid, review_id, criterion_order);

CREATE TABLE IF NOT EXISTS action_result_assets (
  id BIGSERIAL PRIMARY KEY,
  result_asset_id VARCHAR(64) NOT NULL,
  eid BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  action_id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  opportunity_id VARCHAR(64) NOT NULL,
  source_insight_id VARCHAR(128) NOT NULL,
  source_meeting_id VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  result_type VARCHAR(64) NOT NULL,
  summary TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_result_assets_id ON action_result_assets (result_asset_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_result_assets_plan ON action_result_assets (eid, plan_id);
CREATE INDEX IF NOT EXISTS idx_action_result_assets_scope ON action_result_assets (eid, owner_id, status);

CREATE TABLE IF NOT EXISTS action_result_asset_artifacts (
  id BIGSERIAL PRIMARY KEY,
  eid BIGINT NOT NULL,
  result_asset_id VARCHAR(64) NOT NULL,
  artifact_id VARCHAR(128) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_result_asset_artifacts_asset ON action_result_asset_artifacts (eid, result_asset_id);
CREATE INDEX IF NOT EXISTS idx_action_result_asset_artifacts_artifact ON action_result_asset_artifacts (eid, artifact_id);

CREATE TABLE IF NOT EXISTS action_result_asset_evidence (
  id BIGSERIAL PRIMARY KEY,
  eid BIGINT NOT NULL,
  result_asset_id VARCHAR(64) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(128) NOT NULL,
  segment_id VARCHAR(128) NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL,
  timestamp BIGINT NOT NULL DEFAULT 0,
  position VARCHAR(128) NOT NULL DEFAULT '',
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_result_asset_evidence_asset ON action_result_asset_evidence (eid, result_asset_id);
