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
