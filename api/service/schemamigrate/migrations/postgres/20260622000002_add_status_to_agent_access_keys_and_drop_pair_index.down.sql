-- noop: status column is managed by GORM AutoMigrate; uk_agent_access_key_pair may have
-- duplicate eid+agent_id data, making safe recreation impossible in a generic down migration.
SELECT 1;
