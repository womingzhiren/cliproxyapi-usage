import type {
  CliproxyExportPayload,
  CliproxyImportResult,
  InstanceStateRecord,
  SnapshotRecord,
  SyncRunRecord,
  UsageSummary
} from "../src/types";
import type {
  CliproxyClient,
  SnapshotBucket,
  UsageRepository
} from "../src/lib/contracts";

export function createExportPayload(overrides?: Partial<CliproxyExportPayload>): CliproxyExportPayload {
  return {
    version: 1,
    exported_at: "2026-04-25T07:00:00Z",
    usage: {
      total_requests: 2,
      success_count: 2,
      failure_count: 0,
      total_tokens: 42,
      requests_by_day: {
        "2026-04-25": 2
      },
      requests_by_hour: {
        "07": 2
      },
      tokens_by_day: {
        "2026-04-25": 42
      },
      tokens_by_hour: {
        "07": 42
      },
      apis: {
        "POST /v1/chat/completions": {
          total_requests: 2,
          total_tokens: 42,
          models: {
            "gpt-4.1-mini": {
              total_requests: 2,
              total_tokens: 42,
              details: [
                {
                  timestamp: "2026-04-25T06:59:00Z",
                  source: "openai",
                  auth_index: "abc",
                  tokens: {
                    input_tokens: 10,
                    output_tokens: 11,
                    reasoning_tokens: 0,
                    cached_tokens: 0,
                    total_tokens: 21
                  },
                  failed: false
                },
                {
                  timestamp: "2026-04-25T07:00:00Z",
                  source: "openai",
                  auth_index: "abc",
                  tokens: {
                    input_tokens: 11,
                    output_tokens: 10,
                    reasoning_tokens: 0,
                    cached_tokens: 0,
                    total_tokens: 21
                  },
                  failed: false
                }
              ]
            }
          }
        }
      }
    },
    ...overrides
  };
}

export function createEmptyExportPayload(overrides?: Partial<CliproxyExportPayload>): CliproxyExportPayload {
  const payload = createExportPayload();
  return {
    ...payload,
    usage: {
      ...payload.usage,
      total_requests: 0,
      success_count: 0,
      failure_count: 0,
      total_tokens: 0,
      requests_by_day: {},
      requests_by_hour: {},
      tokens_by_day: {},
      tokens_by_hour: {},
      apis: {}
    },
    ...overrides
  };
}

export class FakeCliproxyClient implements CliproxyClient {
  public importCalls: CliproxyExportPayload[] = [];
  public exportCalls = 0;

  constructor(
    private readonly currentExport: CliproxyExportPayload | CliproxyExportPayload[],
    private readonly importResult?: CliproxyImportResult
  ) {}

  async exportUsage(): Promise<CliproxyExportPayload> {
    this.exportCalls += 1;
    if (Array.isArray(this.currentExport)) {
      return this.currentExport[Math.min(this.exportCalls - 1, this.currentExport.length - 1)];
    }
    return this.currentExport;
  }

  async importUsage(payload: CliproxyExportPayload): Promise<CliproxyImportResult> {
    this.importCalls.push(payload);
    return this.importResult ?? {
      added: payload.usage.total_requests,
      skipped: 0,
      total_requests: payload.usage.total_requests,
      failed_requests: payload.usage.failure_count
    };
  }
}

export class FakeSnapshotBucket implements SnapshotBucket {
  public objects = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }
}

export class FakeUsageRepository implements UsageRepository {
  public snapshots: SnapshotRecord[] = [];
  public syncRuns: SyncRunRecord[] = [];
  public state: InstanceStateRecord | null = null;

  public instance = {
    id: "default",
    name: "Default",
    baseUrl: "https://cliproxy.example",
    enabled: true,
    autoRestoreEnabled: true,
    createdAt: "2026-04-25T07:00:00Z",
    updatedAt: "2026-04-25T07:00:00Z"
  };

  async ensureInstance(): Promise<void> {}

  async getState() {
    return this.state;
  }

  async setState(nextState: InstanceStateRecord | null): Promise<void> {
    this.state = nextState;
  }

  async insertSnapshot(snapshot: SnapshotRecord): Promise<void> {
    this.snapshots.push(snapshot);
  }

  async getLatestSnapshot(): Promise<SnapshotRecord | null> {
    return this.snapshots.at(-1) ?? null;
  }

  async listSnapshots(limit: number): Promise<SnapshotRecord[]> {
    return this.snapshots.slice(-limit).reverse();
  }

  async recordRun(run: SyncRunRecord): Promise<void> {
    this.syncRuns.push(run);
  }

  async getStatus(latestSummary: UsageSummary | null) {
    return {
      instance: this.instance,
      state: this.state,
      latestSummary,
      latestSnapshot: this.snapshots.at(-1) ?? null,
      recentRuns: this.syncRuns.slice(-10).reverse(),
      snapshots: this.snapshots.slice(-10).reverse()
    };
  }
}
