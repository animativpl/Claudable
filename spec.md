# spec.md — Claudable

## 1. What is Claudable

An open-source, self-hosted web app builder: describe an app in natural
language, and Claudable drives Claude Code (via the Claude Agent SDK) to
scaffold and iterate on a real Next.js or Astro project, with an instant live
preview alongside the chat. Single-tenant, no authentication, meant to run on
a developer's own machine or a private network — not exposed to the public
internet (see §7).

**Non-goals:** multi-user/SaaS operation, authentication or access control,
support for AI coding agents other than Claude Code, a desktop application
(Electron support was removed 2026-08-27 — web-only from here on).

## 2. Decisions in force

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Deployment surface | Web-only: `npm run dev` locally, or Docker. No desktop app. | User decision, 2026-08-27 — Electron/electron-builder tooling removed entirely. |
| 2 | AI agent | Claude Code only, via `@anthropic-ai/claude-agent-sdk`. | The project shipped a multi-CLI abstraction (a `cli` parameter threaded through model-selection helpers) that never branched on anything; removed 2026-08-27 once confirmed dead. |
| 3 | Schema migrations | `prisma db push --accept-data-loss`, not `prisma migrate dev`/`deploy`. No `prisma/migrations/` directory is tracked. | The only two places that apply schema changes — `Dockerfile`'s container startup and `scripts/run-web.js`'s dev launcher — both call `db push`. A generated migration was found and deleted 2026-08-27 after review showed it was a baseline `CREATE TABLE` set with no `DROP`s: useless (nothing runs `migrate deploy`) and actively risky (it would error against a database that already has the tables). |
| 4 | `ENCRYPTION_KEY` | Required; `lib/crypto.ts` throws on first `encrypt`/`decrypt` call if unset, rather than falling back to an in-memory random key. Checked lazily (inside `encrypt`/`decrypt`), not at module load, so `docker build` — which has no key available — is unaffected. | The old silent fallback generated a different key on every process start, making every existing encrypted `EnvVar` undecryptable after a restart with no warning. |
| 5 | Secret storage split | `EnvVar.valueEncrypted` is AES-encrypted via `lib/crypto.ts`. `ServiceToken.token` (GitHub PAT) is stored **plain text**, by design — the model's own field comment says so (`prisma/schema.prisma:215`, "plain text - local only"). | Confirmed 2026-08-27: no code path calls `encrypt`/`decrypt` on a `ServiceToken`. Two UI strings that had claimed tokens were encrypted were corrected to say so. |
| 6 | Node version floor | `engines.node: ">=22.12.0"` in `package.json`, kept even though nothing in the current dependency tree requires it (`next` needs `>=20.9.0`, `prisma` `>=18.18`). | It was set for Electron 44's own requirement; Electron is gone (decision 1) but lowering the floor is a separate decision nobody has made — the number is a declared minimum, not a derived one. |
| 7 | `Session` model / `Message.sessionId` / `Message.parentMessageId` | Kept in the schema, unused by the live agent flow. | `lib/services/cli/claude.ts` has an explicit comment: `sessionId` is the `Session` table's foreign key, so the real Claude Agent SDK session id is deliberately *not* stored there — it lives in `Project.activeClaudeSessionId` instead. The column still has a generic writer (`POST /api/chat/[project_id]/messages`) and readers (serializers, `ChatLog.tsx`'s dedup key), so it isn't dead code, just inert for the actual product flow. Two now-dead session-detection API routes and a client polling loop that queried the (always-empty) `Session` table were removed 2026-08-27; the model/columns themselves were deliberately left alone pending a real decision on their fate (§9). |
| 8 | Templates | Two project templates: Next.js (App Router) and Astro. Each scaffold gets a `CLAUDE.md` written into it with that framework's conventions. | `lib/templates/`. |
| 9 | Preview ports | 32 concurrent preview slots, `3100`–`3131`. A 33rd concurrent preview fails loudly ("no free port"). | `scripts/setup-env.js`'s `DEFAULT_WEB_SCAN_SPAN`/preview-range constants; this is the feature's actual limit, not a documentation gap. |
| 10 | Docker port publishing | **Stated intent:** `127.0.0.1`-only, since the app has no auth and hands the agent a Bash tool. **Actual current state contradicts this — see §9, flagged, not resolved.** | |

## 3. Architecture

Next.js 16 App Router, TypeScript strict throughout.

- **`app/`** — pages (`app/page.tsx` project list, `app/[project_id]/chat/page.tsx`
  the main chat+preview+file-browser workspace) and API routes under
  `app/api/**/route.ts`.
- **`lib/services/`** — the service layer API routes call into: `project.ts`,
  `preview.ts` (spawns/manages generated projects' dev servers), `github.ts`,
  `env.ts`, `tokens.ts`, `file-browser.ts`, `assets.ts`, `stream.ts` (SSE),
  `cli/claude.ts` (the Claude Agent SDK orchestration — building the query,
  streaming tool events back to the client).
- **`lib/serializers/`** — DB row ↔ wire-shape conversion; `lib/serializers/client/`
  holds pure client-side message-merging/placeholder logic extracted out of
  `ChatLog.tsx`.
- **`lib/tool-actions.ts`** — a deliberately zero-import leaf module (no
  imports at all, checked as an invariant) mapping Claude tool names to
  display actions. Both `lib/services/cli/claude.ts` (server: imports the
  Agent SDK, `fs/promises`, Prisma) and `components/chat/ChatLog.tsx`
  (`"use client"`) import from it. This is the fix for a real class of bug:
  a client component must never import from `lib/services/cli/claude.ts` —
  doing so would either fail to bundle or ship server-only code to the
  browser.
- **`components/`** — React components, largely `"use client"`; `ChatLog.tsx`
  is the largest single file (message rendering, tool-call display).
- **`prisma/schema.prisma`** — the data model (§4). `lib/utils/project-path.ts`
  is the one place project directory paths are computed (`resolveProjectRoot`,
  `resolveSafeProjectPath` — the path-traversal guard every project-file API
  route routes through).
- **`scripts/`** — `run-web.js` (dev launcher, finds free ports), `setup-env.js`
  (`postinstall`, writes `.env` defaults), `migrate-drop-legacy.js` (backup +
  legacy-row cleanup for pre-Docker installs).

Generated user projects live under `PROJECTS_DIR` (default `./data/projects`),
one directory per `Project.id`; each gets its own dev server spawned by
`lib/services/preview.ts` on a port from the preview range (decision 9).

## 4. Data model

SQLite via Prisma (`prisma/schema.prisma`). No enum types — status fields are
plain `String` with a comment listing the values in use (not DB-enforced).

- **`Project`** — one row per generated app. `status` (`idle`/`running`/
  `stopped`/`error`, per `lib/services/project.ts`'s own inline union — the
  frontend's `types/project.ts` tracks a wider 9-value union used for UI
  state, reconciled onto the same declaration as of 2026-08-27 but not
  identical in *usage*, see §9), `templateType` (`nextjs`/`astro`),
  `activeClaudeSessionId` (the real, live session pointer — decision 7),
  `selectedModel`.
- **`Message`** — chat history per project. `role`, `messageType`, `content`,
  `metadataJson` (tool-call metadata as a JSON string). `sessionId`/
  `parentMessageId`/`cliSource` exist but are inert for the live flow
  (decision 7).
- **`Session`** — kept, unused by the live flow (decision 7).
- **`ProjectServiceConnection`** — one row per connected external service per
  project; today only `provider: "github"` is meaningful. `serviceData` is a
  JSON string (`{ repo_url, repo_name, default_branch }`).
- **`EnvVar`** — per-project environment variables, `valueEncrypted` AES via
  `lib/crypto.ts` (decision 4/5). Synced both ways with the generated
  project's own `.env` file (`lib/services/env.ts`'s `syncDbToEnvFile`).
- **`UserRequest`** — one row per user chat instruction, tracks
  `pending`/`processing`/`completed`/`failed`.
- **`ServiceToken`** — GitHub personal access tokens, plain text (decision 5).
  Legacy rows for removed providers (`vercel`, `supabase`) can exist on old
  installations; `scripts/migrate-drop-legacy.js` removes them, and nothing
  in the current API can reach or delete them by provider name (`GET
  /api/tokens/:provider` only recognizes `github`).

Two models existed and were removed 2026-08-27 as fully dead (zero
create/update calls anywhere): `Commit`, `ToolUsage`. Six columns were removed
alongside them as zero-reference: `Message.durationMs`/`tokenCount`/
`costUsd`/`commitSha`, `ProjectServiceConnection.lastSyncAt`,
`Project.settings`.

## 5. Configuration

Read from `.env` (local) or `.env.docker` (Docker, git-ignored, required via
`--env-file`). `scripts/setup-env.js` generates `.env` defaults on
`postinstall`.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `file:../data/cc.db` | SQLite file path, relative to `prisma/`. |
| `PROJECTS_DIR` | `./data/projects` | Where generated projects live. |
| `ENCRYPTION_KEY` | generated by `setup-env.js` locally; **required**, no default, in Docker | 32-byte hex. See decision 4. |
| `PORT` / `WEB_PORT` | `3000`, next free port if taken | The app's own port. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:<PORT>` | Baked into the client bundle at build time — changing it in a running Docker container requires a rebuild. |
| `PREVIEW_PORT_START` / `PREVIEW_PORT_END` | `3100` / `3131` | Decision 9. |
| `CLAUDABLE_DATA` (Docker only) | `./data` | Mounted to `/data`; holds projects, the DB, global settings, and the npm cache (`/data/.npm`, grows over time — expected). |
| `CLAUDABLE_CLAUDE_DIR` (Docker only) | `${HOME}/.claude` | Mounted read-write to `/data/home/.claude` — must be writable, OAuth token refresh writes `.credentials.json`. |
| `HOST_UID` / `HOST_GID` (Docker only) | none — deliberately blank, Compose refuses to start without them | Prevents the container from taking ownership of host `.claude` files under the wrong uid. |

## 6. Docker

`docker-compose.yml`, single service, built from `Dockerfile`. Runs `prisma db
push --accept-data-loss` against the mounted database on every container
start (decision 3) — no backup, no prompt, so a pre-Docker installation must
run `npm run db:backup && npm run db:migrate-legacy` once, from a normal
checkout, before the first `docker compose up` (README §"Upgrading from a
Previous Version" has the exact steps).

Verified end-to-end on arm64 only; x86_64 is unverified (no QEMU available at
verification time).

## 7. Security posture

No authentication of any kind. The agent has an unrestricted Bash tool inside
the container/host. This is a deliberate scope boundary (§1's non-goals), not
an oversight — the project is meant for a single trusted user on their own
machine or private network, not a shared or internet-facing deployment.
Stated Docker port-binding intent is `127.0.0.1`-only for exactly this reason
(decision 10) — **but see §9, the current config does not match this.**

Path-traversal: every project-file API route resolves through
`lib/utils/project-path.ts`'s `resolveSafeProjectPath`, the single guard for
"stay inside the project directory" (a second, divergent, untested copy in
`lib/services/file-browser.ts` was found and routed through the canonical one
2026-08-27).

## 8. Testing

Vitest (`tests/`, mirrors `app/`/`lib/` structure), `npm test`. TypeScript
strict (`npm run type-check`), ESLint 9 flat config (`npm run lint`,
`eslint.config.mjs`). No end-to-end/browser test suite exists — UI changes
without unit-testable logic (e.g. `components/modals/ServiceConnectionModal.tsx`'s
2026-08-27 refactor) rely on manual verification, which is not always
possible in every environment (no browser was available to verify that one
change at merge time — flagged, not silently treated as verified).

## 9. Open questions and flags

**Needs a decision:**
- **`docker-compose.yml` currently runs `network_mode: host`, not the
  `127.0.0.1`-only binding §7/decision 10 describes as intended.** This
  publishes the app (and its unauthenticated Bash-capable agent) on every
  network interface, which the project's own stated threat model calls
  remote code execution for anyone on the same network. Introduced in commit
  `89c16ed`, whose own commit message frames it as a deliberate change (it
  also added a `~/.figma-console-mcp` host mount in the same commit) — so
  this may be an intentional, undocumented decision rather than a regression.
  **Unresolved as of 2026-08-27**; the user needs to determine that commit's
  actual intent before this is fixed one way or the other. Until then, do
  not treat README's/this spec's "127.0.0.1-only" language as the deployed
  reality.
- **`Session` model / `Message.sessionId` / `Message.parentMessageId`'s
  long-term fate** (decision 7) is unresolved. They are schema-live but
  product-inert. Dropping them touches 4 files' worth of pass-through
  plumbing (serializers, `ChatLog.tsx`'s dedup key) and is a real, separate
  decision — not something to fold into an unrelated cleanup task.

**Flags — no decision needed today, but worth knowing:**
- `types/project.ts`'s 9-value `ProjectStatus` union and
  `lib/services/project.ts`'s inline 4-value union (`idle`/`running`/
  `stopped`/`error`) both guard `Project.status` in different places; only
  the *type declarations* were reconciled (§2 decision — `types/backend/
  project.ts` now re-exports the frontend union) — the backend service code's
  own narrower literal union was not touched and still only actually writes
  4 of the 9 values.
- `.next/standalone`'s production build output still traces in most of the
  repo root (~224 MB) beyond the four paths (`.git`, `data`, `.flow`,
  `tests`) explicitly excluded — a `next.config.js`
  `outputFileTracingExcludes` limitation tied to this project's
  `process.cwd()`-relative project-path resolution, not fully solved.

## 10. Assumptions

- The "why" behind decision 2 (single-CLI, Claude Code only) is reconstructed
  from the dead parameter's own removal commit and an in-code comment, not
  from a design discussion — marked `(inferred)`.
- §1's positioning ("Lovable-like", "free") is taken directly from README's
  own framing, not independently verified against the project's actual
  licensing/business model beyond what `LICENSE` (MIT) states.
