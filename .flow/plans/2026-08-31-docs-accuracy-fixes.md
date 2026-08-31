# Docs Accuracy Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four verified documentation/config inaccuracies found by a fresh audit: a likely-broken `npm run prisma:reset` recovery command, an org-name inconsistency between `package.json` and README now that the repo has moved, an overclaim about what `npm install` does, and a stale comment describing removed crypto behavior.

**Architecture:** No new subsystem. Two tasks: (1) fix `package.json`'s `prisma:reset` script (a real behavior change, needs real verification) and its `repository.url` (consistency), (2) fix the remaining doc-only inaccuracies in `README.md` and `.env.docker.example`.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/SQLite, npm.

**Spec:** `spec.md` §9 flags one related item (stale `opactorai` links) as open — this plan closes it. §5/§6 describe `db push --accept-data-loss` as the schema-application mechanism; this plan's Task 1 doesn't change that mechanism, only fixes a *different* script (`prisma:reset`, the manual full-reset path) to use the same family of command instead of a broken one.

**Design record:** `.flow/specs/2026-08-31-docs-accuracy-fixes-design.md`

## Global Constraints

- Full verification gate: `npm run type-check && npm test && npm run lint && npm run build`.
- Commit messages: English, imperative mood, matching this repo's existing convention (see `git log`).
- Task 1 changes real runtime behavior (an npm script) — verify it actually works against a real database, don't just trust the docs citation.

---

### Task 1: Fix `prisma:reset` script and `repository.url`

**Files:**
- Modify: `package.json`

**Interfaces:** None.

`package.json`'s `prisma:reset` script is `"prisma migrate reset"`. This repo has no `prisma/migrations/` directory (deliberately removed in an earlier branch — the real schema-application mechanism everywhere else in this repo is `prisma db push`, confirmed via `Dockerfile` and `scripts/run-web.js`). `prisma migrate reset` relies on replaying tracked migrations to rebuild the schema after dropping the database; with zero migrations tracked, it has nothing to replay. README's "Database Migration Conflicts" section already describes the *intended* behavior accurately ("The command drops and recreates the local database") — that text does not need to change, only the script needs to actually do what it says.

- [ ] **Step 1: Verify the current script is broken, non-destructively**

```bash
cp data/cc.db /tmp/prisma-reset-check.db
DATABASE_URL="file:/tmp/prisma-reset-check.db" npx prisma migrate status
```
Expected: output stating the database is not managed by Prisma Migrate / no migrations found (confirms the diagnosis — re-verify this yourself, don't just trust this plan's prior investigation). Do NOT run `prisma migrate reset` for real, against any real database, to "confirm" it's broken — that's a destructive command and the diagnosis above is sufficient evidence without needing to trigger it. Clean up: `rm /tmp/prisma-reset-check.db`.

- [ ] **Step 2: Fix the script**

In `package.json`, change:
```json
    "prisma:reset": "prisma migrate reset",
```
to:
```json
    "prisma:reset": "prisma db push --force-reset",
```

- [ ] **Step 3: Verify the new script actually works, against a scratch database**

```bash
cp data/cc.db /tmp/prisma-reset-verify.db
DATABASE_URL="file:/tmp/prisma-reset-verify.db" npx prisma db push --force-reset --schema=prisma/schema.prisma
DATABASE_URL="file:/tmp/prisma-reset-verify.db" npx prisma db pull --print --schema=prisma/schema.prisma 2>&1 | head -30
rm /tmp/prisma-reset-verify.db
```
Expected: `db push --force-reset` completes successfully and reports the database now matches the schema; the `db pull --print` sanity check shows the expected tables (`projects`, `messages`, `sessions`, `project_service_connections`, `env_vars`, `user_requests`, `service_tokens` — the current model set, re-verify against `prisma/schema.prisma`'s actual `@@map` names rather than trusting this list). This is the real behavior-preservation evidence for this task — do not skip it in favor of just citing Prisma's docs.

- [ ] **Step 4: Fix `repository.url` for consistency**

In `package.json`, change:
```json
  "repository": {
    "type": "git",
    "url": "https://github.com/anymorph-ai/Claudable.git"
  },
```
to:
```json
  "repository": {
    "type": "git",
    "url": "https://github.com/animativpl/Claudable.git"
  },
```
(Confirmed via the user directly: `animativpl` is where this session's work actually landed, and README's Task 2 will point its public links there too — leaving `package.json` on a different org would recreate the exact inconsistency this plan exists to fix.)

- [ ] **Step 5: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "fix: replace broken prisma:reset script with db push --force-reset, align repository.url

prisma migrate reset had nothing to replay -- this repo tracks no
prisma/migrations/ directory and uses db push everywhere else. Verified
against a scratch copy of the database, not just cited from docs.
repository.url now matches the org README's public links point to."
```

---

### Task 2: Fix README.md and .env.docker.example inaccuracies

**Files:**
- Modify: `README.md`
- Modify: `.env.docker.example`

**Interfaces:** None.

- [ ] **Step 1: Fix the stale `opactorai` org links**

Re-verify current line numbers before editing (this plan predates any drift). Replace every `github.com/opactorai/Claudable` (or `opactorai/Claudable` in a `repos=` query param) with `github.com/animativpl/Claudable` (or `animativpl/Claudable`). As of this plan, the occurrences are:
- GitHub Stars badge (href + img `src`)
- GitHub Forks badge (href + img `src`)
- License badge (href + img `src`)
- The `git clone` command in Quick Start
- The Star History chart (both the `repos=` query param and the link href)

Run this to confirm none remain afterward:
```bash
grep -in "opactorai" README.md
```
Expected: no output.

- [ ] **Step 2: Fix the "Setup" section's overclaim about `npm install`**

Currently:
```
The `npm install` command automatically handles the complete setup:

1. **Port Configuration**: Detects available ports and creates `.env` files
2. **Dependencies**: Installs all required Node.js packages
3. **Database Setup**: SQLite database auto-creates at `data/cc.db` on first run
```
Items 1-2 happen during `npm install` (its `postinstall` hook runs `ensure:env`). Item 3 does not — the database is created on first `npm run dev` (`scripts/run-web.js` runs `prisma db push` itself), not during `npm install`. Read the current file and confirm this is still accurate (check `package.json`'s `postinstall` script and `scripts/run-web.js`'s actual behavior before editing), then reword the topic sentence and/or item 3 so it doesn't claim `npm install` alone handles database setup. Keep the numbered-list structure; this is a wording fix, not a restructure. For example, split the claim: "`npm install` handles the first two automatically; the database is created on your first `npm run dev`." — adjust to whatever reads cleanest in context, the exact wording is yours to judge as long as it's accurate.

- [ ] **Step 3: Fix `.env.docker.example`'s stale `ENCRYPTION_KEY` comment**

The comment currently describes removed behavior — read the current file first (it's in Polish, matching the rest of that file's comments) and confirm the exact wording, but it says something like: if `ENCRYPTION_KEY` were empty, `lib/crypto.ts` would generate a random in-memory key, different on every container start. That's the old, removed fallback. Today, `lib/crypto.ts` throws on the first `encrypt`/`decrypt` call if the key is unset — it doesn't generate anything. Reword the comment to describe the current fail-loud behavior instead (matching README's own already-accurate description of this in its Docker section, `ENCRYPTION_KEY` bullet — read that for the correct current framing, then adapt to this file's own comment style and language).

- [ ] **Step 4: Verify**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS (docs/config-comment-only changes — this confirms nothing broke, not that anything new works).

- [ ] **Step 5: Commit**

```bash
git add README.md .env.docker.example
git commit -m "docs: fix stale org links, npm install overclaim, and outdated crypto-fallback comment"
```

---
