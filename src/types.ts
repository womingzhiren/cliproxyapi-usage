export interface UsageTokens {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  total_tokens: number;
}

export interface UsageDetail {
  timestamp: string;
  source: string;
  auth_index: string;
  tokens: UsageTokens;
  failed: boolean;
  cost?: number;
}

export interface UsageModel {
  total_requests: number;
  total_tokens: number;
  total_cost?: number;
  details: UsageDetail[];
}

export interface UsageApi {
  total_requests: number;
  total_tokens: number;
  total_cost?: number;
  models: Record<string, UsageModel>;
}

export interface UsageSnapshot {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  total_cost?: number;
  requests_by_day: Record<string, number>;
  requests_by_hour: Record<string, number>;
  tokens_by_day: Record<string, number>;
  tokens_by_hour: Record<string, number>;
  apis: Record<string, UsageApi>;
}

export interface CliproxyExportPayload {
  version: number;
  exported_at: string;
  usage: UsageSnapshot;
}

export interface CliproxyImportResult {
  added: number;
  skipped: number;
  total_requests: number;
  failed_requests: number;
}

export interface UsageSummary {
  itemCount: number;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  failedRequests: number;
  isEmpty: boolean;
}

export interface InstanceRecord {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  autoRestoreEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotRecord {
  id: string;
  instanceId: string;
  snapshotTime: string;
  r2Key: string;
  contentHash: string;
  itemCount: number;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  failedRequests: number;
  sourceStatus: string;
  createdAt: string;
}

export interface SyncRunRecord {
  id: string;
  instanceId: string;
  runType: "backup" | "restore" | "manual_backup" | "manual_restore";
  status: "success" | "failed" | "skipped";
  message: string;
  snapshotId: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface InstanceStateRecord {
  instanceId: string;
  lastBackupAt: string | null;
  lastBackupHash: string | null;
  lastRestoreAt: string | null;
  lastRestoreSnapshotId: string | null;
  lastSeenEmptyAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface StatusPayload {
  instance: InstanceRecord;
  state: InstanceStateRecord | null;
  latestSummary: UsageSummary | null;
  latestSnapshot: SnapshotRecord | null;
  recentRuns: SyncRunRecord[];
  snapshots: SnapshotRecord[];
}
