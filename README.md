# cliproxyapi-usage

Cloudflare Worker for persisting `cliproxyapi` usage exports into R2, tracking state in D1, and automatically restoring usage after `cliproxyapi` restarts.

## What It Does

- Runs a cron job every 5 minutes.
- Pulls `GET /v0/management/usage/export` from `cliproxyapi`.
- Deduplicates snapshots by SHA-256 hash.
- Stores raw export JSON in R2.
- Stores snapshot metadata, sync runs, and restore state in D1.
- Detects empty usage and restores from the latest snapshot with `POST /v0/management/usage/import`.
- Exposes a small admin API and a basic status page with manual backup/restore actions.

## Runtime Configuration

### Required bindings

- `DB`: D1 database
- `SNAPSHOTS`: R2 bucket

### Required runtime secrets

- `CLIPROXY_BASE_URL`
- `CLIPROXY_MANAGEMENT_KEY`
- `ADMIN_TOKEN`

### Optional runtime vars

- `INSTANCE_ID` default: `default`
- `AUTO_RESTORE_ENABLED` default: `true`
- `RESTORE_COOLDOWN_MINUTES` default: `30`

## Resource Setup

Install dependencies:

```bash
npm install
```

Create the D1 database:

```bash
npx wrangler d1 create cliproxyapi-usage
```

Copy the returned `database_id` into `wrangler.jsonc`.

Create the R2 bucket:

```bash
npx wrangler r2 bucket create cliproxyapi-usage-snapshots
```

If you use a different bucket name, update `wrangler.jsonc`.

Apply migrations:

```bash
npm run migrate:local
npm run migrate:remote
```

Set secrets:

```bash
npx wrangler secret put CLIPROXY_BASE_URL
npx wrangler secret put CLIPROXY_MANAGEMENT_KEY
npx wrangler secret put ADMIN_TOKEN
```

Run locally:

```bash
npm run dev
```

Open `/` with either:

- `Authorization: Bearer <ADMIN_TOKEN>` header
- `/?token=<ADMIN_TOKEN>` query string

## Cloudflare Git Auto Deploy

This repository is prepared for **Cloudflare Workers Builds**, not GitHub Actions.

Cloudflare official references:

- Workers Builds overview: https://developers.cloudflare.com/workers/ci-cd/builds/
- Build settings and commands: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- Git integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/

### Important requirement

The Worker name in the Cloudflare dashboard must match `wrangler.jsonc`:

```json
"name": "cliproxyapi-usage"
```

If the names do not match, Cloudflare Builds will fail during deploy.

### Recommended Cloudflare Dashboard settings

In **Workers & Pages -> your Worker -> Settings -> Builds**:

- Git provider: GitHub
- Repository: this repository
- Production branch: `main`
- Non-production branch builds: disabled
- Root directory: leave empty unless this project later moves into a monorepo
- Build command:

```bash
npm ci && npm run verify
```

- Deploy command:

```bash
npm run deploy:ci
```

### What those scripts do

Build phase:

```bash
npm run verify
```

This runs:

```bash
npm test
npm run check
```

Deploy phase:

```bash
npm run deploy:ci
```

This runs:

```bash
npm run migrate:remote
wrangler deploy
```

That means every production deploy:

1. Runs tests
2. Runs TypeScript type checking
3. Applies D1 migrations to the remote database
4. Deploys the Worker

If tests, typecheck, or migrations fail, deployment stops before publish.

### Runtime variables and secrets in Cloudflare

Configure these in **Settings -> Variables & Secrets**, not in Build variables:

- `CLIPROXY_BASE_URL`
- `CLIPROXY_MANAGEMENT_KEY`
- `ADMIN_TOKEN`
- `INSTANCE_ID`
- `AUTO_RESTORE_ENABLED`
- `RESTORE_COOLDOWN_MINUTES`

Build variables are only for the build step. This Worker needs the values at runtime.

### First production deploy checklist

Before connecting Git auto deploy, make sure:

- D1 database exists and `database_id` in `wrangler.jsonc` is the real production ID
- R2 bucket exists and `bucket_name` in `wrangler.jsonc` is correct
- Worker runtime secrets are set in Cloudflare
- Worker name in dashboard matches `cliproxyapi-usage`
- `main` branch contains the final production config

## Local Verification

```bash
npm run verify
npm run deploy:dry-run
```
