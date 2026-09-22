CREATE TABLE IF NOT EXISTS action_quality_review_item_details (
  id BIGSERIAL PRIMARY KEY,
  eid BIGINT NOT NULL,
  review_id VARCHAR(64) NOT NULL,
  criterion_id VARCHAR(64) NOT NULL,
  criterion_order INTEGER NOT NULL,
  layer VARCHAR(64) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  evidence_refs TEXT NOT NULL,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_quality_review_details_review ON action_quality_review_item_details (eid, review_id, criterion_order);
CREATE INDEX IF NOT EXISTS idx_action_quality_review_details_criterion ON action_quality_review_item_details (eid, criterion_id);
