CREATE TABLE IF NOT EXISTS action_opportunity_detection_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_key TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_opportunity_detection_lock_key ON action_opportunity_detection_locks (lock_key);
CREATE INDEX IF NOT EXISTS idx_action_opportunity_detection_lock_until ON action_opportunity_detection_locks (lease_until);
