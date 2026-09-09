# Branch-review fix report — chat-history-pagination

Scope: single finding from the whole-branch review — `loadChatHistory` in
`components/chat/ChatLog.tsx` lacked the stale-project guard that
`loadOlderMessages` already has, letting a slow-resolving fetch for project A
seed pagination state (`oldestLoadedCursorRef`, `hasMoreMessages`,
`paginationInitializedRef`) for project B after a project switch, and
permanently breaking B's "Load older messages".

## Finding: `loadChatHistory` missing stale-project guard (components/chat/ChatLog.tsx:1027-1073)

### Fix

Mirrored the pattern already in `loadOlderMessages` (lines ~1091-1117):

- Captured `const requestProjectId = projectId;` at the top of the callback
  (before the `try`), same as `loadOlderMessages` does.
- After `const payload = await response.json();`, added:
  ```ts
  if (projectIdRef.current !== requestProjectId) {
    // The user switched projects while this fetch was in flight.
    // Applying this response now would seed the pagination cursor
    // and hasMoreMessages from the old project's data.
    return;
  }
  ```
  placed before any of the state writes (`paginationInitializedRef`,
  `oldestLoadedCursorRef`, `setHasMoreMessages`, `setMessages`). Reused the
  existing `projectIdRef` (already introduced for `loadOlderMessages`) rather
  than adding a second ref.
- Added an `applied` boolean, initialized `false`, set `true` only when this
  call's response was actually used for the currently-active project: on the
  non-stale success path (right after the guard passes), on a non-ok HTTP
  response for the still-current project, and on a caught error for the
  still-current project. The `finally` block now only flips
  `hasLoadedInitialDataRef.current = true` and `setHasLoadedOnce(true)` when
  `applied` is true — so a stale (guarded-out) response no longer marks
  "initial load done" on behalf of a request that was never meant for the
  now-current project. `setIsLoading(false)` still runs unconditionally in
  `finally` since it only reflects this call's own loading-spinner state, not
  cross-request pagination state.

Diff (`components/chat/ChatLog.tsx`, `loadChatHistory`):

```diff
@@ -1031,6 +1031,14 @@
         setIsLoading(true);
       }
 
+      // Freeze which project this specific request is for, same as
+      // loadOlderMessages: if the user switches projects before the fetch
+      // resolves, projectIdRef.current will have moved on while this stays
+      // put, so comparing the two after the await tells us the response is
+      // stale and must not be applied to the now-current project's state.
+      const requestProjectId = projectId;
+      let applied = false;
+
       try {
         // Always fetch the most recent window; "load older" pages further
         // back from there via a composite (createdAt, id) cursor (see
@@ -1038,6 +1046,13 @@
         const response = await fetch(`${API_BASE}/api/chat/${projectId}/messages?limit=200&order=desc`);
         if (response.ok) {
           const payload = await response.json();
+          if (projectIdRef.current !== requestProjectId) {
+            // The user switched projects while this fetch was in flight.
+            // Applying this response now would seed the pagination cursor
+            // and hasMoreMessages from the old project's data.
+            return;
+          }
+          applied = true;
           const chatMessages = Array.isArray(payload)
             ? payload
             : payload?.data ?? payload?.messages ?? [];
@@ -1056,8 +1071,13 @@
           }
 
           setMessages((prev) => integrateMessages(prev, normalized));
+        } else if (projectIdRef.current === requestProjectId) {
+          applied = true;
         }
       } catch (error) {
+        if (projectIdRef.current === requestProjectId) {
+          applied = true;
+        }
         if (process.env.NODE_ENV === 'development') {
           console.warn('Failed to load chat history (network issue):', error);
         }
@@ -1065,8 +1085,10 @@
         if (shouldShowLoading) {
           setIsLoading(false);
         }
-        hasLoadedInitialDataRef.current = true;
-        setHasLoadedOnce(true);
+        if (applied) {
+          hasLoadedInitialDataRef.current = true;
+          setHasLoadedOnce(true);
+        }
       }
     },
     [projectId, ensureStableMessageId]
```

Note beyond the dispatch's literal instruction: the dispatch only mentioned
guarding the success path (`response.ok` branch) explicitly, but the same
"genuine failure of the request that started for the currently-active
project" language in the dispatch implies the `!response.ok` and `catch`
branches should also skip flipping `applied` when the request was for a
project that's no longer current (e.g. project A's request errors out after
B has already taken over — that error isn't "B's initial load failed" and
shouldn't be allowed to mark B's initial load done prematurely, nor to swallow
a real error for B). Extended the same `projectIdRef.current ===
requestProjectId` check to those two branches for consistency with the
guard's intent, without changing their existing behavior for the normal
(non-switch) case.

### No automated regression test

Confirmed (per dispatch and prior task work) there is no jsdom/testing-library
component harness in this repo — `npm test` only runs Vitest unit tests
against non-component modules. A behavioral regression test for a React
component's async race condition isn't feasible with the current test setup.
Trace-through by inspection instead (below).

### Trace-through

**1. No-switch path (normal load, single project for the whole request lifetime):**
`requestProjectId === projectId` at call time. `projectIdRef.current` never
changes because there's no switch, so it still equals `requestProjectId` when
the guard runs after `await response.json()`. The guard is a no-op:
`applied = true` is set immediately, and execution falls through into the
existing body unchanged (cursor seeding, `setMessages`, then in `finally`
both flags get set as before). Byte-for-byte identical behavior to
pre-fix code in this path.

**2. Switch-during-flight path (A's `loadChatHistory` in flight, user switches
to B before it resolves):**
- `requestProjectId = 'A'` was captured at call start.
- The reset effect (`useEffect` on `[projectId]`, lines 1231-1244) fires on
  the switch, setting `paginationInitializedRef.current = false`,
  `oldestLoadedCursorRef.current = null`, `hasLoadedInitialDataRef.current =
  false`, `setHasLoadedOnce(false)`, `setHasMoreMessages(false)`. It also
  updates `projectIdRef.current = 'B'` (the ref-sync effect at line
  301-303 runs on every render where `projectId` changed).
- A's fetch later resolves. `response.ok` is presumably true, so
  `payload = await response.json()` runs, then the guard checks
  `projectIdRef.current ('B') !== requestProjectId ('A')` — true — so the
  function `return`s immediately, before touching
  `paginationInitializedRef`, `oldestLoadedCursorRef`, `setHasMoreMessages`,
  or `setMessages`. `applied` stays `false`.
- Because the `return` is inside the `try`, the `finally` block still runs:
  `setIsLoading(false)` runs if `shouldShowLoading` was true for this call
  (harmless — it only concerns this call's own spinner flag, and B's own
  concurrent load manages the spinner state for what the user actually
  sees), but the `if (applied)` block is skipped, so
  `hasLoadedInitialDataRef.current` and `setHasLoadedOnce(true)` are **not**
  set from A's stale response.
- Net effect: none of A's data reaches B's pagination or message state.
  `paginationInitializedRef.current` remains `false` (as the reset effect
  left it) and `hasLoadedInitialDataRef.current`/`hasLoadedOnce` remain
  `false` too, both preserved for B's own request to set correctly.

**3. B's own subsequent `loadChatHistory` call (from the reset effect's
re-triggered initial-load effect):**
The initial-load effect (`useEffect` on `[projectId]`, lines 1206-1229) also
re-fires on the switch and calls `loadChatHistory({ showLoading: true })` with
`projectId` now `'B'`. This call captures `requestProjectId = 'B'`. Assuming
no further switch happens before it resolves, `projectIdRef.current` is still
`'B'` when its guard runs, so the guard is a no-op for this call: `applied =
true`, cursor seeding proceeds against `paginationInitializedRef.current ===
false` (correctly reset), so `oldestLoadedCursorRef.current` and
`hasMoreMessages` get seeded from B's own payload, `paginationInitializedRef`
flips to `true`, and in `finally` `hasLoadedInitialDataRef.current` and
`hasLoadedOnce` are set `true` from a real, applied response. B's "Load older
messages" now pages against B's own cursor, correctly — the bug described in
the finding is closed.

## Verification

```
$ npm test
 Test Files  46 passed (46)
      Tests  256 passed (256)
```
256/256 — matches the branch's existing green baseline, no regressions.

```
$ npm run type-check
> tsc --noEmit
```
Clean, no output (exit 0).

```
$ npm run lint
✖ 51 problems (0 errors, 51 warnings)
```
0 errors — same as the branch's baseline (51 pre-existing warnings, none in
the edited range of `ChatLog.tsx` lines 1027-1093; confirmed by grepping lint
output for `ChatLog` and checking the reported line numbers, all outside the
changed region).

## Declined / concerns

None. The finding was correct and reproducible by inspection; fixed as
specified, plus the small consistent extension to the `!ok`/`catch` branches
noted above (kept within the same function, no other code touched).
