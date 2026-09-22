CREATE TABLE IF NOT EXISTS action_quality_review_item_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eid INTEGER NOT NULL,
  review_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  criterion_order INTEGER NOT NULL,
  layer TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_refs TEXT NOT NULL,
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_action_quality_review_details_review ON action_quality_review_item_details (eid, review_id, criterion_order);
CREATE INDEX IF NOT EXISTS idx_action_quality_review_details_criterion ON action_quality_review_item_details (eid, criterion_id);
