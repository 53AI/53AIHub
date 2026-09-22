ALTER TABLE action_opportunities ADD COLUMN IF NOT EXISTS insight_generation BIGINT NOT NULL DEFAULT 0;
