CREATE TABLE IF NOT EXISTS action_step_executions (
  id BIGSERIAL PRIMARY KEY,
  step_execution_id VARCHAR(64) NOT NULL,
  eid BIGINT NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  plan_id VARCHAR(64) NOT NULL DEFAULT '',
  step_order INTEGER NOT NULL,
  step_key VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  input_json TEXT NOT NULL,
  structured_output_json TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL,
  event_refs_json TEXT NOT NULL,
  runtime_thread_id VARCHAR(128) NOT NULL DEFAULT '',
  runtime_turn_id VARCHAR(128) NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  error_message TEXT,
  started_at BIGINT NOT NULL DEFAULT 0,
  completed_at BIGINT NOT NULL DEFAULT 0,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_step_executions_id ON action_step_executions (step_execution_id);
CREATE INDEX IF NOT EXISTS idx_action_step_executions_run ON action_step_executions (eid, run_id, step_order);
CREATE INDEX IF NOT EXISTS idx_action_step_executions_task ON action_step_executions (eid, task_id);
