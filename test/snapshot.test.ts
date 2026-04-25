import { describe, expect, it } from "vitest";

import { backupUsage } from "../src/lib/snapshot-service";
import { buildCumulativeBackupKey, mergeUsageExports, sha256Hex, stableStringify } from "../src/lib/usage";
import { createEmptyExportPayload, createExportPayload, FakeCliproxyClient, FakeSnapshotBucket, FakeUsageRepository } from "./fixtures";

describe("backupUsage", () => {
  it("stores a cumulative backup when the export payload is non-empty", async () => {
    const payload = createExportPayload();
    const client = new FakeCliproxyClient(payload);
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();

    const result = await backupUsage({
      now: "2026-04-25T07:05:00Z",
      instanceId: "default",
      client,
      bucket,
      repo
    });
    const stored = bucket.objects.get(buildCumulativeBackupKey("default"));

    expect(result.status).toBe("stored");
    expect(repo.snapshots).toHaveLength(1);
    expect(bucket.objects.size).toBe(1);
    expect(repo.state?.lastBackupHash).toBe(await sha256Hex(JSON.parse(stored!)));
    expect(repo.state?.backupR2Key).toBe(buildCumulativeBackupKey("default"));
    expect(result.summary).toMatchObject({
      totalRequests: 2,
      totalTokens: 42,
      failedRequests: 0,
      isEmpty: false
    });
    expect(JSON.parse(stored!)).toMatchObject(mergeUsageExports(null, payload));
    expect(repo.syncRuns.at(-1)?.status).toBe("success");
  });

  it("does not store a duplicate snapshot when the hash did not change", async () => {
    const payload = createExportPayload();
    const client = new FakeCliproxyClient(payload);
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();
    const key = buildCumulativeBackupKey("default");
    const merged = mergeUsageExports(null, payload);
    const hash = await sha256Hex(merged);

    await bucket.put(key, stableStringify(merged));
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

    const result = await backupUsage({
      now: "2026-04-25T07:05:00Z",
      instanceId: "default",
      client,
      bucket,
      repo
    });

    expect(result.status).toBe("unchanged");
    expect(repo.snapshots).toHaveLength(0);
    expect(bucket.objects.size).toBe(1);
    expect(repo.syncRuns.at(-1)?.message).toContain("unchanged");
  });

  it("does not overwrite the cumulative backup when export is empty", async () => {
    const previousPayload = createExportPayload();
    const client = new FakeCliproxyClient(createEmptyExportPayload());
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();
    const key = buildCumulativeBackupKey("default");

    await bucket.put(key, JSON.stringify(previousPayload));
    await repo.setState({
      instanceId: "default",
      lastBackupAt: "2026-04-25T07:00:00Z",
      lastBackupHash: "abc",
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

    const result = await backupUsage({
      now: "2026-04-25T07:05:00Z",
      instanceId: "default",
      client,
      bucket,
      repo
    });

    expect(result.status).toBe("empty");
    expect(bucket.objects.get(key)).toBe(JSON.stringify(previousPayload));
    expect(repo.snapshots).toHaveLength(0);
    expect(repo.state?.lastNonEmptyBackupAt).toBe("2026-04-25T07:00:00Z");
  });
});
