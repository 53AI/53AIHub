-- noop: status column is managed by GORM AutoMigrate; uk_agent_access_key_pair may not exist
-- or may have duplicates, making safe recreation impossible in a generic down migration.
SELECT 1;
