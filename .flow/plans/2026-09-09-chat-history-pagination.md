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
changed from "always, on every messages change" to "only when already
near the bottom, or on a project's first render" — this fixes the
originally-reported "load older" jump-to-bottom problem *and* the same
problem for SSE/polling updates while the user is reading history, which
the initial design missed.

**Tech Stack:** Next.js 16 App Router (route handlers), Prisma/SQLite,
React (`"use client"` component), Vitest.

**Spec:** `/home/m/work/Claudable/spec.md` D12 (§2 decisions table).

**Design record:** `/home/m/work/Claudable/.flow/specs/2026-09-09-chat-history-pagination-design.md`

**Revision note:** This plan was red-teamed after its first draft and
revised twice. The red-team found the first draft's client-side
bookkeeping (an offset counter reconstructed from array lengths, a
"remaining count" derived from a one-time total) reintroduced the same
class of bug it was meant to fix, plus a project-switch reset gap and an
unguarded double-click on "load older". This revision removes that
bookkeeping in favor of trusting the server's `hasMore` directly, adds a
composite `(createdAt, id)` cursor to eliminate same-millisecond ties,
adds the new refs to the existing project-switch reset effect, adds an
in-flight guard on "load older", and replaces the originally-planned
manual scroll-position-restore math with a simpler "stick to bottom only
if already there" guard that covers polling/SSE too. The "(N remaining)"
count on the button is dropped — every implementation of it that was
considered depends on knowing the true total against a moving target (new
messages keep arriving), which is exactly the kind of bookkeeping this
revision is removing on purpose; the button now just reads "Load older
messages". Second pass: the service-layer signature change
(`getMessagesByProjectId`) and its sole caller (the route) were
originally two separate tasks; merged into one, because a commit changing
only the service function leaves the still-unmodified route calling it
with the old numeric-offset argument shape — a `tsc --noEmit` failure
that TypeScript-strict (a Global Constraint below) would catch, sitting
in a state a task reviewer would be asked to approve. The two files
cannot be landed independently without breaking the build, so they are
not independently reviewable and must be one task.

**Spec-sync:** Not needed as a separate task. The design gate already
recorded this as decision 12 in `spec.md`'s decision table. No section of
the spec describing *state* (§3 Architecture, §4 Data model) documents the
old offset-based pagination contract, so nothing there is made false by
this change.

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
- **Create** `lib/serializers/client/pagination.ts` — two pure helpers
  used by `ChatLog.tsx`: `getPageCursor` (derive the next composite
  "before" cursor from a batch of messages, correctly handling
  same-millisecond ties) and `shouldStickToBottom` (the near-bottom
  scroll heuristic, as a pure function of DOM measurements so it's
  testable without a DOM).
- **Modify** `components/chat/ChatLog.tsx` — `loadChatHistory` fetches
  newest-first and seeds the pagination cursor exactly once, from real
  data; `loadOlderMessages` pages via the cursor (not `messages.length`),
  trusts the server's `hasMore` directly, and guards against overlapping
  in-flight requests; the auto-scroll effect switches to the near-bottom
  heuristic; the project-switch reset effect is extended to reset the new
  refs so switching projects doesn't leak one project's pagination
  cursor into another's fetches.
- **Create** `tests/services/message-pagination.test.ts`,
  `tests/api/messages-route-pagination.test.ts`,
  `tests/serializers/pagination.test.ts`.

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
- Test: `tests/serializers/pagination.test.ts`

**Interfaces:**
- Produces:
  - `getPageCursor(messages: { createdAt?: string | null; id?: string | null }[]): { createdAt: string; id: string } | null`
  - `shouldStickToBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold?: number): boolean`
  Task 3 calls both from `ChatLog.tsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/serializers/pagination.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getPageCursor, shouldStickToBottom } from '@/lib/serializers/client/pagination';

describe('getPageCursor', () => {
  it('zwraca null dla pustej listy', () => {
    expect(getPageCursor([])).toBeNull();
  });

  it('zwraca najwcześniejszy wpis (po createdAt) niezależnie od kolejności', () => {
    const messages = [
      { createdAt: '2026-01-05T00:00:00.000Z', id: 'c' },
      { createdAt: '2026-01-01T00:00:00.000Z', id: 'a' },
      { createdAt: '2026-01-03T00:00:00.000Z', id: 'b' },
    ];
    expect(getPageCursor(messages)).toEqual({ createdAt: '2026-01-01T00:00:00.000Z', id: 'a' });
  });

  it('przy remisie na createdAt wybiera najmniejsze id jako tiebreaker', () => {
    const tied = '2026-01-05T00:00:00.000Z';
    const messages = [
      { createdAt: tied, id: 'm3' },
      { createdAt: tied, id: 'm1' },
      { createdAt: tied, id: 'm2' },
    ];
    expect(getPageCursor(messages)).toEqual({ createdAt: tied, id: 'm1' });
  });

  it('pomija wpisy bez createdAt lub id', () => {
    const messages = [
      { createdAt: null, id: 'x' },
      { createdAt: '2026-01-02T00:00:00.000Z', id: 'valid' },
      { createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    expect(getPageCursor(messages)).toEqual({ createdAt: '2026-01-02T00:00:00.000Z', id: 'valid' });
  });
});

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

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/serializers/pagination.test.ts`
Expected: FAIL — `lib/serializers/client/pagination.ts` does not exist yet
(module not found).

- [ ] **Step 3: Write the minimal implementation**

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

export const getPageCursor = (messages: PageCursorSource[]): PageCursor | null => {
  let cursor: PageCursor | null = null;

  for (const message of messages) {
    if (!message.createdAt || !message.id) continue;

    if (cursor === null) {
      cursor = { createdAt: message.createdAt, id: message.id };
      continue;
    }

    const currentTime = new Date(message.createdAt).getTime();
    const cursorTime = new Date(cursor.createdAt).getTime();

    if (currentTime < cursorTime || (currentTime === cursorTime && message.id < cursor.id)) {
      cursor = { createdAt: message.createdAt, id: message.id };
    }
  }

  return cursor;
};

export const shouldStickToBottom = (
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold: number = 80
): boolean => {
  return scrollHeight - scrollTop - clientHeight < threshold;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/serializers/pagination.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/serializers/client/pagination.ts tests/serializers/pagination.test.ts
git commit -m "feat: add pure cursor/scroll-guard helpers for chat pagination"
```

---

### Task 3: Wire `ChatLog.tsx` to newest-first loading, composite-cursor pagination, and near-bottom auto-scroll

**Files:**
- Modify: `components/chat/ChatLog.tsx`

**Interfaces:**
- Consumes: `getPageCursor`, `shouldStickToBottom` from `@/lib/serializers/client/pagination` (Task 2); the route's `order`/`before`/`beforeId` query params and `pagination.hasMore` full-page semantics (Task 1).
- Produces: no new exports — this is the component wiring; behavior is
  verified manually (see Step 8). This repo has no component-level test
  harness (`@testing-library/react`/jsdom are not installed — confirmed:
  `package.json` only lists `vitest`), and `spec.md` §8 documents that UI
  logic without unit-testable seams relies on manual verification rather
  than being silently treated as covered.

This task touches several non-adjacent spots in the same file. Do them
in this order. Read the whole file once before starting — some line
numbers below will have shifted slightly by the time you reach later
steps in this same task, since earlier steps in it edit the file too;
re-locate each snippet by its surrounding code, not by line number alone.

- [ ] **Step 1: Add the new import, refs, and state**

Add a new import after the existing `tool-messages` import block (after
`components/chat/ChatLog.tsx:18`):

```ts
import { getPageCursor, shouldStickToBottom } from '@/lib/serializers/client/pagination';
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
  const hasAutoScrolledRef = useRef(false);
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
    hasAutoScrolledRef.current = false;
    setHasMoreMessages(false);
    setIsLoadingOlder(false);
  }, [projectId]);
```

This matters: without it, switching from a short chat to a long one keeps
the short chat's (already-exhausted) pagination state, so "Load older
messages" never appears for the new project; switching the other way
carries the old project's cursor into a fetch for the new project's
messages.

- [ ] **Step 3: Replace the auto-scroll effect with a near-bottom guard**

Find (currently line 863):

```ts
  useEffect(scrollToBottom, [messages]);
```

Replace with:

```ts
  useEffect(() => {
    if (messages.length === 0) return;
    const container = logsContainerRef.current;
    const nearBottom = container
      ? shouldStickToBottom(container.scrollHeight, container.scrollTop, container.clientHeight)
      : true;
    if (!hasAutoScrolledRef.current || nearBottom) {
      scrollToBottom();
      hasAutoScrolledRef.current = true;
    }
  }, [messages]);
```

This scrolls to bottom unconditionally the first time a project's
messages render (`!hasAutoScrolledRef.current`, covering the initial
load), and after that only when the user was already near the bottom —
so live updates while watching the agent work still auto-scroll, but
"load older" (which the user only reaches by scrolling up) and any
poll/SSE update that arrives while reading history no longer yank the
view back down. Leave the `scrollToBottom` function itself (just above,
currently lines 815-817) unchanged.

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

- [ ] **Step 5: Rewrite `loadOlderMessages` to page via the composite cursor, trust the server's `hasMore`, and guard against overlapping requests**

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
          setMessages((prev) => integrateMessages(prev, normalized));
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
a duplicate fetch with the same cursor.

- [ ] **Step 6: Wire the container ref and simplify the button**

Find the scrollable messages container (currently line 1577):

```tsx
      <div className="flex-1 overflow-y-auto px-8 py-3 space-y-2 custom-scrollbar ">
```

Replace with:

```tsx
      <div ref={logsContainerRef} className="flex-1 overflow-y-auto px-8 py-3 space-y-2 custom-scrollbar ">
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
Expected: all tests pass, including the three new suites from Tasks 1-2.

- [ ] **Step 8: Manual verification with the dev server**

This project has no browser/component test harness (see Interfaces note
above), so this step is a documented manual check rather than an
automated one. Cover both the pagination fix and the two bugs the
red-team pass found in an earlier draft (empty-project seeding, and
project-switch state leaking) — a happy-path-only check would miss both.

1. Start the dev server: `npm run dev`.
2. **Empty/new project check:** create a brand-new project with no chat
   messages yet, open its chat, and send exactly one message. Confirm
   "Load older messages" does **not** appear (there's nothing older to
   load — this is the case an earlier plan draft got wrong: it could show
   a permanently-broken "load older" button here).
3. **Batch-loading check:** pick or seed a project with a long history —
   at least 250 messages, so both the initial 200-message window and at
   least one "load older" click are exercised. If none exists, seed one:
   ```bash
   node -e "
   const { PrismaClient } = require('@prisma/client');
   const prisma = new PrismaClient();
   (async () => {
     const project = await prisma.project.findFirst();
     if (!project) { console.error('No project found — create one in the UI first.'); process.exit(1); }
     const base = Date.now() - 300 * 60000;
     for (let i = 0; i < 300; i++) {
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
     console.log('Seeded 300 messages for project', project.id);
   })();
   "
   ```
   Open that project's chat. Confirm the messages shown are the **most
   recent** ones (e.g. "seed message 299", not "seed message 0"), and
   "Load older messages" is visible.
4. Scroll up (away from the bottom), then click "Load older messages"
   once. Confirm: (a) a full batch of earlier messages appears (not just
   one), (b) the view does **not** jump to the bottom — you stay roughly
   where you were reading. Click it again if more remain; confirm it
   keeps making progress (not repeating the same messages) until the
   button disappears at the true start of history ("seed message 0").
5. **Double-click check:** with "Load older messages" visible again (or
   using a fresh seed), click it twice in quick succession. Confirm you
   don't lose a batch of messages (i.e. the second click doesn't
   overwrite/skip while the first is still in flight) — the button
   should read "Loading..." and be disabled between the click and the
   response.
6. **Project-switch check:** with the seeded project fully paged back
   (button hidden), switch to a different project in the sidebar, then
   switch back. Confirm "Load older messages" state is correct for
   whichever project is active (not carried over from the other one).
7. **Live-scroll check:** while an agent turn is actively streaming
   output and you are scrolled to the bottom watching it, confirm the
   view keeps auto-scrolling with new content (this must still work —
   Step 3 only stops the *forced* scroll when you're not already near
   the bottom).
8. Clean up the seeded rows:
   ```bash
   node -e "
   const { PrismaClient } = require('@prisma/client');
   const prisma = new PrismaClient();
   prisma.message.deleteMany({ where: { content: { startsWith: 'seed message ' } } }).then((r) => console.log('Deleted', r.count));
   "
   ```

If any of steps 2-7 doesn't hold, this task is not done — fix the wiring
before moving on, don't just note the discrepancy.

- [ ] **Step 9: Commit**

```bash
git add components/chat/ChatLog.tsx
git commit -m "fix: load newest chat messages first, page older via composite cursor, fix scroll-to-bottom on load-older/poll/SSE"
```
