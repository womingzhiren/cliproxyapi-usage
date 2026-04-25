import type { CliproxyExportPayload, UsageSummary } from "../types";

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
