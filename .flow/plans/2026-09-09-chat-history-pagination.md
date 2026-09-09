# Chat History Pagination Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix chat history pagination so the initial load shows the most
recent conversation (not the oldest messages) and "Load older messages"
reliably pages backward in real batches instead of ~1 message per click.

**Architecture:** Replace numeric offset-based pagination with cursor-based
pagination on `(createdAt, id)` — a composite keyset, not a bare timestamp,
because plain `createdAt` collides when messages are written in the same
millisecond (a real risk here: tool-call/tool-result pairs are written
back-to-back). `getMessagesByProjectId` gains `{ order, before }` options
(`before` is `{ createdAt, id }`) instead of a numeric offset; the API
route passes through `order`/`before`/`beforeId` query params and reports
`hasMore` as "did this page come back full"; `ChatLog.tsx` fetches
newest-first for the initial/polling load and pages older messages via
that composite cursor, tracked from real server responses only — never
from the client's deduplicated/expanded array length, which was the root
cause of the "loads 1 message at a time" bug. Auto-scroll-to-bottom is
driven by a `stickToBottomRef` that starts `true` and is updated only by
the container's own `onScroll` event (never by measuring the DOM inside
the effect that reacts to new messages — messages effects run after
React has already committed the new content, so a post-commit
measurement always sees the *grown* scroll height, not whether the user
was at the bottom before it grew). This fixes the originally-reported
"load older" jump-to-bottom problem *and* the same problem for
SSE/polling updates while the user is reading history. Prepending older
messages additionally needs its own scroll-position restore (`flushSync`
plus a before/after `scrollHeight` diff) — browser CSS scroll anchoring,
which would otherwise absorb most of a prepend's visual jump for free, is
specified to switch off exactly at `scrollTop === 0`, which is where the
"Load older messages" button sits.

**Tech Stack:** Next.js 16 App Router (route handlers), Prisma/SQLite,
React (`"use client"` component), Vitest.

**Spec:** `/home/m/work/Claudable/spec.md` D12 (§2 decisions table).

**Design record:** `/home/m/work/Claudable/.flow/specs/2026-09-09-chat-history-pagination-design.md`

**Revision note:** This plan was red-teamed three times before execution.

*Pass 1* found the first draft's client-side bookkeeping (an offset
counter reconstructed from array lengths, a "remaining count" derived
from a one-time total) reintroduced the same class of bug it was meant to
fix, plus a project-switch reset gap and an unguarded double-click on
"load older". Fixed by: trusting the server's `hasMore` directly instead
of any client running count, a composite `(createdAt, id)` cursor to
eliminate same-millisecond ties, adding the new refs to the existing
project-switch reset effect, and an in-flight guard on "load older". The
"(N remaining)" count on the button was dropped — every implementation of
it considered depends on knowing the true total against a moving target
(new messages keep arriving), exactly the bookkeeping being removed; the
button now just reads "Load older messages".

*Pass 2 (self-review)* found the service-layer signature change
(`getMessagesByProjectId`) and its sole caller (the route) were two
separate tasks; merged into one Task 1, because a commit changing only
the service function leaves the still-unmodified route calling it with
the old numeric-offset argument shape — a `tsc --noEmit` failure that
TypeScript-strict (a Global Constraint below) would catch, sitting in a
state a task reviewer would be asked to approve. The two files cannot be
landed independently without breaking the build.

*Pass 3* found that pass 1's "stick to bottom only if already there"
guard measured scroll position *inside* the effect that reacts to
`messages` changing — i.e. after React had already committed the new,
taller content, so the measurement always saw the *grown* height and
almost never reported "near bottom", breaking auto-scroll for ordinary
new messages (a regression versus the original always-scroll behavior).
It also found the near-bottom guard alone does nothing about the
*prepend* jump from "load older" itself — the button sits at
`scrollTop === 0`, exactly where CSS scroll anchoring is specified to be
suppressed, so relying on it there was unsound. Fixed by: tracking
"should stay pinned to bottom" in a ref (`stickToBottomRef`) updated only
by the container's own `onScroll` handler (never by post-hoc measurement
inside a `messages` effect), and restoring `scrollTop` explicitly after
"load older" prepends content, using `flushSync` to force a synchronous
commit so the before/after `scrollHeight` diff is accurate.
`scrollToBottom` also switched from `behavior: 'smooth'` to `'auto'`,
because a smooth scroll's own intermediate `scroll` events would
otherwise feed back into `stickToBottomRef` and intermittently report
"not at bottom" mid-animation. This pass also found the pure-helpers
task (`getPageCursor`) was defensively re-deriving an ordering the
service layer already guarantees (Task 1's `orderBy` is exactly what
`ChatLog.tsx` relies on) — simplified from a full min-scan to reading the
batch's last element, and `shouldStickToBottom` was relocated from
`lib/serializers/client/` (message-normalization code) to `lib/utils/`
(where it actually belongs — a generic DOM-scroll predicate). It also
found the manual-verification step mixed checks a headless implementer
can actually run (pagination/cursor correctness — fully checkable over
HTTP with `curl`/`fetch`, no browser needed) with checks that gen­uinely
need a browser (visual scroll-jump, double-click race, project-switch
UI); these are now split, with the browser-only checks explicitly flagged
per `spec.md` §8's existing convention for UI work this repo can't
automate, rather than left for an implementer to silently claim as done.
Finally, `spec.md` decision 12 was corrected directly (not deferred to a
plan task) once the cursor became composite and `hasMore`'s semantics
changed — the design record `.flow/specs/2026-09-09-chat-history-pagination-design.md`
is left as-is (a dated record of that session's deliberation, not meant
to be revised), but the decision table row is the current, accurate
contract.

**Spec-sync:** Already done — `spec.md` decision 12 reflects the composite
`(createdAt, id)` cursor and the `hasMore` full-page semantics as of this
plan's current revision. No other section of the spec describing *state*
(§3 Architecture, §4 Data model) documents the pagination contract, so
nothing else there is made false by this change.

## Global Constraints

- TypeScript strict (`npm run type-check` must pass).
- ESLint 9 flat config (`npm run lint` must pass).
- Tests: Vitest, `npm test`; test files mirror `app/`/`lib/` structure
  under `tests/`.
- No new dependencies.
- Match existing code style in each file (this repo's test files commonly
  use Polish `it()`/`describe()` descriptions — follow the convention of
  the directory you're adding to).

---

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

### Task 1: Composite-cursor pagination — service layer and route together

**Files:**
- Modify: `lib/services/message.ts:33-49` (also delete
  `getMessagesCountByProjectId`, currently lines 125-134 — its doc
  comment is `/** Get total count of messages for a project */`)
- Modify: `app/api/chat/[project_id]/messages/route.ts:1-59`
- Test: `tests/services/message-pagination.test.ts`
- Test: `tests/api/messages-route-pagination.test.ts`

**Interfaces:**
- Produces: `getMessagesByProjectId(projectId: string, limit?: number, options?: { order?: 'asc' | 'desc'; before?: { createdAt: Date; id: string } }): Promise<Message[]>` (internal to this task — the route is its only caller, changed here too) and `GET /api/chat/[project_id]/messages?limit=&order=&before=&beforeId=` returning `{ success, data, pagination: { limit, order, hasMore } }`. Task 3 (`ChatLog.tsx`) calls this route with `order=desc` and, for "load older", `before=<ISO createdAt>&beforeId=<id>` from the oldest loaded message.

Why a composite `(createdAt, id)` cursor and not a bare timestamp: this
app's `Message.createdAt` (`prisma/schema.prisma:92`) is
`@default(now())` with millisecond precision and no secondary uniqueness
guarantee; tool-call/tool-result message pairs are written back-to-back
and can land in the same millisecond. A cursor of "createdAt < X" alone
would silently and permanently skip any row tied with the boundary row
whose id sorts after the one used to build the cursor. `id` is
`@default(cuid())` (`prisma/schema.prisma:69`), unique, and a stable
tiebreaker — it doesn't need to be chronologically meaningful, only
deterministic, to make pagination lossless.

The current service implementation (for reference — this is what you're
replacing):

```ts
export async function getMessagesByProjectId(
  projectId: string,
  limit: number = 50,
  offset: number = 0
): Promise<Message[]> {
  const messages = await prisma.message.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    skip: offset,
    take: limit,
  });

  return messages.map(mapPrismaMessage);
}
```

The current route implementation (for reference — the whole file, lines
1-59):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getMessagesByProjectId, createMessage, deleteMessagesByProjectId, getMessagesCountByProjectId } from '@/lib/services/message';
import type { CreateMessageInput } from '@/types/backend';
import { serializeMessages, serializeMessage } from '@/lib/serializers/chat';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { project_id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const [messages, totalCount] = await Promise.all([
      getMessagesByProjectId(project_id, limit, offset),
      getMessagesCountByProjectId(project_id),
    ]);
    const serialized = serializeMessages(messages);

    const res = NextResponse.json({
      success: true,
      data: serialized,
      totalCount,
      pagination: {
        limit,
        offset,
        count: serialized.length,
        hasMore: offset + serialized.length < totalCount,
      },
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (error) {
    console.error('[API] Failed to get messages:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch messages',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 1: Write the failing service-layer test**

Create `tests/services/message-pagination.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();

vi.mock('@/lib/db/client', () => ({
  prisma: {
    message: { findMany },
  },
}));

beforeEach(() => {
  findMany.mockReset();
});

const fixtureRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1',
  projectId: 'proj1',
  conversationId: null,
  sessionId: null,
  role: 'user',
  content: 'hello',
  messageType: 'chat',
  metadataJson: null,
  parentMessageId: null,
  cliSource: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  requestId: null,
  ...overrides,
});

describe('getMessagesByProjectId — paginacja kursorowa', () => {
  it('domyślnie sortuje rosnąco (createdAt, id) i nie filtruje', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');

    await getMessagesByProjectId('proj1', 50);

    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj1' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
  });

  it('order=desc bez before zwraca najnowsze wiadomości malejąco', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');

    await getMessagesByProjectId('proj1', 200, { order: 'desc' });

    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
  });

  it('order=desc z before filtruje po złożonym kursorze (createdAt, id) malejąco', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');
    const before = { createdAt: new Date('2026-01-05T00:00:00.000Z'), id: 'm50' };

    await getMessagesByProjectId('proj1', 100, { order: 'desc', before });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'proj1',
        OR: [
          { createdAt: { lt: before.createdAt } },
          { createdAt: before.createdAt, id: { lt: before.id } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  });

  it('order=asc z before filtruje po złożonym kursorze (createdAt, id) rosnąco', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');
    const before = { createdAt: new Date('2026-01-05T00:00:00.000Z'), id: 'm50' };

    await getMessagesByProjectId('proj1', 100, { order: 'asc', before });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'proj1',
        OR: [
          { createdAt: { gt: before.createdAt } },
          { createdAt: before.createdAt, id: { gt: before.id } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  });
});
```

- [ ] **Step 2: Run the service-layer test to verify it fails**

Run: `npx vitest run tests/services/message-pagination.test.ts`
Expected: FAIL — `getMessagesByProjectId` still takes a numeric `offset`
third argument and a single-field `orderBy`, so none of these `findMany`
call shapes match yet.

- [ ] **Step 3: Implement the service-layer change**

In `lib/services/message.ts`, replace the function (lines 33-49) with:

```ts
export async function getMessagesByProjectId(
  projectId: string,
  limit: number = 50,
  options: { order?: 'asc' | 'desc'; before?: { createdAt: Date; id: string } } = {}
): Promise<Message[]> {
  const { order = 'asc', before } = options;

  const cursorWhere = before
    ? order === 'desc'
      ? {
          OR: [
            { createdAt: { lt: before.createdAt } },
            { createdAt: before.createdAt, id: { lt: before.id } },
          ],
        }
      : {
          OR: [
            { createdAt: { gt: before.createdAt } },
            { createdAt: before.createdAt, id: { gt: before.id } },
          ],
        }
    : {};

  const messages = await prisma.message.findMany({
    where: { projectId, ...cursorWhere },
    orderBy: [{ createdAt: order }, { id: order }],
    take: limit,
  });

  return messages.map(mapPrismaMessage);
}
```

Update the doc comment above it from `/** Retrieve project messages (with
pagination) */` to `/** Retrieve project messages, cursor-paginated by
(createdAt, id) */`.

Then delete `getMessagesCountByProjectId` entirely (currently lines
125-134 — the `/** Get total count of messages for a project */` function
and its blank surrounding lines). Its only caller is the route, changed
in Step 6 below, in this same task.

- [ ] **Step 4: Run the service-layer test to verify it passes**

Run: `npx vitest run tests/services/message-pagination.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing route test**

Create `tests/api/messages-route-pagination.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getMessagesByProjectId = vi.fn();

vi.mock('@/lib/services/message', () => ({
  getMessagesByProjectId,
  createMessage: vi.fn(),
  deleteMessagesByProjectId: vi.fn(),
}));

const fixtureMessage = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1',
  projectId: 'proj1',
  conversationId: null,
  sessionId: null,
  role: 'user',
  content: 'hello',
  messageType: 'chat',
  metadataJson: null,
  parentMessageId: null,
  cliSource: null,
  createdAt: new Date('2026-01-05T00:00:00.000Z'),
  updatedAt: new Date('2026-01-05T00:00:00.000Z'),
  requestId: null,
  ...overrides,
});

const callGet = async (query: string) => {
  const { GET } = await import('@/app/api/chat/[project_id]/messages/route');
  const request = new NextRequest(`http://localhost/api/chat/proj1/messages${query}`);
  return GET(request, { params: Promise.resolve({ project_id: 'proj1' }) });
};

describe('GET /api/chat/[project_id]/messages — paginacja kursorowa', () => {
  it('domyślnie przekazuje order=asc i brak kursora', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);

    await callGet('?limit=50');

    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 50, {
      order: 'asc',
      before: undefined,
    });
  });

  it('order=desc&before=<iso>&beforeId=<id> przekazuje złożony kursor', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);
    const iso = '2026-01-05T00:00:00.000Z';

    await callGet(`?limit=100&order=desc&before=${encodeURIComponent(iso)}&beforeId=m50`);

    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 100, {
      order: 'desc',
      before: { createdAt: new Date(iso), id: 'm50' },
    });
  });

  it('before bez beforeId (albo odwrotnie) jest ignorowany zamiast wywalać żądanie', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);

    const response = await callGet('?limit=50&order=desc&before=2026-01-05T00:00:00.000Z');

    expect(response.status).toBe(200);
    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 50, {
      order: 'desc',
      before: undefined,
    });
  });

  it('nieprawidłowy before jest ignorowany zamiast wywalać żądanie', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);

    const response = await callGet('?limit=50&order=desc&before=not-a-date&beforeId=m50');

    expect(response.status).toBe(200);
    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 50, {
      order: 'desc',
      before: undefined,
    });
  });

  it('hasMore=true gdy strona jest pełna, false gdy niepełna', async () => {
    getMessagesByProjectId
      .mockReset()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => fixtureMessage({ id: `m${i}` })));
    const full = await callGet('?limit=100&order=desc');
    expect((await full.json()).pagination.hasMore).toBe(true);

    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);
    const partial = await callGet('?limit=100&order=desc');
    expect((await partial.json()).pagination.hasMore).toBe(false);
  });

  it('odpowiedź nie zawiera już totalCount', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);

    const response = await callGet('?limit=50');
    const body = await response.json();

    expect(body.totalCount).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run the route test to verify it fails, then implement the route change**

Run: `npx vitest run tests/api/messages-route-pagination.test.ts`
Expected: FAIL — the route still parses `offset`, calls
`getMessagesByProjectId(project_id, limit, offset)` with a bare number
(mismatched against the new options-object signature from Step 3), and
calls `getMessagesCountByProjectId`, which Step 3 already deleted — so
this route file, as it stands right now, doesn't even build.

Replace the whole file `app/api/chat/[project_id]/messages/route.ts`'s
import line and `GET` function with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getMessagesByProjectId, createMessage, deleteMessagesByProjectId } from '@/lib/services/message';
import type { CreateMessageInput } from '@/types/backend';
import { serializeMessages, serializeMessage } from '@/lib/serializers/chat';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

/**
 * GET /api/chat/[project_id]/messages
 * Get project message history
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { project_id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const order: 'asc' | 'desc' = searchParams.get('order') === 'desc' ? 'desc' : 'asc';
    const beforeParam = searchParams.get('before');
    const beforeIdParam = searchParams.get('beforeId');
    const before =
      beforeParam && beforeIdParam && !Number.isNaN(Date.parse(beforeParam))
        ? { createdAt: new Date(beforeParam), id: beforeIdParam }
        : undefined;

    const messages = await getMessagesByProjectId(project_id, limit, { order, before });
    const serialized = serializeMessages(messages);

    const res = NextResponse.json({
      success: true,
      data: serialized,
      pagination: {
        limit,
        order,
        hasMore: serialized.length === limit,
      },
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (error) {
    console.error('[API] Failed to get messages:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch messages',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
```

(Only the import line and the `GET` function change — leave `POST`,
`DELETE`, `RouteContext`, and the trailing `runtime`/`dynamic` exports
exactly as they are.)

- [ ] **Step 7: Run both tests and type-check to verify everything passes together**

Run: `npx vitest run tests/services/message-pagination.test.ts tests/api/messages-route-pagination.test.ts`
Expected: PASS (10 tests total).

Run: `npm run type-check`
Expected: no errors — this is the check that would have caught the
service/route mismatch if they'd been split into two tasks (see this
plan's Revision note); run it here, not just at the very end of the
plan, so a mismatch is caught immediately rather than surfacing three
tasks later.

- [ ] **Step 8: Commit**

```bash
git add lib/services/message.ts app/api/chat/[project_id]/messages/route.ts tests/services/message-pagination.test.ts tests/api/messages-route-pagination.test.ts
git commit -m "fix: composite-cursor pagination in message service and route"
```

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

### Task 3: Wire `ChatLog.tsx` to newest-first loading, composite-cursor pagination, and correct scroll behavior

**Files:**
- Modify: `components/chat/ChatLog.tsx`

**Interfaces:**
- Consumes: `getPageCursor` from `@/lib/serializers/client/pagination`,
  `shouldStickToBottom` from `@/lib/utils/scroll` (Task 2); the route's
  `order`/`before`/`beforeId` query params and `pagination.hasMore`
  full-page semantics (Task 1); `flushSync` from `react-dom` (this
  project's React is 19.2.8, where `flushSync` is a stable, documented
  API — not new/experimental).
- Produces: no new exports — this is the component wiring. Its
  correctness is split across two kinds of verification (Step 8): the
  pagination/cursor logic is checked over plain HTTP, which a headless
  implementer can run directly; the visual scroll behavior needs a real
  browser and is explicitly flagged rather than assumed done — this repo
  has no component-level test harness (`@testing-library/react`/jsdom are
  not installed — confirmed: `package.json` only lists `vitest`), and
  `spec.md` §8 already documents that UI logic without unit-testable
  seams relies on flagged manual verification rather than being silently
  treated as covered.

This task touches several non-adjacent spots in the same file. Do them
in this order. Read the whole file once before starting — some line
numbers below will have shifted slightly by the time you reach later
steps in this same task, since earlier steps in it edit the file too;
re-locate each snippet by its surrounding code, not by line number alone.

- [ ] **Step 1: Add the new imports, refs, and state**

Add two new imports after the existing `tool-messages` import block
(after `components/chat/ChatLog.tsx:18`):

```ts
import { getPageCursor } from '@/lib/serializers/client/pagination';
import { shouldStickToBottom } from '@/lib/utils/scroll';
```

Add `flushSync` to the React import at the very top of the file — this
one is from `react-dom`, not `react`, so it's a separate import line, not
an addition to the existing `import React, { ... } from 'react';` (line
2):

```ts
import { flushSync } from 'react-dom';
```

Next to the existing `logsEndRef` declaration (`const logsEndRef =
useRef<HTMLDivElement>(null);`, currently line 275), add:

```ts
  const logsContainerRef = useRef<HTMLDivElement>(null);
```

Find the existing pagination state (currently lines 403-404):

```ts
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessageCount, setTotalMessageCount] = useState(0);
```

Replace with:

```ts
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const oldestLoadedCursorRef = useRef<{ createdAt: string; id: string } | null>(null);
  const paginationInitializedRef = useRef(false);
  // Whether the view should auto-follow new messages. Starts true (a
  // freshly-mounted project should open at the bottom of its history)
  // and is updated ONLY by the container's own onScroll handler (Step 6)
  // — never by measuring the DOM inside the effect that reacts to
  // `messages` changing, because that effect runs after React has
  // already committed the new, taller content: at that point the
  // container's scrollHeight has already grown, so "distance from
  // bottom" would almost always read as "far", even when the user was
  // at the bottom right before the update.
  const stickToBottomRef = useRef(true);
```

(`totalMessageCount` is removed along with the "(N remaining)" label in
Step 6 — nothing else in the file reads it; confirmed by grepping the
file for `totalMessageCount` before starting this task.)

- [ ] **Step 2: Reset the new refs/state when the project changes**

Find the project-switch reset effect (currently lines 1158-1166):

```ts
  useEffect(() => {
    hasLoadedInitialDataRef.current = false;
    setHasLoadedOnce(false);
    setIsLoading(true);
    setMessages([]);
    setExpandedToolMessages({});
    fallbackMessageIdRef.current.clear();
    visibleToolMessageIdsRef.current.clear();
  }, [projectId]);
```

Add the new refs/state to it:

```ts
  useEffect(() => {
    hasLoadedInitialDataRef.current = false;
    setHasLoadedOnce(false);
    setIsLoading(true);
    setMessages([]);
    setExpandedToolMessages({});
    fallbackMessageIdRef.current.clear();
    visibleToolMessageIdsRef.current.clear();
    oldestLoadedCursorRef.current = null;
    paginationInitializedRef.current = false;
    stickToBottomRef.current = true;
    setHasMoreMessages(false);
    setIsLoadingOlder(false);
  }, [projectId]);
```

This matters: without it, switching from a short chat to a long one keeps
the short chat's (already-exhausted) pagination state, so "Load older
messages" never appears for the new project; switching the other way
carries the old project's cursor into a fetch for the new project's
messages.

- [ ] **Step 3: Fix the auto-scroll effect and switch `scrollToBottom` to an instant jump**

Find `scrollToBottom` (currently lines 815-817):

```ts
  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
```

Replace with:

```ts
  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "auto" });
  };
```

(`behavior: "auto"` instead of `"smooth"`: a smooth scroll fires a
sequence of intermediate native `scroll` events while it animates, each
of which would update `stickToBottomRef` via the `onScroll` handler added
in Step 6 — reporting "not at bottom" for most of the animation's
duration and breaking the sticky-follow behavior for the very next
message that arrives mid-animation. An instant jump has no intermediate
frames, so this can't happen.)

Find the auto-scroll effect (currently line 863):

```ts
  useEffect(scrollToBottom, [messages]);
```

Replace with:

```ts
  useEffect(() => {
    if (messages.length === 0) return;
    if (stickToBottomRef.current) {
      scrollToBottom();
    }
  }, [messages]);
```

This effect only *decides whether* to scroll — it never measures the
DOM itself. The measurement that decides `stickToBottomRef` happens in
the container's `onScroll` handler (Step 6), which only fires on actual
user/programmatic scrolling, not on content growing underneath an
unchanged `scrollTop`.

- [ ] **Step 4: Rewrite `loadChatHistory` to fetch newest-first and seed the cursor once**

Find the current `loadChatHistory` (currently lines 996-1041) and replace
its body with:

```ts
  // Load chat history
  const loadChatHistory = useCallback(
    async ({ showLoading }: { showLoading?: boolean } = {}) => {
      const shouldShowLoading = showLoading ?? !hasLoadedInitialDataRef.current;
      if (shouldShowLoading) {
        setIsLoading(true);
      }

      try {
        // Always fetch the most recent window; "load older" pages further
        // back from there via a composite (createdAt, id) cursor (see
        // loadOlderMessages).
        const response = await fetch(`${API_BASE}/api/chat/${projectId}/messages?limit=200&order=desc`);
        if (response.ok) {
          const payload = await response.json();
          const chatMessages = Array.isArray(payload)
            ? payload
            : payload?.data ?? payload?.messages ?? [];
          const normalized = Array.isArray(chatMessages)
            ? expandMessagesList(chatMessages.map(toChatMessage), ensureStableMessageId)
            : [];

          // Seed the pagination cursor exactly once, from the first
          // response that actually has messages. A poll re-fetching the
          // same newest window must not touch this — it tracks how far
          // back "load older" has already paged, independent of polling.
          if (!paginationInitializedRef.current && Array.isArray(chatMessages) && chatMessages.length > 0) {
            oldestLoadedCursorRef.current = getPageCursor(chatMessages);
            setHasMoreMessages(payload?.pagination?.hasMore ?? false);
            paginationInitializedRef.current = true;
          }

          setMessages((prev) => integrateMessages(prev, normalized));
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('Failed to load chat history (network issue):', error);
        }
      } finally {
        if (shouldShowLoading) {
          setIsLoading(false);
        }
        hasLoadedInitialDataRef.current = true;
        setHasLoadedOnce(true);
      }
    },
    [projectId, ensureStableMessageId]
  );
```

Note what changed: the fetch URL drops `offset=0` in favor of
`order=desc` (so the *first* page is the newest window, not the oldest);
the unused `didSucceed` variable from the old version is gone (it was
assigned but never read); `hasMoreMessages` and the pagination cursor are
now seeded once, guarded on the batch actually being non-empty (an empty
first response — a brand-new project with no messages yet — must leave
`paginationInitializedRef` false, so seeding still happens once real
messages exist on a later poll).

- [ ] **Step 5: Rewrite `loadOlderMessages` to page via the composite cursor, trust the server's `hasMore`, guard against overlapping requests, and preserve scroll position**

Find the current `loadOlderMessages` (currently lines 1055-1086) and
replace it with:

```ts
  // Load older messages (pagination) — pages backward from the oldest
  // loaded message via a composite (createdAt, id) cursor, not an
  // offset, so it never depends on the size of the client's
  // deduplicated/expanded message array (that mismatch was the cause of
  // only ~1 message loading per click).
  const loadOlderMessages = useCallback(async () => {
    if (!projectId || !hasMoreMessages || !oldestLoadedCursorRef.current || isLoadingOlder) return;

    setIsLoadingOlder(true);
    try {
      const cursor = oldestLoadedCursorRef.current;
      const response = await fetch(
        `${API_BASE}/api/chat/${projectId}/messages?limit=100&order=desc&before=${encodeURIComponent(cursor.createdAt)}&beforeId=${encodeURIComponent(cursor.id)}`
      );

      if (response.ok) {
        const payload = await response.json();
        const chatMessages = Array.isArray(payload)
          ? payload
          : payload?.data ?? payload?.messages ?? [];
        const normalized = Array.isArray(chatMessages)
          ? expandMessagesList(chatMessages.map(toChatMessage), ensureStableMessageId)
          : [];

        setHasMoreMessages(payload?.pagination?.hasMore ?? false);

        if (Array.isArray(chatMessages) && chatMessages.length > 0) {
          oldestLoadedCursorRef.current = getPageCursor(chatMessages) ?? oldestLoadedCursorRef.current;
          console.log(`[ChatLog] Loaded ${chatMessages.length} older messages`);
        }

        if (normalized.length > 0) {
          // Prepending above the current scroll position shifts
          // everything below it down. The button that triggers this is
          // at scrollTop === 0, exactly the offset where CSS scroll
          // anchoring is specified to be suppressed, so it can't be
          // relied on here — restore the position explicitly instead.
          // flushSync forces the state update to commit synchronously so
          // the "after" measurement below is accurate (a normal
          // setMessages call wouldn't have updated the DOM yet by the
          // time the next line runs).
          const container = logsContainerRef.current;
          const previousScrollHeight = container?.scrollHeight ?? 0;
          const previousScrollTop = container?.scrollTop ?? 0;
          flushSync(() => {
            setMessages((prev) => integrateMessages(prev, normalized));
          });
          if (container) {
            container.scrollTop = previousScrollTop + (container.scrollHeight - previousScrollHeight);
          }
        }
      }
    } catch (error) {
      console.error('[ChatLog] Failed to load older messages:', error);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [projectId, hasMoreMessages, isLoadingOlder, ensureStableMessageId]);
```

Note what changed: no more `currentOffset = messages.length`; the
request uses `before`/`beforeId` from `oldestLoadedCursorRef` instead of
`offset=${currentOffset}`; `hasMoreMessages` is set directly from this
response's `pagination.hasMore` (the server already computed "did this
page come back full" — Task 1's whole point); a new `isLoadingOlder`
guard (checked at the top and set for the duration of the fetch) means a
second click while a request is in flight is a no-op instead of issuing
a duplicate fetch with the same cursor; the `setMessages` call is now
wrapped in `flushSync` with an explicit scroll-position restore
immediately after it.

- [ ] **Step 6: Wire the container ref, add the `onScroll` handler, and simplify the button**

Find the scrollable messages container (currently line 1577):

```tsx
      <div className="flex-1 overflow-y-auto px-8 py-3 space-y-2 custom-scrollbar ">
```

Replace with:

```tsx
      <div
        ref={logsContainerRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottomRef.current = shouldStickToBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
        }}
        className="flex-1 overflow-y-auto px-8 py-3 space-y-2 custom-scrollbar "
      >
```

Find the "load older messages" button (currently lines 1596-1607):

```tsx
        {/* Load older messages button */}
        {hasMoreMessages && (
          <div className="mb-4 flex justify-center">
            <button
              onClick={loadOlderMessages}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              disabled={isLoading}
            >
              {isLoading ? 'Loading...' : `Load older messages (${totalMessageCount - messages.length} remaining)`}
            </button>
          </div>
        )}
```

Replace with:

```tsx
        {/* Load older messages button */}
        {hasMoreMessages && (
          <div className="mb-4 flex justify-center">
            <button
              onClick={loadOlderMessages}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              disabled={isLoadingOlder}
            >
              {isLoadingOlder ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}
```

(The old button used `disabled={isLoading}` — the *initial-load* flag,
never set during a "load older" fetch, so the button was never actually
disabled while a request was in flight. `isLoadingOlder`, set in Step 5,
fixes that. The "(N remaining)" count is dropped: every way considered to
keep it exactly correct required re-adding the kind of client-side
running-total bookkeeping this task just removed for being the root
cause of the original bug — see this plan's Revision note.)

- [ ] **Step 7: Type-check, lint, and run the full test suite**

Run: `npm run type-check`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm test`
Expected: all tests pass, including the four new suites from Tasks 1-2.

- [ ] **Step 8: Verify — HTTP-level checks (run these), browser checks (flag these)**

This step is split deliberately. Steps 8a and 8b below need only `curl`/
`fetch` against the running dev server — an implementer without browser
access can run and self-verify these, and they cover the pagination
logic (the bug actually reported). Step 8c needs a real browser for the
visual/interaction behavior; **do not claim it as verified unless you
actually used a browser** — report it as unverified instead. This split
exists because an earlier draft of this task asked for browser checks a
headless implementer cannot perform, and the two most serious bugs found
by plan review were exactly the kind Step 8c would have caught but a
skipped/rubber-stamped check would not.

**8a. Start the dev server** (leave it running in the background for the
rest of this step): `npm run dev`.

**8b. HTTP-level pagination check.** Run this script (adjust
`CLAUDABLE_BASE_URL` if the dev server isn't on the default port):

```bash
CLAUDABLE_BASE_URL="${CLAUDABLE_BASE_URL:-http://localhost:3000}" node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = process.env.CLAUDABLE_BASE_URL;

(async () => {
  const emptyProject = await prisma.project.create({ data: { name: 'pagination-check-empty' } });
  const emptyRes = await fetch(\`\${BASE}/api/chat/\${emptyProject.id}/messages?limit=200&order=desc\`);
  const emptyBody = await emptyRes.json();
  if (emptyBody.data.length !== 0 || emptyBody.pagination.hasMore !== false) {
    throw new Error('Empty project check failed: ' + JSON.stringify(emptyBody.pagination));
  }
  console.log('OK: empty project returns no messages, hasMore=false');

  // 337 messages: not a multiple of the 100-per-click batch size, so the
  // final page is a genuine partial page (37 messages) rather than a
  // boundary where a click returns 0 and the button just vanishes.
  const project = await prisma.project.create({ data: { name: 'pagination-check-seeded' } });
  const base = Date.now() - 337 * 60000;
  for (let i = 0; i < 337; i++) {
    await prisma.message.create({
      data: {
        projectId: project.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        messageType: 'chat',
        content: 'seed message ' + i,
        createdAt: new Date(base + i * 60000),
      },
    });
  }

  const page1Res = await fetch(\`\${BASE}/api/chat/\${project.id}/messages?limit=200&order=desc\`);
  const page1 = await page1Res.json();
  if (page1.data.length !== 200) throw new Error('Expected 200 messages, got ' + page1.data.length);
  if (page1.data[0].content !== 'seed message 336') throw new Error('First page is not newest-first: ' + page1.data[0].content);
  if (page1.pagination.hasMore !== true) throw new Error('Expected hasMore=true after first page');
  console.log('OK: initial page is newest-first (200 messages), hasMore=true');

  const oldest1 = page1.data[page1.data.length - 1];
  const page2Res = await fetch(\`\${BASE}/api/chat/\${project.id}/messages?limit=100&order=desc&before=\${encodeURIComponent(oldest1.createdAt)}&beforeId=\${oldest1.id}\`);
  const page2 = await page2Res.json();
  if (page2.data.length !== 100) throw new Error('Expected 100 older messages, got ' + page2.data.length);
  if (page2.data.some((m) => page1.data.some((p) => p.id === m.id))) throw new Error('Second page overlaps the first — cursor is wrong');
  if (page2.pagination.hasMore !== true) throw new Error('Expected hasMore=true after second page (37 remain)');
  console.log('OK: second page is 100 new, non-overlapping messages, hasMore=true');

  const oldest2 = page2.data[page2.data.length - 1];
  const page3Res = await fetch(\`\${BASE}/api/chat/\${project.id}/messages?limit=100&order=desc&before=\${encodeURIComponent(oldest2.createdAt)}&beforeId=\${oldest2.id}\`);
  const page3 = await page3Res.json();
  if (page3.data.length !== 37) throw new Error('Expected 37 final messages, got ' + page3.data.length);
  if (page3.data[page3.data.length - 1].content !== 'seed message 0') throw new Error('Last page does not reach the true start of history');
  if (page3.pagination.hasMore !== false) throw new Error('Expected hasMore=false at the true start of history');
  console.log('OK: final page reaches seed message 0, hasMore=false');

  await prisma.message.deleteMany({ where: { projectId: { in: [emptyProject.id, project.id] } } });
  await prisma.project.deleteMany({ where: { id: { in: [emptyProject.id, project.id] } } });
  console.log('Cleaned up test projects');
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
"
```

Expected: all five `OK:` lines print, script exits 0. If it fails,
Task 3 is not done — this is exercising the exact bug reported (batches
loading correctly, not one message at a time; the initial view being the
newest messages, not the oldest).

**8c. Browser-only checks — flag these explicitly if you cannot run
them; do not mark them done without actually using a browser.**

1. Open the chat UI for a project. Scroll up (away from the bottom) while
   the conversation is active, then click "Load older messages". Confirm
   the view does **not** jump — you stay roughly where you were reading,
   with the newly-loaded messages now above you.
2. With "Load older messages" visible, click it twice in quick
   succession. Confirm you don't lose or double-load a batch — the
   button should read "Loading..." and be disabled between the click and
   the response.
3. With a project fully paged back (button hidden), switch to a
   different project, then switch back. Confirm "Load older messages"
   state is correct for whichever project is active (not carried over
   from the other one).
4. While an agent turn is actively streaming output and you are
   scrolled to the bottom watching it, confirm the view keeps
   auto-scrolling with new content.
5. Scroll up during an active streaming turn and confirm the view does
   **not** auto-scroll while you're reading — new content should
   arrive without yanking your position, until you scroll back down
   yourself.

If you could not run 8c (no browser available in this environment), say
so explicitly in this task's report rather than marking it done — per
`spec.md` §8's existing convention for exactly this situation.

- [ ] **Step 9: Commit**

```bash
git add components/chat/ChatLog.tsx
git commit -m "fix: load newest chat messages first, page older via composite cursor, fix scroll-to-bottom and prepend jump"
```
