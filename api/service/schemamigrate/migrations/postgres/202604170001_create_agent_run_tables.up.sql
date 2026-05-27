CREATE TABLE IF NOT EXISTS agent_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  eid BIGINT NOT NULL,
  conversation_id BIGINT NOT NULL DEFAULT 0,
  message_id BIGINT NOT NULL DEFAULT 0,
  request_id VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  current_step VARCHAR(64) NOT NULL DEFAULT '',
  partial_text TEXT,
  reasoning_text TEXT,
  last_event_id BIGINT NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  error_message TEXT,
  cancel_requested_at BIGINT NOT NULL DEFAULT 0,
  started_at BIGINT NOT NULL DEFAULT 0,
  finished_at BIGINT NOT NULL DEFAULT 0,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_agent_runs_run_id ON agent_runs (run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_eid_status ON agent_runs (eid, status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_eid_request_id ON agent_runs (eid, request_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_eid_conversation_id ON agent_runs (eid, conversation_id);

CREATE TABLE IF NOT EXISTS agent_run_events (
  id BIGSERIAL PRIMARY KEY,
  eid BIGINT NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(255) NOT NULL DEFAULT '',
  seq BIGINT NOT NULL DEFAULT 0,
  event_type VARCHAR(64) NOT NULL,
  message_id BIGINT NOT NULL DEFAULT 0,
  payload_json TEXT,
  created_at BIGINT NOT NULL DEFAULT 0,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_agent_run_events_seq ON agent_run_events (eid, run_id, seq);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_request ON agent_run_events (eid, request_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_event_type ON agent_run_events (event_type);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_message_id ON agent_run_events (message_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_created_at ON agent_run_events (created_at);
