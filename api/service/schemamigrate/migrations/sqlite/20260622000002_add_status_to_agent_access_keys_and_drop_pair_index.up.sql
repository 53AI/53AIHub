ALTER TABLE agent_access_keys ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active';
DROP INDEX IF EXISTS uk_agent_access_key_pair;
