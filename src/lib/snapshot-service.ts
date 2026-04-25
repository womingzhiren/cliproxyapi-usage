import type { CliproxyClient, SnapshotBucket, UsageRepository } from "./contracts";
import { buildSnapshotKey, sha256Hex, stableStringify, summarizeUsageExport } from "./usage";
import type { InstanceStateRecord, SnapshotRecord, SyncRunRecord } from "../types";

interface BackupUsageOptions {
  now: string;
  instanceId: string;
  client: CliproxyClient;
  bucket: SnapshotBucket;
  repo: UsageRepository;
  runType?: SyncRunRecord["runType"];
}

export async function backupUsage(options: BackupUsageOptions) {
  const { now, instanceId, client, bucket, repo } = options;
  const runType = options.runType ?? "backup";
  const startedAt = now;

  await repo.ensureInstance();
  const state = await repo.getState();

  try {
    const payload = await client.exportUsage();
    const summary = summarizeUsageExport(payload);
    const contentHash = await sha256Hex(payload);

    if (state?.lastBackupHash === contentHash) {
      await repo.setState({
        ...coerceState(state, instanceId, now),
        lastBackupAt: now,
        lastBackupHash: contentHash,
        lastError: null
      });
      await repo.recordRun({
        id: crypto.randomUUID(),
        instanceId,
        runType,
        status: "success",
        message: "usage unchanged; snapshot skipped",
        snapshotId: null,
        startedAt,
        finishedAt: now
      });
      return {
        status: "unchanged" as const,
        hash: contentHash,
        summary
      };
    }

    const key = buildSnapshotKey(instanceId, payload.exported_at ?? now, contentHash);
    await bucket.put(key, stableStringify(payload));

    const snapshot: SnapshotRecord = {
      id: crypto.randomUUID(),
      instanceId,
      snapshotTime: payload.exported_at ?? now,
      r2Key: key,
      contentHash,
      itemCount: summary.itemCount,
      totalCost: summary.totalCost,
      totalTokens: summary.totalTokens,
      totalRequests: summary.totalRequests,
      failedRequests: summary.failedRequests,
      sourceStatus: "success",
      createdAt: now
    };

    await repo.insertSnapshot(snapshot);
    await repo.setState({
      ...coerceState(state, instanceId, now),
      lastBackupAt: now,
      lastBackupHash: contentHash,
      lastError: null
    });
    await repo.recordRun({
      id: crypto.randomUUID(),
      instanceId,
      runType,
      status: "success",
      message: "stored usage snapshot",
      snapshotId: snapshot.id,
      startedAt,
      finishedAt: now
    });

    return {
      status: "stored" as const,
      hash: contentHash,
      summary,
      snapshot
    };
  } catch (error) {
    await repo.setState({
      ...coerceState(state, instanceId, now),
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
