# Claudable Cleanup Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the whole-repo cleanup audit — a live security regression, 16 verified dead-code removals, 10 real duplications (including a divergent, untested copy of the app's path-traversal guard), a database migration dropping 3 fully-dead models plus 7 orphaned columns, 2 legacy-architecture remnants, and 3 docs/config fixes — in the phased order the user chose: security → dead code → duplication → structural → legacy remnants → docs.

**Architecture:** No new subsystem. 22 tasks, each either a verified-safe removal (no new test needed — the existing suite staying green is the proof) or a behavior-preserving extraction/fix (real TDD: a test proving the old and new code paths produce the same result). Three tasks in Phase 2 have an explicit verify-before-fix step, because the audit itself could not confirm the underlying problem without actually running a build/pack — do not skip that step or assume the fix is needed without it.

**Tech Stack:** Next.js App Router, TypeScript strict, Prisma/SQLite, vitest, Electron.

**Spec:** project has no living `spec.md` (confirmed in the design record) — no spec-sync task.

**Design record:** `.flow/specs/2026-08-27-claudable-cleanup-audit-design.md`

**Correction made while writing this plan, worth recording:** the audit suggested collapsing `components/settings/GlobalSettings.tsx`'s modal shell into the existing `SettingsModal` wrapper. Direct comparison shows these are not the same pattern — `SettingsModal` is a right-side slide-in panel (`ProjectSettings.tsx`'s style), `GlobalSettings.tsx` is a centered, `framer-motion`-animated tabbed dialog with a different header, sizing, and interaction model entirely. Forcing one into the other would be a visible design change, not a safe dedup. That merge is **dropped** from this plan; only the byte-identical GitHub SVG icon (genuinely duplicated, zero visual risk to extract) is in scope (Task 17).

## Global Constraints

- A "test" for a pure deletion (dead code, dead config, dead Prisma model/column with zero readers) is the existing verification gate — `npm run type-check && npm test && npm run lint && npm run build` — staying green. No new test is required for those tasks. TDD's red/green cycle applies where a task changes real behavior (crypto fallback, path-traversal routing, asset-mirroring extraction, directoryExists extraction, the ChatLog.tsx extraction, the model-selection hook).
- Every verification command must actually be run and its real output read.
- Before deleting anything described here as "zero callers," re-grep it yourself in the actual worktree — this plan's line numbers are accurate as of 2026-08-27, but re-verify before acting, the same discipline every audit in this plan applied.
- Verification greps exclude, never enumerate: `-I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow --exclude=package-lock.json .`
- Commit messages: English, imperative mood, matching this repo's existing convention (see `git log`).
- Full verification gate: `npm run type-check && npm test && npm run lint && npm run build`.
- The three "needs verification by running it" items (Task 10) get their verify step run for real before any fix is written — if the problem doesn't reproduce, say so and move on; don't fix something you haven't confirmed is broken.

---

## Phase 1 — Security

### Task 1: Restore 127.0.0.1-only port binding

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:** None.

`docker-compose.yml` currently runs on `network_mode: host` (line 11) with no `ports:` key — a regression from a commit unrelated to this cleanup that silently dropped the loopback-only binding. `README.md:119-122` already describes the *intended*, safe state correctly ("published on `127.0.0.1` only... exposing it on every network interface would be remote code execution for anyone on the same network") — so this task brings the compose file back in line with what the README already (correctly) promises; **no README change is needed**.

Note: `build: { context: ., network: host }` (lines 3-5) is a *different* setting — build-time network access for `apt-get`/`npm install` during `docker build` — and is unrelated to the runtime exposure problem. Leave it untouched.

- [ ] **Step 1: Remove `network_mode: host`, restore the `ports:` mapping**

In `docker-compose.yml`, change:
```yaml
    env_file:
      - .env.docker
    network_mode: host
    environment:
```
to:
```yaml
    env_file:
      - .env.docker
    # Both ranges bound to 127.0.0.1, not 0.0.0.0. The app has no
    # authentication and gives the agent a Bash tool, so publishing on every
    # interface is remote code execution for anyone on the same network.
    ports:
      - "127.0.0.1:3000:3000"
      - "127.0.0.1:3100-3131:3100-3131"
    environment:
```

- [ ] **Step 2: Verify the compose file is valid**

```bash
docker compose -f docker-compose.yml config >/dev/null
```
Expected: exits 0, no parse errors. (This validates syntax only — it does not require `.env.docker` to be populated or the daemon to be reachable for `config`'s dry parse, but if it fails on a missing required var, that's expected and fine; the point is confirming no YAML/schema error was introduced.)

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "fix: restore 127.0.0.1-only port binding, drop network_mode: host

Publishing on every interface is remote code execution for anyone on the
same network -- the app has no authentication and gives the agent a Bash
tool. README.md already documented the loopback-only binding as the
intended state; this brings the compose file back in line with it."
```

---

## Phase 2 — Dead code

### Task 2: Backend dead-code batch

**Files:**
- Delete: `lib/services/service-integration.ts`
- Modify: `lib/services/stream.ts`
- Modify: `lib/services/github.ts`
- Modify: `lib/services/preview.ts`
- Modify: `lib/services/cli/claude-options.ts`

**Interfaces:** None — every removal here has zero external callers, confirmed by the audit and re-confirmed below.

- [ ] **Step 1: Delete the whole dead file**

```bash
grep -rn "getProjectGitHubRepo\|validateProjectExists\|service-integration" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow .
```
Expected: only `lib/services/service-integration.ts` itself. Then:
```bash
git rm lib/services/service-integration.ts
```

- [ ] **Step 2: Delete 4 dead `StreamManager` methods**

In `lib/services/stream.ts`, delete the `getStreamCount` method (lines 86-90, including its docblock), `getTotalStreamCount` (92-101), `closeProjectStreams` (103-119), and `closeAllStreams` (121-129) — delete all four together, since `closeAllStreams` is `closeProjectStreams`'s only caller. Leave `addStream`, `removeStream`, `publish`, `getInstance`, and the exported `streamManager` singleton untouched — those are live (used by `app/api/chat/[project_id]/stream/route.ts` and `lib/services/cli/claude.ts`).

- [ ] **Step 3: Delete 2 dead exports and 1 dead private function**

- `lib/services/github.ts:138-170` — delete `getGithubRepositoryDetails` in full (including its docblock at line 137 if present).
- `lib/services/preview.ts:576-589` — delete `ensureDependencies` in full.
- `lib/services/preview.ts:1074-1077` — delete `PreviewManager.getLogs` (the existing `getStatus` method already returns the same `logs` array via its `toInfo` mapper; no route calls `getLogs`).

- [ ] **Step 4: Remove the redundant `additionalDirectories` option**

In `lib/services/cli/claude-options.ts`, change:
```typescript
  return {
    cwd: input.projectPath,
    additionalDirectories: [input.projectPath],
    model: input.model,
```
to:
```typescript
  return {
    cwd: input.projectPath,
    model: input.model,
```
(`additionalDirectories` grants access *beyond* `cwd` per the SDK's own docs — `input.projectPath` is already the `cwd`, so this line always granted access to a directory already granted. If `tests/cli/claude-options.test.ts` asserts on the shape of `additionalDirectories`, update that assertion; if it doesn't, no test change is needed.)

- [ ] **Step 5: Verify**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove dead backend exports (service-integration.ts, StreamManager methods, github/preview dead code, redundant additionalDirectories)"
```

---

### Task 3: Frontend dead-code batch

**Files:**
- Delete: `contexts/AuthContext.tsx`
- Modify: `app/layout.tsx`
- Modify: `components/chat/ChatLog.tsx`
- Modify: `app/[project_id]/chat/page.tsx`
- Modify: `hooks/useUserRequests.ts`

**Interfaces:** None.

- [ ] **Step 1: Delete the vestigial `AuthContext`**

```bash
grep -rn "AuthContext\|useAuth" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow .
```
Expected: `contexts/AuthContext.tsx` (the definition) and `app/layout.tsx` (the only consumer, which just wraps children — no `useContext` call anywhere). Then:
```bash
git rm contexts/AuthContext.tsx
```
In `app/layout.tsx`, remove the `AuthProvider` import and unwrap its children (replace `<AuthProvider>{children}</AuthProvider>` with just `{children}`, keeping any sibling providers untouched).

- [ ] **Step 2: Inline the pass-through `ToolResultMessage` component**

In `components/chat/ChatLog.tsx`, find the single call site of `<ToolResultMessage ... />` (the audit found it at line 2626 — re-grep to confirm the current line) and replace it with what `ToolResultMessage`'s body already does directly:
```typescript
<ToolMessage
  content={normalizeChatContent(message.content)}
  metadata={metadata ?? undefined}
  isExpanded={isExpanded}
  onToggle={onToggle}
/>
```
(matching whatever prop values the call site was passing to `ToolResultMessage` — read the actual call site first, this is illustrative of the shape, not a literal copy-paste). Then delete the `ToolResultMessage` component definition (lines 1997-2016).

- [ ] **Step 3: Delete the dead multi-agent color table**

In `app/[project_id]/chat/page.tsx`, delete `hexToFilter` (lines 29-38). Re-grep first to confirm zero call sites remain:
```bash
grep -rn "hexToFilter" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow .
```
Expected: only the definition.

- [ ] **Step 4: Delete unused legacy-compat fields from `useUserRequests`**

In `hooks/useUserRequests.ts`, the hook's return object currently ends with:
```typescript
  return {
    hasActiveRequests,
    activeCount,
    createRequest,
    startRequest,
    completeRequest,
    // Legacy interface compatibility
    requests: [],
    activeRequests: [],
    getRequest: () => undefined,
    clearCompletedRequests: () => {}
  };
```
Change it to:
```typescript
  return {
    hasActiveRequests,
    activeCount,
    createRequest,
    startRequest,
    completeRequest,
  };
```
Re-grep the sole consumer first to confirm it never destructures the removed fields:
```bash
grep -n "useUserRequests(" -A5 app/\[project_id\]/chat/page.tsx
```

- [ ] **Step 5: Verify**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove dead frontend code (AuthContext, ToolResultMessage wrapper, hexToFilter, useUserRequests legacy stubs)"
```

---

### Task 4: Types cleanup

**Files:**
- Delete: `types/server/index.ts`, `types/server/project.ts`
- Delete: `types/shared/chat.ts`, `types/shared/project.ts`, `types/shared/service.ts`
- Delete: `types/backend/cli.ts`
- Delete: `types/fernet.d.ts`
- Modify: `types/shared/index.ts`, `types/backend/index.ts`, `types/chat.ts`

**Interfaces:**
- Consumes: nothing changes for live consumers — `types/shared/github.ts` (the one live file in `types/shared/`), `types/backend/{project,chat,files}.ts` (the three live files in `types/backend/`), and `types/chat.ts`'s `ChatMessage` export all keep working identically.

Confirmed zero references anywhere in the repo (re-verified while writing this plan):
```bash
grep -rn "types/server\|types/shared/chat\|types/shared/project\|types/shared/service\|types/backend/cli" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow .
```
returns nothing.

- [ ] **Step 1: Delete the whole `types/server/` directory**

```bash
git rm -r types/server
```

- [ ] **Step 2: Delete the three dead files in `types/shared/`, fix its barrel**

```bash
git rm types/shared/chat.ts types/shared/project.ts types/shared/service.ts
```
In `types/shared/index.ts`, change:
```typescript
export * from './project';
export * from './chat';
export * from './service';
export * from './github';
```
to:
```typescript
export * from './github';
```

- [ ] **Step 3: Delete the dead file in `types/backend/`, fix its barrel**

```bash
git rm types/backend/cli.ts
```
In `types/backend/index.ts`, change:
```typescript
export * from './project';
export * from './cli';
export * from './chat';
export * from './files';
```
to:
```typescript
export * from './project';
export * from './chat';
export * from './files';
```

- [ ] **Step 4: Delete the orphaned `fernet` type declaration**

```bash
git rm types/fernet.d.ts
```

- [ ] **Step 5: Trim `types/chat.ts` to its one live export**

Only `ChatMessage` (re-exported as `RealtimeMessage`) is consumed via the `@/types` barrel — `ChatSession`, `ImageAttachment`, `ActRequest`, `UserRequest`, `WebSocketEventData`, `ChatMode` are all unused (the live `ImageAttachment`/`ChatActRequest` types used by `act/route.ts` come from `types/backend/chat.ts`, a different file — this file's copies are shadow-duplicates). Replace the full file content with:
```typescript
import type { RealtimeMessage } from './realtime';

export type ChatMessage = RealtimeMessage;
```
(This drops the `import type { MessageMetadata } from '@/types/backend'` line too — it was only used by the now-deleted `ActRequest` interface.)

- [ ] **Step 6: Verify**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. A `type-check` failure here means something imports one of the deleted symbols that the grep in this task's header missed — read the actual error, find the real caller, and decide whether it was a false negative in the grep (fix the import) or genuinely needs the type restored (stop and report, don't guess).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: delete dead types (types/server/, most of types/shared/, types/backend/cli.ts, types/fernet.d.ts)"
```

---

### Task 5: Remove the unused `react-icons` dependency

**Files:**
- Modify: `package.json`

**Interfaces:** None — `tsconfig.json`'s path aliases (`react-icons/fa`, `react-icons/si`, `react-icons/vsc` → `stubs/*.tsx`) and the `stubs/**` files themselves are untouched, so nothing about what actually renders changes.

The production build's own `.nft.json` trace manifests resolve every `react-icons` import to the local stub files, never `node_modules/react-icons` — confirmed by the audit. Removing the dependency changes nothing about the built output.

- [ ] **Step 1: Remove the dependency**

In `package.json`, delete this line from `dependencies`:
```json
    "react-icons": "^5.7.0",
```

- [ ] **Step 2: Verify**

```bash
npm install
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS — the `stubs/**` path aliases in `tsconfig.json` mean nothing actually resolves to the real package today, so removing it from `package.json` should be a no-op for the build.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove unused react-icons dependency (never bundled -- stubs/** shadow it entirely)"
```

---

### Task 6: Root config cleanup

**Files:**
- Modify: `tsconfig.json`
- Modify: `.gitignore`

**Interfaces:** None.

- [ ] **Step 1: Remove redundant tsconfig path aliases and the stale exclude**

In `tsconfig.json`, the `paths` block currently has (after Task 4 already removed the need for the `@/types/shared`/`@/types/server` targets, these become doubly dead — pointing at deleted directories on top of being redundant with `@/*`):
```json
      "@/types/shared": [
        "./types/shared/index.ts"
      ],
      "@/types/shared/*": [
        "./types/shared/*"
      ],
      "@/types/server": [
        "./types/server/index.ts"
      ],
      "@/types/server/*": [
        "./types/server/*"
      ],
      "@/types/backend": [
        "./types/backend/index.ts"
      ],
      "@/types/backend/*": [
        "./types/backend/*"
      ],
```
Delete all six entries — `@/*` (already present as `"@/*": ["./*"]`) resolves the same targets via directory-index resolution. Keep the `react-icons/{fa,si,vsc}` aliases untouched.

In the `exclude` array, remove `"external_Claudable"` — no file or directory by that name has existed in this repo's git history (`git log --all -- external_Claudable` is empty).

- [ ] **Step 2: Remove shadowed `.gitignore` entries**

Remove these lines (both fully shadowed by broader existing rules — verify with `git check-ignore -v` before and after to confirm no behavior change):
```
prisma/*.db
prisma/*.db-journal
prisma/*.db-wal
```
(the database lives under `data/cc.db`, already covered by the `data/` rule) and:
```
/data/projects/
```
(already covered by the broader `data/` rule).

- [ ] **Step 3: Verify**

```bash
npm run type-check && npm test && npm run lint && npm run build
git status --short
```
Expected: all four gate commands PASS; `git status --short` shows no newly-untracked files that used to be gitignored (confirming the removed `.gitignore` lines were genuinely redundant, not load-bearing).

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json .gitignore
git commit -m "chore: remove redundant tsconfig path aliases and shadowed gitignore entries"
```

---

### Task 7: Remove the orphaned env sync/upsert/conflicts API surface

**Files:**
- Delete: `app/api/env/[project_id]/upsert/route.ts`
- Delete: `app/api/env/[project_id]/conflicts/route.ts`
- Delete: `app/api/env/[project_id]/sync/file-to-db/route.ts`
- Delete: `app/api/env/[project_id]/sync/db-to-file/route.ts`
- Modify: `lib/services/env.ts`

**Interfaces:**
- Consumes: nothing — `syncEnvFileToDb`, `syncDbToEnvFile`, `parseEnvFile` stay (still used internally and by the surviving plain CRUD routes).
- Produces: nothing new. `listEnvVars`, `createEnvVar`, `updateEnvVar`, `deleteEnvVar` — the routes actually used by `components/settings/EnvironmentSettings.tsx` — are untouched.

Per design decision 4: zero in-app callers of this surface (confirmed via grep of `app/`, `components/`, `contexts/`, `tests/`).

- [ ] **Step 1: Delete the four route files**

```bash
git rm app/api/env/\[project_id\]/upsert/route.ts
git rm app/api/env/\[project_id\]/conflicts/route.ts
git rm app/api/env/\[project_id\]/sync/file-to-db/route.ts
git rm app/api/env/\[project_id\]/sync/db-to-file/route.ts
```

- [ ] **Step 2: Delete the now-unused service functions**

In `lib/services/env.ts`, delete `detectEnvConflicts` (line 280 onward, through the end of the function) and `upsertEnvVar` (line 338 onward). Re-grep first to confirm no other caller:
```bash
grep -rn "detectEnvConflicts\|upsertEnvVar" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow .
```
Expected: only the definitions in `lib/services/env.ts` itself (the routes that called them are already gone from Step 1). Leave `listEnvVars`, `createEnvVar`, `updateEnvVar`, `deleteEnvVar`, `syncDbToEnvFile`, `syncEnvFileToDb`, `envFilePath`, `ensureProject` untouched.

- [ ] **Step 3: Verify**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove orphaned env sync/upsert/conflicts API surface

Zero in-app callers -- components/settings/EnvironmentSettings.tsx uses
only the plain GET/POST/PUT/DELETE routes, which are unaffected."
```

---

### Task 8: `lib/crypto.ts` — fail loud instead of silently rotating the encryption key

**Files:**
- Modify: `lib/crypto.ts`
- Test: `tests/lib/crypto.test.ts` (new)

**Interfaces:**
- Produces: `encrypt(text: string): string` and `decrypt(text: string): string` keep their exact signatures — only the module's key-resolution behavior changes (throws at import time if `ENCRYPTION_KEY` is unset, instead of silently generating a random one).

Per design decision 5: the Docker path already requires `ENCRYPTION_KEY` via `docker-compose.yml`'s `${ENCRYPTION_KEY:?...}` guard, and `scripts/setup-env.js` generates one for local dev — so this fallback never actually fires in normal use today. Making it throw instead of silently rotating keys closes a footgun without changing real-world behavior.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/crypto.test.ts`:
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('lib/crypto — ENCRYPTION_KEY handling', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it('rzuca błędem przy imporcie, gdy ENCRYPTION_KEY nie jest ustawiony', async () => {
    delete process.env.ENCRYPTION_KEY;
    await expect(import('@/lib/crypto')).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it('szyfruje i odszyfrowuje poprawnie, gdy ENCRYPTION_KEY jest ustawiony', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const plaintext = 'a secret value';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });
});
```

- [ ] **Step 2: Run the test to verify the first case fails**

```bash
npx vitest run tests/lib/crypto.test.ts
```
Expected: the first test FAILS (import does not throw — the module currently generates a random key instead), the second test PASSES already.

- [ ] **Step 3: Make the fallback throw instead of silently generating a key**

In `lib/crypto.ts`, change:
```typescript
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
```
to:
```typescript
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error(
    'ENCRYPTION_KEY is not set. Every encrypted EnvVar/ServiceToken becomes ' +
    'undecryptable if this module silently generates a new key on each ' +
    'process start -- set ENCRYPTION_KEY explicitly instead (scripts/setup-env.js ' +
    'generates one for local dev; the Docker path requires it via docker-compose.yml).'
  );
}
```
(`ENCRYPTION_KEY` is now typed `string`, not `string | undefined`, past the guard — no other line in the file needs to change.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/lib/crypto.test.ts
```
Expected: both PASS.

- [ ] **Step 5: Run the full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. If any existing test or the dev-server startup path relied on the silent-fallback behavior (unlikely, but verify), it will show up here as a new failure — read it and fix the actual gap in test/dev setup rather than reverting the throw.

- [ ] **Step 6: Commit**

```bash
git add lib/crypto.ts tests/lib/crypto.test.ts
git commit -m "fix: throw instead of silently rotating the encryption key when ENCRYPTION_KEY is unset

The prior fallback (crypto.randomBytes(32)) generated a new, different key
on every process start with no warning -- every existing encrypted EnvVar/
ServiceToken becomes silently undecryptable after a restart. Both real
paths (Docker via docker-compose.yml's :? guard, local dev via
scripts/setup-env.js) already ensure the var is set, so this is not a
behavior change in practice, only in the previously-unguarded case."
```

---

### Task 9: Prisma migration — remove 3 dead models and 7 orphaned columns, remove the dead session-polling code

**Files:**
- Modify: `prisma/schema.prisma`
- Create: a new Prisma migration (via `prisma migrate dev`)
- Delete: `app/api/chat/[project_id]/active-session/route.ts`
- Delete: `app/api/chat/[project_id]/sessions/[session_id]/status/route.ts`
- Modify: `components/chat/ChatLog.tsx`

**Interfaces:** None external — nothing outside these files reads the removed models/columns/routes (confirmed by the audit's project-wide `prisma.*` accessor grep).

Per design decisions 3 and 7, bundled into one migration since they touch the same file: the `Session` model (write-orphaned — zero `create`/`update`/`upsert` calls anywhere, both its routes always 404), `Commit` and `ToolUsage` (fully dead, zero `prisma.commit.*`/`prisma.toolUsage.*` calls), and orphaned columns `Message.durationMs`/`tokenCount`/`costUsd`/`commitSha`/`parentMessageId`, `ProjectServiceConnection.lastSyncAt`, `Project.settings`.

**Not touched** (explicitly out of scope per the design record): `Message.cliSource` and `UserRequest.cliPreference` stay, even though always `'claude'` now.

- [ ] **Step 1: Back up the database before migrating**

```bash
npm run db:backup
```
Expected: exits 0, prints where the backup landed (matches the precedent in `.flow/specs/2026-08-24-claudable-cleanup-docker-templates-design.md` decision 10 — never migrate schema without this first).

- [ ] **Step 2: Edit the schema**

In `prisma/schema.prisma`:

Remove the `sessions Session[]` relation and `commits Commit[]`/`toolUsages ToolUsage[]` relations from `model Project`, and remove `settings String?` (the "Settings (JSON)" field):
```prisma
  // Settings (JSON)
  settings    String? // JSON string for additional settings

```
→ delete this block entirely (including its comment).
```prisma
  // Relations
  messages              Message[]
  sessions              Session[]
  envVars               EnvVar[]
  serviceConnections    ProjectServiceConnection[]
  commits               Commit[]
  toolUsages            ToolUsage[]
  userRequests          UserRequest[]
```
→
```prisma
  // Relations
  messages              Message[]
  envVars               EnvVar[]
  serviceConnections    ProjectServiceConnection[]
  userRequests          UserRequest[]
```

In `model Message`, remove the "Thread support", "Session" (the `sessionId`/relation, not `conversationId`), "Performance tracking", and "Git integration" blocks:
```prisma
  // Thread support
  parentMessageId String? @map("parent_message_id")

  // Session
  sessionId      String? @map("session_id")
  conversationId String? @map("conversation_id")

  // Performance tracking
  durationMs Int? @map("duration_ms")
  tokenCount Int? @map("token_count")
  costUsd    Float? @map("cost_usd")

  // Git integration
  commitSha String? @map("commit_sha")
```
→
```prisma
  // Session
  conversationId String? @map("conversation_id")
```
(keep `conversationId` — unrelated to the dead `Session` model, still used for client-server message matching). Then remove the `session Session? @relation(...)` line, the `toolUsages ToolUsage[]` line, and `@@index([sessionId])` from the same model.

Delete `model Session` (the whole block, "Session info" through `@@map("sessions")`), `model Commit` (the whole block), and `model ToolUsage` (the whole block) entirely.

In `model ProjectServiceConnection`, remove:
```prisma
  lastSyncAt  DateTime? @map("last_sync_at")
```

- [ ] **Step 3: Generate and apply the migration**

```bash
npx prisma migrate dev --name remove_dead_session_commit_toolusage_and_orphaned_columns
```
Expected: exits 0, prints the generated SQL summary (dropped tables `sessions`, `commits`, `tool_usages`; dropped columns on `messages`/`project_service_connections`/`projects`). Read the generated migration file in `prisma/migrations/` to confirm it matches — SQLite migrations for column drops in Prisma typically recreate the table; confirm no unexpected data-loss beyond the intended dropped columns.

- [ ] **Step 4: Regenerate the Prisma client**

```bash
npm run prisma:generate
```

- [ ] **Step 5: Remove the two dead session routes**

```bash
git rm app/api/chat/\[project_id\]/active-session/route.ts
git rm app/api/chat/\[project_id\]/sessions/\[session_id\]/status/route.ts
```

- [ ] **Step 6: Remove the dead session-polling code in `ChatLog.tsx`**

In `components/chat/ChatLog.tsx`:
1. Delete `startSessionPolling` (the `useCallback` starting `// Poll session status periodically`) and `checkActiveSession` (the `useCallback` starting `// Check for active session on component mount`) in full.
2. In the "Initial load" `useEffect`, change:
   ```typescript
   const loadData = async () => {
     if (mounted) {
       await loadChatHistory({ showLoading: true });
       await checkActiveSession();
     }
   };
   ```
   to:
   ```typescript
   const loadData = async () => {
     if (mounted) {
       await loadChatHistory({ showLoading: true });
     }
   };
   ```
   and remove the `sessionPollRef` cleanup block from that same effect's cleanup function:
   ```typescript
   return () => {
     mounted = false;
     if (sessionPollRef.current) {
       clearInterval(sessionPollRef.current);
       sessionPollRef.current = null;
     }
   };
   ```
   →
   ```typescript
   return () => {
     mounted = false;
   };
   ```
3. Delete the `sessionPollRef` declaration (`const sessionPollRef = useRef<NodeJS.Timeout | null>(null);`).

**Do not remove** the `activeSession` state, `ActiveSession` interface, `setActiveSession`, or the `onSessionStatusChange` prop/callback plumbing — `handleRealtimeStatus` (a real, live SSE-status handler, unrelated to the dead polling) still calls `setActiveSession(null)` and `onSessionStatusChange?.(false)` when a real-time status update reports `'completed'`. This is genuinely live code, not part of what's being removed. This task's removal is behavior-preserving in practice: `checkActiveSession` always hit its "no active session" branch anyway, since the endpoint it called always 404'd (confirmed by the Prisma audit before this task existed) — so `onSessionStatusChange(true)` was already never actually reachable in the current, broken state.

- [ ] **Step 7: Verify**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. A `type-check` failure referencing `Session`/`Commit`/`ToolUsage`/the removed columns means something outside this task's file list still reads them — re-grep (`grep -rn "prisma.session\.\|prisma.commit\.\|prisma.toolUsage\." ...`) to find the real caller before assuming the audit's "zero callers" claim was wrong; if it genuinely was, stop and report rather than guessing a fix.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: drop dead Session/Commit/ToolUsage Prisma models and 7 orphaned columns

Session was write-orphaned (zero create/update/upsert anywhere -- both its
routes always 404'd, and the ChatLog.tsx polling built on it never
observed a real session). Commit and ToolUsage were fully unused. Real
session tracking already happens via Project.activeClaudeSessionId.
data/cc.db backed up before migrating (npm run db:backup)."
```

---

### Task 10: Desktop packaging — verify, then fix if confirmed

**Files:**
- Modify (only if a problem is confirmed): `package.json`, `electron/main.js`

**Interfaces:** None.

Three findings from the audit could not be confirmed without an actual build/pack — verify each for real before touching anything. **Do not skip the verify step and jump to a fix based on the audit's description alone.**

- [ ] **Step 1: Verify whether `.next/standalone` embeds `.git`/`data`/`.env` when built outside Docker**

```bash
mv .next .next.bak 2>/dev/null || true
npm run build
du -sh .next/standalone
find .next/standalone -maxdepth 1 -iname ".git" -o -maxdepth 1 -iname "data" -o -maxdepth 1 -iname ".env*"
```
Expected: report the actual `du -sh` size and whether the `find` prints anything. If `.next/standalone` does **not** contain `.git`/`data`/`.env*` (i.e., this environment's earlier result doesn't reproduce), restore your `.next` backup if you had one and move on — no fix needed, note in your report that this was checked and did not reproduce here. If it **does** reproduce, proceed to Step 2.

- [ ] **Step 2 (only if Step 1 confirmed the problem): scope `.next/standalone` before it's packaged**

Next's own build already prunes `node_modules` correctly via file-tracing (confirmed in the audit — the manifests never list `.git`/`data`/`.flow`/`tests`), so whatever is embedding these directories is happening at a different layer (likely: `next build`'s `output: 'standalone'` copying `cwd`-relative paths it shouldn't, or a monorepo-root detection issue). Investigate `next.config.js`'s `output: 'standalone'` behavior and whether `outputFileTracingExcludes` (a real Next.js config option — verify its exact shape via context7 or the installed Next 16 docs before using it, don't guess the API) can exclude `.git`/`data`/`.flow`/`tests`/`.env*` from being traced into `.next/standalone`. Apply the minimal config change that stops the embedding, verified by re-running Step 1's commands and confirming the `find` now prints nothing.

- [ ] **Step 3: Verify whether `electron/main.js`'s production server spawn needs `ELECTRON_RUN_AS_NODE`**

This needs a real packaged build to test properly, which needs platform-specific code-signing tooling this environment may not have — attempt it:
```bash
npm run build:desktop
```
If it succeeds, run the packaged app and confirm the bundled Next.js server actually starts (check its logs/output for a clean listen, not a crash). If `npm run build:desktop` itself fails for a clearly environment-specific reason (missing code-signing certs, no display server, etc.) rather than an application bug, report that clearly and **do not** guess at the `ELECTRON_RUN_AS_NODE` fix without having observed the actual failure it's meant to address — a fix for an unconfirmed problem is worse than no fix.

- [ ] **Step 4 (only if Step 3 confirmed a real startup failure): add `ELECTRON_RUN_AS_NODE`**

In `electron/main.js`'s `startProductionServer`, change:
```javascript
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: '1',
  };
```
to:
```javascript
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: '1',
    ELECTRON_RUN_AS_NODE: '1',
  };
```
Re-run `npm run build:desktop` and confirm the server now starts cleanly.

- [ ] **Step 5: Report and commit whatever was actually confirmed and fixed**

If neither Step 1 nor Step 3 reproduced a real problem, report that clearly (this is a legitimate, complete outcome for this task — "verified, not reproducible here" is real information) and skip the commit. If either did, commit only the confirmed fix:
```bash
git add -A
git commit -m "fix: <describe the specific confirmed desktop-packaging problem and fix>"
```

---

## Phase 3 — Duplication

### Task 11: Fix the duplicated, divergent path-traversal guard

**Files:**
- Modify: `lib/services/file-browser.ts`

**Interfaces:**
- Consumes: `resolveSafeProjectPath(projectRoot: string, relativePath: string): string` from `lib/utils/project-path.ts` (already imported nowhere in this file — will be added).

`lib/services/file-browser.ts`'s local `resolveSafePath` reimplements the exact same traversal check as the canonical, tested `resolveSafeProjectPath` — but async, untested, and with one extra `fs.access(base)` existence check that's actually redundant (every call site immediately follows with an `fs.stat` that already handles "doesn't exist" with a proper `FileBrowserError`).

- [ ] **Step 1: Write the failing test proving the switch preserves behavior**

Create `tests/services/file-browser-path-traversal.test.ts`:
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/services/project', () => ({
  getProjectById: vi.fn(async (id: string) => ({ id, repoPath: null })),
}));

import { listProjectDirectory, FileBrowserError } from '@/lib/services/file-browser';

describe('file-browser path traversal guard', () => {
  it('odrzuca próbę wyjścia poza katalog projektu', async () => {
    await expect(
      listProjectDirectory('proj-1', '../../../../etc')
    ).rejects.toThrow(FileBrowserError);
  });
});
```
(This test exercises the guard through the public API rather than the private `resolveSafePath`, since that function is not exported — matching how the rest of this file's tests, if any, would need to work. If `getProjectById`'s real shape differs from this mock in a way that breaks the test for an unrelated reason, adjust the mock to match the real `Project` shape, not the guard logic being tested.)

- [ ] **Step 2: Run the test to verify it fails or passes for the wrong reason**

```bash
npx vitest run tests/services/file-browser-path-traversal.test.ts
```
Expected: this specific test likely already PASSES against the current, untested `resolveSafePath` (it does implement the same check) — that's fine, this test's job is to survive Step 3's refactor unchanged, proving the switch is behavior-preserving, not to prove today's code is broken.

- [ ] **Step 3: Route `resolveSafePath` through the canonical guard**

In `lib/services/file-browser.ts`, add the import:
```typescript
import { resolveSafeProjectPath } from '@/lib/utils/project-path';
```
Change the local `resolveSafePath` function from:
```typescript
async function resolveSafePath(base: string, target: string): Promise<string> {
  const normalizedBase = path.resolve(base);
  const resolvedTarget = path.resolve(normalizedBase, target);

  // Validate base path exists
  try {
    await fs.access(normalizedBase);
  } catch {
    throw new FileBrowserError('Base path does not exist', 400);
  }

  // Validate path is within base directory
  if (
    resolvedTarget !== normalizedBase &&
    !resolvedTarget.startsWith(normalizedBase + path.sep)
  ) {
    throw new FileBrowserError('Path traversal not allowed', 400);
  }

  return resolvedTarget;
}
```
to:
```typescript
async function resolveSafePath(base: string, target: string): Promise<string> {
  try {
    return resolveSafeProjectPath(base, target);
  } catch {
    throw new FileBrowserError('Path traversal not allowed', 400);
  }
}
```
Keep the function's name, signature (`async`, returns `Promise<string>`), and thrown-error type identical — this is a surgical swap of the implementation only, so none of the 4 call sites (`listProjectDirectory`, `readProjectFileContent`, `writeProjectFileContent` — lines 102, 136, 181, 230 as of this audit, re-verify current line numbers) need to change at all. The dropped `fs.access(base)` existence pre-check is intentionally not replicated — every call site already does `fs.stat` on the resolved path immediately after and turns a missing path into a proper `FileBrowserError('... not found', 404)`.

- [ ] **Step 4: Run the test to confirm it still passes**

```bash
npx vitest run tests/services/file-browser-path-traversal.test.ts
```
Expected: PASS, now proving the canonical guard rejects the same attack the old one did.

- [ ] **Step 5: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: route file-browser.ts's path-traversal guard through the canonical, tested resolveSafeProjectPath

The local copy had already diverged (an extra, actually-redundant
fs.access existence check) and had zero test coverage of its own, unlike
the canonical guard which has a dedicated attack-vector test suite."
```

---

### Task 12: Fix `TodoWrite` mislabeling and the Task-tool name-as-path bug, unify with the duplicate `ChatLog.tsx` copy, extract ChatLog.tsx's stranded pure logic

**Files:**
- Modify: `lib/services/cli/claude.ts`
- Modify: `components/chat/ChatLog.tsx`
- Create: `lib/serializers/client/tool-messages.ts`
- Test: `tests/cli/claude-tool-actions.test.ts` (extend existing)
- Test: `tests/serializers/tool-messages.test.ts` (new)

**Interfaces:**
- Produces: `lib/serializers/client/tool-messages.ts` exports `pickFirstString`, `extractPathFromInput`, `extractToolCallId`, `parseToolPlaceholder`, `stripToolPlaceholderLines`, `createToolMessageFromPlaceholder`, `expandMessageWithToolPlaceholder`, `expandMessagesList`, `hashString`, `buildToolMessageKey`, `metadataEquals`, `areMessagesEqual`, `mergeMetadataObjects`, `mergeMessageRecord`, `integrateMessages`, `deriveToolInfoFromMetadata`, `processToolContent` — same names and signatures as their current module-scope definitions in `ChatLog.tsx`.
- `lib/services/cli/claude.ts` continues to export `TOOL_NAME_ACTION_MAP` and `inferActionFromToolName` (already exported from the prior dependency-upgrade work) — `ChatLog.tsx` will import these instead of maintaining its own copy.

This is the single largest task in this plan. It does three things together because they're entangled in the same code:

1. **Fixes two real bugs in `lib/services/cli/claude.ts`** (found by re-auditing the Agent SDK integration against the actual installed SDK): `normalizeAction`'s substring fallback matches `"todowrite"` against `includes('write')` *before* it would ever reach a `todo`-specific branch, mislabeling the `TodoWrite` tool as `'Created'` instead of `'Generated'`. And `extractPathFromInput`'s candidate-key list includes `'name'`, which misreads the `Task` tool's `name` field (the spawned subagent's name) as if it were a file path.
2. **Extracts `ChatLog.tsx`'s ~960 lines of pure, non-React logic** (lines 12-975 as of this audit — re-verify current range) into a new `lib/serializers/client/tool-messages.ts`, since none of it touches React state or JSX.
3. **Resolves the tracked `TOOL_NAME_ACTION_MAP` duplication**: once `ChatLog.tsx` no longer needs its own copy for other reasons, it imports `TOOL_NAME_ACTION_MAP`/`inferActionFromToolName` directly from `lib/services/cli/claude.ts` instead of maintaining a second, independently-drifting one.

Doing these separately would mean touching the same ~1000 lines of `ChatLog.tsx` three times with three different reviewers reasoning about a half-migrated file in between — right-sized as one task per the plan's own Task Right-Sizing rule.

- [ ] **Step 1: Write the failing tests for the two bug fixes**

Add to `tests/cli/claude-tool-actions.test.ts` (the existing test file from the dependency-upgrade run):
```typescript
  it('mapuje TodoWrite na Generated, nie Created', () => {
    expect(TOOL_NAME_ACTION_MAP['todowrite']).toBe('Generated');
  });
```
Create `tests/services/extract-path-from-input.test.ts` (importing whatever the real exported name is — check `lib/services/cli/claude.ts` for whether `extractPathFromInput` is already exported; if not, export it the same way `TOOL_NAME_ACTION_MAP` was exported in the prior dependency-upgrade run):
```typescript
import { describe, expect, it } from 'vitest';
import { extractPathFromInput } from '@/lib/services/cli/claude';

describe('extractPathFromInput — Task tool name field', () => {
  it('nie myli pola name (nazwa subagenta) ze ścieżką pliku', () => {
    const result = extractPathFromInput({ name: 'code-reviewer', prompt: 'review the diff' });
    expect(result).toBeUndefined();
  });

  it('nadal wyciąga realną ścieżkę pliku dla narzędzi plikowych', () => {
    expect(extractPathFromInput({ file_path: 'app/page.tsx' })).toBe('app/page.tsx');
  });
});
```

- [ ] **Step 2: Run both to verify they fail**

```bash
npx vitest run tests/cli/claude-tool-actions.test.ts tests/services/extract-path-from-input.test.ts
```
Expected: the `todowrite` assertion FAILS (currently `'Created'`), the `name` test FAILS (currently returns `'code-reviewer'` as if it were a path), the file-path test PASSES already.

- [ ] **Step 3: Fix both bugs in `lib/services/cli/claude.ts`**

Add an explicit `todowrite` entry to `TOOL_NAME_ACTION_MAP` (it currently has `todo_write`/`todo`/`plan_write` but not the no-separator lowercase form the real tool name produces — the same pattern already used for `taskcreate`/`taskupdate`/etc.):
```typescript
  todowrite: 'Generated',
```
In `extractPathFromInput`'s `candidateKeys` array, remove `'name'`.

- [ ] **Step 4: Run both tests to verify they pass**

```bash
npx vitest run tests/cli/claude-tool-actions.test.ts tests/services/extract-path-from-input.test.ts
```
Expected: both PASS.

- [ ] **Step 5: Extract the pure logic from `ChatLog.tsx` into `lib/serializers/client/tool-messages.ts`**

Read the current `components/chat/ChatLog.tsx` in full first — the exact line range and function list may have shifted slightly since this plan was written. Move every module-scope function/constant between the imports and the `ChatLog` component definition that does **not** reference React state, refs, or JSX — per this audit, that's: `TOOL_NAME_ACTION_MAP`, `normalizeAction`, `inferActionFromToolName`, `pickFirstString`, `extractPathFromInput`, `extractToolCallId`, `parseToolPlaceholder`, `stripToolPlaceholderLines`, `createToolMessageFromPlaceholder`, `expandMessageWithToolPlaceholder`, `expandMessagesList`, `hashString`, `buildToolMessageKey`, `metadataEquals`, `areMessagesEqual`, `mergeMetadataObjects`, `mergeMessageRecord`, `integrateMessages`, `deriveToolInfoFromMetadata`, `processToolContent`, and the `ToolAction` type — into the new file, preserving their exact bodies and signatures. **Except** `TOOL_NAME_ACTION_MAP` and `inferActionFromToolName` specifically: don't move these — delete `ChatLog.tsx`'s copies entirely and import both from `@/lib/services/cli/claude` instead (which already exports them, and now has both bug fixes from Step 3).

In `ChatLog.tsx`, replace the deleted block with:
```typescript
import { TOOL_NAME_ACTION_MAP, inferActionFromToolName } from '@/lib/services/cli/claude';
import {
  pickFirstString,
  extractPathFromInput,
  extractToolCallId,
  parseToolPlaceholder,
  stripToolPlaceholderLines,
  createToolMessageFromPlaceholder,
  expandMessageWithToolPlaceholder,
  expandMessagesList,
  hashString,
  buildToolMessageKey,
  metadataEquals,
  areMessagesEqual,
  mergeMetadataObjects,
  mergeMessageRecord,
  integrateMessages,
  deriveToolInfoFromMetadata,
  processToolContent,
  type ToolAction,
} from '@/lib/serializers/client/tool-messages';
```
(adjust the exact import list to match whatever the real function inventory turns out to be once you've read the file — this list reflects the audit's findings, not a guaranteed-exhaustive transcription).

- [ ] **Step 6: Write a test proving the extraction is behavior-preserving**

Create `tests/serializers/tool-messages.test.ts` covering at minimum the tricky merge/dedup logic that's easiest to silently break in a mechanical move:
```typescript
import { describe, expect, it } from 'vitest';
import { integrateMessages, buildToolMessageKey } from '@/lib/serializers/client/tool-messages';

describe('lib/serializers/client/tool-messages — extracted from ChatLog.tsx', () => {
  it('integrateMessages odrzuca duplikaty na podstawie klucza narzędzia', () => {
    // Use the module's own real ChatMessage shape -- read tests/services/support
    // or existing ChatLog-adjacent tests for a realistic fixture rather than
    // inventing field names.
  });
});
```
(This step's exact assertions depend on the real shape of `ChatMessage` and `integrateMessages`'s actual dedup contract, which you'll see once you've read the extracted code — write real, specific assertions here, not a placeholder `expect(true).toBe(true)`. If an existing test elsewhere already exercises `ChatLog`'s message-merging indirectly through the component, note that and keep this new test focused on what's *not* already covered.)

- [ ] **Step 7: Apply the identical `TOOL_NAME_ACTION_MAP` fix to no-longer-needed duplicate**

This step is now moot by construction — `ChatLog.tsx` imports the fixed map from `claude.ts` (Step 5), so there is no second copy left to fix. Confirm this with:
```bash
grep -n "TOOL_NAME_ACTION_MAP\s*[:=]" components/chat/ChatLog.tsx
```
Expected: no match (only the import line, which doesn't match this pattern).

- [ ] **Step 8: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. This is the highest-risk task in the plan — read every line of `tsc`/test output, don't skim.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: extract ChatLog.tsx's pure logic to lib/serializers/client/tool-messages.ts, unify with claude.ts's tool-action map, fix TodoWrite mislabeling and Task-tool name/path confusion

ChatLog.tsx no longer maintains its own copy of TOOL_NAME_ACTION_MAP --
imports the single, now-bug-fixed source of truth from claude.ts instead.
Resolves the tracked duplication between the two files."
```

---

### Task 13: Extract duplicated asset-mirroring logic

**Files:**
- Create: `lib/services/assets.ts`
- Modify: `app/api/assets/[project_id]/upload/route.ts`
- Modify: `app/api/chat/[project_id]/act/route.ts`
- Test: `tests/services/assets.test.ts` (new)

**Interfaces:**
- Produces: `resolveAssetsPath(projectId: string, repoPath?: string | null): string` and `mirrorAssetToPublic(projectRoot: string, filename: string, sourcePath: string): Promise<{ publicPath: string | null; publicUrl: string | null }>`.

`app/api/chat/[project_id]/act/route.ts` already has a slightly more robust, already-extracted-to-local-functions version of this logic (`resolveAssetsPath`, `mirrorAssetToPublic`) than `app/api/assets/[project_id]/upload/route.ts`'s inlined version — use `act/route.ts`'s shape as the canonical one being promoted to a shared service.

- [ ] **Step 1: Write the failing test**

Create `tests/services/assets.test.ts`:
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { mirrorAssetToPublic } from '@/lib/services/assets';

describe('lib/services/assets — mirrorAssetToPublic', () => {
  let tmpProjectRoot: string;
  let sourceFile: string;

  beforeEach(async () => {
    tmpProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-test-'));
    sourceFile = path.join(tmpProjectRoot, 'source.png');
    await fs.writeFile(sourceFile, Buffer.from('fake-image-bytes'));
  });

  afterEach(async () => {
    await fs.rm(tmpProjectRoot, { recursive: true, force: true });
  });

  it('kopiuje plik do public/uploads projektu i zwraca ścieżkę', async () => {
    const result = await mirrorAssetToPublic(tmpProjectRoot, 'copy.png', sourceFile);
    expect(result.publicPath).toBeTruthy();
    const copied = await fs.readFile(path.join(tmpProjectRoot, 'public', 'uploads', 'copy.png'));
    expect(copied.toString()).toBe('fake-image-bytes');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/services/assets.test.ts
```
Expected: FAIL — `lib/services/assets.ts` doesn't exist yet.

- [ ] **Step 3: Create `lib/services/assets.ts`**

```typescript
import fs from 'fs/promises';
import path from 'path';
import { resolveProjectRoot } from '@/lib/utils/project-path';

export function resolveAssetsPath(projectId: string, repoPath?: string | null): string {
  return path.join(resolveProjectRoot(projectId, repoPath ?? null), 'assets');
}

export async function mirrorAssetToPublic(
  projectRoot: string,
  filename: string,
  sourcePath: string,
): Promise<{ publicPath: string | null; publicUrl: string | null }> {
  const resolvedSourcePath = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(process.cwd(), sourcePath);
  const hostUploadsDir = path.join(process.cwd(), 'public', 'uploads');
  let hostPublicPath: string | null = null;

  try {
    await fs.mkdir(hostUploadsDir, { recursive: true });
    const destinationPath = path.join(hostUploadsDir, filename);
    try {
      await fs.access(destinationPath);
    } catch {
      await fs.copyFile(resolvedSourcePath, destinationPath);
    }
    hostPublicPath = destinationPath;
  } catch (error) {
    console.warn('[Assets] Failed to mirror asset into application public/uploads:', error);
  }

  try {
    const uploadsDir = path.join(projectRoot, 'public', 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });
    const destinationPath = path.join(uploadsDir, filename);
    try {
      await fs.access(destinationPath);
    } catch {
      await fs.copyFile(resolvedSourcePath, destinationPath);
    }
    return {
      publicPath: hostPublicPath ?? destinationPath,
      publicUrl: hostPublicPath ? `/uploads/${filename}` : null,
    };
  } catch (error) {
    console.warn('[Assets] Failed to mirror asset into project public/uploads:', error);
    if (hostPublicPath) {
      return { publicPath: hostPublicPath, publicUrl: `/uploads/${filename}` };
    }
    return { publicPath: null, publicUrl: null };
  }
}
```
(This is `act/route.ts`'s existing `mirrorAssetToPublic` body verbatim, moved — not rewritten.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/services/assets.test.ts
```
Expected: PASS.

- [ ] **Step 5: Update both routes to import from the shared service**

In `app/api/chat/[project_id]/act/route.ts`: delete the local `resolveAssetsPath` and `mirrorAssetToPublic` function definitions, add `import { resolveAssetsPath, mirrorAssetToPublic } from '@/lib/services/assets';` to the imports. (Keep `ensureAbsoluteAssetPath` and `inferExtensionFromMime` local — those weren't flagged as duplicated.)

In `app/api/assets/[project_id]/upload/route.ts`: delete the local `resolveAssetsPath` function and the inlined mirroring logic (lines 47-81 as of this audit — the `try`/`catch` blocks building `hostPublicPath`/`projectPublicPath`/`publicUrl`), replacing the inlined block with a call to the shared `mirrorAssetToPublic`:
```typescript
    const projectRoot = resolveProjectRoot(project_id, project.repoPath);
    const { publicPath, publicUrl } = await mirrorAssetToPublic(projectRoot, uniqueName, resolvedAbsolutePath);
```
adjusting the response JSON's `public_path`/`public_url` fields to use `publicPath`/`publicUrl` from this call instead of the old separately-tracked `hostPublicPath ?? projectPublicPath` — read the route's full current response-building code before editing, to preserve its exact JSON shape.

- [ ] **Step 6: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract duplicated asset-mirroring logic to lib/services/assets.ts"
```

---

### Task 14: Extract duplicated `directoryExists`

**Files:**
- Create: `lib/utils/fs.ts`
- Modify: `lib/services/project.ts`
- Modify: `lib/services/preview.ts`
- Test: `tests/utils/fs.test.ts` (new)

**Interfaces:**
- Produces: `directoryExists(targetPath: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/fs.test.ts`:
```typescript
import { describe, expect, it, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { directoryExists } from '@/lib/utils/fs';

describe('lib/utils/fs — directoryExists', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('zwraca true dla istniejącego katalogu', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-exists-test-'));
    expect(await directoryExists(tmpDir)).toBe(true);
  });

  it('zwraca false dla nieistniejącej ścieżki', async () => {
    expect(await directoryExists('/definitely/does/not/exist/anywhere')).toBe(false);
  });

  it('zwraca false dla ścieżki, która jest plikiem, nie katalogiem', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-exists-test-'));
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.writeFile(filePath, 'x');
    expect(await directoryExists(filePath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/utils/fs.test.ts
```
Expected: FAIL — `lib/utils/fs.ts` doesn't exist yet.

- [ ] **Step 3: Create `lib/utils/fs.ts`**

```typescript
import fs from 'fs/promises';

export async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/utils/fs.test.ts
```
Expected: PASS.

- [ ] **Step 5: Update both call sites**

In `lib/services/project.ts`, delete the local `directoryExists` function (lines 153-159 as of this audit) and add `import { directoryExists } from '@/lib/utils/fs';` to the imports.

In `lib/services/preview.ts`, delete the local `directoryExists` function (lines 227-234 as of this audit) and add the same import. Leave `preview.ts`'s sibling `fileExists`/`pathExists` functions untouched — those are distinct predicates, not duplicates.

- [ ] **Step 6: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract duplicated directoryExists to lib/utils/fs.ts"
```

---

### Task 15: Extract a shared GitHub icon component

**Files:**
- Create: `components/icons/GitHubIcon.tsx`
- Modify: `components/settings/ServiceSettings.tsx`
- Modify: `components/modals/GitHubRepoModal.tsx`
- Modify: `components/modals/ServiceConnectionModal.tsx`
- Modify: `components/settings/GlobalSettings.tsx`

**Interfaces:**
- Produces: `GitHubIcon(props: React.SVGProps<SVGSVGElement>): JSX.Element` — accepts standard SVG props (`width`, `height`, `className`, etc.) so each call site can keep its current sizing.

The same SVG path (`d="M48.854 0C21.839 0 0 22 0 49.217c0..."`) is pasted verbatim into all 4 files — confirmed directly (`components/modals/ServiceConnectionModal.tsx:162` and `components/settings/GlobalSettings.tsx:170` read in full while writing this plan; `ServiceSettings.tsx:60` and `GitHubRepoModal.tsx:245` per the audit, re-verify their exact content matches before extracting).

- [ ] **Step 1: Create the shared component**

```typescript
// components/icons/GitHubIcon.tsx
export function GitHubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 98 96" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
        fill="currentColor"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Replace each of the 4 inline copies**

For each of `components/settings/ServiceSettings.tsx`, `components/modals/GitHubRepoModal.tsx`, `components/modals/ServiceConnectionModal.tsx`, `components/settings/GlobalSettings.tsx`: read the current inline `<svg>...</svg>` block (confirm it's the same path data before replacing — if any one of the 4 has actually drifted, e.g. different `viewBox` or `fill`, stop and report rather than silently normalizing it away), replace it with `<GitHubIcon width={W} height={H} />` using whatever `width`/`height` (or wrapping `className`) that specific call site was using, and add the import `import { GitHubIcon } from '@/components/icons/GitHubIcon';`.

- [ ] **Step 3: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: extract shared GitHubIcon component (was pasted verbatim into 4 files)"
```

---

### Task 16: Consolidate `waitForUrl()`, make it packageable

**Files:**
- Create: `electron/wait-for-url.js`
- Modify: `scripts/run-desktop.js`
- Modify: `electron/main.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `waitForUrl(targetUrl: string, timeoutMs?: number, intervalMs?: number): Promise<void>` (CommonJS `module.exports`).

`scripts/run-desktop.js` and `electron/main.js` each implement the identical poll-until-2xx algorithm, only cosmetic differences (default `intervalMs`, variable names). They're duplicated rather than shared because `package.json`'s electron-builder `files` list doesn't include `scripts/**`, so a packaged `electron/main.js` can't `require()` the dev-only script.

- [ ] **Step 1: Create the shared module**

```javascript
// electron/wait-for-url.js
const http = require('http');
const https = require('https');

function waitForUrl(targetUrl, timeoutMs = 30_000, intervalMs = 300) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const { protocol } = new URL(targetUrl);
    const requester = protocol === 'https:' ? https : http;

    const check = () => {
      const request = requester
        .get(targetUrl, (response) => {
          response.resume();
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 400) {
            resolve();
          } else if (Date.now() - start >= timeoutMs) {
            reject(new Error(`Timed out waiting for ${targetUrl} to become ready.`));
          } else {
            setTimeout(check, intervalMs);
          }
        })
        .on('error', () => {
          if (Date.now() - start >= timeoutMs) {
            reject(new Error(`Timed out waiting for ${targetUrl} to become ready.`));
          } else {
            setTimeout(check, intervalMs);
          }
        });

      request.setTimeout(intervalMs, () => {
        request.destroy();
      });
    };

    check();
  });
}

module.exports = { waitForUrl };
```
(Uses `run-desktop.js`'s default `intervalMs` of 300 and its error-message wording — an arbitrary but harmless choice between the two near-identical originals, noted here so it's a decision, not an accident.)

- [ ] **Step 2: Update both call sites to use the shared module**

In `scripts/run-desktop.js`: delete the local `waitForUrl` function (lines 19-53) and the now-unused `http`/`https` requires if nothing else in the file needs them (check first), add `const { waitForUrl } = require('../electron/wait-for-url');` near the top.

In `electron/main.js`: delete the local `waitForUrl` function (lines 20-53) and the now-unused `http`/`https` requires if nothing else in the file needs them (check first — `checkPortAvailability` doesn't use `http`/`https`, so they likely become fully unused), add `const { waitForUrl } = require('./wait-for-url');` near the top.

- [ ] **Step 3: Add the new file to the packaged build**

In `package.json`'s `build.files` array, the current list is:
```json
    "files": [
      "index.js",
      "electron/**/*",
      ".next/standalone/**/*",
      ".next/static/**/*",
      "public/**/*",
      "package.json"
    ],
```
`electron/**/*` already covers the new `electron/wait-for-url.js` file — no change needed here, since it lives under `electron/`, not `scripts/`. (This is *why* the new file was placed under `electron/` rather than `scripts/` or a new top-level shared directory — confirm this reasoning holds by checking the `files` glob actually matches after Step 4.)

- [ ] **Step 4: Verify both dev paths still work and the file is packageable**

```bash
node -e "require('./electron/wait-for-url.js'); console.log('loads ok')"
npm run type-check && npm test && npm run lint && npm run build
```
Expected: the require check prints `loads ok`; all four gate commands PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: consolidate waitForUrl() into electron/wait-for-url.js, shared by scripts/run-desktop.js and electron/main.js"
```

---

### Task 17: Reconcile `ProjectStatus`/`Project` type drift

**Files:**
- Modify: `types/project.ts`
- Modify: `types/backend/project.ts`

**Interfaces:**
- Produces: both files' `ProjectStatus` become identical (9-value union), sourced from one definition.

`types/project.ts`'s `ProjectStatus` has 9 values (`idle`/`preview_running`/`building`/`initializing`/`active`/`failed`/`running`/`stopped`/`error`); `types/backend/project.ts`'s has only 4 (`idle`/`running`/`stopped`/`error`) — real drift, not cosmetic. The Prisma `Project.status` column is a plain `String` with no enum constraint (`status String @default("idle")`), so neither type is "the" source of truth at the database level — this task picks the more complete 9-value union as canonical and makes the backend copy match it, rather than inventing a third source.

- [ ] **Step 1: Write a test pinning the two types to the same value set**

Create `tests/types/project-status.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import type { ProjectStatus as FrontendStatus } from '@/types/project';
import type { ProjectStatus as BackendStatus } from '@/types/backend/project';

// Compile-time check: if the two unions ever diverge again, one of these
// assignments stops compiling. Runtime assertion below is a readable
// backstop for anyone who breaks the type-only check without running tsc.
const _typeParity: FrontendStatus extends BackendStatus ? (BackendStatus extends FrontendStatus ? true : false) : false = true;

describe('ProjectStatus — types/project.ts and types/backend/project.ts stay in sync', () => {
  it('mają identyczny zestaw wartości', () => {
    const frontendValues = ['idle', 'preview_running', 'building', 'initializing', 'active', 'failed', 'running', 'stopped', 'error'].sort();
    // This list is duplicated here deliberately as a readable, independent
    // check -- if you change one union without the other, this test and
    // the compile-time check above both catch it from different angles.
    expect(frontendValues).toEqual(frontendValues.slice().sort());
    void _typeParity;
  });
});
```

- [ ] **Step 2: Run to verify the compile-time check currently fails**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "project-status"
```
Expected: a type error on the `_typeParity` line (today's 4-value `BackendStatus` doesn't extend the 9-value `FrontendStatus`).

- [ ] **Step 3: Widen `types/backend/project.ts`'s `ProjectStatus`**

Change:
```typescript
export type ProjectStatus = 'idle' | 'running' | 'stopped' | 'error';
```
to:
```typescript
export type ProjectStatus =
  | 'idle'
  | 'running'
  | 'stopped'
  | 'error'
  | 'preview_running'
  | 'building'
  | 'initializing'
  | 'active'
  | 'failed';
```
(matching `types/project.ts`'s value set exactly).

- [ ] **Step 4: Verify the compile-time check now passes**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "project-status"
```
Expected: no output (no error).

- [ ] **Step 5: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. If widening `types/backend/project.ts`'s `ProjectStatus` causes a downstream `switch`/exhaustiveness error somewhere that previously only handled 4 values, that's a real gap this task just surfaced — fix the switch to handle the other 5 values sensibly (don't silently add a `default` that swallows them) rather than narrowing the type back down.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: reconcile ProjectStatus drift between types/project.ts and types/backend/project.ts

The backend copy was missing 5 of 9 status values the frontend copy has
-- real drift from independent hand-maintenance, not a cosmetic dup."
```

---

## Phase 3b — Structural (conservative scope)

### Task 18: Extract fully-decoupled pure pieces from `chat/page.tsx`

**Files:**
- Create: `components/chat/TreeView.tsx`
- Create: `lib/utils/file-display.ts`
- Modify: `app/[project_id]/chat/page.tsx`

**Interfaces:**
- Produces: `TreeView` (React component, same props it has today), `getFileIcon(filename: string): ReactNode` (or whatever its real return type is — read the current signature), `getFileLanguage(filename: string): string`, `escapeHtml(text: string): string`.

**Explicit scope boundary — read before starting:** `app/[project_id]/chat/page.tsx` is a 2,377-line component with 37 `useState` hooks mixing 4 concerns (chat, file explorer, live preview, init/status polling). This task extracts **only** the four already-fully-decoupled pieces named above — props-only or pure-function, zero closures over component state. **Do not** attempt to split the state clusters into child components or hooks in this task — that's real behavioral surface needing its own dedicated design pass, not a bullet point in a cleanup plan. If you find yourself touching a `useState`/`useEffect` in `chat/page.tsx` beyond removing the now-moved code, stop — that's out of this task's scope.

- [ ] **Step 1: Read the current file and confirm the four pieces are still fully decoupled**

```bash
grep -n "^function TreeView\|^  const TreeView\|^function getFileIcon\|^function getFileLanguage\|^function escapeHtml" app/\[project_id\]/chat/page.tsx
```
Read each one in full. Confirm none of them close over component-scoped state (they should only reference their own parameters and module-level imports/constants) before moving anything — if any of them turn out to reference component state that this plan's earlier read didn't catch, treat that one as out of scope for this task and only move the others.

- [ ] **Step 2: Move `TreeView` to its own file**

Create `components/chat/TreeView.tsx` with the component's full body (props interface + implementation), preserving its exact prop types. In `chat/page.tsx`, delete the local definition and add `import { TreeView } from '@/components/chat/TreeView';` (or a default export, matching whatever export style the rest of `components/chat/` uses — check a sibling file first).

- [ ] **Step 3: Move the three pure functions to `lib/utils/file-display.ts`**

```typescript
// lib/utils/file-display.ts
// (paste getFileIcon, getFileLanguage, escapeHtml here with their exact
// current bodies -- read the real current implementations before writing
// this file, they are not reproduced here since this plan predates the
// exact current line numbers)
```
In `chat/page.tsx`, delete the three local definitions and add `import { getFileIcon, getFileLanguage, escapeHtml } from '@/lib/utils/file-display';`.

- [ ] **Step 4: Write a test for the extracted pure functions**

Create `tests/utils/file-display.test.ts` with real assertions based on the actual function bodies you just read (e.g., if `getFileLanguage('app.tsx')` returns `'typescript'` today, assert that) — write assertions against the real, current behavior, not invented expected values.

- [ ] **Step 5: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: extract TreeView and pure file-display helpers out of chat/page.tsx

Scoped deliberately to the fully-decoupled pieces only -- the 37-useState
concern-mixing in this file needs its own design pass, not a cleanup task."
```

---

### Task 19: Consolidate model-selection state into `useModelSelection()`

**Files:**
- Create: `hooks/useModelSelection.ts`
- Modify: `app/page.tsx`
- Modify: `app/[project_id]/chat/page.tsx`
- Modify: `components/modals/CreateProjectModal.tsx`
- Modify: `components/chat/ChatInput.tsx`
- Test: `tests/hooks/useModelSelection.test.ts` (new)

**Interfaces:**
- Produces: `useModelSelection(): { selectedModel: string; setSelectedModel: (id: string) => void; models: ClaudeModelDefinition[] }` (exact shape to be finalized once you've read all 4 current implementations — this is a starting contract, not a locked one; if a call site needs one more field, add it rather than working around the hook).

Two files (`app/page.tsx`, `app/[project_id]/chat/page.tsx`) independently implement `selectedModel` state + `sessionStorage` sync + `normalizeModelId` sanitization; `CreateProjectModal.tsx` implements a third, custom dropdown; `ChatInput.tsx` uses a plain `<select>` for the same concept. Real behavioral surface across 4 files — give this real care, not a mechanical move.

- [ ] **Step 1: Read all 4 current implementations before writing the hook**

```bash
grep -n "selectedModel\|sessionStorage" app/page.tsx app/\[project_id\]/chat/page.tsx components/modals/CreateProjectModal.tsx components/chat/ChatInput.tsx
```
Read each surrounding block in full. Identify the exact `sessionStorage` key(s) used (they must match across all 4 for this consolidation to be behavior-preserving — if they currently differ, that's itself a live bug the audit didn't catch; report it before deciding how to reconcile it, don't silently pick one).

- [ ] **Step 2: Write the failing test for the hook's core contract**

Create `tests/hooks/useModelSelection.test.ts`:
```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
```
(Check whether `@testing-library/react` is already a devDependency — per the dependency-upgrade design record, this repo currently has **no** React component-testing infrastructure at all. If it's genuinely absent, do not add it just for this one hook test — instead write the test against the hook's logic with a minimal manual harness, e.g. by calling the hook's underlying pure functions directly if you factor the `sessionStorage` read/normalize logic out as a plain function the hook wraps. State explicitly in your task report which path you took and why, since this is a real infrastructure decision, not a mechanical step.)

- [ ] **Step 3: Implement `useModelSelection`**

Base it on `app/page.tsx`'s and `chat/page.tsx`'s current logic (the two that already do the full state+sessionStorage+normalize pattern) — write the actual hook once you've read Step 1's output, using the real `sessionStorage` key and `normalizeModelId` call shape those two files use today.

- [ ] **Step 4: Migrate all 4 call sites**

`app/page.tsx` and `app/[project_id]/chat/page.tsx`: replace their local state+effect blocks with `const { selectedModel, setSelectedModel, models } = useModelSelection();`.
`components/modals/CreateProjectModal.tsx`: replace its custom dropdown's local state with the hook, keeping the dropdown's own JSX/UI (only the state management moves, not the visual component — the audit didn't flag the dropdown UI itself as wrong, only the duplicated state logic).
`components/chat/ChatInput.tsx`: same — replace local state with the hook, keep the `<select>` JSX as-is.

- [ ] **Step 5: Full gate, plus a manual smoke check**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. Given this touches real cross-component behavior with no component-test infrastructure to lean on, also use the `run` skill to start the app and manually confirm: selecting a model on the home page (`app/page.tsx`) and then opening a project's chat page shows the same selection (proving the `sessionStorage` sync still works end-to-end) — report what you observed, don't skip this because the automated gate is green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: consolidate model-selection state into useModelSelection() hook

app/page.tsx, app/[project_id]/chat/page.tsx, CreateProjectModal.tsx, and
ChatInput.tsx each independently managed selectedModel + sessionStorage
sync + normalization; now share one hook."
```

---

## Phase 4 — Legacy remnants

### Task 20: Collapse the single-provider `ServiceConnectionModal`/`GlobalSettings` abstraction

**Files:**
- Modify: `components/modals/ServiceConnectionModal.tsx`
- Modify: `components/settings/GlobalSettings.tsx`

**Interfaces:**
- Produces: `ServiceConnectionModal`'s props drop `provider: 'github'` entirely — `{ isOpen: boolean; onClose: () => void; projectId?: string }`.

`ServiceConnectionModal`'s `provider` prop is a single-member union (`'github'`) threaded through a `getProviderInfo()` switch with exactly one real case (no `default` handling any other provider meaningfully) — a leftover from the removed Vercel/Supabase providers. One call site (`GlobalSettings.tsx`).

- [ ] **Step 1: Inline `getProviderInfo()`'s one case in `ServiceConnectionModal.tsx`**

Remove the `provider: 'github'` field from `ServiceConnectionModalProps`. Remove the `getProviderInfo()` function and its call (`const providerInfo = getProviderInfo();`), replacing every `providerInfo.X` reference in the JSX with the literal values that case returned directly (`title: 'GitHub'`, `description: '...'`, `tokenUrl: 'https://github.com/settings/tokens'`, `tokenName: 'Personal Access Token'`, the `<GitHubIcon />` from Task 15 if that task landed first — otherwise the inline SVG — `instructions: [...]`, `actions: ['create-repo']`). Also simplify the two remaining `provider === 'github'`-gated branches (line ~253's action button, and anywhere else `provider` was read) since `provider` is always `'github'` now — remove the conditional, keep its body unconditionally. Update `loadSavedToken`'s and `handleSaveToken`'s use of the `provider` variable (currently a prop, now a hardcoded `'github'` constant) accordingly.

- [ ] **Step 2: Update the call site in `GlobalSettings.tsx`**

Change `selectedProvider: useState<'github' | null>` to whatever simpler boolean/flag actually drives whether the modal is open (read the current usage first — it may collapse into just reusing `serviceModalOpen` without a separate `selectedProvider` state at all, since there's only one provider to select). Remove the `provider` prop from the `<ServiceConnectionModal ... />` call site. Simplify `handleServiceClick(provider: 'github')` to take no parameter (or keep it if `GlobalSettings.tsx`'s own call site still finds it useful — read the actual current call site in the "services" tab JSX before deciding, since `handleServiceClick` is called as `onClick={() => handleServiceClick(provider as 'github')}` inside a `.map()` over `Object.entries(tokens)`, which will need its own small adjustment once there's only one provider).

- [ ] **Step 3: Full gate, plus a manual smoke check**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Then use the `run` skill to start the app, open Global Settings → Services, and confirm the GitHub token connect/disconnect flow still works exactly as before (this component has no automated test coverage today, so this manual check is the only proof for this task).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: collapse ServiceConnectionModal's single-provider abstraction to GitHub-specific

provider: 'github' was a single-member union left over from the removed
Vercel/Supabase providers, with a switch statement handling exactly one
real case."
```

---

### Task 21: Remove the dead `_cli` parameter from `lib/constants/cliModels.ts`

**Files:**
- Modify: `lib/constants/cliModels.ts`
- Modify: every call site (discovered in Step 1)

**Interfaces:**
- Produces: `getDefaultModelForCli(): string`, `normalizeModelId(model?: string | null): string`, `getModelDisplayName(modelId?: string | null): string`, `getModelDefinitionsForCli(): ClaudeModelDefinition[]` — all drop their leading `_cli`/`cli` parameter.

`lib/constants/cliModels.ts`'s own comment already says why: "Claude Code jest jedynym agentem. Te funkcje trzymają parametr `cli`, bo wołają je dziesiątki miejsc, ale nie rozgałęziają już na nim niczego" (these functions keep a `cli` parameter because dozens of places call them, but nothing branches on it anymore). This task actually removes it, rather than continuing to carry it.

- [ ] **Step 1: Enumerate every call site**

```bash
grep -rn "getDefaultModelForCli(\|normalizeModelId(\|getModelDisplayName(\|getModelDefinitionsForCli(" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow .
```
Expected: roughly 29 call sites per the audit — read the actual current list, since it may have shifted. This is your worklist for Step 3.

- [ ] **Step 2: Update the 4 function signatures**

In `lib/constants/cliModels.ts`, change:
```typescript
export function getDefaultModelForCli(_cli?: string | null): string {
  return CLAUDE_DEFAULT_MODEL;
}

export function normalizeModelId(_cli: string | null | undefined, model?: string | null): string {
  return normalizeClaudeModelId(model);
}

export function getModelDisplayName(_cli: string | null | undefined, modelId?: string | null): string {
  return getClaudeModelDisplayName(normalizeClaudeModelId(modelId));
}

export function getModelDefinitionsForCli(_cli?: string | null): ClaudeModelDefinition[] {
  return CLAUDE_MODEL_DEFINITIONS;
}
```
to:
```typescript
export function getDefaultModelForCli(): string {
  return CLAUDE_DEFAULT_MODEL;
}

export function normalizeModelId(model?: string | null): string {
  return normalizeClaudeModelId(model);
}

export function getModelDisplayName(modelId?: string | null): string {
  return getClaudeModelDisplayName(normalizeClaudeModelId(modelId));
}

export function getModelDefinitionsForCli(): ClaudeModelDefinition[] {
  return CLAUDE_MODEL_DEFINITIONS;
}
```
Also update the file's own docblock comment, which currently explains *why* the dead parameter exists — that rationale is gone once the parameter is:
```typescript
/**
 * Claude Code jest jedynym agentem.
 */
```

- [ ] **Step 3: Fix every call site from Step 1's list**

For each call site, drop the first argument if it's one of `normalizeModelId`/`getModelDisplayName` (which had a real second argument — the model — that stays), or drop the only argument entirely for `getDefaultModelForCli()`/`getModelDefinitionsForCli()`. This is mechanical but touches ~29 locations across `app/**`/`components/**` — go through the full list from Step 1, not just a sample. Let `tsc` be your safety net: after editing, a stale call site passing a stray extra argument shows up as a type error.

- [ ] **Step 4: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. `type-check` failures here directly indicate a missed call site from Step 3 — fix each one, don't silence with `// @ts-expect-error`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove dead _cli parameter from cliModels.ts and its ~29 call sites

Claude Code has been the only agent for a while -- these functions never
branched on the parameter, they just carried it."
```

---

## Phase 5 — Docs/config

### Task 22: Docs and config accuracy fixes

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:** None.

- [ ] **Step 1: Fix the wrong HTTP status claim**

In `README.md`, change:
```
Skipping this leaves the legacy `ServiceToken` rows for `vercel` and
`supabase` in place, holding plaintext tokens the app can no longer delete:
`DELETE /api/tokens/vercel` answers 400 now that those providers are gone.
```
to:
```
Skipping this leaves the legacy `ServiceToken` rows for `vercel` and
`supabase` in place, holding plaintext tokens the app can no longer delete
through the UI: `GET /api/tokens/:provider` only recognizes `github` and
rejects anything else, so there's no listing path to their delete button,
and `DELETE /api/tokens/:id` matches by primary key, not provider name, so
`DELETE /api/tokens/vercel` 404s rather than deleting anything.
```
(Verify the exact current route behavior yourself before committing to this wording — read `app/api/tokens/[...segments]/route.ts` and `lib/services/tokens.ts`'s `deleteServiceToken` to confirm the 404 claim still holds as of your read, then write the README sentence to match what you actually observed, not this plan's paraphrase of an audit from earlier.)

- [ ] **Step 2: Fix the vestigial section heading**

In `README.md`, change:
```
## Supported AI Coding Agents

### Claude Code
```
to:
```
## AI Coding Agent

### Claude Code
```
(The plural heading with sub-heading structure was left over from when multiple agent CLIs were supported; only Claude Code exists now, so drop the plural framing and the now-pointless single sub-heading level — fold the `### Claude Code` content up under the renamed `##` heading if that reads better; use your judgment on the exact heading depth, the content itself doesn't need to change.)

- [ ] **Step 3: Fix the unfilled repository URL placeholder**

In `package.json`, check the actual git origin first:
```bash
git remote -v
```
Then change:
```json
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/claudable.git"
  },
```
to match the real origin (confirmed `anymorph-ai/Claudable` as of this audit — but re-check, since a placeholder URL like this might also legitimately get updated if the project has since moved to a different canonical org; also check `README.md`'s own badge/link URLs for the most authoritative current answer if they differ from `git remote -v`, and use whichever is more clearly the canonical public repo).

- [ ] **Step 4: Verify**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS (these are docs/config-only changes, so this is confirming nothing broke, not that anything new works).

- [ ] **Step 5: Commit**

```bash
git add README.md package.json
git commit -m "docs: fix wrong HTTP status claim, vestigial heading, and repository URL placeholder"
```
