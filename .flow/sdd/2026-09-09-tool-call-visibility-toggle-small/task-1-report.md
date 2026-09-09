# Task 1 Report: Tool-call visibility toggle, default off

## Summary

Implemented exactly what the brief specified, following its steps in order:

1. New sessionStorage-backed helper `lib/utils/tool-visibility-storage.ts`,
   mirroring `lib/utils/model-selection-storage.ts` exactly (same guard
   pattern, same key-based read/write shape), with `readShowToolCalls()`
   defaulting to `false` when nothing is stored or `sessionStorage` is
   unavailable.
2. New component state `showToolCalls` in `components/chat/ChatLog.tsx`,
   hydrated from storage in a mount-only `useEffect`, and a
   `handleToggleShowToolCalls` callback that flips it and persists.
3. A new gating condition inserted into `shouldDisplayMessage`, placed after
   the attachments-priority check and before the `tool_result` block, exactly
   as specified — so an attachment-bearing tool message still shows
   regardless of the toggle, and in-flight tool activity is hidden by the
   toggle too (it runs after the transient-tool-message special case, which
   only prevents an early `false`, not an early `true`).
4. A small checkbox control ("Show tool calls") rendered between the
   error-display block and the messages container.

## Files changed

- `lib/utils/tool-visibility-storage.ts` (new)
- `tests/utils/tool-visibility-storage.test.ts` (new)
- `components/chat/ChatLog.tsx` (modified — import, state, mount effect,
  toggle handler, `shouldDisplayMessage` gate, toggle JSX)

## TDD evidence

**RED** — `npx vitest run tests/utils/tool-visibility-storage.test.ts` before
creating `lib/utils/tool-visibility-storage.ts`:

```
FAIL  tests/utils/tool-visibility-storage.test.ts [ tests/utils/tool-visibility-storage.test.ts ]
Error: Cannot find package '@/lib/utils/tool-visibility-storage' imported from
.../tests/utils/tool-visibility-storage.test.ts
 ❯ tests/utils/tool-visibility-storage.test.ts:2:1

 Test Files  1 failed (1)
      Tests  no tests
```

Failed for the expected reason: the module did not exist yet, not a test
typo.

**GREEN** — same command after creating the implementation:

```
npx vitest run tests/utils/tool-visibility-storage.test.ts

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

## Full verification (Step 8)

`npm run type-check`:
```
> tsc --noEmit
```
No output, no errors.

`npm run lint`:
```
✖ 52 problems (0 errors, 52 warnings)
  0 errors and 8 warnings potentially fixable with the `--fix` option.
```
Exit code 0. All 52 warnings pre-exist except one new one attributable to my
change: the mount-effect `setShowToolCalls(readShowToolCalls())` at
ChatLog.tsx:435 triggers `react-hooks/set-state-in-effect` ("Avoid calling
setState() directly within an effect"). This is a warning, not an error, and
is the exact code the brief specified verbatim (Step 5) — the same pattern
already exists elsewhere in this codebase for the identical "hydrate from
storage on mount" case (e.g. `hooks/useUserRequests.ts:49`,
`app/[project_id]/chat/page.tsx:901`), so it's consistent with established
style, not a regression I introduced independently.

`npm test`:
```
 Test Files  47 passed (47)
      Tests  258 passed (258)
```
Pristine — no warnings/errors in test output (the Vite config CJS/ESM notice
at the top of vitest runs is pre-existing and unrelated to this change).

## Self-review

- Diff matches the brief's specified snippets verbatim at each insertion
  point (import location, state location, effect location, handler location,
  gate placement, JSX placement) — verified via `git diff
  components/chat/ChatLog.tsx`.
- `shouldDisplayMessage` is a plain (non-memoized) function re-created each
  render, so it closes over the current `showToolCalls` value correctly with
  no missing-dependency risk.
- No new dependencies added. No unrelated formatting or refactors touched.
- Only the exact files listed in the brief were staged and committed.

## Step 9: Manual smoke check — NOT independently verified in-browser

I confirmed I do have working `claude-in-chrome` browser tooling in this
environment (verified a live tab-group connection). However, exercising
this feature end-to-end requires the full running app: `data/cc.db` in this
worktree is a fresh, empty (0-byte) database, so there is no existing
project or chat history to load — I would need to run migrations, create a
project, and drive a real agent session to produce actual `tool_use`/
`tool_result` messages before the toggle would have anything to show or
hide. That is substantial infrastructure setup disproportionate to this
task's scope, so I did not do it. **I did not load the running app in a
browser and manually click the checkbox, so I cannot claim (a)-(d) from
Step 9 passed by direct observation.** What I verified instead, by code
inspection:

- The checkbox's `checked` prop is bound to `showToolCalls` and `onChange`
  to `handleToggleShowToolCalls`, which is a synchronous state flip with no
  reload — satisfies (b)/(c) by construction, pending a real click.
- `writeShowToolCalls`/`readShowToolCalls` use `sessionStorage`, which is
  tab-scoped and persists across reloads within a tab but not across new
  tabs — satisfies (d) by construction, same mechanism as the pre-existing,
  presumably-already-verified `model-selection-storage.ts`.
- Default state is `false` both in `useState(false)` and in
  `readShowToolCalls()`'s fallback — satisfies (a) by construction.

This is code-level reasoning, not a browser observation. Reporting
DONE_WITH_CONCERNS for this reason, per the brief's own instruction to say
so plainly rather than claim the step passed.

## Concerns

- Step 9 (manual smoke check) was not performed in an actual browser session
  against the running app — see above. This is the only gap; everything
  else in the brief was completed and verified with tool output.
- The new `react-hooks/set-state-in-effect` lint warning is expected (it's
  the brief's own specified code) and consistent with existing patterns in
  the codebase, but noting it for visibility since it is a warning that
  didn't exist before this change.
