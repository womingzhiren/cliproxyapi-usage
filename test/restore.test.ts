import { describe, expect, it } from "vitest";

import { maybeRestoreUsage } from "../src/lib/restore-service";
import { buildCumulativeBackupKey, stableStringify } from "../src/lib/usage";
import { FakeCliproxyClient, FakeSnapshotBucket, FakeUsageRepository, createEmptyExportPayload, createExportPayload } from "./fixtures";

describe("maybeRestoreUsage", () => {
  it("restores from the cumulative backup when current usage is empty and cooldown passed", async () => {
    const emptyPayload = createEmptyExportPayload();
    const backupPayload = createExportPayload();
    const client = new FakeCliproxyClient(emptyPayload);
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();
    const key = buildCumulativeBackupKey("default");

    await repo.setState({
      instanceId: "default",
      lastBackupAt: "2026-04-25T07:00:00Z",
      lastBackupHash: "abc",
      lastRestoreAt: "2026-04-25T06:00:00Z",
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
    await bucket.put(key, JSON.stringify(backupPayload));

    const result = await maybeRestoreUsage({
      now: "2026-04-25T07:40:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result.status).toBe("restored");
    expect(client.importCalls).toHaveLength(1);
    expect(repo.state?.backupR2Key).toBe(key);
  });

  it("does not restore while still in the cooldown window", async () => {
    const emptyPayload = createEmptyExportPayload();
    const client = new FakeCliproxyClient(emptyPayload);
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();

    await repo.setState({
      instanceId: "default",
      lastBackupAt: "2026-04-25T07:00:00Z",
      lastBackupHash: "abc",
      lastRestoreAt: "2026-04-25T07:20:00Z",
      lastRestoreSnapshotId: "snap-1",
      lastSeenEmptyAt: null,
      lastError: null,
      backupR2Key: buildCumulativeBackupKey("default"),
      lastNonEmptyBackupAt: "2026-04-25T07:00:00Z",
      backupTotalRequests: 2,
      backupTotalTokens: 42,
      backupItemCount: 2,
      updatedAt: "2026-04-25T07:20:00Z"
    });

    const result = await maybeRestoreUsage({
      now: "2026-04-25T07:40:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result.status).toBe("cooldown");
    expect(client.importCalls).toHaveLength(0);
  });

  it("bootstraps the cumulative backup from the latest non-empty legacy snapshot", async () => {
    const emptyPayload = createEmptyExportPayload();
    const backupPayload = createExportPayload();
    const client = new FakeCliproxyClient(emptyPayload);
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();

    await repo.setState({
      instanceId: "default",
      lastBackupAt: "2026-04-25T07:00:00Z",
      lastBackupHash: "abc",
      lastRestoreAt: "2026-04-25T06:00:00Z",
      lastRestoreSnapshotId: null,
      lastSeenEmptyAt: null,
      lastError: null,
      backupR2Key: null,
      lastNonEmptyBackupAt: null,
      backupTotalRequests: null,
      backupTotalTokens: null,
      backupItemCount: null,
      updatedAt: "2026-04-25T07:00:00Z"
    });
    await repo.insertSnapshot({
      id: "snap-1",
      instanceId: "default",
      snapshotTime: "2026-04-25T07:00:00Z",
      r2Key: "snapshots/default/2026/04/25/snap-1.json",
      contentHash: "abc",
      itemCount: 2,
      totalCost: 0,
      totalTokens: 42,
      totalRequests: 2,
      failedRequests: 0,
      sourceStatus: "success",
      createdAt: "2026-04-25T07:00:00Z"
    });
    await bucket.put("snapshots/default/2026/04/25/snap-1.json", JSON.stringify(backupPayload));

    const result = await maybeRestoreUsage({
      now: "2026-04-25T07:40:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result.status).toBe("restored");
    expect(bucket.objects.get(buildCumulativeBackupKey("default"))).toBe(stableStringify(backupPayload));
    expect(repo.state?.backupR2Key).toBe(buildCumulativeBackupKey("default"));
  });
});
