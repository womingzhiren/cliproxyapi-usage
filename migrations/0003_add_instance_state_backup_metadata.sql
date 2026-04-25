ALTER TABLE instance_state ADD COLUMN backup_r2_key TEXT;
ALTER TABLE instance_state ADD COLUMN last_non_empty_backup_at TEXT;
ALTER TABLE instance_state ADD COLUMN backup_total_requests INTEGER;
ALTER TABLE instance_state ADD COLUMN backup_total_tokens INTEGER;
ALTER TABLE instance_state ADD COLUMN backup_item_count INTEGER;
