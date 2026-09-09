## Global Constraints

- TypeScript strict (`npm run type-check` must pass).
- ESLint 9 flat config (`npm run lint` must pass).
- Tests: Vitest, `npm test`; test files mirror `app/`/`lib/` structure
  under `tests/`.
- No new dependencies.
- Match existing code style in each file (this repo's test files commonly
  use Polish `it()`/`describe()` descriptions — follow the convention of
  the directory you're adding to).


## File Structure

- **Modify** `lib/services/message.ts` — `getMessagesByProjectId` changes
  from `(projectId, limit, offset)` to `(projectId, limit, { order?,
  before? })` where `before` is `{ createdAt: Date; id: string }`
  (composite keyset, not a bare timestamp). `getMessagesCountByProjectId`
  is deleted in the same task — it has exactly one caller (confirmed via
  `trace_path`), the messages route below, and that caller no longer
  needs a total count once the "(N remaining)" label is gone.
- **Modify** `app/api/chat/[project_id]/messages/route.ts` — `GET` gains
  `order`/`before`/`beforeId` query params, passes them through as a
  composite cursor, drops the `getMessagesCountByProjectId` call and
  `totalCount` response field (nothing reads them after Task 3), and
  `hasMore` becomes a full-page check instead of an offset+count
  comparison. Changed in the same task as the service file above — see
  the Revision note on why these two aren't split.
- **Create** `lib/serializers/client/pagination.ts` — `getPageCursor`,
  deriving the next composite "before" cursor from a batch of messages.
  Lives alongside `chat.ts`/`tool-messages.ts` because, like them, it's
  message-normalization logic.
- **Create** `lib/utils/scroll.ts` — `shouldStickToBottom`, the
  near-bottom scroll heuristic, as a pure function of DOM measurements so
  it's testable without a DOM. Lives in `lib/utils/` (alongside
  `random-id.ts` and friends) rather than `lib/serializers/client/`
  because it's a generic scroll predicate, not message-normalization
  logic — it has nothing to do with `ChatMessage` shapes.
- **Modify** `components/chat/ChatLog.tsx` — `loadChatHistory` fetches
  newest-first and seeds the pagination cursor exactly once, from real
  data; `loadOlderMessages` pages via the cursor (not `messages.length`),
  trusts the server's `hasMore` directly, guards against overlapping
  in-flight requests, and restores scroll position after prepending older
  messages; a `stickToBottomRef` (updated only by the container's
  `onScroll` handler) replaces the old always-scroll effect; the
  project-switch reset effect is extended to reset the new refs so
  switching projects doesn't leak one project's pagination cursor into
  another's fetches.
- **Create** `tests/services/message-pagination.test.ts`,
  `tests/api/messages-route-pagination.test.ts`,
  `tests/serializers/pagination.test.ts`, `tests/utils/scroll.test.ts`.

Task order: service layer + route together first (Task 1, since they
can't land independently — see Revision note), then the pure client
helpers (Task 2), then wiring them into `ChatLog.tsx` (Task 3) — each
task only depends on the ones before it.

---

### Task 2: Pure pagination helpers for the client

**Files:**
- Create: `lib/serializers/client/pagination.ts`
- Create: `lib/utils/scroll.ts`
- Test: `tests/serializers/pagination.test.ts`
- Test: `tests/utils/scroll.test.ts`

**Interfaces:**
- Produces:
  - `getPageCursor(messages: { createdAt?: string | null; id?: string | null }[]): { createdAt: string; id: string } | null`
  - `shouldStickToBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold?: number): boolean`
  Task 3 imports `getPageCursor` from `@/lib/serializers/client/pagination`
  and `shouldStickToBottom` from `@/lib/utils/scroll`.

`getPageCursor` trusts the ordering Task 1's `getMessagesByProjectId`
already guarantees (`orderBy: [{ createdAt: order }, { id: order }]`):
for `order=desc`, the batch the route returns is already sorted newest
to oldest, so the row this batch's "next page" cursor should point at —
the oldest row in the batch — is simply its last element. This is
narrower than "find the minimum regardless of input order" (which the
first version of this helper did); it's correct precisely because it
relies on a contract Task 1 established, not because it re-derives the
ordering defensively.

- [ ] **Step 1: Write the failing tests**

Create `tests/serializers/pagination.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getPageCursor } from '@/lib/serializers/client/pagination';

describe('getPageCursor', () => {
  it('zwraca null dla pustej listy', () => {
    expect(getPageCursor([])).toBeNull();
  });

  it('zwraca (createdAt, id) ostatniego elementu partii', () => {
    // Task 1's route always returns batches pre-sorted by (createdAt, id)
    // in the requested order — for order=desc, the last element is the
    // oldest row, exactly the cursor the next "load older" call needs.
    const messages = [
      { createdAt: '2026-01-05T00:00:00.000Z', id: 'c' },
      { createdAt: '2026-01-03T00:00:00.000Z', id: 'b' },
      { createdAt: '2026-01-01T00:00:00.000Z', id: 'a' },
    ];
    expect(getPageCursor(messages)).toEqual({ createdAt: '2026-01-01T00:00:00.000Z', id: 'a' });
  });

  it('zwraca null, gdy ostatniemu elementowi brakuje createdAt lub id', () => {
    expect(getPageCursor([{ createdAt: '2026-01-01T00:00:00.000Z' }])).toBeNull();
    expect(getPageCursor([{ id: 'a' }])).toBeNull();
  });
});
```

Create `tests/utils/scroll.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldStickToBottom } from '@/lib/utils/scroll';

describe('shouldStickToBottom', () => {
  it('true, gdy kontener jest przewinięty blisko dołu', () => {
    // scrollHeight 1000, scrollTop 900, clientHeight 90 -> 10px od dołu
    expect(shouldStickToBottom(1000, 900, 90)).toBe(true);
  });

  it('false, gdy użytkownik przewinął daleko w górę', () => {
    expect(shouldStickToBottom(1000, 100, 200)).toBe(false);
  });

  it('respektuje niestandardowy threshold', () => {
    expect(shouldStickToBottom(1000, 700, 200, 150)).toBe(true);
    expect(shouldStickToBottom(1000, 700, 200, 50)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/serializers/pagination.test.ts tests/utils/scroll.test.ts`
Expected: FAIL — neither `lib/serializers/client/pagination.ts` nor
`lib/utils/scroll.ts` exists yet (module not found).

- [ ] **Step 3: Write the minimal implementations**

Create `lib/serializers/client/pagination.ts`:

```ts
export interface PageCursorSource {
  createdAt?: string | null;
  id?: string | null;
}

export interface PageCursor {
  createdAt: string;
  id: string;
}

// Trusts the ordering lib/services/message.ts's getMessagesByProjectId
// already guarantees for a desc-ordered batch: the last element is the
// oldest row, i.e. exactly this batch's "next page" cursor.
export const getPageCursor = (messages: PageCursorSource[]): PageCursor | null => {
  const last = messages[messages.length - 1];
  if (!last?.createdAt || !last?.id) return null;
  return { createdAt: last.createdAt, id: last.id };
};
```

Create `lib/utils/scroll.ts`:

```ts
export const shouldStickToBottom = (
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold: number = 80
): boolean => {
  return scrollHeight - scrollTop - clientHeight < threshold;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/serializers/pagination.test.ts tests/utils/scroll.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add lib/serializers/client/pagination.ts lib/utils/scroll.ts tests/serializers/pagination.test.ts tests/utils/scroll.test.ts
git commit -m "feat: add pure cursor/scroll-guard helpers for chat pagination"
```

---
