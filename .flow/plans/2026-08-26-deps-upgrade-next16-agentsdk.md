# Aktualizacja zależności — Next.js 16, Claude Agent SDK 0.3, TypeScript 5.9, Electron 44 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `next`, `@anthropic-ai/claude-agent-sdk`, `electron`, `typescript`, and the rest of `package.json`'s dependencies to their latest versions (Prisma and Tailwind CSS majors excluded — deferred to their own migrations), with every breaking change actually verified against this codebase and against live npm registry data, not assumed.

**Architecture:** No new subsystem — this is a dependency-upgrade task. Six tasks, each bumping a coherent group of packages and re-running the verification gate (`type-check`, `test`, `lint`, `build`). Three tasks touch actual code/config beyond `package.json` because the bump lands directly on it:
- Task 2 (Next 16 makes Turbopack the default and hard-fails a build that has a `webpack` config and no `turbopack` config — this repo has exactly that shape, confirmed against Next's own source; also `next lint` is removed).
- Task 5 (Agent SDK 0.3 renames the `TodoWrite` tool to `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`, which this app's two — yes, two, they're duplicated — tool-name-to-display-label maps need to recognize; and Agent SDK 0.3 replaces its bundled `cli.js` with an ~236 MB native platform binary delivered via `optionalDependencies`, which changes what the Docker runtime image actually needs to carry and how big it gets).

**This plan went through two red-team passes before execution**, both independently verified (not just accepted) by unpacking the actual npm tarballs and reading Next.js's/the codemod's own source — not just registry metadata. First pass: Turbopack-default build failure (fixed via `--webpack`), `typescript@7.0.2` incompatibility with `typescript-eslint` (reverted to `5.9.3`, user decision with evidence), and a suspected Docker peer-dependency gap for the Agent SDK bump. Second pass unpacked the actual `@anthropic-ai/claude-agent-sdk@0.3.246` tarball and proved the first pass's Docker fix was aimed at the wrong mechanism — see Task 5 below and design decisions 10-15 for the full paper trail. Trust the specific claims in this plan (each says what was checked and how); they are not guesses.

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
    "node": ">=20.19.0",
    "npm": ">=10.0.0"
  },
```
Next 16 (landing in Task 2) requires Node `>=20.9.0`, but `eslint@10.9.1` (also landing in Task 2) requires `^20.19.0 || ^22.13.0 || >=24` — a plain `>=20.9.0` floor would accept Node versions between 20.9 and 20.19 that satisfy Next but not ESLint. `>=20.19.0` is the tightest single floor that satisfies both (an odd-numbered Node release like 21 or 23 isn't a real deployment target here — this repo's Docker image runs `node:22-slim`, and the local dev machine runs Node 26).

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
- Modify then delete: `.eslintrc.json` (the codemod migrates it via `@eslint/migrate-config` but does **not** delete it — this task deletes it explicitly once `eslint.config.mjs` is confirmed working)
- Create: `eslint.config.mjs` (generated by the codemod, then hand-edited to add one rule override — see Step 5)

**Interfaces:** None — no application code changes; this task only migrates config, scripts, and tooling.

Four facts confirmed directly against Next.js 16's/the codemod's own source while writing this plan (not inferred, not taken from docs prose alone — read from the actual shipped `.js` in the `@next/codemod@16.3.3` and `eslint-config-next@16.3.3` tarballs):

1. **Turbopack is the default bundler in Next 16, and a project with a custom `webpack` config and no `turbopack` config makes `next build`/`next dev` exit with code 1** (from `packages/next/src/lib/turbopack-warning.ts`: `if (process.env.TURBOPACK === 'auto' && hasWebpackConfig && !hasTurboConfig) { ...; process.exit(1) }`). This repo's `next.config.js` has a `webpack:` function (excludes `fs`/`path`/`os` from the client bundle) and no `turbopack` key — it hits this guard exactly. Next ships a documented, first-class opt-out: the `--webpack` flag on `next build`/`next dev`, which keeps today's webpack behavior unchanged. **This task uses `--webpack`, not a Turbopack migration** — the Docker image's `output: 'standalone'` behavior is proven under webpack today; re-proving it under Turbopack is a separate migration with its own design gate (design decision 11).
2. **`next lint` and the `eslint` key in `next.config.js` are both removed in Next 16.** This repo's `next.config.js` has no `eslint` key (checked already, clean).
3. **`eslint-config-next@16.3.3` is flat-config only** — its `exports` map is `.`, `./core-web-vitals`, `./typescript`, `./parser`, each resolving to a flat-config array in `dist/*.js`. There is no eslintrc-style config left to extend via `FlatCompat` (the codemod itself deletes `@eslint/eslintrc` for exactly this reason).
4. **`eslint-config-next@16.3.3` enables `typescript-eslint`'s `recommended` ruleset for the first time** (`15.1.0`'s extends list was `['plugin:react/recommended', 'plugin:react-hooks/recommended', 'plugin:@next/next/recommended']` — zero TypeScript-specific rules; `16.3.3`'s `dist/typescript.js` spreads `typescriptEslint.configs.recommended`, which sets `@typescript-eslint/no-explicit-any` to `error`). This repo has **49** existing `any` occurrences (confirmed by grep while writing this plan) that would newly fail the lint gate. Fixing 49 pre-existing type-safety issues is not part of a dependency upgrade — Step 5 adds one rule override to keep today's effective leniency, the same philosophy as the `--webpack` decision above (preserve current behavior via an official mechanism, don't silently take on unrelated work).

The umbrella `npx @next/codemod upgrade` wizard is **not used** — it is interactive, and for this repo it would do nothing beyond what's covered explicitly below (no `middleware.ts`, no `unstable_`-prefixed API usage, no `experimental_ppr`, no sync `cookies()`/`headers()`/`draftMode()` calls — already grepped clean before this plan was written). The single-purpose `next-lint-to-eslint-cli` transform (Step 3) does the real work.

Expect `npm install` in Step 4 to print a few `npm warn ERESOLVE overriding peer dependency` lines for `typescript-eslint`/`eslint-plugin-*` packages that declare their `eslint` peer as `^9` only (verified: `eslint-config-next@16.3.3` itself declares `eslint: ">=9.0.0"`, accepting 10, but several of its own dependencies haven't updated their own peer range yet) — these are warnings, not install failures (design decision 13); don't try to "fix" them by downgrading `eslint`.

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

- [ ] **Step 3: Run the lint-migration codemod**

```bash
npx @next/codemod@latest next-lint-to-eslint-cli . --force --skip-install
```
Two things confirmed by reading `@next/codemod@16.3.3/bin/transform.js` and `transforms/next-lint-to-eslint-cli.js` directly, not assumed: this specific transform does **not** implement a real dry-run (it has zero references to a `dry` option anywhere in its own file — it always writes), so don't pass `--dry` expecting a preview; and it calls `checkGitStatus`, which exits 1 on an uncommitted tree unless `--force` is passed (`--force` just prints a warning and continues) — Steps 1-2 above already dirtied the tree, so `--force` is required here, not optional. `--skip-install` stops the codemod from running its own `npm install` (it would otherwise install any new dev dependency it decides it needs mid-step, ahead of this task's own controlled `npm install` in Step 5). **Ordering matters and is load-bearing:** the codemod force-downgrades `devDependencies.eslint` to `^9` if the version it finds in `package.json` is below `9.0.0` — since Step 1 already bumped it to `^10.9.1` (which is not below `9.0.0`), that downgrade condition never fires. Running this codemod before Step 1 would silently undo the ESLint bump.

Expect it to migrate `.eslintrc.json` via `@eslint/migrate-config` (a network call) into a new `eslint.config.mjs`, and rewrite `package.json`'s `"lint"` script from `"next lint"` to `"eslint ."`. It does **not** delete `.eslintrc.json` — that happens in Step 6 below, once the new config is confirmed working.

If the codemod fails outright (network error reaching `@eslint/migrate-config`, or any other hard failure), fall back to writing `eslint.config.mjs` by hand, importing the flat configs `eslint-config-next` ships directly (no `FlatCompat` — confirmed `eslint-config-next@16.3.3` is flat-config-only, `FlatCompat` has nothing eslintrc-shaped left to convert):
```javascript
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
];

export default eslintConfig;
```
and change `package.json`'s `"lint"` script from `"next lint"` to `"eslint ."` by hand. Treat this as a last resort, not the expected path — Step 3's real invocation above should just work.

- [ ] **Step 4: Re-confirm no leftover Next 15 sync dynamic-API usage or removed config keys**

```bash
grep -rn "unstable_\|experimental_ppr" --include="*.ts" --include="*.tsx" -I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow --exclude=package-lock.json .
grep -n "eslint:" next.config.js
find . -maxdepth 1 -iname "middleware.ts"
```
Expected: all empty/no match (this was already confirmed clean before this task started — this step re-confirms nothing in Task 1's bumps or this task's own edits introduced any).

- [ ] **Step 5: Add the `no-explicit-any` override, install, and verify**

In the generated (or hand-written) `eslint.config.mjs`, add one more entry to the exported array — a rules override, after the spread of `nextTypescript`/the codemod's generated Next.js config entries:
```javascript
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
```
(Preserves today's effective behavior — this rule didn't exist under `eslint-config-next@15.1.0` at all, so this repo's 49 existing `any` usages were never flagged. `'warn'` keeps them visible without turning them into a red gate; fixing them is out of scope for this upgrade.)

```bash
npm install
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all four PASS (ignore the `npm warn ERESOLVE overriding peer dependency` lines noted above — those are expected). This is the first point where `--webpack`, the new `eslint.config.mjs`, and ESLint 10 are exercised together for real — read the actual output, don't assume. If `npm run build` still hits the Turbopack guard, the `--webpack` flag in Step 2 was not applied correctly — fix that before going further, do not add a `turbopack: {}` stub as a workaround (that silently opts into Turbopack for anything the flag doesn't cover). If `npm run lint` still fails on something other than `no-explicit-any`, read the actual error — that's a real finding to fix or record, not to override away.

- [ ] **Step 6: Delete the now-unused legacy config and commit**

```bash
git rm .eslintrc.json
git add package.json package-lock.json scripts/run-web.js eslint.config.mjs
git commit -m "chore: upgrade to Next.js 16 (keep webpack via --webpack), migrate next lint to ESLint CLI (eslint 10)"
```

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

**Baseline note, checked while writing this plan:** on this dev machine, `node_modules/electron` is *currently* in a broken state at the pre-upgrade version (`npx --no-install electron --version` throws `Electron failed to install correctly`) — a leftover from some prior partial/interrupted install, unrelated to this task. Step 2's `npm install` does a real (non-`--ignore-scripts`) install, which should fetch the Electron 44 binary fresh and fix this as a side effect. If Step 2's check still fails after a real `npm install`, don't assume it's an Electron 44 regression before ruling out environment issues (network access to Electron's binary CDN, disk space) — the baseline was already broken before this task touched anything.

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
- Modify: `package.json` (`@anthropic-ai/claude-agent-sdk`, plus new explicit `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` **devDependencies** — see point 3 below for why not `dependencies`)
- Modify: `Dockerfile:95-101` (comment only — no `COPY` line changes; see point 3)
- Modify: `lib/services/cli/claude.ts:31-63` (`TOOL_NAME_ACTION_MAP`), and its `inferActionFromToolName` function (currently unexported, at line 107)
- Modify: `components/chat/ChatLog.tsx:20-52` (duplicate `TOOL_NAME_ACTION_MAP`), `:96-108` (duplicate `inferActionFromToolName`), `:843`, `:881-885`, `:1576`
- Create: `tests/cli/claude-tool-actions.test.ts`

**Interfaces:**
- Consumes: `ToolAction` type, `TOOL_NAME_ACTION_MAP`, and `inferActionFromToolName` already defined (module-private) in `lib/services/cli/claude.ts:29-63,107-119`.
- Produces: `export const TOOL_NAME_ACTION_MAP: Record<string, ToolAction>` and `export const inferActionFromToolName = (toolName: unknown): ToolAction | undefined => ...` — same shapes as today, just exported instead of module-private.

This task's design record entry (decision 12) was **revised after a second red-team pass unpacked the actual npm tarballs** — its first version (copy both new peers into `dependencies`, widen the Dockerfile `COPY`) was solving a problem that doesn't exist and missing the one that does. What follows is the corrected, tarball-verified understanding:

1. **`TodoWrite` → Task tools rename** (unchanged from the first pass, still correct). As of TypeScript Agent SDK `0.3.142` (this bump lands on `0.3.246`, past that point), sessions default to `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList` instead of the legacy `TodoWrite` tool (`code.claude.com/docs/en/agent-sdk/todo-tracking`).
2. **This mapping is duplicated in this codebase** (unchanged, still correct). `lib/services/cli/claude.ts:29-63,107-119` and `components/chat/ChatLog.tsx:12,20-52,96-108` are byte-identical copies of the same `ToolAction` type, `TOOL_NAME_ACTION_MAP`, and `inferActionFromToolName`. Both need the new entries — missing either one leaves that copy falling through to the generic `normalizeAction` substring matcher, which actively mislabels the new names: `"taskcreate".includes('create')` → `'Created'`, `"taskupdate".includes('update')` → `'Edited'`, both wrong. This task fixes both copies (not a shared-module extraction — that's a larger refactor than this bug needs).
3. **The real runtime mechanism change, verified by unpacking `@anthropic-ai/claude-agent-sdk@0.3.246`'s actual tarball (not just its `package.json` metadata):**
   - It ships **no `cli.js` at all**. Its `files`/`exports` are `sdk.mjs`, `sdk.d.ts`, `bridge.mjs`, `browser-sdk.js`, `extractFromBunfs.js`, `manifest.json` — nothing named `cli.js`, and no `./cli.js` export. The existing `Dockerfile:95-100` comment, which the *first* red-team pass's fix left untouched, describes a mechanism (`cli.js` spawned from a frozen build-time path) that **no longer exists** at 0.3.246.
   - Instead, it declares `optionalDependencies` on 8 platform-specific native-binary packages: `@anthropic-ai/claude-agent-sdk-linux-x64`, `-linux-arm64`, `-linux-x64-musl`, `-linux-arm64-musl`, `-darwin-x64`, `-darwin-arm64`, `-win32-x64`, `-win32-arm64`, each ~236 MB unpacked (confirmed: `@anthropic-ai/claude-agent-sdk-linux-x64@0.3.246`'s tarball contains one file, `claude`, at that size). At runtime, `sdk.mjs` resolves the right one via `createRequire(import.meta.url).resolve(...)`, and throws `Native CLI binary for ${platform}-${arch} not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, ...` if it's missing (this exact string is in the shipped `sdk.mjs`).
   - `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` **are declared as `peerDependencies` but are never `require`d or `import`ed by the runtime code** — grepping the actual shipped `sdk.mjs` and `bridge.mjs` for both package names returns zero hits. They appear only inside the shipped `.d.ts` files (type re-exports, e.g. `from '@modelcontextprotocol/sdk/types.js'`), meaning `tsc` needs them resolvable for **type-checking**, but nothing at runtime ever loads them. They belong in `devDependencies`, not `dependencies` — putting them in `dependencies` would drag `@modelcontextprotocol/sdk`'s own 17 runtime transitive deps (`express`, `hono`, `ajv`, `cors`, …) into the production install and Next's build graph for no reason.
   - **The Docker fix this task actually needs is smaller than the first pass's, not bigger:** `@anthropic-ai/claude-agent-sdk-linux-x64` shares the `@anthropic-ai` npm scope with the main package, so the *existing* `COPY --from=build --chown=node:node /app/node_modules/@anthropic-ai ./node_modules/@anthropic-ai` line already carries the native binary into the runtime image — that's how npm lays out scoped packages, not a special case. This task updates the comment to describe the real mechanism (so the next reader isn't misled by a comment describing `cli.js`), and — critically — actually **verifies** this with a real Docker build rather than assuming the lucky scoping holds (Step 10). It does **not** add a `@modelcontextprotocol` `COPY` line (nothing needs it there) and does **not** add either package to production `dependencies`.
   - One consequence to consciously accept, not discover later: this adds roughly 236 MB unpacked to the runtime image (the native binary), on top of whatever the base image already carries. The Dockerfile's own comments (`Dockerfile:79-89`) document a deliberate 2.96 GB → standalone-output shrink; this is a real, measurable regression against that effort, worth recording (Step 10 measures and reports the resulting image size), not a silent trade to wave through.
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

- [ ] **Step 3: Bump the SDK and add the two type-only peer packages as devDependencies**

In `dependencies`:
```json
    "@anthropic-ai/claude-agent-sdk": "^0.3.246",
```
In `devDependencies` (not `dependencies` — see point 3 above: neither package is ever imported at runtime, only their types are needed, for `tsc`):
```json
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

- [ ] **Step 8: Correct the Dockerfile comment to describe the real 0.3 mechanism (the `COPY` line itself is unchanged)**

In `Dockerfile`, the comment at lines 95-100 describes `cli.js` — a file that no longer exists as of SDK 0.3.246 (point 3 above). Change:
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
# kopiuje. Od Agent SDK 0.3 (zmierzone rozpakowaniem tarballa) SDK nie ma już
# `cli.js` — resolvuje w runtime jeden z ośmiu platformowych
# `optionalDependencies` (`@anthropic-ai/claude-agent-sdk-linux-x64` na tym
# obrazie, ~236 MB rozpakowane) przez `createRequire(...).resolve(...)`. Bez
# tego katalogu pierwsza instrukcja wysłana do agenta pada na "Native CLI
# binary ... not found", czyli cała funkcja produktu, i to dopiero przy
# pierwszym użyciu — start kontenera wygląda zdrowo.
#
# Ten pakiet platformowy dzieli scope @anthropic-ai z głównym pakietem SDK,
# więc poniższy COPY (niezmieniony od czasu, gdy kopiował tylko cli.js) go już
# przenosi — zweryfikowane uruchomieniem obrazu (Task 5 Step 10 planu
# aktualizacji zależności), nie założone.
COPY --from=build --chown=node:node /app/node_modules/@anthropic-ai ./node_modules/@anthropic-ai
```

- [ ] **Step 9: Install and confirm the native binary resolves on this machine**

Checked while writing this plan: this machine's `process.platform`/`process.arch` is `linux`/`arm64` — **not** `x64`. Don't hardcode `linux-x64`; resolve the right optional package name the same way the SDK itself does:
```bash
npm install
node -e "
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const pkg = \`@anthropic-ai/claude-agent-sdk-linux-\${arch}\`;
console.log(require.resolve(\`\${pkg}/package.json\`));
"
```
Expected: prints a real path under `node_modules/@anthropic-ai/claude-agent-sdk-linux-<arch>/package.json`, where `<arch>` matches this machine's actual architecture. This confirms npm's optional-dependency platform matching picked the right native-binary package. `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` don't get a `require.resolve` check here — they're type-only devDependencies (point 3 above), and `@anthropic-ai/sdk`'s own `exports` map doesn't even expose a `./package.json` subpath to resolve; `npm run type-check` in Step 11 is the real, correct test for those two.

- [ ] **Step 10: Prove the Docker runtime image actually has the native binary, and measure the size impact**

`docker build` with no `--platform` flag targets the **host's** architecture by default — on this machine that's `arm64`, so the image built here gets the `linux-arm64` variant, not `linux-x64`. If this step runs on a different machine (e.g. an x64 CI runner) or the deployment target is a different architecture than the build host, adjust the expected package name in the check below to match; don't assume `x64` is universal just because it's the more common cloud-server architecture.
```bash
ARCH=$(node -e "console.log(process.arch === 'arm64' ? 'arm64' : 'x64')")
docker build -t claudable:deps-upgrade-check .
docker run --rm --entrypoint sh claudable:deps-upgrade-check -c "test -x /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-$ARCH/claude && echo BINARY_OK || echo BINARY_MISSING"
docker image inspect claudable:deps-upgrade-check --format '{{.Size}}'
docker rmi claudable:deps-upgrade-check
```
The `docker build` is a full multi-stage build (apt-get installs, `npm ci`, `prisma generate`, `next build` inside the image) and can easily take several minutes on a cold cache — give it a generous timeout (10 minutes) rather than the default and don't treat a slow-but-progressing build as a hang. Expected: `BINARY_OK`, and a size figure to report (this is the ~236 MB-heavier image flagged in point 3 above — record the number, don't just wave it through). This does not need `--env-file`/`ENCRYPTION_KEY`/bind mounts — it overrides the container's entrypoint to run a one-off shell check instead of the real startup command, so it's a pure "does the executable exist in this image, with execute permission" proof, not a full app boot. If this prints `BINARY_MISSING`, the scoping assumption in point 3/Step 8 was wrong for real — stop and investigate what actually happened to `node_modules/@anthropic-ai` between build and runtime stages before touching anything else in this task; that assumption, not a `COPY` line edit, is what this step exists to test. The final `docker rmi` cleans up the check image so it doesn't linger next to the real `claudable:dev` image.

**Separately worth flagging to whoever reviews this branch (not something this task can resolve):** if the real production deployment runs on a different architecture than whatever machine builds the Docker image (e.g. building on an x64 CI runner but deploying to an arm64 host, or vice versa), the image would need to be built with `docker build --platform linux/<target-arch>` for npm to install the matching optional dependency — this plan's check only proves correctness for the architecture it happens to run on.

- [ ] **Step 11: Full gate**

```bash
npm run type-check && npm test && npm run lint && npm run build
```
Expected: all PASS — this includes `tests/cli/claude-options.test.ts`'s existing env-scrub assertions and the new `claude-tool-actions.test.ts`.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json Dockerfile lib/services/cli/claude.ts components/chat/ChatLog.tsx tests/cli/claude-tool-actions.test.ts
git commit -m "feat: upgrade Claude Agent SDK 0.2 -> 0.3, recognize Task tools that replaced TodoWrite, document the native-binary Docker mechanism"
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
Every changed file should trace to one of Tasks 1-5 above (dependency manifests, `scripts/run-web.js`, `eslint.config.mjs` created / `.eslintrc.json` removed, `Dockerfile`, `lib/services/cli/claude.ts`, `components/chat/ChatLog.tsx`, and the two new test files). Nothing else — in particular, `next.config.js` should show **no diff** (confirmed while writing this plan: nothing in it needs to change for Next 16).

- [ ] **Step 3: Confirm the deferred-scope packages were left alone, and the risky ones landed where intended**

```bash
grep -n "\"prisma\"\|\"@prisma/client\"\|\"tailwindcss\"\|\"typescript\"\|\"next\"\|\"@anthropic-ai/sdk\"\|\"@modelcontextprotocol/sdk\"" package.json
grep -n -- "--webpack" package.json scripts/run-web.js
```
Expected: `prisma`/`@prisma/client` at `^6.19.3` (not 7.x/8.x), `tailwindcss` at `^3.4.19` (not 4.x), `typescript` at `^5.9.3` (not 7.x), `next` at `^16.3.3`; `--webpack` present in both the `package.json` `build` script and `scripts/run-web.js`; `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` present under `devDependencies`, **not** `dependencies` (point 3 of Task 5 — they're type-only).

- [ ] **Step 4: Manual smoke test — actually run the app and send the SDK a message**

This is the one part of the upgrade that automated type-checking cannot prove: `lib/services/cli/claude.ts`'s streaming loop dispatches on string discriminants from the SDK's event stream (`stream_event`, `tool_use`, etc.) — a changed field *shape* inside an existing union member would not be caught by `tsc`, only a removed/renamed member would. Use the `run` skill (or `npm run dev` directly) to start the app, open or create one project, send it a single message that would make the agent use its todo/task-tracking behavior (e.g. "make a small multi-step plan and track it with todos"), and confirm in the browser that: the response streams normally, and any Task-tool activity renders with a sensible label (not a raw "Tool action" fallback) — this is the empirical proof that Step 4/6/7 of Task 5 actually connected correctly, matching this project's own established convention of proving SDK behavior by running it (see the earlier design record's decision on logging the SDK's `init` payload as proof, not just relying on types).

- [ ] **Step 5: Record the outcome for the branch-review / finish stage**

No spec to sync (see header). Note for whoever reviews the branch: `npm run package:<platform>` (real Electron desktop packaging) was not exercised by this plan — it needs platform-specific code-signing tooling this environment doesn't have — so a manual desktop-build smoke test is a follow-up, not part of this run's proof. Tailwind 3→4 and Prisma 6→7 remain explicitly out of scope (design decisions 8 and 2) for future runs.
