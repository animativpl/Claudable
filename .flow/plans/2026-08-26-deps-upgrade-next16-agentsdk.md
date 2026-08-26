# Aktualizacja zależności — Next.js 16, Claude Agent SDK 0.3, TypeScript 5.9, Electron 44 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `next`, `@anthropic-ai/claude-agent-sdk`, `electron`, `typescript`, and the rest of `package.json`'s dependencies to their latest versions (Prisma and Tailwind CSS majors excluded — deferred to their own migrations), with every breaking change actually verified against this codebase and against live npm registry data, not assumed.

**Architecture:** No new subsystem — this is a dependency-upgrade task. Six tasks, each bumping a coherent group of packages and re-running the verification gate (`type-check`, `test`, `lint`, `build`). Three tasks touch actual code/config beyond `package.json` because the bump lands directly on it:
- Task 2 (Next 16 makes Turbopack the default and hard-fails a build that has a `webpack` config and no `turbopack` config — this repo has exactly that shape, confirmed against Next's own source; also `next lint` is removed).
- Task 5 (Agent SDK 0.3 renames the `TodoWrite` tool to `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`, which this app's two — yes, two, they're duplicated — tool-name-to-display-label maps need to recognize; and Agent SDK 0.3 makes `@anthropic-ai/sdk`/`@modelcontextprotocol/sdk` real non-optional peer dependencies, which the Docker runtime image does not currently copy).

**This plan supersedes an earlier draft of the same file.** That draft went through a red-team pass (`plan-red-team` subagent) which found three deterministic-failure blockers, all independently verified against the live npm registry, Next.js's own source, and this repo's actual `Dockerfile`/`next.config.js`/`scripts/run-web.js` before this rewrite: (1) the Turbopack-default build failure above, (2) `typescript@7.0.2` cannot coexist with `typescript-eslint`'s peer range and ships no compiler API at all — taken back to the user, who chose TypeScript `5.9.3` over forcing `7.0.2`, (3) the Agent SDK peer-dependency/Docker gap above. See design record decisions 10-12 for the full paper trail.

**Tech Stack:** Next.js (App Router), TypeScript strict, vitest, npm, Docker.

**Spec:** project has no living `spec.md` (confirmed in the design record, section 1) — this plan's last task does **not** include a spec-sync step; there is nothing to keep true.

**Design record:** `.flow/specs/2026-08-26-deps-upgrade-next16-agentsdk-design.md`

## Global Constraints

- Prisma stays within 6.x this run (design decision 2) — target `@prisma/client`/`prisma` at `6.19.3`, never the `prisma` package's raw npm `latest` tag (currently an `8.0.0-rc.11` prerelease).
- Tailwind CSS stays within 3.x this run (design decision 8) — target `3.4.19`, not 4.x.
- TypeScript targets `5.9.3`, not `7.0.2` (design decision 10 — reversed after red-team evidence).
- A "test" for a pure version bump (no code change in that task) is the existing verification gate actually passing — there is no new failing-test-first step for those tasks; TDD's red/green cycle applies only where this plan adds real code (Task 5).
- Every verification command must actually be run and its real output read — a task is not done because the bump "should" work. Where a claim in this plan says something was "confirmed against npm/source," that means a live `npm view`/registry check or a documentation fetch was actually done while writing this plan — implementers can trust those specific claims without re-deriving them, but must still run every step's own verification command for real.
- Verification greps exclude, never enumerate: `-I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow --exclude=package-lock.json .`
- Commit messages: English, imperative mood, matching this repo's existing convention (see `git log`).
- Scratch files (logs, temp output) go under the run's own scratch space, never `/tmp` directly.
- Full verification gate (used at the end of every task): `npm run type-check && npm test && npm run lint && npm run build`.

---

### Task 1: Low-risk dependency bumps (no lint/tooling coupling)

**Files:**
- Modify: `package.json:34-67` (dependencies, devDependencies, engines)

**Interfaces:** None — no code changes, version bumps only.

Bumps everything that does **not** touch the ESLint/lint-tooling chain (kept out because Task 2 changes that chain, and a lint failure after Task 2 should be attributable to Task 2 alone, not tangled up with unrelated bumps from this task). Four of these are still major-version bumps — `framer-motion` (11→13), `lucide-react` (0.x→1.x), `dotenv` (16→17), and `@types/node` — call them out as such in the commit, don't bury them under "low-risk." `@types/node` targets the latest **22.x** patch, matching the `node:22-slim` base image this app actually deploys on (`Dockerfile:3,9,29,45`) and the `engines.node` floor below — not the newest `@types/node` major, which would type-check correctly on this dev machine's newer local Node but not match production. All target versions below were confirmed against the npm registry on 2026-08-26.

| Package | Current | Target |
|---|---|---|
| `react` | `19.0.0` | `19.2.8` |
| `react-dom` | `19.0.0` | `19.2.8` |
| `@types/react` | `^19.0.0` | `^19.2.18` |
| `@types/react-dom` | `^19.0.0` | `^19.2.5` |
| `zod` | `^4.3.6` | `^4.4.3` |
| `@prisma/client` | `^6.1.0` | `^6.19.3` |
| `prisma` | `^6.1.0` | `^6.19.3` |
| `@types/node` | `^22.10.0` | `^22.20.1` |
| `autoprefixer` | `^10.4.20` | `^10.5.4` |
| `postcss` | `^8.4.49` | `^8.5.26` |
| `prettier` | `^3.4.2` | `^3.9.6` |
| `tailwindcss` | `^3.4.17` | `^3.4.19` |
| `dotenv` | `^16.4.5` | `^17.4.2` |
| `framer-motion` | `^11.11.17` | `^13.1.1` |
| `highlight.js` | `^11.10.0` | `^11.12.0` |
| `lucide-react` | `^0.460.0` | `^1.34.0` |
| `react-icons` | `^5.5.0` | `^5.7.0` |
| `react-markdown` | `^10.0.0` | `^10.1.0` |

`vitest` is already at latest (`^4.1.11`) — no change.

- [ ] **Step 1: Bump `engines.node` floor**

In `package.json`, change:
```json
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  },
```
to:
```json
  "engines": {
    "node": ">=20.9.0",
    "npm": ">=10.0.0"
  },
```
(Next 16, landing in Task 2, requires Node `20.9.0`; raising the floor here keeps `package.json` internally consistent from the first commit of this run.)

- [ ] **Step 2: Bump the dependency versions from the table above**

Edit the `dependencies` and `devDependencies` blocks in `package.json` to the exact target values listed in the table (keep the existing `^`/exact-pin style per package — `react`/`react-dom` stay unprefixed exact versions, everything else keeps its `^`).

- [ ] **Step 3: Install and verify**

```bash
npm install
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. `tsc --strict` will catch removed/renamed named exports from `framer-motion`, `lucide-react`, and `@types/node` (this codebase imports specific icons from `lucide-react` and uses `framer-motion`'s `motion`/`AnimatePresence` — a rename shows up as a type error, a runtime-only behavior change would not, so a green `type-check` here is real but partial evidence). If `npm run lint` fails, stop and diagnose before proceeding — this task touches nothing lint-related, so a failure here means something in the table unexpectedly needs a closer look, not a Next 16/ESLint 10 issue (those land in Task 2).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump dependencies (react, prisma-client 6.x, framer-motion, lucide-react, dotenv, and others) to latest within scope"
```

---

### Task 2: Next.js 15 → 16 (keeping Webpack), ESLint 9 → 10, lint tooling migration

**Files:**
- Modify: `package.json` (`next`, `eslint`, `eslint-config-next`, `"build"`/`"dev"` scripts)
- Modify: `scripts/run-web.js:146`
- Delete: `.eslintrc.json` (replaced by the codemod)
- Create: `eslint.config.mjs` (generated by the codemod)

**Interfaces:** None — no application code changes; this task only migrates config, scripts, and tooling.

Two facts confirmed directly against Next.js 16's own source and docs while writing this plan (not inferred):

1. **Turbopack is the default bundler in Next 16, and a project with a custom `webpack` config and no `turbopack` config makes `next build`/`next dev` exit with code 1** (from `packages/next/src/lib/turbopack-warning.ts`: `if (process.env.TURBOPACK === 'auto' && hasWebpackConfig && !hasTurboConfig) { ...; process.exit(1) }`). This repo's `next.config.js` has a `webpack:` function (excludes `fs`/`path`/`os` from the client bundle) and no `turbopack` key — it hits this guard exactly. Next ships a documented, first-class opt-out for this: the `--webpack` flag on `next build`/`next dev`, which keeps today's webpack behavior unchanged. **This task uses `--webpack`, not a Turbopack migration** — the Docker image's `output: 'standalone'` behavior is proven under webpack today, and re-proving it under Turbopack is a separate migration with its own design gate (design decision 11), not something to fold into a dependency bump.
2. **`next lint` and the `eslint` key in `next.config.js` are both removed in Next 16.** This repo's `next.config.js` has no `eslint` key (checked already, clean). The official single-purpose codemod `next-lint-to-eslint-cli` migrates `.eslintrc.json` → `eslint.config.mjs` and rewrites the `"lint"` script.

The umbrella `npx @next/codemod upgrade` wizard is **not used** in this task — it is interactive (prompts for confirmation), which a non-interactive Bash tool call cannot answer, and for this repo it would do nothing beyond what's covered explicitly below: no `middleware.ts`, no `unstable_`-prefixed API usage, no `experimental_ppr`, and no sync `cookies()`/`headers()`/`draftMode()` calls exist in this codebase (already grepped clean before this plan was written) — the only two things the umbrella codemod would actually do here are the Turbopack config migration (we're deliberately not doing that — see point 1) and the lint migration (done explicitly via the single-purpose codemod below, not the wizard).

- [ ] **Step 1: Bump `next`, `eslint`, and `eslint-config-next` directly**

```json
    "next": "^16.3.3",
```
```json
    "eslint": "^10.9.1",
    "eslint-config-next": "^16.3.3",
```

- [ ] **Step 2: Add `--webpack` to the build and dev commands**

In `package.json`, change:
```json
    "dev": "node scripts/run-web.js",
    ...
    "build": "next build",
```
to:
```json
    "dev": "node scripts/run-web.js",
    ...
    "build": "next build --webpack",
```
(`dev` stays pointed at `scripts/run-web.js`, which spawns `next dev` itself — the `--webpack` flag for dev goes there, not here.)

In `scripts/run-web.js:146`, change:
```javascript
    ['next', 'dev', '--port', resolvedPort.toString(), ...passthrough],
```
to:
```javascript
    ['next', 'dev', '--webpack', '--port', resolvedPort.toString(), ...passthrough],
```

- [ ] **Step 3: Run the lint-migration codemod (dry run first, then for real)**

```bash
npx @next/codemod@latest next-lint-to-eslint-cli . --dry
```
Read the dry-run output. If it looks reasonable (creates `eslint.config.mjs` from `{"root": true, "extends": ["next/core-web-vitals"]}`, rewrites the `"lint"` script from `"next lint"` to `"eslint ."`), run it for real:
```bash
npx @next/codemod@latest next-lint-to-eslint-cli .
```
If the codemod prompts interactively despite `--dry`/direct invocation, stop and fall back to doing it by hand: delete `.eslintrc.json`, create `eslint.config.mjs` with:
```javascript
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [...compat.extends('next/core-web-vitals')];

export default eslintConfig;
```
and change `package.json`'s `"lint"` script from `"next lint"` to `"eslint ."`. (`@eslint/eslintrc`'s `FlatCompat` may need adding as a devDependency if the codemod would have added it and the manual path is used — check `npm run lint` in Step 5 for a "Cannot find module '@eslint/eslintrc'" error before assuming it's needed.)

- [ ] **Step 4: Re-confirm no leftover Next 15 sync dynamic-API usage or removed config keys**

```bash
grep -rn "unstable_\|experimental_ppr" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow --exclude=package-lock.json .
grep -n "eslint:" next.config.js
find . -maxdepth 1 -iname "middleware.ts"
```
Expected: all empty/no match (this was already confirmed clean before this task started — this step re-confirms nothing in Task 1's bumps or this task's own edits introduced any).

- [ ] **Step 5: Install and verify**

```bash
npm install
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. This is the first point where `--webpack`, the new `eslint.config.mjs`, and ESLint 10 are exercised together for real — read the actual output, don't assume. If `npm run build` still hits the Turbopack guard, the `--webpack` flag in Step 2 was not applied correctly — fix that before going further, do not add a `turbopack: {}` stub as a workaround (that silently opts into Turbopack for anything the flag doesn't cover).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/run-web.js next.config.js eslint.config.mjs .eslintrc.json
git commit -m "chore: upgrade to Next.js 16 (keep webpack via --webpack), migrate next lint to ESLint CLI (eslint 10)"
```
(`git rm` will have already staged the `.eslintrc.json` deletion if it still exists after the codemod; adjust the file list above to match whatever actually changed.)

---

### Task 3: TypeScript 5.7 → 5.9.3

**Files:**
- Modify: `package.json` (`typescript`)

**Interfaces:** None.

Design decision 10: `typescript@7.0.2` was ruled out during this plan's red-team pass — its `package.json` `exports` map resolves the root import to `./lib/version.cjs` only (no compiler API, just the `bin/tsc` binary and experimental `./unstable/*` paths), and `typescript-eslint` (pulled in by `eslint-config-next`, landed in Task 2) declares a hard peer requirement of `typescript: ">=4.8.4 <6.1.0"` — installing `7.0.2` alongside it would produce an `ERESOLVE` conflict, not just a red lint run. `5.9.3` is the latest TypeScript 5.x, clears Next 16's `>=5.1.0` floor, and is what `typescript-eslint` actually supports.

- [ ] **Step 1: Bump `typescript`**

```json
    "typescript": "^5.9.3",
```

- [ ] **Step 2: Install and verify**

```bash
npm install
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS — no known-issue branching needed here, unlike the ruled-out 7.0.2 path. If any of these fail, it is a real regression from the 5.7→5.9 bump (unlikely but not impossible — TS 5.8/5.9 tightened some strict-mode inference rules) and must be fixed, not waived.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade TypeScript 5.7 -> 5.9.3"
```

---

### Task 4: Electron 39 → 44

**Files:**
- Modify: `package.json` (`electron`, `electron-builder`)

**Interfaces:** None.

Checked against this repo's actual `electron/main.js` and `electron/preload.js`: neither uses the `clipboard` module, `setPermissionRequestHandler`, or any ASAR/native-addon file-descriptor access — the three areas flagged as breaking between Electron 39 and 44. Also checked: the `Dockerfile`'s `deps` stage runs `npm ci --ignore-scripts` (`Dockerfile:7`), which already skips Electron's own postinstall binary download today, at Electron 39 — so Electron 42's change to that download mechanism changes nothing for this repo's Docker path (the binary was never being fetched there either way; the Docker image is a headless web server and never runs Electron code). The only place Electron's binary actually needs to download is a real desktop dev/build machine (`npm run dev:desktop` / `npm run build:desktop`), which this task's automated gate does not exercise — see Step 3.

- [ ] **Step 1: Bump `electron` and `electron-builder`**

```json
    "electron": "^44.0.0",
    "electron-builder": "^26.15.3",
```

- [ ] **Step 2: Install and confirm the Electron binary actually resolves**

```bash
npm install
npx electron --version
```
Expected: prints `v44.0.0` (or the patch version npm actually resolved). This is a real check, not a re-grep of app source that a version bump cannot have changed — it proves the binary download succeeded on this machine and the package works enough to report its own version.

- [ ] **Step 3: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all PASS. None of these four commands execute any code under `electron/` (it is not part of the Next.js app's module graph), so this gate proves the Next.js side of the repo still works with `electron` at 44 in `node_modules` — it does not exercise Electron itself. Packaging a real desktop build (`npm run package:<platform>`) needs platform-specific code-signing tooling this environment doesn't have; note this as a manual follow-up in Task 6, don't attempt to fake it here.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade Electron 39 -> 44 and electron-builder 25 -> 26"
```

---

### Task 5: Claude Agent SDK 0.2.68 → 0.3.246

**Files:**
- Modify: `package.json` (`@anthropic-ai/claude-agent-sdk`, plus new explicit `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` dependencies)
- Modify: `Dockerfile:95-101`
- Modify: `lib/services/cli/claude.ts:31-63` (`TOOL_NAME_ACTION_MAP`), and its `inferActionFromToolName` function (currently unexported, at line 107)
- Modify: `components/chat/ChatLog.tsx:20-52` (duplicate `TOOL_NAME_ACTION_MAP`), `:96-108` (duplicate `inferActionFromToolName`), `:843`, `:881-885`, `:1576`
- Create: `tests/cli/claude-tool-actions.test.ts`

**Interfaces:**
- Consumes: `ToolAction` type, `TOOL_NAME_ACTION_MAP`, and `inferActionFromToolName` already defined (module-private) in `lib/services/cli/claude.ts:29-63,107-119`.
- Produces: `export const TOOL_NAME_ACTION_MAP: Record<string, ToolAction>` and `export const inferActionFromToolName = (toolName: unknown): ToolAction | undefined => ...` — same shapes as today, just exported instead of module-private.

Four things confirmed directly against the SDK's docs and the live npm registry while writing this plan:

1. **`TodoWrite` → Task tools rename.** As of TypeScript Agent SDK `0.3.142` (this bump lands on `0.3.246`, past that point), sessions default to `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList` instead of the legacy `TodoWrite` tool (`code.claude.com/docs/en/agent-sdk/todo-tracking`).
2. **This mapping is duplicated in this codebase, and the plan's earlier draft only caught one copy.** `lib/services/cli/claude.ts:29-63,107-119` and `components/chat/ChatLog.tsx:12,20-52,96-108` are byte-identical copies of the same `ToolAction` type, `TOOL_NAME_ACTION_MAP`, and `inferActionFromToolName`. Both need the new entries — missing either one leaves that copy falling through to the generic `normalizeAction` substring matcher, which actively mislabels the new names: `"taskcreate".includes('create')` → `'Created'`, `"taskupdate".includes('update')` → `'Edited'`, both wrong. This task fixes both copies (not a shared-module extraction — that's a larger refactor than this bug needs; mirroring the existing duplication pattern is the smaller, lower-risk fix).
3. **The SDK's peer dependencies changed shape, and it breaks the Docker runtime image if not handled.** `@anthropic-ai/claude-agent-sdk@0.2.68` has `peerDependencies: { zod }` only — `0.3.246` adds `"@anthropic-ai/sdk": ">=0.93.0"` and `"@modelcontextprotocol/sdk": "^1.29.0"`, with no `peerDependenciesMeta` (neither is optional). Standalone-output tracing bundles the app's own imports but the SDK spawns its `cli.js` by a path frozen at build time (see the existing comment at `Dockerfile:95-100`), so the runtime image must have the real `node_modules` tree for the SDK and everything it needs — and today `Dockerfile:101` copies only the `@anthropic-ai` scope. `@modelcontextprotocol/sdk` is a different scope and would be silently missing from the production image, exactly the "container starts healthy, first agent message fails" failure class the existing comment describes. This task adds both packages as explicit `dependencies` (this app now genuinely depends on them, not just transitively) and widens the Dockerfile `COPY`.
4. **No code change needed for two other things flagged in design** (recorded here so the next person doesn't re-litigate them): `options.env` fully replacing `process.env` instead of merging is already how `claude-options.ts`'s `childEnv()` works (spreads `{...process.env}` before deleting platform-only keys); `tests/cli/claude-options.test.ts` already asserts this. MCP servers connecting asynchronously by default doesn't change behavior for `mcp-servers-loader.ts` specifically, because SDK docs confirm stdio/HTTP/SSE servers **without cached tools still delay the first turn** until connected (default 30s), and this loader has no tool-caching.

- [ ] **Step 1: Write the failing test**

Create `tests/cli/claude-tool-actions.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { TOOL_NAME_ACTION_MAP } from '@/lib/services/cli/claude';

describe('TOOL_NAME_ACTION_MAP — Task tools (Agent SDK 0.3, replaces TodoWrite)', () => {
  it('mapuje warianty TaskCreate na Generated, tak jak dawne TodoWrite', () => {
    expect(TOOL_NAME_ACTION_MAP['task_create']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['taskcreate']).toBe('Generated');
  });

  it('mapuje warianty TaskUpdate na Generated', () => {
    expect(TOOL_NAME_ACTION_MAP['task_update']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['taskupdate']).toBe('Generated');
  });

  it('mapuje warianty TaskList i TaskGet na Generated', () => {
    expect(TOOL_NAME_ACTION_MAP['task_list']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['tasklist']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['task_get']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['taskget']).toBe('Generated');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/cli/claude-tool-actions.test.ts
```
Expected: FAIL — `TOOL_NAME_ACTION_MAP` is not exported yet from `claude.ts`, so this fails at the import. That is the correct RED for this step; Step 3 both exports the map and adds the entries, so Step 4's green is a real assertion pass, not just an import succeeding.

- [ ] **Step 3: Bump the SDK and add the new explicit peer dependencies**

```json
    "@anthropic-ai/claude-agent-sdk": "^0.3.246",
    "@anthropic-ai/sdk": "^0.120.0",
    "@modelcontextprotocol/sdk": "^1.30.0",
```

- [ ] **Step 4: Export the map, extend it, in `lib/services/cli/claude.ts`**

Change line 29-31 from:
```typescript
type ToolAction = 'Edited' | 'Created' | 'Read' | 'Deleted' | 'Generated' | 'Searched' | 'Executed';

const TOOL_NAME_ACTION_MAP: Record<string, ToolAction> = {
```
to:
```typescript
type ToolAction = 'Edited' | 'Created' | 'Read' | 'Deleted' | 'Generated' | 'Searched' | 'Executed';

export const TOOL_NAME_ACTION_MAP: Record<string, ToolAction> = {
```

And extend the map (currently ending at line 63 with `plan_write: 'Generated',`) by adding these entries alongside the existing `todo_write`/`todo`/`plan_write` ones:
```typescript
  task_create: 'Generated',
  taskcreate: 'Generated',
  task_update: 'Generated',
  taskupdate: 'Generated',
  task_get: 'Generated',
  taskget: 'Generated',
  task_list: 'Generated',
  tasklist: 'Generated',
```
(Both the `snake_case` and the lowercased-no-separator forms are added because `inferActionFromToolName` normalizes to lowercase but does not strip underscores — see the existing `todo_write`/`todo` pair for the same pattern.)

Also export `inferActionFromToolName` (line 107) the same way, since Task 6's smoke test and any future caller may need it directly:
```typescript
export const inferActionFromToolName = (toolName: unknown): ToolAction | undefined => {
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/cli/claude-tool-actions.test.ts
```
Expected: PASS.

- [ ] **Step 6: Apply the identical map extension to the duplicate copy in `ChatLog.tsx`**

In `components/chat/ChatLog.tsx`, the `TOOL_NAME_ACTION_MAP` at lines 20-52 gets the same eight entries added as Step 4 (right after the existing `todo_write`/`todo`/`plan_write` lines, same values). This copy stays module-private (`const`, not `export`) — it is not imported anywhere outside this file, so no export needed here, only the map contents need to match.

- [ ] **Step 7: Mirror the tool-name rename in `ChatLog.tsx`'s rendering logic**

At `components/chat/ChatLog.tsx:843`, change:
```typescript
      const toolMatch = processedContent.match(/\*\*(Read|LS|Glob|Grep|Edit|Write|Bash|MultiEdit|TodoWrite)\*\*\s*`?([^`\n]+)`?/);
```
to:
```typescript
      const toolMatch = processedContent.match(/\*\*(Read|LS|Glob|Grep|Edit|Write|Bash|MultiEdit|TodoWrite|TaskCreate|TaskUpdate|TaskGet|TaskList)\*\*\s*`?([^`\n]+)`?/);
```

Add a case to the `switch (toolName)` block right after the existing `case 'TodoWrite':` (around line 881-885):
```typescript
          case 'TaskCreate':
          case 'TaskUpdate':
          case 'TaskGet':
          case 'TaskList':
            action = 'Generated';
            filePath = 'Task List';
            cleanContent = undefined;
            break;
```

And in the standalone detection regex at `components/chat/ChatLog.tsx:1576`, change:
```typescript
      /\*\*(Read|LS|Glob|Grep|Edit|Write|Bash|Task|WebFetch|WebSearch|MultiEdit|TodoWrite)\*\*/,
```
to:
```typescript
      /\*\*(Read|LS|Glob|Grep|Edit|Write|Bash|Task|TaskCreate|TaskUpdate|TaskGet|TaskList|WebFetch|WebSearch|MultiEdit|TodoWrite)\*\*/,
```
(The bare `Task` alternative already there is the general-purpose subagent-dispatch tool — unrelated, keep it as-is.)

- [ ] **Step 8: Widen the Dockerfile COPY to include the new peer dependency scope**

In `Dockerfile`, change the comment and `COPY` at lines 95-101 from:
```dockerfile
# SDK agenta trace standalone bundluje do JavaScriptu, więc samego pakietu nie
# kopiuje — a zbundlowany kod spawnuje `cli.js` po ścieżce zamrożonej w
# buildzie: /app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js. Bez tego
# katalogu pierwsza instrukcja wysłana do agenta pada na "Cannot find module",
# czyli cała funkcja produktu, i to dopiero przy pierwszym użyciu — start
# kontenera wygląda zdrowo.
COPY --from=build --chown=node:node /app/node_modules/@anthropic-ai ./node_modules/@anthropic-ai
```
to:
```dockerfile
# SDK agenta trace standalone bundluje do JavaScriptu, więc samego pakietu nie
# kopiuje — a zbundlowany kod spawnuje `cli.js` po ścieżce zamrożonej w
# buildzie: /app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js. Bez tego
# katalogu pierwsza instrukcja wysłana do agenta pada na "Cannot find module",
# czyli cała funkcja produktu, i to dopiero przy pierwszym użyciu — start
# kontenera wygląda zdrowo.
#
# Od Agent SDK 0.3 dochodzą do tego dwa realne (nie-optional) peer
# dependencies: @anthropic-ai/sdk i @modelcontextprotocol/sdk. cli.js ich
# require'uje w czasie działania, więc muszą wejść tą samą ścieżką co SDK —
# standalone trace ich też nie złapie, tym samym mechanizmem co wyżej.
COPY --from=build --chown=node:node /app/node_modules/@anthropic-ai ./node_modules/@anthropic-ai
COPY --from=build --chown=node:node /app/node_modules/@modelcontextprotocol ./node_modules/@modelcontextprotocol
```

- [ ] **Step 9: Install and positively confirm the new peer deps resolve (not just "no warning")**

```bash
npm install
node -e "console.log(require.resolve('@modelcontextprotocol/sdk/package.json'))"
node -e "console.log(require.resolve('@anthropic-ai/sdk/package.json'))"
```
Expected: both print a real path under `node_modules/`. A silent, warning-free `npm install` is not sufficient proof by itself — npm auto-installs non-optional missing peers without necessarily warning, so the positive `require.resolve` is the actual test.

- [ ] **Step 10: Prove the Docker runtime image actually contains both scopes**

```bash
docker build -t claudable:deps-upgrade-check .
docker run --rm --entrypoint node claudable:deps-upgrade-check -e "require.resolve('@modelcontextprotocol/sdk/package.json'); require.resolve('@anthropic-ai/claude-agent-sdk/cli.js'); console.log('ok')"
docker rmi claudable:deps-upgrade-check
```
The `docker build` is a full multi-stage build (apt-get installs, `npm ci`, `prisma generate`, `next build` inside the image) and can easily take several minutes on a cold cache — give it a generous timeout (10 minutes) rather than the default and don't treat a slow-but-progressing build as a hang. Expected: `docker run` prints `ok`. This does not need `--env-file`/`ENCRYPTION_KEY`/bind mounts — it overrides the container's entrypoint to run a one-off Node check instead of the real startup command, so it's a pure "does the file exist in this image" proof, not a full app boot. If this fails with `Cannot find module`, Step 8's `COPY` line is wrong — fix it before moving on; this is the one step in this whole plan that directly proves Blocking-3 is actually fixed, not just that `package.json` looks right. The final `docker rmi` cleans up the check image so it doesn't linger next to the real `claudable:dev` image.

- [ ] **Step 11: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all PASS — this includes `tests/cli/claude-options.test.ts`'s existing env-scrub assertions and the new `claude-tool-actions.test.ts`.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json Dockerfile lib/services/cli/claude.ts components/chat/ChatLog.tsx tests/cli/claude-tool-actions.test.ts
git commit -m "feat: upgrade Claude Agent SDK 0.2 -> 0.3, recognize Task tools that replaced TodoWrite, fix Docker peer-dep gap"
```

---

### Task 6: Final verification gate, manual smoke test, and wrap-up

**Files:** None modified — verification only.

**Interfaces:** None.

- [ ] **Step 1: Run the full gate one more time on the fully-upgraded tree**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all PASS.

- [ ] **Step 2: Confirm no accidental scope creep**

```bash
git diff main --stat
```
Every changed file should trace to one of Tasks 1-5 above (dependency manifests, `next.config.js` if touched, `scripts/run-web.js`, `.eslintrc.json`/`eslint.config.mjs`, `Dockerfile`, `lib/services/cli/claude.ts`, `components/chat/ChatLog.tsx`, and the two new test files). Nothing else.

- [ ] **Step 3: Confirm the deferred-scope packages were left alone, and the risky ones landed where intended**

```bash
grep -n "\"prisma\"\|\"@prisma/client\"\|\"tailwindcss\"\|\"typescript\"\|\"next\"" package.json
grep -n -- "--webpack" package.json scripts/run-web.js
grep -n "@modelcontextprotocol" Dockerfile
```
Expected: `prisma`/`@prisma/client` at `^6.19.3` (not 7.x/8.x), `tailwindcss` at `^3.4.19` (not 4.x), `typescript` at `^5.9.3` (not 7.x), `next` at `^16.3.3`; `--webpack` present in both the `package.json` `build` script and `scripts/run-web.js`; `@modelcontextprotocol` present in `Dockerfile`.

- [ ] **Step 4: Manual smoke test — actually run the app and send the SDK a message**

This is the one part of the upgrade that automated type-checking cannot prove: `lib/services/cli/claude.ts`'s streaming loop dispatches on string discriminants from the SDK's event stream (`stream_event`, `tool_use`, etc.) — a changed field *shape* inside an existing union member would not be caught by `tsc`, only a removed/renamed member would. Use the `run` skill (or `npm run dev` directly) to start the app, open or create one project, send it a single message that would make the agent use its todo/task-tracking behavior (e.g. "make a small multi-step plan and track it with todos"), and confirm in the browser that: the response streams normally, and any Task-tool activity renders with a sensible label (not a raw "Tool action" fallback) — this is the empirical proof that Step 4/6/7 of Task 5 actually connected correctly, matching this project's own established convention of proving SDK behavior by running it (see the earlier design record's decision on logging the SDK's `init` payload as proof, not just relying on types).

- [ ] **Step 5: Record the outcome for the branch-review / finish stage**

No spec to sync (see header). Note for whoever reviews the branch: `npm run package:<platform>` (real Electron desktop packaging) was not exercised by this plan — it needs platform-specific code-signing tooling this environment doesn't have — so a manual desktop-build smoke test is a follow-up, not part of this run's proof. Tailwind 3→4 and Prisma 6→7 remain explicitly out of scope (design decisions 8 and 2) for future runs.
