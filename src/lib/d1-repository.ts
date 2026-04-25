import type { UsageRepository } from "./contracts";
import type {
  InstanceRecord,
  InstanceStateRecord,
  SnapshotRecord,
  StatusPayload,
  SyncRunRecord,
  UsageSummary
} from "../types";

interface RepositoryConfig {
  db: D1Database;
  instance: InstanceRecord;
}

export class D1UsageRepository implements UsageRepository {
  constructor(private readonly config: RepositoryConfig) {}

  async ensureInstance(): Promise<void> {
    const instance = this.config.instance;
    await this.config.db
      .prepare(
        `INSERT INTO instances (id, name, base_url, enabled, auto_restore_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           base_url = excluded.base_url,
           enabled = excluded.enabled,
           auto_restore_enabled = excluded.auto_restore_enabled,
           updated_at = excluded.updated_at`
      )
      .bind(
        instance.id,
        instance.name,
        instance.baseUrl,
        instance.enabled ? 1 : 0,
        instance.autoRestoreEnabled ? 1 : 0,
        instance.createdAt,
        instance.updatedAt
      )
      .run();
  }

  async getState(): Promise<InstanceStateRecord | null> {
    const row = await this.config.db
      .prepare("SELECT * FROM instance_state WHERE instance_id = ?")
      .bind(this.config.instance.id)
      .first<Record<string, unknown>>();

    return row ? mapState(row) : null;
  }

  async setState(state: InstanceStateRecord | null): Promise<void> {
    if (!state) {
      return;
    }
    await this.config.db
      .prepare(
        `INSERT INTO instance_state (
           instance_id, last_backup_at, last_backup_hash, last_restore_at,
           last_restore_snapshot_id, last_seen_empty_at, last_error, backup_r2_key,
           last_non_empty_backup_at, backup_total_requests, backup_total_tokens,
           backup_item_count, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(instance_id) DO UPDATE SET
           last_backup_at = excluded.last_backup_at,
           last_backup_hash = excluded.last_backup_hash,
           last_restore_at = excluded.last_restore_at,
           last_restore_snapshot_id = excluded.last_restore_snapshot_id,
           last_seen_empty_at = excluded.last_seen_empty_at,
           last_error = excluded.last_error,
           backup_r2_key = excluded.backup_r2_key,
           last_non_empty_backup_at = excluded.last_non_empty_backup_at,
           backup_total_requests = excluded.backup_total_requests,
           backup_total_tokens = excluded.backup_total_tokens,
           backup_item_count = excluded.backup_item_count,
           updated_at = excluded.updated_at`
      )
      .bind(
        state.instanceId,
        state.lastBackupAt,
        state.lastBackupHash,
        state.lastRestoreAt,
        state.lastRestoreSnapshotId,
        state.lastSeenEmptyAt,
        state.lastError,
        state.backupR2Key,
        state.lastNonEmptyBackupAt,
        state.backupTotalRequests,
        state.backupTotalTokens,
        state.backupItemCount,
        state.updatedAt
      )
      .run();
  }

  async insertSnapshot(snapshot: SnapshotRecord): Promise<void> {
    await this.config.db
      .prepare(
        `INSERT INTO snapshots (
          id, instance_id, snapshot_time, r2_key, content_hash, item_count,
          total_cost, total_tokens, total_requests, failed_requests, source_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        snapshot.id,
        snapshot.instanceId,
        snapshot.snapshotTime,
        snapshot.r2Key,
        snapshot.contentHash,
        snapshot.itemCount,
        snapshot.totalCost,
        snapshot.totalTokens,
        snapshot.totalRequests,
        snapshot.failedRequests,
        snapshot.sourceStatus,
        snapshot.createdAt
      )
      .run();
  }

  async getLatestSnapshot(): Promise<SnapshotRecord | null> {
    const row = await this.config.db
      .prepare("SELECT * FROM snapshots WHERE instance_id = ? ORDER BY snapshot_time DESC LIMIT 1")
      .bind(this.config.instance.id)
      .first<Record<string, unknown>>();
    return row ? mapSnapshot(row) : null;
  }

  async listSnapshots(limit: number): Promise<SnapshotRecord[]> {
    const result = await this.config.db
      .prepare("SELECT * FROM snapshots WHERE instance_id = ? ORDER BY snapshot_time DESC LIMIT ?")
      .bind(this.config.instance.id, limit)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map(mapSnapshot);
  }

  async recordRun(run: SyncRunRecord): Promise<void> {
    await this.config.db
      .prepare(
        `INSERT INTO sync_runs (
           id, instance_id, run_type, status, message, snapshot_id, started_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(run.id, run.instanceId, run.runType, run.status, run.message, run.snapshotId, run.startedAt, run.finishedAt)
      .run();
  }

  async getStatus(latestSummary: UsageSummary | null): Promise<StatusPayload> {
    const state = await this.getState();
    const latestSnapshot = await this.getLatestSnapshot();
    const snapshots = await this.listSnapshots(10);
    const recentRuns = await this.listRuns(10);

    return {
      instance: this.config.instance,
      state,
      latestSummary,
      latestSnapshot,
      recentRuns,
      snapshots
    };
  }

  private async listRuns(limit: number): Promise<SyncRunRecord[]> {
    const result = await this.config.db
      .prepare("SELECT * FROM sync_runs WHERE instance_id = ? ORDER BY finished_at DESC LIMIT ?")
      .bind(this.config.instance.id, limit)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map(mapRun);
  }
}

function mapSnapshot(row: Record<string, unknown>): SnapshotRecord {
  return {
    id: String(row.id),
    instanceId: String(row.instance_id),
    snapshotTime: String(row.snapshot_time),
    r2Key: String(row.r2_key),
    contentHash: String(row.content_hash),
    itemCount: Number(row.item_count),
    totalCost: Number(row.total_cost),
    totalTokens: Number(row.total_tokens),
    totalRequests: Number(row.total_requests),
    failedRequests: Number(row.failed_requests),
    sourceStatus: String(row.source_status),
    createdAt: String(row.created_at)
  };
}

function mapRun(row: Record<string, unknown>): SyncRunRecord {
  return {
    id: String(row.id),
    instanceId: String(row.instance_id),
    runType: String(row.run_type) as SyncRunRecord["runType"],
    status: String(row.status) as SyncRunRecord["status"],
    message: String(row.message ?? ""),
    snapshotId: row.snapshot_id ? String(row.snapshot_id) : null,
    startedAt: String(row.started_at),
    finishedAt: String(row.finished_at)
  };
}

function mapState(row: Record<string, unknown>): InstanceStateRecord {
  return {
    instanceId: String(row.instance_id),
    lastBackupAt: row.last_backup_at ? String(row.last_backup_at) : null,
    lastBackupHash: row.last_backup_hash ? String(row.last_backup_hash) : null,
    lastRestoreAt: row.last_restore_at ? String(row.last_restore_at) : null,
    lastRestoreSnapshotId: row.last_restore_snapshot_id ? String(row.last_restore_snapshot_id) : null,
    lastSeenEmptyAt: row.last_seen_empty_at ? String(row.last_seen_empty_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    backupR2Key: row.backup_r2_key ? String(row.backup_r2_key) : null,
    lastNonEmptyBackupAt: row.last_non_empty_backup_at ? String(row.last_non_empty_backup_at) : null,
    backupTotalRequests: row.backup_total_requests != null ? Number(row.backup_total_requests) : null,
    backupTotalTokens: row.backup_total_tokens != null ? Number(row.backup_total_tokens) : null,
    backupItemCount: row.backup_item_count != null ? Number(row.backup_item_count) : null,
    updatedAt: String(row.updated_at)
  };
}
