import type { CliproxyClient, SnapshotBucket, UsageRepository } from "./contracts";
import { buildCumulativeBackupKey, sha256Hex, stableStringify, summarizeUsageExport } from "./usage";
import type { CliproxyExportPayload, InstanceStateRecord, SyncRunRecord } from "../types";

interface RestoreOptions {
  now: string;
  instanceId: string;
  cooldownMinutes: number;
  autoRestoreEnabled: boolean;
  client: CliproxyClient;
  bucket: SnapshotBucket;
  repo: UsageRepository;
  runType?: SyncRunRecord["runType"];
}

export async function maybeRestoreUsage(options: RestoreOptions) {
  const { now, instanceId, cooldownMinutes, autoRestoreEnabled, client, bucket, repo } = options;
  const runType = options.runType ?? "restore";
  const startedAt = now;

  await repo.ensureInstance();
  const state = await repo.getState();

  if (!autoRestoreEnabled) {
    await repo.recordRun(skipRun(instanceId, runType, startedAt, now, "auto restore disabled"));
    return { status: "disabled" as const };
  }

  try {
    const currentExport = await client.exportUsage();
    const summary = summarizeUsageExport(currentExport);
    if (!summary.isEmpty) {
      await repo.recordRun(skipRun(instanceId, runType, startedAt, now, "usage not empty"));
      return { status: "not-empty" as const };
    }

    if (isInCooldown(state?.lastRestoreAt ?? null, now, cooldownMinutes)) {
      await repo.setState({
        ...coerceState(state, instanceId, now),
        lastSeenEmptyAt: now
      });
      await repo.recordRun(skipRun(instanceId, runType, startedAt, now, "restore cooldown active"));
      return { status: "cooldown" as const };
    }

    const baseline = await loadRestoreBaseline(instanceId, state, repo, bucket, now);
    if (!baseline) {
      await repo.setState({
        ...coerceState(state, instanceId, now),
        lastSeenEmptyAt: now
      });
      await repo.recordRun(skipRun(instanceId, runType, startedAt, now, "no restore baseline"));
      return { status: "no-baseline" as const };
    }

    const importResult = await client.importUsage(baseline.payload);

    await repo.setState({
      ...coerceState(state, instanceId, now),
      lastRestoreAt: now,
      lastRestoreSnapshotId: null,
      lastSeenEmptyAt: now,
      backupR2Key: baseline.key,
      lastNonEmptyBackupAt: state?.lastNonEmptyBackupAt ?? now,
      backupTotalRequests: baseline.summary.totalRequests,
      backupTotalTokens: baseline.summary.totalTokens,
      backupItemCount: baseline.summary.itemCount,
      lastBackupHash: baseline.hash,
      lastError: null
    });
    await repo.recordRun({
      id: crypto.randomUUID(),
      instanceId,
      runType,
      status: "success",
      message: `restored ${importResult.total_requests} requests from cumulative backup`,
      snapshotId: null,
      startedAt,
      finishedAt: now
    });

    return {
      status: "restored" as const
    };
  } catch (error) {
    await repo.setState({
      ...coerceState(state, instanceId, now),
      lastSeenEmptyAt: now,
      lastError: error instanceof Error ? error.message : String(error)
    });
    await repo.recordRun({
      id: crypto.randomUUID(),
      instanceId,
      runType,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      snapshotId: null,
      startedAt,
      finishedAt: now
    });
    return {
      status: "failed" as const,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function coerceState(
  state: InstanceStateRecord | null,
  instanceId: string,
  now: string
): InstanceStateRecord {
  return {
    instanceId,
    lastBackupAt: state?.lastBackupAt ?? null,
    lastBackupHash: state?.lastBackupHash ?? null,
    lastRestoreAt: state?.lastRestoreAt ?? null,
    lastRestoreSnapshotId: state?.lastRestoreSnapshotId ?? null,
    lastSeenEmptyAt: state?.lastSeenEmptyAt ?? null,
    lastError: state?.lastError ?? null,
    backupR2Key: state?.backupR2Key ?? null,
    lastNonEmptyBackupAt: state?.lastNonEmptyBackupAt ?? null,
    backupTotalRequests: state?.backupTotalRequests ?? null,
    backupTotalTokens: state?.backupTotalTokens ?? null,
    backupItemCount: state?.backupItemCount ?? null,
    updatedAt: now
  };
}

async function loadRestoreBaseline(
  instanceId: string,
  state: InstanceStateRecord | null,
  repo: UsageRepository,
  bucket: SnapshotBucket,
  now: string
) {
  const key = state?.backupR2Key ?? buildCumulativeBackupKey(instanceId);
  const currentRaw = await bucket.get(key);
  if (currentRaw) {
    const payload = JSON.parse(currentRaw) as CliproxyExportPayload;
    const summary = summarizeUsageExport(payload);
    if (!summary.isEmpty) {
      return {
        key,
        payload,
        summary,
        hash: await sha256Hex(payload)
      };
    }
  }

  const legacySnapshots = await repo.listSnapshots(100);
  for (const snapshot of legacySnapshots) {
    const raw = await bucket.get(snapshot.r2Key);
    if (!raw) {
      continue;
    }
    const payload = JSON.parse(raw) as CliproxyExportPayload;
    const summary = summarizeUsageExport(payload);
    if (summary.isEmpty) {
      continue;
    }
    await bucket.put(key, stableStringify(payload));
    return {
      key,
      payload,
      summary,
      hash: await sha256Hex(payload)
    };
  }

  return null;
}

function isInCooldown(lastRestoreAt: string | null, now: string, cooldownMinutes: number): boolean {
  if (!lastRestoreAt) {
    return false;
  }
  const diffMs = new Date(now).getTime() - new Date(lastRestoreAt).getTime();
  return diffMs < cooldownMinutes * 60_000;
}

function skipRun(
  instanceId: string,
  runType: SyncRunRecord["runType"],
  startedAt: string,
  finishedAt: string,
  message: string
): SyncRunRecord {
  return {
    id: crypto.randomUUID(),
    instanceId,
    runType,
    status: "skipped",
    message,
    snapshotId: null,
    startedAt,
    finishedAt
  };
}
