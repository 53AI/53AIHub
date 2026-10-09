CREATE TABLE IF NOT EXISTS action_opportunity_detection_locks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lock_key VARCHAR(191) NOT NULL,
  lease_token VARCHAR(64) NOT NULL,
  lease_until BIGINT NOT NULL DEFAULT 0,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_action_opportunity_detection_lock_key (lock_key),
  KEY idx_action_opportunity_detection_lock_until (lease_until)
);
