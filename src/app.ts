import type { UsageRepository } from "./lib/contracts";
import type { StatusPayload, SyncRunRecord, UsageSummary } from "./types";

interface AppDependencies {
  adminToken: string;
  instanceId: string;
  latestSummary: UsageSummary | null;
  repo: UsageRepository;
  services: {
    triggerBackup(): Promise<unknown>;
    triggerRestore(): Promise<unknown>;
  };
}

export function createApp(deps: AppDependencies) {
  return {
    fetch(request: Request) {
      return handleRequest(request, deps);
    }
  };
}

async function handleRequest(request: Request, deps: AppDependencies): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    if (!isAuthorized(request, deps.adminToken) && url.searchParams.get("token") !== deps.adminToken) {
      return new Response("Unauthorized", { status: 401 });
    }
    const status = await deps.repo.getStatus(deps.latestSummary);
    return new Response(renderStatusPage(status, deps.adminToken), {
      headers: {
        "content-type": "text/html; charset=utf-8"
      }
    });
  }

  if (!url.pathname.startsWith("/api/admin/")) {
    return json({ error: "Not Found" }, 404);
  }

  if (!isAuthorized(request, deps.adminToken)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/api/admin/status") {
    return json(await deps.repo.getStatus(deps.latestSummary));
  }
  if (request.method === "GET" && url.pathname === "/api/admin/snapshots") {
    return json(await deps.repo.listSnapshots(20));
  }
  if (request.method === "POST" && url.pathname === "/api/admin/backup") {
    return json(await deps.services.triggerBackup());
  }
  if (request.method === "POST" && url.pathname === "/api/admin/restore") {
    return json(await deps.services.triggerRestore());
  }

  return json({ error: "Not Found" }, 404);
}

function isAuthorized(request: Request, adminToken: string): boolean {
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${adminToken}`;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function renderStatusPage(status: StatusPayload, adminToken: string): string {
  const latestAutomaticRestore = findLatestRun(status.recentRuns, "restore");
  const latestAutomaticBackup = findLatestRun(status.recentRuns, "backup");
  const snapshotRows = status.snapshots
    .map(
      (snapshot) =>
        `<tr><td>${escapeHtml(snapshot.snapshotTime)}</td><td>${snapshot.totalRequests}</td><td>${snapshot.totalTokens}</td><td>${escapeHtml(snapshot.r2Key)}</td></tr>`
    )
    .join("");
  const recentRunRows = status.recentRuns
    .map(
      (run) =>
        `<tr><td>${escapeHtml(run.finishedAt)}</td><td>${escapeHtml(run.runType)}</td><td>${escapeHtml(run.status)}</td><td>${escapeHtml(run.message)}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cliproxy Usage</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
      main { max-width: 960px; margin: 0 auto; padding: 32px 20px 48px; }
      .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
      .card { background: #111827; border: 1px solid #334155; border-radius: 16px; padding: 16px; }
      .card strong { display: block; margin-bottom: 8px; }
      .card .muted { margin-top: 8px; }
      button { background: #38bdf8; color: #082f49; border: 0; border-radius: 999px; padding: 10px 16px; font-weight: 700; cursor: pointer; margin-right: 12px; }
      h2 { margin: 32px 0 12px; font-size: 1.1rem; }
      table { width: 100%; border-collapse: collapse; background: #111827; border-radius: 16px; overflow: hidden; }
      th, td { text-align: left; padding: 12px; border-bottom: 1px solid #1e293b; }
      .muted { color: #94a3b8; }
    </style>
  </head>
  <body>
    <main>
      <h1>Cliproxyapi Usage Persistence</h1>
      <p class="muted">Instance: ${escapeHtml(status.instance.id)}</p>
      <div class="cards">
        <section class="card"><strong>Last backup</strong><div>${escapeHtml(status.state?.lastBackupAt ?? "never")}</div></section>
        <section class="card"><strong>Last restore</strong><div>${escapeHtml(status.state?.lastRestoreAt ?? "never")}</div></section>
        <section class="card"><strong>Last error</strong><div>${escapeHtml(status.state?.lastError ?? "none")}</div></section>
        ${renderRunSummary("Last automatic restore", latestAutomaticRestore)}
        ${renderRunSummary("Last automatic backup", latestAutomaticBackup)}
      </div>
      <div style="margin-bottom: 24px;">
        <button onclick="trigger('/api/admin/backup')">Manual backup</button>
        <button onclick="trigger('/api/admin/restore')">Manual restore</button>
      </div>
      <h2>Recent runs</h2>
      <table>
        <thead>
          <tr><th>Finished at</th><th>Run type</th><th>Status</th><th>Message</th></tr>
        </thead>
        <tbody>${recentRunRows || '<tr><td colspan="4" class="muted">No runs yet</td></tr>'}</tbody>
      </table>
      <h2>Snapshots</h2>
      <table>
        <thead>
          <tr><th>Snapshot time</th><th>Requests</th><th>Tokens</th><th>R2 key</th></tr>
        </thead>
        <tbody>${snapshotRows || '<tr><td colspan="4" class="muted">No snapshots yet</td></tr>'}</tbody>
      </table>
    </main>
    <script>
      async function trigger(path) {
        const response = await fetch(path, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + ${JSON.stringify(adminToken)} }
        });
        const body = await response.text();
        alert(body);
        location.reload();
      }
    </script>
  </body>
</html>`;
}

function findLatestRun(
  runs: SyncRunRecord[],
  runType: SyncRunRecord["runType"]
): SyncRunRecord | null {
  return runs.find((run) => run.runType === runType) ?? null;
}

function renderRunSummary(title: string, run: SyncRunRecord | null): string {
  if (!run) {
    return `<section class="card"><strong>${escapeHtml(title)}</strong><div>never</div><div class="muted">No automatic run recorded yet</div></section>`;
  }

  return `<section class="card"><strong>${escapeHtml(title)}</strong><div>${escapeHtml(run.status)} at ${escapeHtml(run.finishedAt)}</div><div class="muted">${escapeHtml(run.message)}</div></section>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
