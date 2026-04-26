import { describe, expect, it } from "vitest";

import { runAutomaticSync } from "../src/lib/auto-sync-service";
import {
  FakeCliproxyClient,
  FakeSnapshotBucket,
  FakeUsageRepository,
  createEmptyExportPayload,
  createExportPayload
} from "./fixtures";
import {
  buildCumulativeBackupKey,
  flattenUsageDetails,
  mergeUsageExports,
  rebuildUsageExport,
  stableStringify
  ,
  usageContentHash
} from "../src/lib/usage";

describe("runAutomaticSync", () => {
  it("does not trigger backup after a successful restore", async () => {
    const client = new FakeCliproxyClient(createEmptyExportPayload());
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();

    await bucket.put("backups/default/usage-cumulative.json", JSON.stringify(createExportPayload()));

    const result = await runAutomaticSync({
      now: "2026-04-25T07:40:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result.restoreResult.status).toBe("restored");
    expect(result.backupResult).toBeNull();
    expect(repo.syncRuns).toHaveLength(1);
    expect(repo.syncRuns[0]?.runType).toBe("restore");
  });

  it("triggers backup when restore is skipped because usage is not empty", async () => {
    const client = new FakeCliproxyClient(createExportPayload());
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();
    const key = buildCumulativeBackupKey("default");
    const payload = createExportPayload();
    const hash = await usageContentHash(mergeUsageExports(null, payload));

    await repo.setState({
      instanceId: "default",
      lastBackupAt: "2026-04-25T07:00:00Z",
      lastBackupHash: hash,
      lastRestoreAt: null,
      lastRestoreSnapshotId: null,
      lastSeenEmptyAt: null,
      lastError: null,
      backupR2Key: key,
      lastNonEmptyBackupAt: "2026-04-25T07:00:00Z",
      backupTotalRequests: 2,
      backupTotalTokens: 42,
      backupItemCount: 2,
      updatedAt: "2026-04-25T07:00:00Z"
    });
    await bucket.put(key, stableStringify(payload));

    const result = await runAutomaticSync({
      now: "2026-04-25T07:40:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result.restoreResult.status).toBe("not-behind");
    expect(result.backupResult?.status).toBe("unchanged");
    expect(repo.syncRuns).toHaveLength(2);
    expect(repo.syncRuns.map((run) => run.runType)).toEqual(["restore", "backup"]);
  });

  it("still attempts backup after restore fails", async () => {
    const client = new FakeCliproxyClient([
      new Error("restore export failed"),
      createExportPayload()
    ]);
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();

    const result = await runAutomaticSync({
      now: "2026-04-25T07:40:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result.restoreResult.status).toBe("failed");
    expect(result.backupResult?.status).toBe("stored");
    expect(repo.syncRuns).toHaveLength(2);
    expect(repo.syncRuns[0]).toMatchObject({
      runType: "restore",
      status: "failed"
    });
    expect(repo.syncRuns[1]).toMatchObject({
      runType: "backup",
      status: "success"
    });
  });

  it("runs backup after restoring missing history into a non-empty instance", async () => {
    const backupPayload = createExportPayload();
    const currentPayload = rebuildUsageExport(
      flattenUsageDetails(backupPayload).slice(1),
      "2026-04-25T07:20:00Z",
      backupPayload.version
    );
    const client = new FakeCliproxyClient([currentPayload, currentPayload]);
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();
    const key = buildCumulativeBackupKey("default");
    const hash = await usageContentHash(mergeUsageExports(null, backupPayload));

    await repo.setState({
      instanceId: "default",
      lastBackupAt: "2026-04-25T07:00:00Z",
      lastBackupHash: hash,
      lastRestoreAt: "2026-04-25T07:20:00Z",
      lastRestoreSnapshotId: null,
      lastSeenEmptyAt: null,
      lastError: null,
      backupR2Key: key,
      lastNonEmptyBackupAt: "2026-04-25T07:00:00Z",
      backupTotalRequests: 2,
      backupTotalTokens: 42,
      backupItemCount: 2,
      updatedAt: "2026-04-25T07:20:00Z"
    });
    await bucket.put(key, stableStringify(backupPayload));

    const result = await runAutomaticSync({
      now: "2026-04-25T07:25:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result.restoreResult).toMatchObject({
      status: "restored",
      restoreMode: "missing-history"
    });
    expect(result.backupResult?.status).toBe("unchanged");
    expect(client.importCalls).toHaveLength(1);
    expect(repo.syncRuns).toHaveLength(2);
    expect(repo.syncRuns.map((run) => run.runType)).toEqual(["restore", "backup"]);
  });
});
