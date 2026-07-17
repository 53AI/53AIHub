ALTER TABLE messages ADD COLUMN openclaw_projection_key TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN openclaw_turn_id TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN openclaw_seq_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN openclaw_seq_end INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN openclaw_status TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN openclaw_projection_json TEXT;
