CREATE TABLE IF NOT EXISTS action_step_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_execution_id TEXT NOT NULL,
  eid INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  step_order INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input_json TEXT NOT NULL,
  structured_output_json TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL,
  event_refs_json TEXT NOT NULL,
  runtime_thread_id TEXT NOT NULL DEFAULT '',
  runtime_turn_id TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  started_at INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER NOT NULL DEFAULT 0,
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_step_executions_id ON action_step_executions (step_execution_id);
CREATE INDEX IF NOT EXISTS idx_action_step_executions_run ON action_step_executions (eid, run_id, step_order);
CREATE INDEX IF NOT EXISTS idx_action_step_executions_task ON action_step_executions (eid, task_id);
