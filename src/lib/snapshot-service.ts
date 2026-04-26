import type { CliproxyClient, SnapshotBucket, UsageRepository } from "./contracts";
import {
  buildCumulativeBackupKey,
  mergeUsageExports,
  stableStringify,
  summarizeUsageExport,
  usageContentHash
} from "./usage";
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
    if (summary.isEmpty) {
      await repo.setState({
        ...coerceState(state, instanceId, now),
        lastSeenEmptyAt: now,
        lastError: null
      });
      await repo.recordRun({
        id: crypto.randomUUID(),
        instanceId,
        runType,
        status: "skipped",
        message: "empty export; cumulative backup preserved",
        snapshotId: null,
        startedAt,
        finishedAt: now
      });
      return {
        status: "empty" as const,
        summary
      };
    }

    const backupKey = state?.backupR2Key ?? buildCumulativeBackupKey(instanceId);
    const existingRaw = await bucket.get(backupKey);
    const existingPayload = existingRaw ? (JSON.parse(existingRaw) as typeof payload) : null;
    const mergedPayload = mergeUsageExports(existingPayload, payload);
    const mergedSummary = summarizeUsageExport(mergedPayload);
    const contentHash = await usageContentHash(mergedPayload);

    if (state?.lastBackupHash === contentHash) {
      await repo.setState({
        ...coerceState(state, instanceId, now),
        lastBackupAt: now,
        lastBackupHash: contentHash,
        backupR2Key: backupKey,
        lastNonEmptyBackupAt: now,
        backupTotalRequests: mergedSummary.totalRequests,
        backupTotalTokens: mergedSummary.totalTokens,
        backupItemCount: mergedSummary.itemCount,
        lastError: null
      });
      await repo.recordRun({
        id: crypto.randomUUID(),
        instanceId,
        runType,
        status: "skipped",
        message: "usage unchanged; cumulative backup preserved",
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

    await bucket.put(backupKey, stableStringify(mergedPayload));

    const snapshot: SnapshotRecord = {
      id: crypto.randomUUID(),
      instanceId,
      snapshotTime: payload.exported_at ?? now,
      r2Key: backupKey,
      contentHash,
      itemCount: mergedSummary.itemCount,
      totalCost: mergedSummary.totalCost,
      totalTokens: mergedSummary.totalTokens,
      totalRequests: mergedSummary.totalRequests,
      failedRequests: mergedSummary.failedRequests,
      sourceStatus: "success",
      createdAt: now
    };

    await repo.insertSnapshot(snapshot);
    await repo.setState({
        ...coerceState(state, instanceId, now),
        lastBackupAt: now,
        lastBackupHash: contentHash,
        backupR2Key: backupKey,
        lastNonEmptyBackupAt: now,
        backupTotalRequests: mergedSummary.totalRequests,
        backupTotalTokens: mergedSummary.totalTokens,
        backupItemCount: mergedSummary.itemCount,
        lastError: null
      });
    await repo.recordRun({
      id: crypto.randomUUID(),
      instanceId,
      runType,
      status: "success",
      message: "stored cumulative usage backup",
      snapshotId: snapshot.id,
      startedAt,
      finishedAt: now
    });

    return {
      status: "stored" as const,
      hash: contentHash,
      summary: mergedSummary,
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
    backupR2Key: state?.backupR2Key ?? null,
    lastNonEmptyBackupAt: state?.lastNonEmptyBackupAt ?? null,
    backupTotalRequests: state?.backupTotalRequests ?? null,
    backupTotalTokens: state?.backupTotalTokens ?? null,
    backupItemCount: state?.backupItemCount ?? null,
    updatedAt: now
  };
}
