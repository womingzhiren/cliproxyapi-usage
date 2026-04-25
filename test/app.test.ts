import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { FakeUsageRepository } from "./fixtures";

describe("admin API", () => {
  it("rejects unauthenticated API requests", async () => {
    const app = createApp({
      adminToken: "secret",
      instanceId: "default",
      latestSummary: null,
      repo: new FakeUsageRepository(),
      services: {
        triggerBackup: async () => ({ status: "stored" as const }),
        triggerRestore: async () => ({ status: "restored" as const })
      }
    });

    const response = await app.fetch(new Request("https://example.com/api/admin/status"));

    expect(response.status).toBe(401);
  });

  it("returns status for authenticated requests", async () => {
    const repo = new FakeUsageRepository();
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

    const response = await app.fetch(
      new Request("https://example.com/api/admin/status", {
        headers: {
          authorization: "Bearer secret"
        }
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      instance: {
        id: "default"
      }
    });
  });
});
