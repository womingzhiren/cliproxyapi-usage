ALTER TABLE snapshots ADD COLUMN total_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE snapshots ADD COLUMN failed_requests INTEGER NOT NULL DEFAULT 0;

UPDATE snapshots
SET total_requests = item_count
WHERE total_requests = 0;

UPDATE snapshots
SET failed_requests = 0
WHERE failed_requests IS NULL OR failed_requests < 0;
