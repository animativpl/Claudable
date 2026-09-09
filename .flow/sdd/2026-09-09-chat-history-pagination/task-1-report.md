# Task 1 Report — Composite-cursor pagination (service layer and route)

## Summary

Implemented Task 1 exactly per brief: replaced offset-based pagination in
`getMessagesByProjectId` with a composite `(createdAt, id)` keyset cursor,
deleted `getMessagesCountByProjectId` (its only caller was the route, updated
in the same commit), and updated the `GET /api/chat/[project_id]/messages`
route to accept `order`/`before`/`beforeId` query params, drop `totalCount`,
and compute `hasMore` as a full-page check.

## Workspace verification

```
$ git rev-parse --show-toplevel
/home/m/work/Claudable/.claude/worktrees/fix+chat-history-pagination
$ git branch --show-current
worktree-fix+chat-history-pagination
```

Matches the dispatch. `git status` at start showed only the untracked
`.flow/sdd/` directory (the brief itself) — no foreign changes.

## Files changed

- `lib/services/message.ts` — `getMessagesByProjectId` signature changed
  from `(projectId, limit, offset)` to `(projectId, limit, { order?,
  before? })`; builds a composite keyset `OR` filter when `before` is
  given; orders by `[{ createdAt: order }, { id: order }]`. Deleted
  `getMessagesCountByProjectId`.
- `app/api/chat/[project_id]/messages/route.ts` — `GET` now parses
  `order`/`before`/`beforeId`, builds the composite cursor (only when both
  `before` and `beforeId` are present and `before` parses as a valid date),
  calls the new service signature, drops the `getMessagesCountByProjectId`
  call and `totalCount` field, and sets `hasMore = serialized.length ===
  limit`. Only the import line and `GET` function changed; `POST`,
  `DELETE`, `RouteContext`, and the trailing exports are untouched.
- `tests/services/message-pagination.test.ts` (new) — 4 tests for the
  service layer's default/asc/desc/before-cursor `findMany` call shapes.
- `tests/api/messages-route-pagination.test.ts` (new) — 6 tests for the
  route's query-param parsing, cursor validation (missing beforeId,
  invalid date), `hasMore` full/partial page, and absence of `totalCount`.

## TDD evidence

### Service layer (Steps 1-4)

RED — `npx vitest run tests/services/message-pagination.test.ts` before
implementing:
```
❯ tests/services/message-pagination.test.ts (4 tests | 4 failed) 12ms
AssertionError: expected "vi.fn()" to be called with arguments...
- orderBy: [{ createdAt: "asc" }, { id: "asc" }]
+ orderBy: { createdAt: "asc" }, skip: 0
```
Expected: fails because the old implementation still uses `skip`/single-field
`orderBy`. Confirmed — all 4 assertions failed on exactly that shape
mismatch, not on an error/typo.

GREEN — same command after implementing (Step 3):
```
Test Files  1 passed (1)
     Tests  4 passed (4)
```

### Route (Steps 5-6)

RED — `npx vitest run tests/api/messages-route-pagination.test.ts` before
implementing:
```
❯ tests/api/messages-route-pagination.test.ts (6 tests | 5 failed) 43ms
[API] Failed to get messages: Error: [vitest] No "getMessagesCountByProjectId"
export is defined on the "@/lib/services/message" mock.
```
Expected: fails because the route still imports/calls the now-deleted
`getMessagesCountByProjectId` and passes a bare numeric `offset` instead of
the options object — exactly as the brief predicted ("this route file, as it
stands right now, doesn't even build" against the new mock/signature).
Confirmed — 5/6 failed for this reason; 1 incidentally passed (the
default-params call happened to match before the offset/count logic threw,
since the assertion runs before the throw is observed by the test in that
particular case) — no test passed for the wrong reason material to the task.

GREEN — same command after implementing (Step 6):
```
Test Files  1 passed (1)
     Tests  6 passed (6)
```

### Combined (Step 7)

```
$ npx vitest run tests/services/message-pagination.test.ts tests/api/messages-route-pagination.test.ts
Test Files  2 passed (2)
     Tests  10 passed (10)
```

```
$ npm run type-check
> tsc --noEmit
(no output, exit 0)
```

## Additional verification

- `grep -rn "getMessagesCountByProjectId"` across the worktree: no
  remaining references (confirms the brief's "exactly one caller" claim
  and that nothing else broke).
- Full suite: `npm test` → `Test Files 44 passed (44)`, `Tests 250 passed
  (250)`, output pristine.
- `npm run lint`: 0 errors. 51 pre-existing warnings in unrelated files
  (`hooks/useUserRequests.ts`, `lib/services/preview.ts`,
  `lib/services/project.ts`, `lib/utils/ports.ts`, `scripts/setup-env.js`,
  `tests/utils/ports-default-range.test.ts`) — none in the files this task
  touched.

## Self-review

- Diff matches the brief's Step 3 and Step 6 code blocks exactly; no
  unrelated lines touched in either modified file.
- Doc comment updated as instructed
  (`/** Retrieve project messages, cursor-paginated by (createdAt, id) */`).
- `POST`/`DELETE`/`RouteContext`/trailing exports in the route file
  verified unchanged (`git show` diff confirms only import line + `GET`
  changed).
- No new dependencies added; matches existing Polish-description test
  convention already used elsewhere in `tests/`.

## Concerns

None. Everything in the brief's acceptance criteria (Step 7/8) is met:
both test files pass together (10/10), `npm run type-check` is clean, and
the commit contains exactly the four files the brief's Step 8 lists.

## Fix — reviewer finding: vacuous `totalCount` assertion

### Finding

`tests/api/messages-route-pagination.test.ts`, test `'odpowiedź nie zawiera
już totalCount'`: the test only asserted `expect(body.totalCount).toBeUndefined()`.
A 500 error body (`{ success: false, error, message }`) also has no
`totalCount` field, so the test would pass even if the route were broken
and returning an error — it never confirmed the request actually
succeeded.

### Fix

Added `expect(response.status).toBe(200)` and `expect(body.success).toBe(true)`
alongside the existing assertion, matching the pattern already used by the
other tests in the file (e.g. the `before`-validation tests assert
`response.status` explicitly).

Workspace re-verified before editing:
```
$ git rev-parse --show-toplevel
/home/m/work/Claudable/.claude/worktrees/fix+chat-history-pagination
$ git branch --show-current
worktree-fix+chat-history-pagination
```
`git status` showed only the untracked `.flow/sdd/` dir (no foreign changes).

### Proof the old assertion was vacuous, and the new one is not

Temporarily forced `getMessagesByProjectId` to reject (`mockRejectedValueOnce`)
to simulate the route's error path, with the strengthened assertions already
in place, and ran just this test:

```
$ npx vitest run tests/api/messages-route-pagination.test.ts
 ❯ tests/api/messages-route-pagination.test.ts (6 tests | 1 failed)
     × odpowiedź nie zawiera już totalCount
AssertionError: expected 500 to be 200 // Object.is equality
- Expected: 200
+ Received: 500
```
This confirms the gap: with only the old `body.totalCount` check, this
500-error scenario would have passed silently. The strengthened test
correctly fails against it — i.e., it would have failed against a buggy
route that regressed to an error response instead of the paginated
success shape.

Restored the mock to the success case (`mockResolvedValueOnce([fixtureMessage()])`)
and reran:
```
$ npx vitest run tests/api/messages-route-pagination.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Full verification

```
$ npm test
 Test Files  44 passed (44)
      Tests  250 passed (250)
   Duration  2.49s
```

```
$ npm run type-check
> tsc --noEmit
(no output, exit 0)
```

### Diff

```
diff --git a/tests/api/messages-route-pagination.test.ts b/tests/api/messages-route-pagination.test.ts
@@ -98,6 +98,8 @@
     const response = await callGet('?limit=50');
     const body = await response.json();

+    expect(response.status).toBe(200);
+    expect(body.success).toBe(true);
     expect(body.totalCount).toBeUndefined();
   });
 });
```
Only this test file changed — nothing else in Task 1's approved diff was
touched, per the dispatch's instruction.

### Commit

`3318615` — "test: strengthen totalCount-absence assertion in messages route test"

### Declined

Nothing declined; the finding was applied as specified.
