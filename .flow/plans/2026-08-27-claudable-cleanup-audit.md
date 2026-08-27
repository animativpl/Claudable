# Claudable Cleanup Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the whole-repo cleanup audit — a live security regression, 16 verified dead-code removals, 10 real duplications (including a divergent, untested copy of the app's path-traversal guard), a database migration dropping 3 fully-dead models plus 7 orphaned columns, 2 legacy-architecture remnants, and 3 docs/config fixes — in the phased order the user chose: security → dead code → duplication → structural → legacy remnants → docs.

**Architecture:** No new subsystem. 22 tasks, each either a verified-safe removal (no new test needed — the existing suite staying green is the proof) or a behavior-preserving extraction/fix (real TDD: a test proving the old and new code paths produce the same result). Three tasks in Phase 2 have an explicit verify-before-fix step, because the audit itself could not confirm the underlying problem without actually running a build/pack — do not skip that step or assume the fix is needed without it.

**Tech Stack:** Next.js App Router, TypeScript strict, Prisma/SQLite, vitest, Electron.

**Spec:** project has no living `spec.md` (confirmed in the design record) — no spec-sync task.

**Design record:** `.flow/specs/2026-08-27-claudable-cleanup-audit-design.md`

**Correction made while writing this plan, worth recording:** the audit suggested collapsing `components/settings/GlobalSettings.tsx`'s modal shell into the existing `SettingsModal` wrapper. Direct comparison shows these are not the same pattern — `SettingsModal` is a right-side slide-in panel (`ProjectSettings.tsx`'s style), `GlobalSettings.tsx` is a centered, `framer-motion`-animated tabbed dialog with a different header, sizing, and interaction model entirely. Forcing one into the other would be a visible design change, not a safe dedup. That merge is **dropped** from this plan; only the byte-identical GitHub SVG icon (genuinely duplicated, zero visual risk to extract) is in scope (Task 15).

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

### Task 1: Restore 127.0.0.1-only port binding — ⏸ PAUSED, do not start until unblocked

**Do not implement this task yet.** Red-team review found that commit `89c16ed`'s own message describes "switch to host networking" as a deliberate change, not an accident — the design record's original characterization of this as a silent security regression was wrong. That same commit added user-scope MCP server loading and a `~/.figma-console-mcp` host mount; a locally-running MCP server would need host networking to reach `localhost` on the host machine, which is a concrete, plausible reason for the change. The user has been asked to confirm the actual reason before this task proceeds (as of this plan revision, their answer was "I need to check first" — not yet resolved). **Check `~/.claude/hooks/flow-state show` or ask the controller/user directly whether this task is unblocked before starting it.** If it's still unresolved when you reach this task in sequence, skip it and move to Task 2 — do not guess.

Once unblocked, here is the task as originally scoped, for whichever direction the user confirms:

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

Confirmed zero **path-string** references anywhere in the repo:
```bash
grep -rn "types/server\|types/shared/chat\|types/shared/project\|types/shared/service\|types/backend/cli" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow .
```
returns nothing — **but this only checks path strings, not barrel-mediated symbol imports.** Red-team review caught one real one: `lib/services/cli/claude.ts:8` does `import type { ClaudeSession, ClaudeResponse } from '@/types/backend'` — both types are defined in `types/backend/cli.ts` (the file this task deletes) and re-exported through the `types/backend/index.ts` barrel. Re-verified: neither `ClaudeSession` nor `ClaudeResponse` is actually *used* anywhere else in `claude.ts` (the import itself is dead weight) — but the import statement would still fail to compile once `types/backend/cli.ts` is gone and the barrel no longer re-exports them, so it needs to be deleted, not left behind. Step 3 below now includes this. Before deleting anything in this task, re-grep at the **symbol** level, not just the path level:
```bash
grep -rn "ClaudeSession\|ClaudeResponse\|\bSessionType\b\|\bSessionStatus\b\|\bCLIType\b\|\bCLIModel\b\|\bCLIOption\b\|\bGlobalSettings\b\|\bToolUse\b" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow . | grep -v "types/backend/cli.ts"
```
(these are every export `types/backend/cli.ts` defines — confirm which, if any, have real usages beyond the one now-known `claude.ts` case before proceeding).

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

- [ ] **Step 3: Delete the dead file in `types/backend/`, fix its barrel, remove the one real dangling import**

Re-run the symbol-level grep above yourself first — the analysis while writing this plan found exactly one real hit (`lib/services/cli/claude.ts:8`), all other matches were an unrelated `GlobalSettings` React component/interface with the same name, or unrelated `activeClaudeSessionId` fields. Confirm that still holds, then:
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
In `lib/services/cli/claude.ts`, delete this line entirely (both `ClaudeSession` and `ClaudeResponse` are imported but never actually referenced anywhere else in the file — confirmed by grep — so this isn't preserving a used type, just removing a now-broken dead import):
```typescript
import type { ClaudeSession, ClaudeResponse } from '@/types/backend';
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

Remove these lines — two different reasons, not the same one:
```
prisma/*.db
prisma/*.db-journal
prisma/*.db-wal
```
These are not shadowed by anything (`prisma/` and `data/` are different paths) — they're simply unreachable. `DATABASE_URL` (set by `scripts/setup-env.js:276`, `"file:../data/cc.db"`) puts the SQLite file at `data/cc.db`, and nothing in this repo has ever pointed it at `prisma/`. These three lines have never matched a real file.
```
/data/projects/
```
This one genuinely *is* shadowed — the broader `data/` rule two lines above it (line 49, unanchored) already matches `/data/projects/` as a subpath, so this line is redundant with an existing rule rather than pointing at a dead path.

Verify with `git check-ignore -v` before and after removing both to confirm no behavior change either way.

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

**Revised after red-team review.** The original version of this task threw at *module scope* (as soon as `lib/crypto.ts` is imported). Verified this breaks `docker build`: `.dockerignore` excludes `.env`, and the Dockerfile's build stage (`COPY . . && RUN npx prisma generate && npm run build`) has no `ENCRYPTION_KEY` anywhere — it's only supplied at container *runtime* via `docker-compose.yml`. `next build` evaluates route handlers during page-data collection, and `lib/services/env.ts` (imported by the `/api/env/*` routes) imports `lib/crypto.ts` — so a module-scope throw would crash `docker build` while `npm run build` run locally (where `.env` **is** present) stays green, meaning this task's own gate can't see the break it would cause. **Fix: resolve the key lazily, inside `encrypt`/`decrypt`, not at module scope.**

**Files:**
- Modify: `lib/crypto.ts`
- Test: `tests/lib/crypto.test.ts` (new)

**Interfaces:**
- Produces: `encrypt(text: string): string` and `decrypt(text: string): string` keep their exact signatures — only the module's key-resolution behavior changes (throws when actually called if `ENCRYPTION_KEY` is unset, instead of silently generating a random one at import time).

Per design decision 5: the Docker *runtime* path already requires `ENCRYPTION_KEY` via `docker-compose.yml`'s `${ENCRYPTION_KEY:?...}` guard, and `scripts/setup-env.js` generates one for local dev — so this fallback never actually fires when the app is actually serving requests. Making it throw instead of silently rotating keys closes a footgun without changing real-world runtime behavior; resolving it lazily instead of at import time is what keeps the Docker *build* stage (which legitimately has no `ENCRYPTION_KEY` and shouldn't need one, since it never calls `encrypt`/`decrypt`) working.

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

  it('nie rzuca przy samym imporcie, gdy ENCRYPTION_KEY nie jest ustawiony', async () => {
    delete process.env.ENCRYPTION_KEY;
    await expect(import('@/lib/crypto')).resolves.toBeDefined();
  });

  it('rzuca dopiero przy realnym użyciu encrypt/decrypt, gdy klucza brak', async () => {
    delete process.env.ENCRYPTION_KEY;
    const { encrypt } = await import('@/lib/crypto');
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
  });

  it('szyfruje i odszyfrowuje poprawnie, gdy ENCRYPTION_KEY jest ustawiony', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const plaintext = 'a secret value';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });
});
```

- [ ] **Step 2: Run the test to verify the second case fails**

```bash
npx vitest run tests/lib/crypto.test.ts
```
Expected: the first test PASSES already (import never throws today — it silently generates a key instead); the second FAILS (`encrypt('x')` today succeeds with a random key instead of throwing); the third PASSES already.

- [ ] **Step 3: Resolve the key lazily instead of at module scope**

In `lib/crypto.ts`, change:
```typescript
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
```
to:
```typescript
function requireEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Every encrypted EnvVar/ServiceToken becomes ' +
      'undecryptable if this module silently generates a new key on each ' +
      'process start -- set ENCRYPTION_KEY explicitly instead (scripts/setup-env.js ' +
      'generates one for local dev; the Docker runtime path requires it via ' +
      "docker-compose.yml). This is checked lazily, not at import time, so a build " +
      'step that never calls encrypt/decrypt (e.g. `docker build`, which has no ' +
      'ENCRYPTION_KEY available) is unaffected.'
    );
  }
  return key;
}
```
Then update `encrypt` and `decrypt` to call `requireEncryptionKey()` instead of referencing the old module-scope `ENCRYPTION_KEY` constant:
```typescript
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(requireEncryptionKey().slice(0, 64), 'hex'),
    iv
  );
  // ... rest unchanged
```
```typescript
export function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift()!, 'hex');
  const encryptedText = parts.join(':');

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(requireEncryptionKey().slice(0, 64), 'hex'),
    iv
  );
  // ... rest unchanged
```
(Only the `Buffer.from(...)` lines' key source changes — the rest of both functions' bodies stay exactly as they are today.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/lib/crypto.test.ts
```
Expected: all three PASS.

- [ ] **Step 5: Run the full gate, plus a build-time sanity check that specifically simulates the Docker build's missing-key condition**

```bash
npm run type-check && npm test && npm run lint
env -u ENCRYPTION_KEY npm run build
```
Expected: `type-check`/`test`/`lint` PASS; the `env -u ENCRYPTION_KEY npm run build` line (running the build with `ENCRYPTION_KEY` explicitly unset, simulating the Docker build stage) must also succeed — this is the check that would have caught the original module-scope-throw version of this task. If it fails, the lazy-resolution fix in Step 3 didn't fully move the key access out of module-evaluation time; find the remaining eager reference and fix it before proceeding.

- [ ] **Step 6: Fix the README section this task makes inaccurate**

`README.md:112-118` currently documents the *old* fallback behavior as fact: *"An empty value would not stop the app — `lib/crypto.ts` falls back to a random in-memory key, a different one on every container start, so the first restart would leave every stored service token and encrypted env var undecryptable."* After Step 3, this is no longer true — the app still starts fine with an empty key (that part stays accurate), but it now throws when `encrypt`/`decrypt` is actually called instead of silently generating a key. Change the sentence to:
```
  empty value would not stop the app at startup — but `lib/crypto.ts` now
  throws the first time it's actually asked to encrypt or decrypt anything
  (e.g. saving a service token or env var), rather than silently generating
  a new random key on every container start the way it used to.
```

- [ ] **Step 7: Commit**

```bash
git add lib/crypto.ts tests/lib/crypto.test.ts README.md
git commit -m "fix: throw on use, not on import, when ENCRYPTION_KEY is unset

The prior fallback (crypto.randomBytes(32)) generated a new, different key
on every process start with no warning -- every existing encrypted EnvVar/
ServiceToken becomes silently undecryptable after a restart. Resolving the
key lazily inside encrypt/decrypt (rather than throwing at module-import
time) keeps the Docker build stage working -- it has no ENCRYPTION_KEY
available and never calls encrypt/decrypt, only the runtime container does,
where docker-compose.yml's :? guard already requires the var."
```

---

### Task 9: Prisma migration — remove 2 dead models and 6 orphaned columns; remove the dead session-detection routes and polling code

**Revised after red-team review found the original scope was wrong.** The original version of this task also dropped the `Session` model and `Message.sessionId`/`parentMessageId`. Investigation (done in response to the finding, not guessed) showed that's a different situation from `Commit`/`ToolUsage`: the `Session` **table** is confirmed always empty (zero `prisma.session.create`/`update`/`upsert` calls anywhere — only two `findFirst` reads, in `lib/services/chat-sessions.ts`), so the active-session-detection *feature* is genuinely dead, same as originally found. But `Message.sessionId` the **column** is a separate thing: it has a real writer (`app/api/chat/[project_id]/messages/route.ts:102-121` accepts it from the request body) and real readers (`lib/services/message.ts`'s `mapPrismaMessage`, `lib/serializers/chat.ts`'s `serializeMessage`/`createRealtimeMessage`, and `components/chat/ChatLog.tsx`'s `buildToolMessageKey` dedup-key builder). The real agent flow (`lib/services/cli/claude.ts`) deliberately never populates it — there's an explicit comment at line 1055 saying so: *"sessionId is Session table foreign key, so don't store Claude SDK session ID / Claude SDK session ID is stored in project.activeClaudeSessionId"* — so in practice it's always `null` for real product messages and never affects the dedup key (which skips null parts). But it's not the zero-impact deletion the original plan assumed either: dropping the column means updating 4 files' worth of pass-through plumbing, and deciding whether to also touch `Message.parentMessageId` (same situation — "Thread support", schema-only, never written by `createMessage`, but still read/passed-through in the same 4 places). That's a real, separate decision, not a schema drop to bundle into a broad dead-code migration. **This task now leaves `model Session`, `Message.sessionId`, and `Message.parentMessageId` untouched.** Removing them is future work with its own task, if wanted.

What stays in scope, because it was never challenged and doesn't touch any of that live plumbing: `Commit` and `ToolUsage` (fully dead — zero `prisma.commit.*`/`prisma.toolUsage.*` calls anywhere, re-verified), `Message.durationMs`/`tokenCount`/`costUsd`/`commitSha` (re-verified zero field-level references anywhere in the codebase — unlike `sessionId`/`parentMessageId`, nothing reads or writes these four at all), `ProjectServiceConnection.lastSyncAt` (re-verified zero references), and `Project.settings` (re-verified: exactly one write site, `app/api/projects/[project_id]/route.ts:73`'s `settings: body.settings`, and zero reads anywhere — a write with no reader is inert, unlike `sessionId`'s situation). The two session-detection API routes and `ChatLog.tsx`'s dead polling code stay in scope too — they're dead regardless of what happens to the `Session` model's schema, since the table they query is confirmed always empty.

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `app/api/projects/[project_id]/route.ts`
- Create: a new Prisma migration (via `prisma migrate dev`)
- Delete: `app/api/chat/[project_id]/active-session/route.ts`
- Delete: `app/api/chat/[project_id]/sessions/[session_id]/status/route.ts`
- Delete: `lib/services/chat-sessions.ts`
- Modify: `components/chat/ChatLog.tsx`

**Interfaces:** None external.

**Not touched:** `model Session`, `Message.sessionId`, `Message.parentMessageId`, `Message.cliSource`, `UserRequest.cliPreference` all stay in the schema exactly as they are.

- [ ] **Step 1: Back up the database before migrating**

```bash
npm run db:backup
```
Expected: exits 0, prints where the backup landed (matches the precedent in `.flow/specs/2026-08-24-claudable-cleanup-docker-templates-design.md` decision 10 — never migrate schema without this first).

- [ ] **Step 2: Edit the schema**

In `prisma/schema.prisma`, remove the `commits Commit[]`/`toolUsages ToolUsage[]` relations from `model Project` (keep `sessions Session[]`), and remove `settings String?` (the "Settings (JSON)" field):
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
  sessions              Session[]
  envVars               EnvVar[]
  serviceConnections    ProjectServiceConnection[]
  userRequests          UserRequest[]
```

In `model Message`, remove only the "Performance tracking" and "Git integration" blocks — leave "Thread support" (`parentMessageId`) and "Session" (`sessionId`/`conversationId`) exactly as they are:
```prisma
  // Performance tracking
  durationMs Int? @map("duration_ms")
  tokenCount Int? @map("token_count")
  costUsd    Float? @map("cost_usd")

  // Git integration
  commitSha String? @map("commit_sha")
```
→ delete this block entirely. Also remove the `toolUsages ToolUsage[]` relation line from `model Message` (keep the `session Session? @relation(...)` line and `@@index([sessionId])` — both stay).

Delete `model Commit` (the whole block) and `model ToolUsage` (the whole block) entirely. **Do not delete `model Session`.**

In `model ProjectServiceConnection`, remove:
```prisma
  lastSyncAt  DateTime? @map("last_sync_at")
```

- [ ] **Step 3: Remove the now-dead `Project.settings` write site**

In `app/api/projects/[project_id]/route.ts`, remove the `settings: body.settings` line (line 73 as of this audit — re-verify) from whatever update-data object it's part of, since the column it wrote to no longer exists.

- [ ] **Step 4: Type-check *before* migrating**

```bash
npm run prisma:generate
npm run type-check
```
Expected: PASS. Do this *before* `prisma migrate dev`, not after — a schema edit plus `prisma generate` is enough to catch every stale reference to a removed field via the TypeScript compiler, without needing to have already applied a destructive migration to find out. If this fails, you missed a caller; find and fix it here, before Step 5 touches the actual database.

- [ ] **Step 5: Generate and apply the migration**

```bash
npx prisma migrate dev --name remove_dead_commit_toolusage_and_orphaned_columns
```
Expected: exits 0, prints the generated SQL summary (dropped tables `commits`, `tool_usages`; dropped columns on `messages`/`project_service_connections`/`projects` — `sessions` table and `messages.session_id`/`messages.parent_message_id` are **not** touched). Read the generated migration file in `prisma/migrations/` to confirm it matches exactly this and nothing more.

- [ ] **Step 6: Remove the two dead session-detection routes and their service file**

```bash
git rm app/api/chat/\[project_id\]/active-session/route.ts
git rm app/api/chat/\[project_id\]/sessions/\[session_id\]/status/route.ts
```
Re-confirm `lib/services/chat-sessions.ts` (`getActiveSession`, `getSessionById`) has no other callers, then delete it too:
```bash
grep -rn "chat-sessions" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow .
```
Expected: only the two route files you just deleted. Then:
```bash
git rm lib/services/chat-sessions.ts
```

- [ ] **Step 7: Remove the dead session-polling code in `ChatLog.tsx`**

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

**Do not remove** the `activeSession` state, `ActiveSession` interface, `setActiveSession`, or the `onSessionStatusChange` prop/callback plumbing — `handleRealtimeStatus` (a real, live SSE-status handler, unrelated to the dead polling) still calls `setActiveSession(null)` and `onSessionStatusChange?.(false)` when a real-time status update reports `'completed'`. This is genuinely live code, not part of what's being removed. This step's removal is behavior-preserving in practice: `checkActiveSession` always hit its "no active session" branch anyway, since the `Session` table it queried via the now-deleted routes is confirmed always empty — so `onSessionStatusChange(true)` was already never actually reachable in the current, broken state.

- [ ] **Step 8: Full verify**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: drop dead Commit/ToolUsage Prisma models and 6 orphaned columns, remove dead session-detection routes

Commit and ToolUsage were fully unused. Message.durationMs/tokenCount/
costUsd/commitSha, ProjectServiceConnection.lastSyncAt, and Project.settings
had zero readers. The active-session routes and ChatLog.tsx polling built
on the Session table are dead too -- that table is confirmed to have zero
create/update/upsert calls anywhere. The Session model itself and
Message.sessionId/parentMessageId are deliberately NOT touched here --
they have real (if narrow) pass-through plumbing that needs its own
dedicated decision, not a bundled schema drop. data/cc.db backed up
before migrating (npm run db:backup)."
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

**Real, minor behavior change this introduces:** today, when the project's base directory itself does not exist, `resolveSafePath` throws `FileBrowserError('Base path does not exist', 400)` immediately, before any traversal check runs. `resolveSafeProjectPath` does no existence check at all (it's pure path arithmetic — see `lib/utils/project-path.ts`), so after this change that same missing-base case instead falls through to the call site's subsequent `fs.stat`, which throws its own `FileBrowserError('... not found', 404)`. Both are still errors, both are still `FileBrowserError`, but the status code and message change (400→404) for that one edge case (a project whose stored `repoPath` points at a directory that no longer exists). This is accepted as-is — 404 is arguably the more correct code for "directory doesn't exist" anyway — not silently preserved with extra logic. Do not add back the `fs.access` check to avoid this; that would defeat the point of routing through the canonical, untested-duplicate-free implementation.

- [ ] **Step 1: Write the failing test proving the switch preserves the traversal-rejection behavior**

The test must exercise the traversal-rejection branch specifically, through a base directory that actually exists on disk — not the base-missing branch, which today also throws a 400 `FileBrowserError` and would make the assertion pass for the wrong reason (indistinguishable from a genuine traversal rejection since both throw the same error type).

Create `tests/services/file-browser-path-traversal.test.ts`:
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

let projectDir: string;

vi.mock('@/lib/services/project', () => ({
  getProjectById: vi.fn(async (id: string) => ({ id, repoPath: projectDir })),
}));

import { listProjectDirectory, FileBrowserError } from '@/lib/services/file-browser';

describe('file-browser path traversal guard', () => {
  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-browser-test-'));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('odrzuca próbę wyjścia poza katalog projektu, gdy katalog bazowy realnie istnieje', async () => {
    await expect(
      listProjectDirectory('proj-1', '../../../../etc')
    ).rejects.toThrow(FileBrowserError);
  });

  it('akceptuje ścieżkę wewnątrz katalogu projektu', async () => {
    await expect(listProjectDirectory('proj-1', '.')).resolves.toBeDefined();
  });
});
```
`repoPath` is set to a real temp directory (absolute path), so `resolveProjectRoot` (in `lib/utils/project-path.ts`) uses it directly instead of falling back to `PROJECTS_DIR_ABSOLUTE` — this guarantees the base directory genuinely exists, so the first test's rejection can only come from the traversal check itself, not a missing-base short-circuit. The second test is a minimal sanity check that the swap doesn't also break the non-attack path. (This test exercises the guard through the public API rather than the private `resolveSafePath`, since that function is not exported — matching how the rest of this file's tests, if any, would need to work. If `getProjectById`'s real shape differs from this mock in a way that breaks the test for an unrelated reason, adjust the mock to match the real `Project` shape, not the guard logic being tested.)

- [ ] **Step 2: Run the test to verify it fails or passes for the wrong reason**

```bash
npx vitest run tests/services/file-browser-path-traversal.test.ts
```
Expected: both tests already PASS against the current, untested `resolveSafePath` (it does implement the same check) — that's fine, this test's job is to survive Step 3's refactor unchanged, proving the switch is behavior-preserving for both the attack path and the happy path, not to prove today's code is broken.

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

### Task 12: Fix `TodoWrite` mislabeling and the Task-tool name-as-path bug via a shared leaf module

**Substantially revised after red-team review found two problems with the original version.** First (blocking): the original Step 5 had `ChatLog.tsx` — a `"use client"` component — import `TOOL_NAME_ACTION_MAP`/`inferActionFromToolName` from `lib/services/cli/claude.ts`, which imports the Agent SDK, `fs/promises`, and Prisma-backed services. No component in this codebase imports anything from `lib/services` today; doing so from a client component either fails to bundle or ships server code (including `fs/promises`) to the browser. Second (serious): `claude.ts` and `ChatLog.tsx` each independently duplicate **four** things — `TOOL_NAME_ACTION_MAP`, `normalizeAction`, `inferActionFromToolName`, `extractPathFromInput` (plus `pickFirstString`, which `extractPathFromInput` calls) — not just the one map. The original plan only patched `claude.ts`'s copies, leaving both bugs live on `ChatLog.tsx`'s copy, which is the one that actually renders what the user sees.

**Fix: put all five in a new leaf module with zero imports, and have both `claude.ts` and `ChatLog.tsx` import from it — never from each other.** This fixes both bugs exactly once, on both the server dispatch path and the client rendering path, and never puts server-only code in a client bundle.

**Files:**
- Create: `lib/tool-actions.ts`
- Modify: `lib/services/cli/claude.ts`
- Modify: `components/chat/ChatLog.tsx`
- Test: `tests/lib/tool-actions.test.ts` (new — replaces `tests/cli/claude-tool-actions.test.ts` from the prior dependency-upgrade run, since the map it tests is moving)

**Interfaces:**
- Produces: `lib/tool-actions.ts` exports `type ToolAction`, `TOOL_NAME_ACTION_MAP: Record<string, ToolAction>`, `normalizeAction(value: unknown): ToolAction | undefined`, `inferActionFromToolName(toolName: unknown): ToolAction | undefined`, `pickFirstString(value: unknown): string | undefined`, `extractPathFromInput(input: unknown, action?: ToolAction): string | undefined` — same signatures as the current duplicated copies in both files. This module must have **zero imports** — verify this once written, since that's what guarantees it's safe for a client component to pull in.

- [ ] **Step 1: Read both current copies in full, confirm they're still byte-identical**

```bash
diff <(sed -n '/^type ToolAction/,/^const extractPathFromInput/p' lib/services/cli/claude.ts) <(sed -n '/^type ToolAction/,/^const extractPathFromInput/p' components/chat/ChatLog.tsx)
```
(This is an approximate range-diff to sanity-check before committing to the exact extraction — read both files' actual current line ranges yourself rather than trusting this one command's output blindly; the two copies were confirmed byte-identical except for the `export` keyword as of this plan's writing, but re-confirm.)

- [ ] **Step 2: Write the failing tests for the two bug fixes, against the not-yet-created module**

Create `tests/lib/tool-actions.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { TOOL_NAME_ACTION_MAP, extractPathFromInput, inferActionFromToolName } from '@/lib/tool-actions';

describe('lib/tool-actions — TodoWrite mislabeling', () => {
  it('mapuje TodoWrite na Generated, nie Created', () => {
    expect(inferActionFromToolName('TodoWrite')).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['todowrite']).toBe('Generated');
  });
});

describe('lib/tool-actions — Task tool name field', () => {
  it('nie myli pola name (nazwa subagenta) ze ścieżką pliku', () => {
    const result = extractPathFromInput({ name: 'code-reviewer', prompt: 'review the diff' });
    expect(result).toBeUndefined();
  });

  it('nadal wyciąga realną ścieżkę pliku dla narzędzi plikowych', () => {
    expect(extractPathFromInput({ file_path: 'app/page.tsx' })).toBe('app/page.tsx');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run tests/lib/tool-actions.test.ts
```
Expected: FAIL — `lib/tool-actions.ts` doesn't exist yet.

- [ ] **Step 4: Create `lib/tool-actions.ts` with both bugs fixed**

Move `ToolAction`, `TOOL_NAME_ACTION_MAP`, `normalizeAction`, `inferActionFromToolName`, `pickFirstString`, `extractPathFromInput` from `lib/services/cli/claude.ts` (pick either copy as the source — they're identical) into the new file, with these two fixes applied:
1. Add `todowrite: 'Generated',` to `TOOL_NAME_ACTION_MAP` (it currently has `todo_write`/`todo`/`plan_write` but not the no-separator lowercase form the real tool name produces — the same pattern already used for `taskcreate`/`taskupdate`/etc.).
2. Remove `'name'` from `extractPathFromInput`'s `candidateKeys` array.

The new file must have **zero imports** (all five exports are pure functions/data operating only on their own parameters) — if you find either copy actually does import something, stop and reconsider whether this module is safe for a client component before proceeding.

Export everything: `export type ToolAction = ...`, `export const TOOL_NAME_ACTION_MAP = ...`, `export function normalizeAction(...)`, `export function inferActionFromToolName(...)`, `export function pickFirstString(...)`, `export function extractPathFromInput(...)`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/lib/tool-actions.test.ts
```
Expected: all PASS.

- [ ] **Step 6: Point both `claude.ts` and `ChatLog.tsx` at the new module**

In `lib/services/cli/claude.ts`: delete the local `ToolAction`/`TOOL_NAME_ACTION_MAP`/`normalizeAction`/`inferActionFromToolName`/`pickFirstString`/`extractPathFromInput` definitions, add:
```typescript
import { TOOL_NAME_ACTION_MAP, inferActionFromToolName, extractPathFromInput, type ToolAction } from '@/lib/tool-actions';
```
(only import the specific names this file actually references elsewhere — read the file to confirm which of the six it uses beyond the ones already named).

In `components/chat/ChatLog.tsx`: delete its own local copies of the same six, add the identical import line. Since `lib/tool-actions.ts` has zero imports, this is safe for a `"use client"` file.

- [ ] **Step 7: Remove the now-superseded old test file**

```bash
git rm tests/cli/claude-tool-actions.test.ts
```
(Its assertions are now covered by `tests/lib/tool-actions.test.ts`, testing the actual single source of truth instead of one of two copies.)

- [ ] **Step 8: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. Pay particular attention to the build step — a client-component bundling failure is exactly the class of problem this task's redesign exists to prevent; if it fails here, re-check Step 4's zero-imports claim rather than assuming it's an unrelated flake.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: unify claude.ts and ChatLog.tsx's duplicated tool-action logic into lib/tool-actions.ts, fix TodoWrite mislabeling and Task-tool name/path confusion

Both files had four independently-duplicated pieces (the map plus three
functions), not just the one map previously tracked -- both bugs now fixed
once, in a zero-import leaf module both the server dispatch path and the
client rendering path import from. Never has a client component import
lib/services/cli/claude.ts, which pulls in the Agent SDK, fs/promises, and
Prisma-backed services."
```

---

### Task 12b (optional, lower confidence): extract ChatLog.tsx's remaining stranded pure logic

**This task is optional and should be scoped freshly by whoever implements it, not from this plan's line numbers.** The original version of this task claimed a precise 18-function inventory for a ~960-line move; red-team review found three concrete errors in that inventory (`processToolContent` is not module-scope — it's defined inside the `ToolMessage` component and may close over props; the claimed line range includes `ToolMessage` itself, a ~210-line JSX component explicitly meant to stay; `ensureMessageIdentity` and `randomMessageId`, which `integrateMessages`/`createToolMessageFromPlaceholder` likely depend on, were omitted). A plan whose stated contract is wrong in multiple places will not survive a fresh implementer without redoing the inventory from scratch — so do that inventory as this task's real first step, don't trust the list below as anything more than a starting hypothesis.

**Value vs. risk:** Task 12 (above) already fixes both real bugs and resolves the *tracked* duplication (the map + the three functions around it). This task's only remaining value is moving `ChatLog.tsx`'s other pure helpers (message-merging, placeholder-parsing) into a lib module for its own sake — real, but purely cosmetic, and the riskiest mechanical operation in the whole plan given how large and easy to get subtly wrong it is. If time/risk tolerance is tight, skip this task entirely; nothing else in the plan depends on it.

**Files:**
- Create: `lib/serializers/client/tool-messages.ts`
- Modify: `components/chat/ChatLog.tsx`
- Test: `tests/serializers/tool-messages.test.ts` (new)

**Interfaces:**
- Produces: whatever the real inventory from Step 1 turns out to be — do not assume the names below are complete or correctly scoped.

- [ ] **Step 1: Do a fresh, careful inventory — do not reuse this plan's line numbers**

Read `components/chat/ChatLog.tsx` in full. For each candidate function between the imports and the `ChatLog` component definition, confirm with the codebase graph (not just reading) that it's genuinely module-scope and closure-free:
```
mcp__codebase-memory-mcp__search_graph(project="home-m-work-Claudable", file_pattern="ChatLog.tsx", label="Function")
```
For each result, check its containing scope — a function nested inside another function/component (like `processToolContent` inside `ToolMessage`, per the red-team finding) is not a candidate for this extraction, even if it looks pure on a skim. Build the real list before writing anything.

- [ ] **Step 2: Extract the confirmed-safe subset into `lib/serializers/client/tool-messages.ts`**

Move only what Step 1 actually confirmed — likely candidates per the original audit (verify each): `extractToolCallId`, `parseToolPlaceholder`, `stripToolPlaceholderLines`, `createToolMessageFromPlaceholder`, `expandMessageWithToolPlaceholder`, `expandMessagesList`, `hashString`, `buildToolMessageKey`, `metadataEquals`, `areMessagesEqual`, `mergeMetadataObjects`, `mergeMessageRecord`, `integrateMessages`, `deriveToolInfoFromMetadata`, plus whatever supporting functions (e.g. `ensureMessageIdentity`, `randomMessageId`) Step 1 finds they depend on. Preserve exact bodies and signatures — this is a move, not a rewrite. `processToolContent` stays in `ChatLog.tsx` inside `ToolMessage` unless Step 1's investigation specifically proves it's safe to extract (in which case, extract it and note why the original finding was wrong).

- [ ] **Step 3: Write a real behavior-preservation test**

Create `tests/serializers/tool-messages.test.ts` with real assertions against the real `ChatMessage` shape (read `types/realtime.ts` or wherever it's actually defined) and the real dedup contract of `integrateMessages`/`buildToolMessageKey` as you now understand them from Step 1 — no placeholder assertions.

- [ ] **Step 4: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 5: Commit (or explicitly skip this task and say why)**

```bash
git add -A
git commit -m "refactor: extract ChatLog.tsx's remaining pure message-merging logic to lib/serializers/client/tool-messages.ts"
```
If you determine during Step 1 that the risk/value tradeoff isn't worth it for the actual current state of the file, that's a legitimate outcome for this task — report what you found and why you're skipping it, rather than forcing an extraction the inventory doesn't cleanly support.

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

**Note before writing this:** `mirrorAssetToPublic` (as moved verbatim in Step 3 below) writes to two locations — the project's own `public/uploads` (parameterized by `projectRoot`, safe to point at a temp dir) *and* a "host" copy at `path.join(process.cwd(), 'public', 'uploads')`, which is **not parameterized** — it always resolves against the real process working directory, i.e. this repo's actual `public/uploads/` directory when the test suite runs. This is existing behavior being moved, not something this task changes, so the test cannot avoid it by picking a different `projectRoot` — it must clean up the real file it causes to be written, or the test suite leaves a stray file in the tracked repo tree on every run.

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
  const testFilename = 'assets-test-mirror-artifact.png';
  // mirrorAssetToPublic's "host" mirror is hardcoded to process.cwd(), not
  // parameterized -- this test's own artifact there, so it must clean up
  // after itself instead of leaving a stray file in the real repo tree.
  const hostArtifactPath = path.join(process.cwd(), 'public', 'uploads', testFilename);

  beforeEach(async () => {
    tmpProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-test-'));
    sourceFile = path.join(tmpProjectRoot, 'source.png');
    await fs.writeFile(sourceFile, Buffer.from('fake-image-bytes'));
  });

  afterEach(async () => {
    await fs.rm(tmpProjectRoot, { recursive: true, force: true });
    await fs.rm(hostArtifactPath, { force: true });
  });

  it('kopiuje plik do public/uploads projektu i zwraca ścieżkę', async () => {
    const result = await mirrorAssetToPublic(tmpProjectRoot, testFilename, sourceFile);
    expect(result.publicPath).toBeTruthy();
    const copied = await fs.readFile(path.join(tmpProjectRoot, 'public', 'uploads', testFilename));
    expect(copied.toString()).toBe('fake-image-bytes');
  });
});
```
A distinctive filename (`assets-test-mirror-artifact.png`, not `copy.png`) is used deliberately, so this test's cleanup can never collide with or delete a real uploaded asset of the same name if this ever runs against a working tree that has one.

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

**Revised after red-team review: re-export instead of a hand-duplicated second union + test.** The original draft widened `types/backend/project.ts`'s union to match `types/project.ts` by hand, backed by a `tests/types/project-status.test.ts` whose "runtime backstop" assertion (`expect(frontendValues).toEqual(frontendValues.slice().sort())`) compares an array to its own sorted copy — it never reads `BackendStatus` at runtime at all, so it would pass unconditionally regardless of what either union actually contains. Two hand-maintained unions is also exactly the shape that drifted the first time. The fix below removes the second declaration entirely instead of policing it.

**Files:**
- Modify: `types/backend/project.ts`

**Interfaces:**
- Produces: `types/backend/project.ts`'s `ProjectStatus` becomes a direct re-export of `types/project.ts`'s (same 9-value union: `idle`/`preview_running`/`building`/`initializing`/`active`/`failed`/`running`/`stopped`/`error`), so there is exactly one declaration and structural drift is no longer possible.

`types/project.ts`'s `ProjectStatus` has 9 values; `types/backend/project.ts`'s independently hand-written copy has only 4 (`idle`/`running`/`stopped`/`error`) — real drift, not cosmetic. The Prisma `Project.status` column is a plain `String` with no enum constraint (`status String @default("idle")`), so neither type is "the" source of truth at the database level — this task picks the more complete 9-value union in `types/project.ts` as canonical and makes `types/backend/project.ts` re-export it, rather than inventing a third source or maintaining two copies in sync by hand.

- [ ] **Step 1: Read `types/backend/project.ts` in full**

Confirm the current `ProjectStatus` declaration (today: `export type ProjectStatus = 'idle' | 'running' | 'stopped' | 'error';`) and check whether anything else in the file depends on it being a locally-declared type rather than a re-export (e.g. re-exported again from a barrel, or used as a generic default) — a plain `export type { ProjectStatus } from '...'` re-export is interchangeable with a local declaration everywhere TypeScript checks structural compatibility, so this should be a non-issue, but confirm before changing it.

- [ ] **Step 2: Replace the duplicated declaration with a re-export**

Change:
```typescript
export type ProjectStatus = 'idle' | 'running' | 'stopped' | 'error';
```
to:
```typescript
export type { ProjectStatus } from '@/types/project';
```

- [ ] **Step 3: Verify the widened type doesn't break an exhaustive `switch` somewhere**

```bash
npm run type-check
```
Expected: PASS. If this surfaces a `switch`/exhaustiveness error somewhere that previously only handled the narrower 4 values, that's a real gap this task just surfaced — fix the switch to handle the other 5 values sensibly (don't silently add a `default` that swallows them) rather than reverting to a narrower local type.

- [ ] **Step 4: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: reconcile ProjectStatus drift by re-exporting types/project.ts's union from types/backend/project.ts

The backend copy was a hand-maintained duplicate missing 5 of 9 status
values the frontend copy has. Re-exporting instead of widening both by
hand removes the second declaration entirely, so this can't drift again."
```

---

## Phase 3b — Structural (conservative scope)

### Task 18: Extract fully-decoupled pure pieces from `chat/page.tsx`

**Files:**
- Create: `components/chat/TreeView.tsx`
- Create: `lib/utils/file-display.ts`
- Modify: `app/[project_id]/chat/page.tsx`

**Interfaces:**
- Produces (from `components/chat/TreeView.tsx`): `export type Entry = { path: string; type: 'file' | 'dir'; size?: number }`, `export interface TreeViewProps` (same shape as today), `export function TreeView(props: TreeViewProps): React.ReactElement | null`, `export function getFileIcon(entry: Entry): React.ReactElement`.
- Produces (from `lib/utils/file-display.ts`): `getFileLanguage(path: string): string`, `escapeHtml(value: string): string`.

**Corrected after self-review against the real file** (the first draft of this task had 3 wrong assumptions — verified directly by reading `app/[project_id]/chat/page.tsx` before writing this version):
1. `getFileIcon` returns JSX (`React.ReactElement`, literally `<span>...<FaFolder /></span>` etc.) — it cannot live in `lib/utils/file-display.ts` as a plain `.ts` module (the project's `lib/` tree has zero `.tsx` files today; introducing one here would be the first, breaking an established convention for no reason). It moves into `components/chat/TreeView.tsx` instead, alongside `TreeView` — the component it's already passed into as a prop.
2. The grep pattern in the original draft (`^function TreeView`, `^function getFileIcon`, etc.) does not match anything: `getFileLanguage`, `escapeHtml`, and `getFileIcon` are declared with 2-space indentation, nested inside the page's default-exported `ChatPage` component body (they read only their own parameters and module-level imports, so they're still safely extractable — nesting doesn't imply a closure over state here, confirmed by reading each body in full).
3. `TreeViewProps` references a module-scope type alias `type Entry = { path: string; type: 'file'|'dir'; size?: number }` (declared once, above `TreeView`, at today's line 40) that the original draft never gave a destination. It moves to `components/chat/TreeView.tsx` too (as an `export type`), since that's the type's primary consumer and where `getFileIcon` also needs it.

**Explicit scope boundary — read before starting:** `app/[project_id]/chat/page.tsx` is a 2,377-line component with 37 `useState` hooks mixing 4 concerns (chat, file explorer, live preview, init/status polling). This task extracts **only** the four already-fully-decoupled pieces named above — props-only or pure-function, zero closures over component state. **Do not** attempt to split the state clusters into child components or hooks in this task — that's real behavioral surface needing its own dedicated design pass, not a bullet point in a cleanup plan. If you find yourself touching a `useState`/`useEffect` in `chat/page.tsx` beyond removing the now-moved code, stop — that's out of this task's scope.

- [ ] **Step 1: Read the current file and confirm the pieces are still where this plan found them**

```bash
grep -n "^type Entry\|^function TreeView\|^  function getFileIcon\|^  function getFileLanguage\|^  function escapeHtml" app/\[project_id\]/chat/page.tsx
```
As of this audit: `type Entry` at line 40, `function TreeView` at line 65 (module-scope, not nested), `function getFileLanguage` at line 888, `function escapeHtml` at line 957, `function getFileIcon` at line 967 (these three nested 2 spaces inside `ChatPage`). Re-verify these line numbers and read each in full before moving anything — if any of them now reference component-scoped state that this plan didn't catch, treat that one as out of scope for this task and only move the others.

- [ ] **Step 2: Move `Entry`, `TreeView`, and `getFileIcon` to `components/chat/TreeView.tsx`**

Create `components/chat/TreeView.tsx`:
```typescript
import {
  FaFolder,
  FaFolderOpen,
  FaChevronDown,
  FaChevronRight,
  FaFileCode,
  FaCss3Alt,
  FaHtml5,
  FaJs,
  FaReact,
  FaPython,
  FaDocker,
  FaMarkdown,
  FaDatabase,
  FaPhp,
  FaJava,
  FaRust,
  FaVuejs,
  FaLock,
  FaCog,
  FaFile,
} from 'react-icons/fa';
import { SiTypescript, SiGo, SiRuby, SiSvelte, SiJson, SiYaml, SiCplusplus } from 'react-icons/si';
import { VscJson } from 'react-icons/vsc';

export type Entry = { path: string; type: 'file' | 'dir'; size?: number };

export interface TreeViewProps {
  entries: Entry[];
  selectedFile: string;
  expandedFolders: Set<string>;
  folderContents: Map<string, Entry[]>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  onLoadFolder: (path: string) => Promise<void>;
  level: number;
  parentPath?: string;
  getFileIcon: (entry: Entry) => React.ReactElement;
}

export function TreeView({ entries, selectedFile, expandedFolders, folderContents, onToggleFolder, onSelectFile, onLoadFolder, level, parentPath = '', getFileIcon }: TreeViewProps) {
  // (paste the exact current body of the module-scope `TreeView` function
  // here, lines 66-166 of app/[project_id]/chat/page.tsx as of this audit --
  // it is a straight cut-paste, no logic changes, re-verify against the
  // current file before pasting)
}

// (paste the exact current body of the nested `getFileIcon` function here,
// lines 967-1047 as of this audit -- straight cut-paste, no logic changes)
export function getFileIcon(entry: Entry): React.ReactElement {
  // ...
}
```
`SiJson` is imported by the original file's icon-import block but not actually referenced inside `getFileIcon`'s body (re-verify: the current code uses `VscJson` for `package.json`/`.json`, not `SiJson`) — do not carry over an unused import; only import what `getFileIcon` and `TreeView` actually reference in their pasted bodies.

In `chat/page.tsx`, delete the local `type Entry`, `TreeViewProps` interface, `TreeView` function, and nested `getFileIcon` function, and add:
```typescript
import { TreeView, getFileIcon, type Entry } from '@/components/chat/TreeView';
```
Anywhere in `chat/page.tsx` that referenced the bare `Entry` type (e.g. state typed `Map<string, Entry[]>`) now needs this import instead of the deleted local type.

- [ ] **Step 3: Move `getFileLanguage` and `escapeHtml` to `lib/utils/file-display.ts`**

```typescript
// lib/utils/file-display.ts
// (paste the exact current bodies of getFileLanguage, lines 888-955, and
// escapeHtml, lines 957-964 as of this audit -- straight cut-paste, no
// logic changes; re-verify against the current file before pasting)
export function getFileLanguage(path: string): string {
  // ...
}

export function escapeHtml(value: string): string {
  // ...
}
```
In `chat/page.tsx`, delete the two local definitions and add `import { getFileLanguage, escapeHtml } from '@/lib/utils/file-display';`.

- [ ] **Step 4: Write tests for the extracted pure functions**

Create `tests/utils/file-display.test.ts` with real assertions based on the actual function bodies you just read (e.g., if `getFileLanguage('app.tsx')` returns `'typescript'` today, assert that) — write assertions against the real, current behavior, not invented expected values.

Create `tests/components/tree-view.test.tsx` with at least one assertion that `getFileIcon` returns a distinct icon for a directory entry vs. a `.ts` file entry vs. an unrecognized extension (render with `@testing-library/react` if already a project dependency — check `package.json` first; if it is not, assert on the returned `React.ReactElement`'s `type`/`props` directly instead of rendering, matching whatever pattern the rest of `components/chat/` tests already use — check for existing tests under `tests/components/` first rather than introducing a new testing approach).

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

### Task 19: Extract the shared `sessionStorage` model-persistence logic (revised, much smaller scope)

**Substantially revised after red-team review found the original premise was wrong for 3 of the 4 named files.** Direct verification (re-read all 4 files in full):
- `app/page.tsx` both **reads** (`sessionStorage.getItem('selectedModel')`, line 69) and **writes** (`sessionStorage.setItem('selectedModel', ...)`, line 96) — this one is real.
- `app/[project_id]/chat/page.tsx` only ever **writes** (`sessionStorage.setItem('selectedModel', ...)`, lines 254 and 359) — it never reads `sessionStorage` at all. It initializes its own `selectedModel` state from `getDefaultModelForCli` and the project record, not from `sessionStorage`.
- `components/modals/CreateProjectModal.tsx`'s `selectedModel` state is seeded from a `defaultModel` **prop** (passed by `app/page.tsx`, which is where the real `sessionStorage` state lives) and never touches `sessionStorage` directly anywhere in the file. This is deliberately ephemeral, scoped to one open-modal session — routing it through a shared persisted store would make picking a model in the create-project dialog silently overwrite the home page's saved selection, a real behavior regression, not a dedup.
- `components/chat/ChatInput.tsx` has **no model state at all** — `selectedModel` is a plain prop (line 47), `selectedModelValue` is a `useMemo` derived from it. There is nothing to consolidate here.

So this is not "4 copies of one thing" — it's a producer (`app/page.tsx`) and one write-only consumer (`chat/page.tsx`) sharing a `sessionStorage` key, plus two unrelated files that don't participate at all. **`CreateProjectModal.tsx` and `ChatInput.tsx` are dropped from this task entirely.**

**Files:**
- Create: `lib/utils/model-selection-storage.ts`
- Modify: `app/page.tsx`
- Modify: `app/[project_id]/chat/page.tsx`
- Test: `tests/utils/model-selection-storage.test.ts` (new)

**Interfaces:**
- Produces: `readStoredModel(): string | null` (returns the raw stored value, or `null` if unset/unavailable — callers apply their own `normalizeModelId` as they do today) and `writeStoredModel(modelId: string): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/model-selection-storage.test.ts`:
```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { readStoredModel, writeStoredModel } from '@/lib/utils/model-selection-storage';

describe('lib/utils/model-selection-storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('zwraca null, gdy nic nie zapisano', () => {
    expect(readStoredModel()).toBeNull();
  });

  it('zapisuje i odczytuje wybrany model', () => {
    writeStoredModel('claude-opus-5');
    expect(readStoredModel()).toBe('claude-opus-5');
  });
});
```
(Requires a `sessionStorage` global in the vitest environment — check `vitest.config.ts`'s `environment` setting; if it's not already `jsdom` or similar, this is a real infrastructure gap to report, not something to silently work around.)

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/utils/model-selection-storage.test.ts
```
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Create the shared module**

```typescript
// lib/utils/model-selection-storage.ts
const STORAGE_KEY = 'selectedModel';

export function readStoredModel(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function writeStoredModel(modelId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, modelId);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run tests/utils/model-selection-storage.test.ts
```
Expected: PASS.

- [ ] **Step 5: Update the two real call sites**

In `app/page.tsx`: replace the direct `sessionStorage.getItem('selectedModel')` (line 69) and `sessionStorage.setItem('selectedModel', ...)` (line 96) calls with `readStoredModel()`/`writeStoredModel(...)`, keeping every surrounding line (the `normalizeModelId` call, the `isPageRefresh`/`navigationFlag` logic, the `isInitialLoad` guard) exactly as it is today — only the two direct `sessionStorage.*` calls change.

In `app/[project_id]/chat/page.tsx`: replace the two `sessionStorage.setItem('selectedModel', ...)` call sites (lines 254 and 359) with `writeStoredModel(...)`, keeping their surrounding logic unchanged. Do not add a read call here — this file has never read from `sessionStorage` and nothing in this task should change that.

- [ ] **Step 6: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract sessionStorage model-persistence into lib/utils/model-selection-storage.ts

app/page.tsx (the only reader+writer) and app/[project_id]/chat/page.tsx
(write-only) shared a raw sessionStorage key with two independent call
sites; now share one small module. CreateProjectModal.tsx and
ChatInput.tsx were never part of this -- the former's model state is
scoped to one open-modal session via a prop, the latter has no model
state of its own at all."
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
