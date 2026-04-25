import { describe, expect, it } from "vitest";

import { sha256Hex, stableStringify, summarizeUsageExport } from "../src/lib/usage";
import { createExportPayload } from "./fixtures";

describe("usage helpers", () => {
  it("produces the same stable JSON for objects with different key order", () => {
    const left = stableStringify({ b: 2, a: { d: 4, c: 3 } });
    const right = stableStringify({ a: { c: 3, d: 4 }, b: 2 });

    expect(left).toBe(right);
  });

  it("hashes equal payloads identically", async () => {
    const first = createExportPayload();
    const second = createExportPayload({
      usage: {
        ...createExportPayload().usage,
        requests_by_hour: {
          "07": 2
        }
      }
    });

    await expect(sha256Hex(first)).resolves.toBe(await sha256Hex(second));
  });

  it("summarizes export payload totals", () => {
    const summary = summarizeUsageExport(createExportPayload());

    expect(summary).toEqual({
      itemCount: 2,
      totalCost: 0,
      totalTokens: 42,
      totalRequests: 2,
      failedRequests: 0,
      isEmpty: false
    });
  });
});
