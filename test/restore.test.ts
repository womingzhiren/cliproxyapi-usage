import { describe, expect, it } from "vitest";

import { maybeRestoreUsage } from "../src/lib/restore-service";
import { FakeCliproxyClient, FakeSnapshotBucket, FakeUsageRepository, createExportPayload } from "./fixtures";

describe("maybeRestoreUsage", () => {
  it("restores the latest snapshot when current usage is empty and cooldown passed", async () => {
    const emptyPayload = createExportPayload({
      usage: {
        ...createExportPayload().usage,
        total_requests: 0,
        total_tokens: 0,
        success_count: 0,
        apis: {}
      }
    });
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
      updatedAt: "2026-04-25T07:00:00Z"
    });
    await repo.insertSnapshot({
      id: "snap-1",
      instanceId: "default",
      snapshotTime: "2026-04-25T07:00:00Z",
      r2Key: "snapshots/default/2026/04/25/2026-04-25T07-00-00Z-abc.json",
      contentHash: "abc",
      itemCount: 2,
      totalCost: 0,
      totalTokens: 42,
      totalRequests: 2,
      failedRequests: 0,
      sourceStatus: "success",
      createdAt: "2026-04-25T07:00:00Z"
    });
    await bucket.put("snapshots/default/2026/04/25/2026-04-25T07-00-00Z-abc.json", JSON.stringify(backupPayload));

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
    expect(repo.state?.lastRestoreSnapshotId).toBe("snap-1");
  });

  it("does not restore while still in the cooldown window", async () => {
    const emptyPayload = createExportPayload({
      usage: {
        ...createExportPayload().usage,
        total_requests: 0,
        total_tokens: 0,
        success_count: 0,
        apis: {}
      }
    });
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
});
