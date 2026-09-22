CREATE TABLE IF NOT EXISTS action_quality_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
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
  updated_time BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_action_quality_reviews_id (review_id),
  KEY idx_action_quality_reviews_scope (eid, owner_id, status),
  KEY idx_action_quality_reviews_plan (eid, plan_id, checked_at),
  KEY idx_action_quality_reviews_run (eid, run_id)
);

CREATE TABLE IF NOT EXISTS action_quality_review_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  eid BIGINT NOT NULL,
  review_id VARCHAR(64) NOT NULL,
  criterion_order INT NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  evidence TEXT NOT NULL,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  KEY idx_action_quality_review_items_review (eid, review_id, criterion_order)
);

CREATE TABLE IF NOT EXISTS action_result_assets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
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
  updated_time BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_action_result_assets_id (result_asset_id),
  UNIQUE KEY uk_action_result_assets_plan (eid, plan_id),
  KEY idx_action_result_assets_scope (eid, owner_id, status)
);

CREATE TABLE IF NOT EXISTS action_result_asset_artifacts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  eid BIGINT NOT NULL,
  result_asset_id VARCHAR(64) NOT NULL,
  artifact_id VARCHAR(128) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  KEY idx_action_result_asset_artifacts_asset (eid, result_asset_id),
  KEY idx_action_result_asset_artifacts_artifact (eid, artifact_id)
);

CREATE TABLE IF NOT EXISTS action_result_asset_evidence (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  eid BIGINT NOT NULL,
  result_asset_id VARCHAR(64) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(128) NOT NULL,
  segment_id VARCHAR(128) NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL,
  timestamp BIGINT NOT NULL DEFAULT 0,
  position VARCHAR(128) NOT NULL DEFAULT '',
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  KEY idx_action_result_asset_evidence_asset (eid, result_asset_id)
);
