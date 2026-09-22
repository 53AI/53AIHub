CREATE TABLE IF NOT EXISTS action_result_specs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  result_spec_id VARCHAR(64) NOT NULL,
  eid BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  result_spec_version VARCHAR(64) NOT NULL,
  renderer_version VARCHAR(64) NOT NULL,
  template_version VARCHAR(64) NOT NULL,
  spec_json LONGTEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_action_result_specs_id (result_spec_id),
  KEY idx_action_result_specs_scope (eid, owner_id, plan_id),
  KEY idx_action_result_specs_run (eid, run_id)
);
