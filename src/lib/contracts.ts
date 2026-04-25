import type {
  CliproxyExportPayload,
  CliproxyImportResult,
  InstanceStateRecord,
  SnapshotRecord,
  StatusPayload,
  SyncRunRecord,
  UsageSummary
} from "../types";

export interface CliproxyClient {
  exportUsage(): Promise<CliproxyExportPayload>;
  importUsage(payload: CliproxyExportPayload): Promise<CliproxyImportResult>;
}

export interface SnapshotBucket {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

export interface UsageRepository {
  ensureInstance(): Promise<void>;
  getState(): Promise<InstanceStateRecord | null>;
  setState(state: InstanceStateRecord | null): Promise<void>;
  insertSnapshot(snapshot: SnapshotRecord): Promise<void>;
  getLatestSnapshot(): Promise<SnapshotRecord | null>;
  listSnapshots(limit: number): Promise<SnapshotRecord[]>;
  recordRun(run: SyncRunRecord): Promise<void>;
  getStatus(latestSummary: UsageSummary | null): Promise<StatusPayload>;
}
