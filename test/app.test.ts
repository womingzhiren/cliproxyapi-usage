import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { HttpCliproxyClient } from "../src/lib/cliproxy-client";
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

  it("uses the global fetch with the correct this binding", async () => {
    const originalFetch = globalThis.fetch;
    const payload = { version: 1, exported_at: "2026-04-25T07:00:00Z", usage: { total_requests: 0, success_count: 0, failure_count: 0, total_tokens: 0, requests_by_day: {}, requests_by_hour: {}, tokens_by_day: {}, tokens_by_hour: {}, apis: {} } };

    globalThis.fetch = (function (this: typeof globalThis, _input: RequestInfo | URL, _init?: RequestInit) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: {
            "content-type": "application/json"
          }
        })
      );
    }) as typeof fetch;

    try {
      const client = new HttpCliproxyClient("https://cliproxy.example", "secret");
      await expect(client.exportUsage()).resolves.toMatchObject(payload);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
