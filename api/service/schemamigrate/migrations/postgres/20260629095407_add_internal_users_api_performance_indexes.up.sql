DROP INDEX IF EXISTS idx_users_eid;
CREATE INDEX IF NOT EXISTS idx_users_eid_type ON users (eid, type);
CREATE INDEX IF NOT EXISTS idx_mid_eid ON member_bindings (mid, eid);
CREATE INDEX IF NOT EXISTS idx_eid_bindvalue ON member_bindings (eid, bindvalue);
CREATE INDEX IF NOT EXISTS idx_bid_eid ON member_department_relations (bid, eid);
CREATE INDEX IF NOT EXISTS idx_did_eid_from ON member_department_relations (did, eid, "from");
CREATE INDEX IF NOT EXISTS idx_type_resource ON resource_permissions (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_departments_eid ON departments (eid);