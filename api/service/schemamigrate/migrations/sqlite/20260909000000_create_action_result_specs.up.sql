CREATE TABLE IF NOT EXISTS action_result_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_spec_id TEXT NOT NULL,
  eid INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  result_spec_version TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  template_version TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_result_specs_id ON action_result_specs (result_spec_id);
CREATE INDEX IF NOT EXISTS idx_action_result_specs_scope ON action_result_specs (eid, owner_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_action_result_specs_run ON action_result_specs (eid, run_id);
