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
