import type { CliproxyClient, SnapshotBucket, UsageRepository } from "./contracts";
import { summarizeUsageExport } from "./usage";
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

    const latestSnapshot = await repo.getLatestSnapshot();
    if (!latestSnapshot) {
      await repo.setState({
        ...coerceState(state, instanceId, now),
        lastSeenEmptyAt: now
      });
      await repo.recordRun(skipRun(instanceId, runType, startedAt, now, "no snapshot available"));
      return { status: "no-snapshot" as const };
    }

    const raw = await bucket.get(latestSnapshot.r2Key);
    if (!raw) {
      throw new Error(`snapshot payload missing: ${latestSnapshot.r2Key}`);
    }

    const payload = JSON.parse(raw) as CliproxyExportPayload;
    const importResult = await client.importUsage(payload);

    await repo.setState({
      ...coerceState(state, instanceId, now),
      lastRestoreAt: now,
      lastRestoreSnapshotId: latestSnapshot.id,
      lastSeenEmptyAt: now,
      lastError: null
    });
    await repo.recordRun({
      id: crypto.randomUUID(),
      instanceId,
      runType,
      status: "success",
      message: `restored ${importResult.total_requests} requests`,
      snapshotId: latestSnapshot.id,
      startedAt,
      finishedAt: now
    });

    return {
      status: "restored" as const,
      snapshotId: latestSnapshot.id
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
    updatedAt: now
  };
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
