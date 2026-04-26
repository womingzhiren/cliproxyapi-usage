import { describe, expect, it } from "vitest";

import { runAutomaticSync } from "../src/lib/auto-sync-service";
import {
  FakeCliproxyClient,
  FakeSnapshotBucket,
  FakeUsageRepository,
  createEmptyExportPayload,
  createExportPayload
} from "./fixtures";

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

    const result = await runAutomaticSync({
      now: "2026-04-25T07:40:00Z",
      instanceId: "default",
      cooldownMinutes: 30,
      autoRestoreEnabled: true,
      client,
      bucket,
      repo
    });

    expect(result.restoreResult.status).toBe("not-empty");
    expect(result.backupResult?.status).toBe("stored");
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
});
