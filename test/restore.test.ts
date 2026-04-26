import { describe, expect, it } from "vitest";

import { maybeRestoreUsage } from "../src/lib/restore-service";
import {
  buildCumulativeBackupKey,
  flattenUsageDetails,
  rebuildUsageExport,
  stableStringify
} from "../src/lib/usage";
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

  it("restores only missing history when current usage is non-empty but behind the cumulative backup", async () => {
    const backupPayload = createExportPayload();
    const currentPayload = rebuildUsageExport(
      flattenUsageDetails(backupPayload).slice(1),
      "2026-04-25T07:20:00Z",
      backupPayload.version
    );
    const client = new FakeCliproxyClient(currentPayload);
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();
    const key = buildCumulativeBackupKey("default");

    await repo.setState({
      instanceId: "default",
      lastBackupAt: "2026-04-25T07:00:00Z",
      lastBackupHash: "abc",
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
    await bucket.put(key, JSON.stringify(backupPayload));

    const result = await maybeRestoreUsage({
      now: "2026-04-25T07:25:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result).toMatchObject({
      status: "restored",
      restoreMode: "missing-history"
    });
    expect(client.importCalls).toHaveLength(1);
    expect(client.importCalls[0]?.usage.total_requests).toBe(1);
    expect(client.importCalls[0]?.usage.total_tokens).toBe(21);
    expect(client.importCalls[0]?.usage.apis["POST /v1/chat/completions"]?.models["gpt-4.1-mini"]?.details).toHaveLength(1);
    expect(repo.syncRuns.at(-1)?.message).toContain("missing history");
  });

  it("does not restore non-empty usage when it is not behind the cumulative backup", async () => {
    const currentPayload = createExportPayload();
    const client = new FakeCliproxyClient(currentPayload);
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
    await bucket.put(key, JSON.stringify(currentPayload));

    const result = await maybeRestoreUsage({
      now: "2026-04-25T07:40:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result).toMatchObject({
      status: "not-behind"
    });
    expect(client.importCalls).toHaveLength(0);
    expect(repo.syncRuns.at(-1)?.message).toContain("not behind");
  });

  it("restores missing history even when current summary matches the cumulative backup", async () => {
    const backupPayload = createExportPayload();
    const backupEntries = flattenUsageDetails(backupPayload);
    const currentPayload = rebuildUsageExport(
      [
        backupEntries[0],
        {
          ...backupEntries[1],
          detail: {
            ...backupEntries[1].detail,
            timestamp: "2026-04-25T07:01:00Z",
            auth_index: "def"
          }
        }
      ],
      "2026-04-25T07:20:00Z",
      backupPayload.version
    );
    const client = new FakeCliproxyClient(currentPayload);
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

    expect(result).toMatchObject({
      status: "restored",
      restoreMode: "missing-history"
    });
    expect(client.importCalls).toHaveLength(1);
    expect(client.importCalls[0]?.usage.total_requests).toBe(1);
    expect(client.importCalls[0]?.usage.total_tokens).toBe(21);
  });
});
