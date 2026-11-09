---
name: deploy-dokploy
description:
  End-to-end workflow for the Eduqat OpenInspect production stack on Hetzner/Dokploy — develop,
  deploy (CI or manual), verify, roll back, and troubleshoot. Use when the user wants to ship a
  change to production, check deployment status, debug a production issue, or manage sign-in
  admission. Covers the full path from local development through this stack's known incidents
  (sign-in admission, sandbox secrets, build context).
user-invocable: true
allowed-tools:
  Bash, Read, Write, Edit, Glob, Grep, Agent, WebFetch, AskUserQuestion, TaskCreate, TaskUpdate,
  TaskList
---

# OpenInspect Production on Dokploy — End-to-End Workflow

## Stack facts (memorize before acting)

- **Source of truth**: fork `maubelajarapa/background-agents`, branch **`dokploy`** (local repo at
  `~/project/maubel/research/eduqat-openinspect`). All production changes go through this branch.
- **Stack**: Dokploy compose `openinspect` (id `sc9DqonmrpKLmG9hJlOjg`) on Hetzner `5.9.108.170`,
  Dokploy at `https://dokploy.reduqate.com` (API key: ask user or check session history — never
  commit it).
  - `app` = control plane → https://openinspect-cp.eduqat.com (health: `/healthz`)
  - `web` = Next.js standalone → https://openinspect.eduqat.com (WS URL baked at build time)
  - `object-store` + `litestream` (continuous `global.db` replication to the `backups` bucket)
- **Modal data plane**: workspace `agung-widhiatmojo`, env `main`. NOT deployed by CI — always
  manual (see below).
- **Sign-in admission**: locked down — `ALLOWED_GITHUB_ORGS=maubelajarapa`, no
  `UNSAFE_ALLOW_ALL_USERS`. Only org members can sign in.
- Container name prefix `compose-index-multi-byte-pixel-8woqyg-*`; SSH is `root@5.9.108.170`
  (password: `jq -r '.hetzner' ~/project/maubel/ssh/pass.json` + sshpass).

## 1. Develop

1. Work on the `dokploy` branch (or branch off it, then merge/fast-push to `dokploy`).
2. Conventional commits, subject < 72 chars.
3. Run checks before pushing if touching code:
   ```bash
   npm run build -w @open-inspect/shared   # always first
   npm run typecheck
   npm test -w @open-inspect/control-plane # and the package you touched
   ```
4. If you add a new file/directory that the Docker images need: the root `.dockerignore` is a
   whitelist (`*` then `!path/` includes) **and** `packages/web/Dockerfile` needs a matching COPY
   line. Missing either → docker build fails on the server (check CI/deploy logs).

## 2. Deploy

### Automatic (default)

Push to `dokploy`. `.github/workflows/deploy-dokploy.yml` triggers when these paths change:
`packages/control-plane/**`, `packages/shared/**`, `packages/web/**`, `terraform/d1/migrations/**`,
`docker-compose.dokploy.yml`, `.dockerignore`, the workflow itself. Other paths (docs, modal-infra,
terraform) do NOT auto-deploy — use manual.

The workflow: calls Dokploy `compose.deploy` → polls `compose.one` until `composeStatus` goes
`running` then `done` → smoke-checks both public URLs. Concurrency group `dokploy-production` queues
runs; never two deploys at once.

Watch it:

```bash
gh run list -R maubelajarapa/background-agents --branch dokploy --limit 3
gh run watch -R maubelajarapa/background-agents
```

### Manual

- GitHub Actions → "Deploy to Dokploy" → Run workflow (`workflow_dispatch`), or
  `gh workflow run deploy-dokploy.yml -R maubelajarapa/background-agents --ref dokploy`
- Or direct API (what CI does):
  ```bash
  curl -sf -X POST "https://dokploy.reduqate.com/api/compose.deploy" \
    -H "x-api-key: $DOKPLOY_API_KEY" -H "Content-Type: application/json" \
    -d '{"composeId":"sc9DqonmrpKLmG9hJlOjg"}'
  ```
- Env var changes: Dokploy UI (compose → Environment) or `compose.update` API. `compose.create` only
  accepts name+environmentId; everything else goes through `compose.update`.

### Modal (always manual)

```bash
cd packages/modal-infra
uv run python deploy.py --build-sandbox-image && uv run modal deploy deploy.py
```

Force image rebuild by bumping `CACHE_BUSTER` in `src/images/base.py`.

## 3. Verify

1. CI green (both "Wait for deployment" and "Smoke check" steps).
2. `curl https://openinspect-cp.eduqat.com/healthz` → 200.
3. Server-side logs if diagnosing:
   ```bash
   sshpass -p "$(jq -r '.hetzner' ~/project/maubel/ssh/pass.json)" \
     ssh -o StrictHostKeyChecking=no root@5.9.108.170 \
     "docker logs --tail 100 compose-index-multi-byte-pixel-8woqyg-app-1"
   ```
   Dokploy deploy logs: `/etc/dokploy/logs/compose-index-multi-byte-pixel-8woqyg/` on the server.
4. Behavior changes: user signs in and exercises the feature (admission, sessions, secrets UI).

## 4. Roll back

```bash
git revert <bad-commit> && git push origin dokploy
```

CI redeploys the previous code. Expect ~10–30s control-plane downtime per deploy (single replica).
Database migrations are self-healing (run at boot; litestream replica restores an empty volume), so
no manual migration steps either direction.

## 5. Troubleshooting playbook (incidents already hit — check these first)

### Sign-in returns HTTP 500 at `/api/auth/callback/github`

The admission policy (`packages/control-plane/src/auth/user/admission-policy.ts`) throws two
distinct errors — identify which from `docker logs` on the app container:

- **`AdmissionDeniedError`** ("User is not admitted"): the user is genuinely not a member of
  `maubelajarapa`. Working as intended.
- **`AdmissionUnavailableError`** ("could not be evaluated"): the org membership API call failed.
  Log line `[admission] org membership check failed: ...` shows status/body.
  - **403 "Resource not accessible by integration"** (hit 2026-11-09): the GitHub App has the
    Members permission at the _app_ level, but the org **installation** never accepted the new
    permission. Verify with a JWT probe: `GET /orgs/maubelajarapa/installation` — if `permissions`
    lacks `"members":"read"`, the org owner must open
    https://github.com/organizations/maubelajarapa/settings/apps/eduqat-openinspect-local and accept
    the pending "Members: Read-only" permission (or remove + reinstall the app). Note: revoking the
    _user_ authorization does NOT refresh installation permissions — that trap cost an hour.
  - Fallback if org API can't be used: switch to `ALLOWED_USERS=<github-logins>` (bypasses the
    org-membership API entirely).

### "Model not found" in a session

The sandbox environment is **baked at spawn**. Model keys added to global secrets after a sandbox
started need a NEW session. Never debug catalog/versions before checking this.

### Control-plane `.env` parse error after adding GITHUB_APP_PRIVATE_KEY

Dokploy decodes quoted `\n` when writing `.env`. Store the key **unquoted with literal `\n`**
characters; the control plane strips them at read time.

### Docker build fails on server: "COPY <path>: not found" or TS "Cannot find module"

Root `.dockerignore` whitelist or web Dockerfile COPY lines missing for the new path (see §1.4).

### CI "Wait for deployment" exits early / passes before deploy finished

`composeStatus` "done" lingers from the _previous_ deploy. The workflow waits to observe "running"
first — don't "simplify" it back to a single poll loop.

### Both domains serve the wrong app / 404 after deploy

Usually transient Traefik routing during container recreate; re-check after 30s before
investigating.

### Removing a user account (offboarding)

No UI — direct SQL on the server, deleting the user's rows across all tables in `/data/global.db`
via `docker exec ... node -e "const {DatabaseSync}=require('node:sqlite');..."`. Check
`user_identities`, `user_role_assignments`, `users`, `global_secrets`.

## 6. Known users / access

- `agung widhiatmojo` (login `agungwa`) — Owner on local + production (prod user id
  `a482593ed557fe13907396b6b6faa27d`)
- Team: Daniel Liejardi, Lafif Astahdziq, Husein Arbi; `forrest-umkmall` is a known external
  collaborator (do not offboard without asking)
- GitHub App `eduqat-openinspect-local` (App ID 5552233), callbacks localhost:3000 and
  openinspect.eduqat.com, installed on the `maubelajarapa` org

When in doubt about prod state, read the auto-memory file `project_production_deployment.md` first —
it stays current.
