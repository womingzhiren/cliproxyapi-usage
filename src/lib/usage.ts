import type {
  CliproxyExportPayload,
  UsageApi,
  UsageDetailWithContext,
  UsageModel,
  UsageSnapshot,
  UsageSummary
} from "../types";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return Object.fromEntries(entries.map(([key, nested]) => [key, sortValue(nested)]));
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export async function sha256Hex(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function summarizeUsageExport(payload: CliproxyExportPayload): UsageSummary {
  const totalRequests = payload.usage.total_requests ?? 0;
  const totalTokens = payload.usage.total_tokens ?? 0;
  const failedRequests = payload.usage.failure_count ?? 0;
  const totalCost = payload.usage.total_cost ?? 0;

  return {
    itemCount: totalRequests,
    totalCost,
    totalTokens,
    totalRequests,
    failedRequests,
    isEmpty: totalRequests === 0 && totalTokens === 0
  };
}

export function buildSnapshotKey(instanceId: string, snapshotTime: string, hash: string): string {
  const date = new Date(snapshotTime);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const safeTimestamp = snapshotTime.replaceAll(":", "-");

  return `snapshots/${instanceId}/${year}/${month}/${day}/${safeTimestamp}-${hash}.json`;
}

export function buildCumulativeBackupKey(instanceId: string): string {
  return `backups/${instanceId}/usage-cumulative.json`;
}

export function flattenUsageDetails(payload: CliproxyExportPayload): UsageDetailWithContext[] {
  const entries: UsageDetailWithContext[] = [];
  for (const [api, apiUsage] of Object.entries(payload.usage.apis ?? {})) {
    for (const [model, modelUsage] of Object.entries(apiUsage.models ?? {})) {
      for (const detail of modelUsage.details ?? []) {
        entries.push({
          api,
          model,
          detail
        });
      }
    }
  }
  return entries;
}

export function usageDetailFingerprint(entry: UsageDetailWithContext): string {
  return stableStringify(entry);
}

export function mergeUsageExports(existing: CliproxyExportPayload | null, incoming: CliproxyExportPayload): CliproxyExportPayload {
  const mergedEntries = new Map<string, UsageDetailWithContext>();

  for (const entry of existing ? flattenUsageDetails(existing) : []) {
    mergedEntries.set(usageDetailFingerprint(entry), entry);
  }
  for (const entry of flattenUsageDetails(incoming)) {
    mergedEntries.set(usageDetailFingerprint(entry), entry);
  }

  const mergedPayload = rebuildUsageExport(Array.from(mergedEntries.values()), incoming.exported_at, incoming.version);
  return mergedPayload;
}

export function rebuildUsageExport(
  entries: UsageDetailWithContext[],
  exportedAt: string,
  version = 1
): CliproxyExportPayload {
  const sortedEntries = entries.slice().sort((left, right) => left.detail.timestamp.localeCompare(right.detail.timestamp));
  const usage: UsageSnapshot = {
    total_requests: 0,
    success_count: 0,
    failure_count: 0,
    total_tokens: 0,
    total_cost: 0,
    requests_by_day: {},
    requests_by_hour: {},
    tokens_by_day: {},
    tokens_by_hour: {},
    apis: {}
  };

  for (const entry of sortedEntries) {
    const day = entry.detail.timestamp.slice(0, 10);
    const hour = entry.detail.timestamp.slice(11, 13);
    const totalTokens = entry.detail.tokens.total_tokens ?? 0;
    const apiUsage = (usage.apis[entry.api] ??= {
      total_requests: 0,
      total_tokens: 0,
      total_cost: 0,
      models: {}
    } satisfies UsageApi);
    const modelUsage = (apiUsage.models[entry.model] ??= {
      total_requests: 0,
      total_tokens: 0,
      total_cost: 0,
      details: []
    } satisfies UsageModel);

    usage.total_requests += 1;
    usage.total_tokens += totalTokens;
    usage.total_cost = (usage.total_cost ?? 0) + (entry.detail.cost ?? 0);
    usage.requests_by_day[day] = (usage.requests_by_day[day] ?? 0) + 1;
    usage.requests_by_hour[hour] = (usage.requests_by_hour[hour] ?? 0) + 1;
    usage.tokens_by_day[day] = (usage.tokens_by_day[day] ?? 0) + totalTokens;
    usage.tokens_by_hour[hour] = (usage.tokens_by_hour[hour] ?? 0) + totalTokens;

    if (entry.detail.failed) {
      usage.failure_count += 1;
    } else {
      usage.success_count += 1;
    }

    apiUsage.total_requests += 1;
    apiUsage.total_tokens += totalTokens;
    apiUsage.total_cost = (apiUsage.total_cost ?? 0) + (entry.detail.cost ?? 0);

    modelUsage.total_requests += 1;
    modelUsage.total_tokens += totalTokens;
    modelUsage.total_cost = (modelUsage.total_cost ?? 0) + (entry.detail.cost ?? 0);
    modelUsage.details.push(entry.detail);
  }

  return {
    version,
    exported_at: exportedAt,
    usage
  };
}
