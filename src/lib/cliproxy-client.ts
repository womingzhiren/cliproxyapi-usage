import type { CliproxyClient } from "./contracts";
import type { CliproxyExportPayload, CliproxyImportResult } from "../types";

export class HttpCliproxyClient implements CliproxyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly managementKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async exportUsage(): Promise<CliproxyExportPayload> {
    return this.request<CliproxyExportPayload>("/v0/management/usage/export", {
      method: "GET"
    });
  }

  async importUsage(payload: CliproxyExportPayload): Promise<CliproxyImportResult> {
    return this.request<CliproxyImportResult>("/v0/management/usage/import", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.managementKey}`,
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      throw new Error(`cliproxyapi management request failed: ${response.status}`);
    }

    return (await response.json()) as T;
  }
}
