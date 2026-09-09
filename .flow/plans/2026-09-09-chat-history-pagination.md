# Chat History Pagination Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix chat history pagination so the initial load shows the most
recent conversation (not the oldest messages) and "Load older messages"
reliably pages backward in real batches instead of ~1 message per click.

**Architecture:** Replace numeric offset-based pagination with cursor-based
pagination (`createdAt` timestamp). `getMessagesByProjectId` gains
`{ order, before }` options instead of a numeric offset; the API route
passes through `order`/`before` query params; `ChatLog.tsx` fetches
newest-first for the initial/polling load and pages older messages via a
`before` cursor tracked from real server responses (not the client's
deduplicated/expanded array length, which was the root cause of the
"loads 1 message at a time" bug). A small pure-function module is
extracted for the two testable pieces of client logic (cursor selection,
scroll-position math), following this repo's existing pattern of pulling
pure client logic out of `ChatLog.tsx` into `lib/serializers/client/`.

**Tech Stack:** Next.js 16 App Router (route handlers), Prisma/SQLite,
React (`"use client"` component), Vitest.

**Spec:** `/home/m/work/Claudable/spec.md` D12 (§2 decisions table).

**Design record:** `/home/m/work/Claudable/.flow/specs/2026-09-09-chat-history-pagination-design.md`

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

- **Modify** `lib/services/message.ts` — `getMessagesByProjectId` switches
  from `(projectId, limit, offset)` to `(projectId, limit, { order?, before? })`,
  cursor-based.
- **Modify** `app/api/chat/[project_id]/messages/route.ts` — `GET` gains
  `order`/`before` query params, passes them through, `hasMore` becomes a
  full-page check instead of an offset+count comparison.
- **Create** `lib/serializers/client/pagination.ts` — two pure helpers used
  by `ChatLog.tsx`: `getOldestCreatedAt` (derive the next "before" cursor
  from a batch of messages) and `computeScrollTopAfterPrepend` (scroll-
  position math for prepending older messages without a visual jump).
- **Modify** `components/chat/ChatLog.tsx` — `loadChatHistory` fetches
  newest-first; `loadOlderMessages` pages via the cursor instead of
  `messages.length`; the auto-scroll-to-bottom effect skips itself and
  restores scroll position instead, specifically for a "load older" update.
- **Create** `tests/services/message-pagination.test.ts`,
  `tests/api/messages-route-pagination.test.ts`,
  `tests/serializers/pagination.test.ts`.

Task order: service layer first (Task 1), then the route that depends on
it (Task 2), then the pure client helpers (Task 3), then wiring them into
`ChatLog.tsx` (Task 4) — each task only depends on the ones before it.

---

### Task 1: Cursor-based pagination in `getMessagesByProjectId`

**Files:**
- Modify: `lib/services/message.ts:33-49`
- Test: `tests/services/message-pagination.test.ts`

**Interfaces:**
- Consumes: `prisma.message.findMany` (existing, from `@/lib/db/client`).
- Produces: `getMessagesByProjectId(projectId: string, limit?: number, options?: { order?: 'asc' | 'desc'; before?: Date }): Promise<Message[]>` — Task 2 calls this with the route's parsed `order`/`before`.

The current implementation (for reference — this is what you're replacing):

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

- [ ] **Step 1: Write the failing test**

Create `tests/services/message-pagination.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();

vi.mock('@/lib/db/client', () => ({
  prisma: {
    message: { findMany },
  },
}));

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
  it('domyślnie sortuje rosnąco i nie filtruje po createdAt', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');

    await getMessagesByProjectId('proj1', 50);

    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj1' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
  });

  it('order=desc bez before zwraca najnowsze wiadomości malejąco', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');

    await getMessagesByProjectId('proj1', 200, { order: 'desc' });

    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj1' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });

  it('order=desc z before filtruje createdAt < before i sortuje malejąco', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');
    const before = new Date('2026-01-05T00:00:00.000Z');

    await getMessagesByProjectId('proj1', 100, { order: 'desc', before });

    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj1', createdAt: { lt: before } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/services/message-pagination.test.ts`
Expected: FAIL — `getMessagesByProjectId` still takes a numeric `offset`
third argument, so the `findMany` call shape won't match (still includes
`skip`, orderBy is hardcoded to `'asc'`).

- [ ] **Step 3: Implement the minimal change**

In `lib/services/message.ts`, replace the function (lines 33-49) with:

```ts
export async function getMessagesByProjectId(
  projectId: string,
  limit: number = 50,
  options: { order?: 'asc' | 'desc'; before?: Date } = {}
): Promise<Message[]> {
  const { order = 'asc', before } = options;
  const messages = await prisma.message.findMany({
    where: {
      projectId,
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: order },
    take: limit,
  });

  return messages.map(mapPrismaMessage);
}
```

Update the doc comment above it from `/** Retrieve project messages (with
pagination) */` to `/** Retrieve project messages, cursor-paginated by
createdAt */`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/services/message-pagination.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/message.ts tests/services/message-pagination.test.ts
git commit -m "fix: cursor-based pagination for getMessagesByProjectId"
```

---

### Task 2: Route passthrough for `order`/`before`, fix `hasMore`

**Files:**
- Modify: `app/api/chat/[project_id]/messages/route.ts:19-59`
- Test: `tests/api/messages-route-pagination.test.ts`

**Interfaces:**
- Consumes: `getMessagesByProjectId(projectId, limit, { order?, before? })` from Task 1; `getMessagesCountByProjectId(projectId)` and `serializeMessages(messages)` (both unchanged, existing).
- Produces: `GET /api/chat/[project_id]/messages?limit=&order=&before=` returning `{ success, data, totalCount, pagination: { limit, order, before, count, hasMore } }`. Task 4 (`ChatLog.tsx`) calls this with `order=desc` and, for "load older", `before=<ISO timestamp>`.

The current handler (for reference — lines 19-59 of the route file):

```ts
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

- [ ] **Step 1: Write the failing test**

Create `tests/api/messages-route-pagination.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getMessagesByProjectId = vi.fn();
const getMessagesCountByProjectId = vi.fn();

vi.mock('@/lib/services/message', () => ({
  getMessagesByProjectId,
  getMessagesCountByProjectId,
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
  it('domyślnie przekazuje order=asc i brak before', async () => {
    getMessagesByProjectId.mockResolvedValueOnce([fixtureMessage()]);
    getMessagesCountByProjectId.mockResolvedValueOnce(1);

    await callGet('?limit=50');

    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 50, {
      order: 'asc',
      before: undefined,
    });
  });

  it('order=desc&before=<iso> przekazuje Date do serwisu', async () => {
    getMessagesByProjectId.mockResolvedValueOnce([fixtureMessage()]);
    getMessagesCountByProjectId.mockResolvedValueOnce(500);
    const iso = '2026-01-05T00:00:00.000Z';

    await callGet(`?limit=100&order=desc&before=${encodeURIComponent(iso)}`);

    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 100, {
      order: 'desc',
      before: new Date(iso),
    });
  });

  it('nieprawidłowy before jest ignorowany zamiast wywalać żądanie', async () => {
    getMessagesByProjectId.mockResolvedValueOnce([fixtureMessage()]);
    getMessagesCountByProjectId.mockResolvedValueOnce(1);

    const response = await callGet('?limit=50&order=desc&before=not-a-date');

    expect(response.status).toBe(200);
    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 50, {
      order: 'desc',
      before: undefined,
    });
  });

  it('hasMore=true gdy strona jest pełna, false gdy niepełna', async () => {
    getMessagesByProjectId.mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, i) => fixtureMessage({ id: `m${i}` }))
    );
    getMessagesCountByProjectId.mockResolvedValueOnce(500);
    const full = await callGet('?limit=100&order=desc');
    expect((await full.json()).pagination.hasMore).toBe(true);

    getMessagesByProjectId.mockResolvedValueOnce([fixtureMessage()]);
    getMessagesCountByProjectId.mockResolvedValueOnce(500);
    const partial = await callGet('?limit=100&order=desc');
    expect((await partial.json()).pagination.hasMore).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/api/messages-route-pagination.test.ts`
Expected: FAIL — the route still parses `offset` and calls
`getMessagesByProjectId(project_id, limit, offset)` with a bare number,
not the `{ order, before }` object shape these assertions expect.

- [ ] **Step 3: Implement the minimal change**

In `app/api/chat/[project_id]/messages/route.ts`, replace the `GET`
function body (lines 19-59) with:

```ts
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
    const before =
      beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? new Date(beforeParam) : undefined;

    const [messages, totalCount] = await Promise.all([
      getMessagesByProjectId(project_id, limit, { order, before }),
      getMessagesCountByProjectId(project_id),
    ]);
    const serialized = serializeMessages(messages);

    const res = NextResponse.json({
      success: true,
      data: serialized,
      totalCount,
      pagination: {
        limit,
        order,
        before: before ? before.toISOString() : null,
        count: serialized.length,
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/api/messages-route-pagination.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/[project_id]/messages/route.ts tests/api/messages-route-pagination.test.ts
git commit -m "fix: pass order/before cursor params through messages route"
```

---

### Task 3: Pure pagination helpers for the client

**Files:**
- Create: `lib/serializers/client/pagination.ts`
- Test: `tests/serializers/pagination.test.ts`

**Interfaces:**
- Produces:
  - `getOldestCreatedAt(messages: { createdAt?: string | null }[]): string | null`
  - `computeScrollTopAfterPrepend(previousScrollHeight: number, previousScrollTop: number, nextScrollHeight: number): number`
  Task 4 calls both from `ChatLog.tsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/serializers/pagination.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeScrollTopAfterPrepend, getOldestCreatedAt } from '@/lib/serializers/client/pagination';

describe('getOldestCreatedAt', () => {
  it('zwraca null dla pustej listy', () => {
    expect(getOldestCreatedAt([])).toBeNull();
  });

  it('zwraca najwcześniejszy createdAt niezależnie od kolejności', () => {
    const messages = [
      { createdAt: '2026-01-05T00:00:00.000Z' },
      { createdAt: '2026-01-01T00:00:00.000Z' },
      { createdAt: '2026-01-03T00:00:00.000Z' },
    ];
    expect(getOldestCreatedAt(messages)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('pomija wpisy bez createdAt', () => {
    const messages = [
      { createdAt: null },
      { createdAt: '2026-01-02T00:00:00.000Z' },
      {},
    ];
    expect(getOldestCreatedAt(messages)).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('computeScrollTopAfterPrepend', () => {
  it('przesuwa scrollTop o różnicę wysokości, żeby widok nie skoczył', () => {
    // 500px doszło na górze kontenera (nowa wysokość 1500 vs stara 1000);
    // scrollTop musi wzrosnąć o tyle samo, żeby ten sam fragment został widoczny.
    expect(computeScrollTopAfterPrepend(1000, 200, 1500)).toBe(700);
  });

  it('nie zmienia scrollTop, gdy wysokość się nie zmieniła', () => {
    expect(computeScrollTopAfterPrepend(1000, 200, 1000)).toBe(200);
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
export interface TimestampedMessage {
  createdAt?: string | null;
}

export const getOldestCreatedAt = (messages: TimestampedMessage[]): string | null => {
  let oldest: string | null = null;
  for (const message of messages) {
    if (!message.createdAt) continue;
    if (oldest === null || new Date(message.createdAt).getTime() < new Date(oldest).getTime()) {
      oldest = message.createdAt;
    }
  }
  return oldest;
};

export const computeScrollTopAfterPrepend = (
  previousScrollHeight: number,
  previousScrollTop: number,
  nextScrollHeight: number
): number => {
  return nextScrollHeight - previousScrollHeight + previousScrollTop;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/serializers/pagination.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/serializers/client/pagination.ts tests/serializers/pagination.test.ts
git commit -m "feat: add pure cursor/scroll-math helpers for chat pagination"
```

---

### Task 4: Wire `ChatLog.tsx` to newest-first loading, cursor pagination, and scroll preservation

**Files:**
- Modify: `components/chat/ChatLog.tsx`

**Interfaces:**
- Consumes: `getOldestCreatedAt`, `computeScrollTopAfterPrepend` from `@/lib/serializers/client/pagination` (Task 3); the route's `order`/`before` query params and `pagination.hasMore` full-page semantics (Task 2).
- Produces: no new exports — this is the component wiring; behavior is
  verified manually (see Step 6). This repo has no component-level test
  harness (`@testing-library/react`/jsdom are not installed — confirmed:
  `package.json` only lists `vitest`), and `spec.md` §8 documents that UI
  logic without unit-testable seams relies on manual verification rather
  than being silently treated as covered.

This task touches several non-adjacent spots in the same file. Do them
in this order.

- [ ] **Step 1: Add the new refs and import**

At the top of `components/chat/ChatLog.tsx`, change the React import
(line 2) to include `useLayoutEffect`:

```ts
import React, { useEffect, useLayoutEffect, useState, useRef, ReactElement, useCallback } from 'react';
```

Add a new import after the existing `tool-messages` import block (after
line 18):

```ts
import { getOldestCreatedAt, computeScrollTopAfterPrepend } from '@/lib/serializers/client/pagination';
```

Next to the existing `logsEndRef` declaration (`const logsEndRef =
useRef<HTMLDivElement>(null);`, currently line 275), add:

```ts
  const logsContainerRef = useRef<HTMLDivElement>(null);
```

Next to the existing `hasMoreMessages`/`totalMessageCount` state
(currently lines 403-404), add:

```ts
  const rawLoadedCountRef = useRef(0);
  const oldestLoadedCreatedAtRef = useRef<string | null>(null);
  const paginationInitializedRef = useRef(false);
  const preserveScrollOnNextUpdateRef = useRef(false);
  const pendingScrollMetricsRef = useRef({ previousScrollHeight: 0, previousScrollTop: 0 });
```

- [ ] **Step 2: Replace the scroll effect**

Find (currently line 863):

```ts
  useEffect(scrollToBottom, [messages]);
```

Replace with:

```ts
  useLayoutEffect(() => {
    if (preserveScrollOnNextUpdateRef.current) {
      const container = logsContainerRef.current;
      if (container) {
        container.scrollTop = computeScrollTopAfterPrepend(
          pendingScrollMetricsRef.current.previousScrollHeight,
          pendingScrollMetricsRef.current.previousScrollTop,
          container.scrollHeight
        );
      }
      preserveScrollOnNextUpdateRef.current = false;
      return;
    }
    scrollToBottom();
  }, [messages]);
```

Leave the `scrollToBottom` function itself (just above, currently lines
815-817) unchanged.

- [ ] **Step 3: Rewrite `loadChatHistory` to fetch newest-first**

Find the current `loadChatHistory` (currently lines 996-1041) and replace
its body with:

```ts
  // Load chat history
  const loadChatHistory = useCallback(
    async ({ showLoading }: { showLoading?: boolean } = {}) => {
      const shouldShowLoading = showLoading ?? !hasLoadedInitialDataRef.current;
      let didSucceed = false;
      if (shouldShowLoading) {
        setIsLoading(true);
      }

      try {
        // Always fetch the most recent window; "load older" pages further
        // back from there via a createdAt cursor (see loadOlderMessages).
        const response = await fetch(`${API_BASE}/api/chat/${projectId}/messages?limit=200&order=desc`);
        if (response.ok) {
          didSucceed = true;
          const payload = await response.json();
          const chatMessages = Array.isArray(payload)
            ? payload
            : payload?.data ?? payload?.messages ?? [];
          const normalized = Array.isArray(chatMessages)
            ? expandMessagesList(chatMessages.map(toChatMessage), ensureStableMessageId)
            : [];
          const totalCount = payload.totalCount || 0;

          if (!paginationInitializedRef.current && Array.isArray(chatMessages)) {
            rawLoadedCountRef.current = chatMessages.length;
            oldestLoadedCreatedAtRef.current = getOldestCreatedAt(chatMessages);
            paginationInitializedRef.current = true;
          }

          setTotalMessageCount(totalCount);
          setHasMoreMessages(rawLoadedCountRef.current < totalCount);
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
`rawLoadedCountRef`/`oldestLoadedCreatedAtRef` are seeded once, from the
very first successful response, and left alone on every later poll (a
poll re-fetching the newest 200 must not reset how far back the user has
already paged via "load older"); `hasMoreMessages` is now derived from
`rawLoadedCountRef` vs. the live `totalCount`, not from the just-fetched
page's own `pagination.hasMore` (which only describes that one page).

- [ ] **Step 4: Rewrite `loadOlderMessages` to page via cursor and preserve scroll**

Find the current `loadOlderMessages` (currently lines 1055-1086) and
replace it with:

```ts
  // Load older messages (pagination) — pages backward from the oldest
  // loaded message via a createdAt cursor, not an offset, so it never
  // depends on the size of the client's deduplicated/expanded message
  // array (that mismatch was the cause of only ~1 message loading per click).
  const loadOlderMessages = useCallback(async () => {
    if (!projectId || !hasMoreMessages || !oldestLoadedCreatedAtRef.current) return;

    try {
      const cursor = oldestLoadedCreatedAtRef.current;
      const response = await fetch(
        `${API_BASE}/api/chat/${projectId}/messages?limit=100&order=desc&before=${encodeURIComponent(cursor)}`
      );

      if (response.ok) {
        const payload = await response.json();
        const chatMessages = Array.isArray(payload)
          ? payload
          : payload?.data ?? payload?.messages ?? [];
        const normalized = Array.isArray(chatMessages)
          ? expandMessagesList(chatMessages.map(toChatMessage), ensureStableMessageId)
          : [];
        const totalCount = payload.totalCount || 0;

        if (Array.isArray(chatMessages) && chatMessages.length > 0) {
          rawLoadedCountRef.current += chatMessages.length;
          oldestLoadedCreatedAtRef.current =
            getOldestCreatedAt(chatMessages) ?? oldestLoadedCreatedAtRef.current;
          console.log(
            `[ChatLog] Loaded ${chatMessages.length} older messages (${rawLoadedCountRef.current}/${totalCount} total)`
          );
        }

        setTotalMessageCount(totalCount);
        setHasMoreMessages(rawLoadedCountRef.current < totalCount);

        // Prepending older messages shifts the container's content down;
        // capture the pre-update scroll metrics so the effect above can
        // restore the same visual position instead of jumping to bottom.
        if (normalized.length > 0) {
          const container = logsContainerRef.current;
          pendingScrollMetricsRef.current = {
            previousScrollHeight: container?.scrollHeight ?? 0,
            previousScrollTop: container?.scrollTop ?? 0,
          };
          preserveScrollOnNextUpdateRef.current = true;
          setMessages((prev) => integrateMessages(prev, normalized));
        }
      }
    } catch (error) {
      console.error('[ChatLog] Failed to load older messages:', error);
    }
  }, [projectId, hasMoreMessages, ensureStableMessageId]);
```

Note what changed: no more `currentOffset = messages.length`; the request
uses `before=<oldestLoadedCreatedAtRef.current>` instead of
`offset=${currentOffset}`; the dependency array drops `messages.length`
(the function no longer reads it at all).

- [ ] **Step 5: Wire the container ref and fix the "remaining" count**

Find the scrollable messages container (currently line 1577):

```tsx
      <div className="flex-1 overflow-y-auto px-8 py-3 space-y-2 custom-scrollbar ">
```

Replace with:

```tsx
      <div ref={logsContainerRef} className="flex-1 overflow-y-auto px-8 py-3 space-y-2 custom-scrollbar ">
```

Find the "load older messages" button label (currently line 1604):

```tsx
              {isLoading ? 'Loading...' : `Load older messages (${totalMessageCount - messages.length} remaining)`}
```

Replace with:

```tsx
              {isLoading ? 'Loading...' : `Load older messages (${Math.max(totalMessageCount - rawLoadedCountRef.current, 0)} remaining)`}
```

(`totalMessageCount - messages.length` used the same deduplicated/expanded
array length that caused the pagination bug; `rawLoadedCountRef.current`
is the real count of DB rows fetched so far.)

- [ ] **Step 6: Type-check, lint, and run the full test suite**

Run: `npm run type-check`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm test`
Expected: all tests pass, including the three new suites from Tasks 1-3.

- [ ] **Step 7: Manual verification with the dev server**

This project has no browser/component test harness (see Interfaces note
above), so this step is a documented manual check rather than an
automated one:

1. Start the dev server: `npm run dev`.
2. Pick (or create) a project with a long chat history — at least 250
   messages, so both the initial 200-message window and at least one
   "load older" click are exercised. If none exists, seed one:
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
3. Open that project's chat in the browser. Confirm the messages shown
   are the **most recent** ones (e.g. "seed message 299", not "seed
   message 0"), and the "Load older messages" button is visible with a
   remaining count around 100 (300 total − 200 initial).
4. Click "Load older messages" once. Confirm: (a) the remaining count
   drops by a full batch (to 0, since only 100 remain after the initial
   200), (b) the earlier messages ("seed message 0" onward) are now
   visible, (c) the view does **not** jump to the bottom — the message
   that was at the top of the viewport before the click stays roughly in
   view.
5. Clean up the seeded rows:
   ```bash
   node -e "
   const { PrismaClient } = require('@prisma/client');
   const prisma = new PrismaClient();
   prisma.message.deleteMany({ where: { content: { startsWith: 'seed message ' } } }).then((r) => console.log('Deleted', r.count));
   "
   ```

If step 3 or 4 doesn't hold, this task is not done — fix the wiring
before moving on, don't just note the discrepancy.

- [ ] **Step 8: Commit**

```bash
git add components/chat/ChatLog.tsx
git commit -m "fix: load newest chat messages first, page older via cursor, preserve scroll"
```
