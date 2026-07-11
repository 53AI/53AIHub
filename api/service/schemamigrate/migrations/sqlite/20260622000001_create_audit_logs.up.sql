CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eid INTEGER NOT NULL,
  agent_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  ip TEXT DEFAULT '',
  status_code INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  request_id TEXT DEFAULT '',
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_eid ON audit_logs (eid);
CREATE INDEX IF NOT EXISTS idx_audit_logs_agent_id ON audit_logs (agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_token_id ON audit_logs (token_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON audit_logs (request_id);
