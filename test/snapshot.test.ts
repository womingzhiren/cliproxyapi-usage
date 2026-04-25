import { describe, expect, it } from "vitest";

import { backupUsage } from "../src/lib/snapshot-service";
import { sha256Hex } from "../src/lib/usage";
import { createExportPayload, FakeCliproxyClient, FakeSnapshotBucket, FakeUsageRepository } from "./fixtures";

describe("backupUsage", () => {
  it("stores a new snapshot when the export payload changed", async () => {
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

    expect(result.status).toBe("stored");
    expect(repo.snapshots).toHaveLength(1);
    expect(bucket.objects.size).toBe(1);
    expect(repo.state?.lastBackupHash).toBe(await sha256Hex(payload));
    expect(repo.syncRuns.at(-1)?.status).toBe("success");
  });

  it("does not store a duplicate snapshot when the hash did not change", async () => {
    const payload = createExportPayload();
    const client = new FakeCliproxyClient(payload);
    const bucket = new FakeSnapshotBucket();
    const repo = new FakeUsageRepository();
    const hash = await sha256Hex(payload);

    await repo.setState({
      instanceId: "default",
      lastBackupAt: "2026-04-25T07:00:00Z",
      lastBackupHash: hash,
      lastRestoreAt: null,
      lastRestoreSnapshotId: null,
      lastSeenEmptyAt: null,
      lastError: null,
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
    expect(bucket.objects.size).toBe(0);
    expect(repo.syncRuns.at(-1)?.message).toContain("unchanged");
  });
});
