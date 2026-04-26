import type { CliproxyClient, SnapshotBucket, UsageRepository } from "./contracts";
import { maybeRestoreUsage } from "./restore-service";
import { backupUsage } from "./snapshot-service";

interface AutomaticSyncOptions {
  now: string;
  instanceId: string;
  cooldownMinutes: number;
  autoRestoreEnabled: boolean;
  client: CliproxyClient;
  bucket: SnapshotBucket;
  repo: UsageRepository;
}

export async function runAutomaticSync(options: AutomaticSyncOptions) {
  const restoreResult = await maybeRestoreUsage({
    now: options.now,
    instanceId: options.instanceId,
    cooldownMinutes: options.cooldownMinutes,
    autoRestoreEnabled: options.autoRestoreEnabled,
    client: options.client,
    bucket: options.bucket,
    repo: options.repo
  });

  if (restoreResult.status === "restored" && restoreResult.restoreMode === "empty-instance") {
    return {
      restoreResult,
      backupResult: null
    };
  }

  const backupResult = await backupUsage({
    now: options.now,
    instanceId: options.instanceId,
    client: options.client,
    bucket: options.bucket,
    repo: options.repo
  });

  return {
    restoreResult,
    backupResult
  };
}
