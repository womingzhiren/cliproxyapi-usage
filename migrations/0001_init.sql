CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_restore_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  snapshot_time TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  total_cost REAL NOT NULL,
  total_tokens INTEGER NOT NULL,
  source_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (instance_id) REFERENCES instances(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_instance_time
  ON snapshots(instance_id, snapshot_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_instance_hash
  ON snapshots(instance_id, content_hash);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  snapshot_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  FOREIGN KEY (instance_id) REFERENCES instances(id),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_instance_finished
  ON sync_runs(instance_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS instance_state (
  instance_id TEXT PRIMARY KEY,
  last_backup_at TEXT,
  last_backup_hash TEXT,
  last_restore_at TEXT,
  last_restore_snapshot_id TEXT,
  last_seen_empty_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (instance_id) REFERENCES instances(id),
  FOREIGN KEY (last_restore_snapshot_id) REFERENCES snapshots(id)
);
