-- Duplicate source markers removed by the up migration cannot be recreated.
-- Keep the unique index to preserve the sync idempotency guarantee.
SELECT 1;
