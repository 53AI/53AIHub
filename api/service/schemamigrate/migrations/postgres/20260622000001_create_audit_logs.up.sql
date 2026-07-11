CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
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
  updated_time BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_eid ON audit_logs (eid);
CREATE INDEX IF NOT EXISTS idx_audit_logs_agent_id ON audit_logs (agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_token_id ON audit_logs (token_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON audit_logs (request_id);
