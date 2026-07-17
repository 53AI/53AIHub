CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  eid BIGINT NOT NULL,
  agent_id BIGINT NOT NULL,
  token_id BIGINT NOT NULL,
  method VARCHAR(16) NOT NULL,
  path VARCHAR(256) NOT NULL,
  ip VARCHAR(64) DEFAULT '',
  status_code INT NOT NULL DEFAULT 0,
  latency_ms BIGINT NOT NULL DEFAULT 0,
  request_id VARCHAR(64) DEFAULT '',
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  INDEX idx_audit_logs_eid (eid),
  INDEX idx_audit_logs_agent_id (agent_id),
  INDEX idx_audit_logs_token_id (token_id),
  INDEX idx_audit_logs_request_id (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
