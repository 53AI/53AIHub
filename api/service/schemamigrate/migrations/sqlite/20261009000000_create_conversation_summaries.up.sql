-- conversation_summaries: 二号总裁探讨会话的持久化增量摘要 (Phase 2A)
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eid BIGINT NOT NULL,
  conversation_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  agent_id BIGINT NOT NULL,
  summary TEXT,
  summary_version INTEGER NOT NULL DEFAULT 0,
  covered_through_message_id INTEGER NOT NULL DEFAULT 0,
  latest_message_id INTEGER NOT NULL DEFAULT 0,
  latest_message_time INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  skipped_message_ids TEXT,
  created_time INTEGER NOT NULL DEFAULT 0,
  updated_time INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_conversation_summaries_eid_conv ON conversation_summaries (eid, conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_eid_conv ON conversation_summaries (eid, conversation_id);
