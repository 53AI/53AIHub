CREATE TABLE IF NOT EXISTS action_opportunity_detection_locks (
  id BIGSERIAL PRIMARY KEY,
  lock_key VARCHAR(191) NOT NULL,
  lease_token VARCHAR(64) NOT NULL,
  lease_until BIGINT NOT NULL DEFAULT 0,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_opportunity_detection_lock_key ON action_opportunity_detection_locks (lock_key);
CREATE INDEX IF NOT EXISTS idx_action_opportunity_detection_lock_until ON action_opportunity_detection_locks (lease_until);
