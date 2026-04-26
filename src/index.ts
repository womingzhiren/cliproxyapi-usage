import { createApp } from "./app";
import { HttpCliproxyClient } from "./lib/cliproxy-client";
import { runAutomaticSync } from "./lib/auto-sync-service";
import { D1UsageRepository } from "./lib/d1-repository";
import { maybeRestoreUsage } from "./lib/restore-service";
import { backupUsage } from "./lib/snapshot-service";
import type { InstanceRecord } from "./types";

export interface Env {
  DB: D1Database;
  SNAPSHOTS: R2Bucket;
  CLIPROXY_BASE_URL: string;
  CLIPROXY_MANAGEMENT_KEY: string;
  ADMIN_TOKEN: string;
  INSTANCE_ID?: string;
  AUTO_RESTORE_ENABLED?: string;
  RESTORE_COOLDOWN_MINUTES?: string;
}

class R2SnapshotBucketAdapter {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, value: string): Promise<void> {
    await this.bucket.put(key, value, {
      httpMetadata: {
        contentType: "application/json"
      }
    });
  }

  async get(key: string): Promise<string | null> {
    const object = await this.bucket.get(key);
    return object ? object.text() : null;
  }
}

function buildInstance(env: Env, now: string): InstanceRecord {
  return {
    id: env.INSTANCE_ID ?? "default",
    name: env.INSTANCE_ID ?? "default",
    baseUrl: env.CLIPROXY_BASE_URL,
    enabled: true,
    autoRestoreEnabled: readBoolean(env.AUTO_RESTORE_ENABLED, true),
    createdAt: now,
    updatedAt: now
  };
}

function createDependencies(env: Env, now = new Date().toISOString()) {
  const instance = buildInstance(env, now);
  const repo = new D1UsageRepository({
    db: env.DB,
    instance
  });
  const client = new HttpCliproxyClient(env.CLIPROXY_BASE_URL, env.CLIPROXY_MANAGEMENT_KEY);
  const bucket = new R2SnapshotBucketAdapter(env.SNAPSHOTS);
  const autoRestoreEnabled = readBoolean(env.AUTO_RESTORE_ENABLED, true);
  const cooldownMinutes = Number(env.RESTORE_COOLDOWN_MINUTES ?? "30");

  return {
    instance,
    repo,
    client,
    bucket,
    autoRestoreEnabled,
    cooldownMinutes
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const deps = createDependencies(env);
    const app = createApp({
      adminToken: env.ADMIN_TOKEN,
      instanceId: deps.instance.id,
      latestSummary: null,
      repo: deps.repo,
      services: {
        triggerBackup: () =>
          backupUsage({
            now: new Date().toISOString(),
            instanceId: deps.instance.id,
            client: deps.client,
            bucket: deps.bucket,
            repo: deps.repo,
            runType: "manual_backup"
          }),
        triggerRestore: () =>
          maybeRestoreUsage({
            now: new Date().toISOString(),
            instanceId: deps.instance.id,
            cooldownMinutes: deps.cooldownMinutes,
            autoRestoreEnabled: deps.autoRestoreEnabled,
            client: deps.client,
            bucket: deps.bucket,
            repo: deps.repo,
            runType: "manual_restore"
          })
      }
    });

    return app.fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const deps = createDependencies(env);
    await runAutomaticSync({
      now: new Date().toISOString(),
      instanceId: deps.instance.id,
      cooldownMinutes: deps.cooldownMinutes,
      autoRestoreEnabled: deps.autoRestoreEnabled,
      client: deps.client,
      bucket: deps.bucket,
      repo: deps.repo
    });
  }
};

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }
  return value === "true";
}
