CREATE TABLE IF NOT EXISTS action_quality_review_item_details (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  eid BIGINT NOT NULL,
  review_id VARCHAR(64) NOT NULL,
  criterion_id VARCHAR(64) NOT NULL,
  criterion_order INT NOT NULL,
  layer VARCHAR(64) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  evidence_refs TEXT NOT NULL,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  KEY idx_action_quality_review_details_review (eid, review_id, criterion_order),
  KEY idx_action_quality_review_details_criterion (eid, criterion_id)
);
