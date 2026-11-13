-- conversation_summaries: 二号总裁探讨会话的持久化增量摘要 (Phase 2A)
-- 每个 (eid, conversation_id) 单行；covered_through_message_id 为可靠消息游标，
-- summary_version 供 CAS 乐观锁推进；skipped_message_ids 记录待补偿的跳过消息。
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  eid BIGINT NOT NULL,
  conversation_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  agent_id BIGINT NOT NULL,
  summary TEXT,
  summary_version BIGINT NOT NULL DEFAULT 0,
  covered_through_message_id BIGINT NOT NULL DEFAULT 0,
  latest_message_id BIGINT NOT NULL DEFAULT 0,
  latest_message_time BIGINT NOT NULL DEFAULT 0,
  last_error TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  skipped_message_ids TEXT,
  created_time BIGINT NOT NULL DEFAULT 0,
  updated_time BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_conversation_summaries_eid_conv (eid, conversation_id),
  KEY idx_conversation_summaries_eid_conv (eid, conversation_id)
);
