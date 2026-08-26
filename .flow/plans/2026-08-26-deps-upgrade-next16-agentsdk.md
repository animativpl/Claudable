# Aktualizacja zależności — Next.js 16, Claude Agent SDK 0.3, TypeScript 7, Electron 44 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `next`, `@anthropic-ai/claude-agent-sdk`, `typescript`, `electron`, and the rest of `package.json`'s dependencies to their latest versions (Prisma and Tailwind CSS majors excluded — deferred to their own migrations), with every breaking change identified in design actually verified against this codebase, not assumed away.

**Architecture:** No new subsystem — this is a dependency-upgrade task. Six tasks, each bumping a coherent group of packages and re-running the verification gate (`type-check`, `test`, `lint`, `build`). Two tasks touch actual application code because the bump lands directly on it: Task 2 (Next 16 removes `next lint`, forcing a lint-tooling migration) and Task 5 (Agent SDK 0.3 renames the `TodoWrite` tool to `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`, which this app's tool-name-to-display-label mapping needs to recognize).

**Tech Stack:** Next.js (App Router), TypeScript strict, vitest, npm.

**Spec:** project has no living `spec.md` (confirmed in the design record, section 1) — this plan's last task does **not** include a spec-sync step; there is nothing to keep true.

**Design record:** `.flow/specs/2026-08-26-deps-upgrade-next16-agentsdk-design.md`

## Global Constraints

- Prisma stays within 6.x this run (design decision 2) — do **not** bump `@prisma/client` or `prisma` past `6.19.3`, and never touch the `prisma` package's raw npm `latest` tag (it currently resolves to an `8.0.0-rc.11` prerelease).
- Tailwind CSS stays within 3.x this run (design decision 8) — target `3.4.19`, not 4.x.
- A "test" for a pure version bump (no code change in that task) is the existing verification gate actually passing — there is no new failing-test-first step for those tasks; TDD's red/green cycle applies only where this plan adds real code (Task 5).
- Every verification command must actually be run and its real output read — a task is not done because the bump "should" work.
- Verification greps exclude, never enumerate: `-I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow --exclude=package-lock.json .`
- Commit messages: English, imperative mood, matching this repo's existing convention (see `git log`).
- Full verification gate (used at the end of every task): `npm run type-check && npm test && npm run lint && npm run build`.

---

### Task 1: Low-risk dependency bumps (no lint/tooling coupling)

**Files:**
- Modify: `package.json:34-67` (dependencies, devDependencies, engines)

**Interfaces:** None — no code changes, version bumps only.

Bumps everything that does **not** touch the ESLint/lint-tooling chain (kept out because Task 2 and Task 3 change that chain together — mixing an eslint-adjacent bump into this task would make a later lint failure ambiguous to attribute). All target versions below were confirmed against the npm registry on 2026-08-26.

| Package | Current | Target |
|---|---|---|
| `react` | `19.0.0` | `19.2.8` |
| `react-dom` | `19.0.0` | `19.2.8` |
| `@types/react` | `^19.0.0` | `^19.2.18` |
| `@types/react-dom` | `^19.0.0` | `^19.2.5` |
| `zod` | `^4.3.6` | `^4.4.3` |
| `@prisma/client` | `^6.1.0` | `^6.19.3` |
| `prisma` | `^6.1.0` | `^6.19.3` |
| `@types/node` | `^22.10.0` | `^26.3.0` |
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

Run:
```bash
npm install
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. If `npm run lint` fails, stop and diagnose before proceeding — this task touches nothing lint-related, so a failure here means something in the table unexpectedly needs a closer look (e.g., a transitive peer-dependency conflict), not a TS7/eslint10 issue (those land in later tasks).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump low-risk dependencies to latest within their current major"
```

---

### Task 2: Next.js 15 → 16, ESLint 9 → 10, lint tooling migration

**Files:**
- Modify: `package.json` (`next`, `eslint`, `eslint-config-next`, `lint` script)
- Modify: `next.config.js` (only if the codemod changes it)
- Delete: `.eslintrc.json` (replaced by the codemod)
- Create: `eslint.config.mjs` (generated by the codemod)

**Interfaces:** None — no application code changes; this task only migrates config and tooling.

Confirmed via Next.js's own v16 upgrade docs: `next lint` and the `eslint` key in `next.config.js` are both removed in Next 16. The official codemod handles the full migration (Turbopack config relocation, `next lint` → ESLint CLI, `middleware` → `proxy` rename, `unstable_` prefix removal, `experimental_ppr` removal) — this repo was already checked and has **no** `middleware.ts`, no `unstable_`-prefixed API usage, no `experimental_ppr`, and no sync `cookies()`/`headers()`/`draftMode()` calls, so the codemod's work here should be close to a no-op beyond the lint migration. Verify that assumption rather than trust it.

- [ ] **Step 1: Bump `next` and run the upgrade codemod**

```bash
npm install next@latest
npx @next/codemod@canary upgrade latest
```
The codemod may prompt interactively — accept its suggested changes. It updates `next`, `react`, `react-dom` itself; after it finishes, confirm `react`/`react-dom` are still at the Task 1 versions (`19.2.8`) — if the codemod bumped them further, that is fine (matches "latest"), but note the new version in the commit.

- [ ] **Step 2: Run the lint-migration codemod explicitly (in case the umbrella codemod skipped it)**

```bash
npx @next/codemod@canary next-lint-to-eslint-cli .
```
This creates `eslint.config.mjs` from the existing `.eslintrc.json` (`{"root": true, "extends": ["next/core-web-vitals"]}`), rewrites the `"lint"` script in `package.json` from `"next lint"` to `"eslint ."`, and adds any ESLint dependencies it decides are needed.

- [ ] **Step 3: Bump `eslint` and `eslint-config-next` explicitly**

In `package.json`, set:
```json
    "eslint": "^10.9.1",
    "eslint-config-next": "^16.3.3",
```
(match `eslint-config-next` to whatever exact `next` version Step 1 landed on if it differs from `16.3.3`.)

- [ ] **Step 4: Verify no leftover Next 15 sync dynamic-API usage or removed config keys**

```bash
grep -rn "unstable_\|experimental_ppr" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow --exclude=package-lock.json .
grep -n "eslint:" next.config.js
```
Expected: both empty/no match (this was already confirmed clean before this task started — this step re-confirms the codemod didn't introduce any).

- [ ] **Step 5: Install and verify**

```bash
npm install
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS. This is the first point where the new `eslint.config.mjs` + ESLint 10 combination is exercised for real — read the actual `npm run lint` output, don't assume.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: upgrade to Next.js 16, migrate next lint to ESLint CLI (eslint 10)"
```

---

### Task 3: TypeScript 5.7 → 7.0.2

**Files:**
- Modify: `package.json` (`typescript`)

**Interfaces:** None.

Next 16 requires TypeScript ≥5.1.0 (confirmed via Next's own docs), so `7.0.2` clears that floor. The open question — confirmed as a real risk in the design record, not resolved yet — is whether `typescript-eslint` (pulled in transitively by `eslint-config-next`) works against the new Go-based `tsgo` compiler. This task's job is to find out for real and record the outcome, not to guess.

- [ ] **Step 1: Bump `typescript`**

```json
    "typescript": "^7.0.2",
```

- [ ] **Step 2: Install and run type-check first, in isolation**

```bash
npm install
npm run type-check
```
Record the exact result. `tsc --noEmit`-equivalent checking is the part of TS7 most likely to just work (tsgo's CLI is designed as a drop-in for `tsc`); if this fails, it is a real regression to fix (project-wide `strict: true` may surface new-in-TS7 diagnostics) — read every error before deciding it's a fix vs. a false start.

- [ ] **Step 3: Run lint and record what happens**

```bash
npm run lint
```
Two possible outcomes, both acceptable — the user explicitly chose "jump to 7.0.2 anyway, accept lint may break" over staying on TypeScript 5.x:
- **PASS** — `typescript-eslint` already supports TS7 (fully possible; TS 7.0 GA'd in July 2026 and the ecosystem may have caught up by now). Nothing further to do.
- **FAIL due to a `typescript-eslint`/TS7 incompatibility** (e.g. a crash inside the parser, not a real lint violation in this repo's code) — this is the accepted, known trade-off from the design gate. Do not attempt to hack around it (no downgrading TypeScript back to 5.x, no disabling all of ESLint). Confirm the failure is specifically about TS7 compatibility (read the actual error), then record it plainly in the Task 3 commit message and in the final Task 6 summary so it is visible, not silently swallowed.

- [ ] **Step 4: Full gate**

```bash
npm test && npm run build
```
Expected: both PASS regardless of the Step 3 outcome (lint is the one component with permission to be red here).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade TypeScript 5.7 -> 7.0.2 (tsgo)"
```
If Step 3 was a known-issue FAIL, say so explicitly in the commit body (one or two lines: what broke, why it's accepted).

---

### Task 4: Electron 39 → 44

**Files:**
- Modify: `package.json` (`electron`, `electron-builder`)

**Interfaces:** None.

Checked against this repo's actual `electron/main.js` and `electron/preload.js`: neither uses the `clipboard` module, `setPermissionRequestHandler`, or any ASAR/native-addon file-descriptor access — the three areas flagged as breaking between Electron 39 and 44. This task's verification step re-confirms that after the bump rather than trusting the pre-check.

- [ ] **Step 1: Bump `electron` and `electron-builder`**

```json
    "electron": "^44.0.0",
    "electron-builder": "^26.15.3",
```

- [ ] **Step 2: Install and verify no breaking-API usage was introduced**

```bash
npm install
grep -rn "clipboard\|setPermissionRequestHandler" electron/ || echo "none"
```
Expected: `none` (matches the pre-check above — this just re-confirms after the version bump touched `node_modules`, in case a postinstall step or type update changed anything observable).

- [ ] **Step 3: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all PASS. (Packaging a real Electron binary via `npm run build:desktop` / `electron-builder` is not part of this gate — it needs platform-specific code-signing tooling this environment doesn't have. Note in the Task 6 summary that a manual `npm run package:<platform>` smoke test is a follow-up, not covered here.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade Electron 39 -> 44 and electron-builder 25 -> 26"
```

---

### Task 5: Claude Agent SDK 0.2.68 → 0.3.246

**Files:**
- Modify: `package.json` (`@anthropic-ai/claude-agent-sdk`)
- Modify: `lib/services/cli/claude.ts:31-63` (`TOOL_NAME_ACTION_MAP`), and its `inferActionFromToolName` function (currently unexported, at line 107)
- Modify: `components/chat/ChatLog.tsx:843`, `:881-885`, `:1576`
- Create: `tests/cli/claude-tool-actions.test.ts`

**Interfaces:**
- Consumes: `ToolAction` type and `TOOL_NAME_ACTION_MAP` already defined in `lib/services/cli/claude.ts:29-63`.
- Produces: `export function inferActionFromToolName(toolName: unknown): ToolAction | undefined` (same signature as today, just exported instead of module-private).

Verified via the SDK's own docs (`code.claude.com/docs/en/agent-sdk/todo-tracking`): as of TypeScript Agent SDK `0.3.142` (this bump goes to `0.3.246`, past that point), sessions default to the Task tools (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) instead of the legacy `TodoWrite` tool. Two places in this app map raw tool names to a UI action/label, both keyed on the old name only — both need the new names added, mirroring exactly how `TodoWrite`/`todo_write` are already handled (action `'Generated'`).

Also verified and requiring **no code change** (recorded here so the next person doesn't re-litigate it):
- `options.env` fully replacing `process.env` instead of merging (confirmed via SDK docs: "`env` replaces the subprocess environment, so keep inherited variables") is already how `lib/services/cli/claude-options.ts`'s `childEnv()` works today — it spreads `{...process.env}` before deleting platform-only keys, so it was never relying on merge semantics. `tests/cli/claude-options.test.ts` already asserts non-Claude env vars survive; Step 4 below re-runs it as regression proof, nothing new to write.
- MCP servers connecting asynchronously: confirmed via SDK docs that stdio/HTTP/SSE servers **without cached tools still delay the first turn** until connected (default 30s timeout via `MCP_TIMEOUT`) — this app's `mcp-servers-loader.ts` has no tool-caching, so behavior is unchanged. No `alwaysLoad` needed.
- `@anthropic-ai/sdk` / `@modelcontextprotocol/sdk` moving to `peerDependencies`: grepped this repo for direct imports of either package — none exist. `npm install`'s own peer-dependency resolution (Step 2 below) is the real test; only add them to `package.json` explicitly if that install step actually warns or fails.

- [ ] **Step 1: Write the failing test**

Create `tests/cli/claude-tool-actions.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { inferActionFromToolName } from '@/lib/services/cli/claude';

describe('inferActionFromToolName — Task tools (Agent SDK 0.3, replaces TodoWrite)', () => {
  it('mapuje TaskCreate na Generated, tak jak dawne TodoWrite', () => {
    expect(inferActionFromToolName('TaskCreate')).toBe('Generated');
    expect(inferActionFromToolName('task_create')).toBe('Generated');
  });

  it('mapuje TaskUpdate na Generated', () => {
    expect(inferActionFromToolName('TaskUpdate')).toBe('Generated');
    expect(inferActionFromToolName('task_update')).toBe('Generated');
  });

  it('mapuje TaskList i TaskGet na Generated', () => {
    expect(inferActionFromToolName('TaskList')).toBe('Generated');
    expect(inferActionFromToolName('TaskGet')).toBe('Generated');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/cli/claude-tool-actions.test.ts
```
Expected: FAIL — `inferActionFromToolName` is not exported yet (`claude.ts` has no `export` on it), so this fails at the import, not at an assertion. That is the correct RED for this step.

- [ ] **Step 3: Bump the SDK, export the function, and extend the map**

```json
    "@anthropic-ai/claude-agent-sdk": "^0.3.246",
```

In `lib/services/cli/claude.ts`, change line 107 from:
```typescript
const inferActionFromToolName = (toolName: unknown): ToolAction | undefined => {
```
to:
```typescript
export const inferActionFromToolName = (toolName: unknown): ToolAction | undefined => {
```

And extend `TOOL_NAME_ACTION_MAP` (currently `lib/services/cli/claude.ts:31-63`) by adding these entries alongside the existing `todo_write`/`todo`/`plan_write` ones:
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
(Both the `snake_case` and the lowercased-no-separator forms are added because `inferActionFromToolName` normalizes to lowercase but does not strip underscores — see the existing `todo_write`/`todo` pair for the same pattern. Without the explicit `taskcreate`/`taskupdate` entries, `normalizeAction`'s generic substring fallback would mislabel them: `"taskcreate".includes('create')` → `'Created'`, `"taskupdate".includes('update')` → `'Edited'`, both wrong.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/cli/claude-tool-actions.test.ts
```
Expected: PASS.

- [ ] **Step 5: Mirror the same rename in `ChatLog.tsx`**

In `components/chat/ChatLog.tsx:843`, change:
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

- [ ] **Step 6: Install and check for peer-dependency warnings**

```bash
npm install 2>&1 | tee /tmp/npm-install-sdk-bump.log
grep -i "peer dep\|UNMET PEER" /tmp/npm-install-sdk-bump.log || echo "no peer dep warnings"
```
If `@anthropic-ai/sdk` or `@modelcontextprotocol/sdk` show up as unmet peers, add them explicitly to `package.json` `dependencies` at whatever version `npm install` recommends, then re-run `npm install`. If the grep prints "no peer dep warnings", no action needed — this confirms the earlier no-direct-import check was sufficient.

- [ ] **Step 7: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all PASS — this includes `tests/cli/claude-options.test.ts`'s existing env-scrub assertions (the `options.env` regression proof noted above) and the new `claude-tool-actions.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/services/cli/claude.ts components/chat/ChatLog.tsx tests/cli/claude-tool-actions.test.ts
git commit -m "feat: upgrade Claude Agent SDK 0.2 -> 0.3, recognize Task tools that replaced TodoWrite"
```

---

### Task 6: Final verification gate and wrap-up

**Files:** None modified — verification only, plus the final commit if anything is outstanding.

**Interfaces:** None.

- [ ] **Step 1: Run the full gate one more time on the fully-upgraded tree**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: same outcome as the last task (all PASS, or lint red only if Task 3 recorded a known TS7/`typescript-eslint` incompatibility).

- [ ] **Step 2: Confirm no accidental scope creep**

```bash
git diff main --stat
```
Every changed file should trace to one of Tasks 1-5 above (dependency manifests, `next.config.js`/eslint config if the codemod touched them, `lib/services/cli/claude.ts`, `components/chat/ChatLog.tsx`, the two new test files). Nothing else.

- [ ] **Step 3: Confirm the deferred-scope packages were left alone**

```bash
grep -n "\"prisma\"\|\"@prisma/client\"\|\"tailwindcss\"" package.json
```
Expected: `prisma`/`@prisma/client` at `^6.19.3` (not 7.x/8.x), `tailwindcss` at `^3.4.19` (not 4.x) — per design decisions 2 and 8.

- [ ] **Step 4: Record the outcome for the branch-review / finish stage**

No spec to sync (see header). If Task 3 hit the known TS7/`typescript-eslint` incompatibility, this is the place to restate it plainly for whoever reviews the branch, alongside the Task 4 note that `npm run package:<platform>` (real Electron packaging) was not exercised by this plan's gate and is a manual follow-up.
