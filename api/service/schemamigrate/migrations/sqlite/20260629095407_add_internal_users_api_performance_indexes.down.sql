DROP INDEX IF EXISTS idx_users_eid_type;
CREATE INDEX IF NOT EXISTS idx_users_eid ON users (eid);
DROP INDEX IF EXISTS idx_eid_bindvalue;
DROP INDEX IF EXISTS idx_mid_eid;
DROP INDEX IF EXISTS idx_did_eid_from;
DROP INDEX IF EXISTS idx_bid_eid;
DROP INDEX IF EXISTS idx_type_resource;
DROP INDEX IF EXISTS idx_departments_eid;