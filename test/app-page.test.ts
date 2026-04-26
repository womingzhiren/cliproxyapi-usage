import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { FakeUsageRepository } from "./fixtures";

describe("status page", () => {
  it("renders recent runs and automatic run summaries", async () => {
    const repo = new FakeUsageRepository();
    repo.state = {
      instanceId: "default",
      lastBackupAt: "2026-04-25T07:10:00Z",
      lastBackupHash: "abc",
      lastRestoreAt: "2026-04-25T07:05:00Z",
      lastRestoreSnapshotId: null,
      lastSeenEmptyAt: "2026-04-25T07:05:00Z",
      lastError: null,
      backupR2Key: "backups/default/usage-cumulative.json",
      lastNonEmptyBackupAt: "2026-04-25T07:10:00Z",
      backupTotalRequests: 2,
      backupTotalTokens: 42,
      backupItemCount: 2,
      updatedAt: "2026-04-25T07:10:00Z"
    };
    repo.syncRuns = [
      {
        id: "run-1",
        instanceId: "default",
        runType: "restore",
        status: "skipped",
        message: "usage not empty",
        snapshotId: null,
        startedAt: "2026-04-25T07:00:00Z",
        finishedAt: "2026-04-25T07:00:05Z"
      },
      {
        id: "run-2",
        instanceId: "default",
        runType: "backup",
        status: "success",
        message: "stored cumulative usage backup",
        snapshotId: null,
        startedAt: "2026-04-25T07:00:05Z",
        finishedAt: "2026-04-25T07:00:10Z"
      },
      {
        id: "run-3",
        instanceId: "default",
        runType: "manual_restore",
        status: "success",
        message: "restored 2 requests from cumulative backup",
        snapshotId: null,
        startedAt: "2026-04-25T06:00:00Z",
        finishedAt: "2026-04-25T06:00:05Z"
      }
    ];

    const app = createApp({
      adminToken: "secret",
      instanceId: "default",
      latestSummary: null,
      repo,
      services: {
        triggerBackup: async () => ({ status: "stored" as const }),
        triggerRestore: async () => ({ status: "restored" as const })
      }
    });

    const response = await app.fetch(new Request("https://example.com/?token=secret"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Last automatic restore");
    expect(html).toContain("Last automatic backup");
    expect(html).toContain("Recent runs");
    expect(html).toContain("usage not empty");
    expect(html).toContain("stored cumulative usage backup");
    expect(html).toContain("manual_restore");
  });
});
