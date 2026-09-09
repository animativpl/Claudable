# Design record — chat history pagination fix

Date: 2026-09-09

## Problem

Reported symptom: chat history only shows the initial messages; the "load
older messages" button exists but each click adds roughly one message
instead of a batch.

## Root cause (confirmed by reading the code, not guessed)

Two compounding bugs, plus a related side effect:

1. `getMessagesByProjectId` (`lib/services/message.ts`) orders
   `createdAt: 'asc'` and the initial client fetch uses `offset=0`, so the
   first page returned is always the **oldest** messages in the
   conversation, not the most recent ones.
2. `loadOlderMessages` (`components/chat/ChatLog.tsx`) computes the
   backend's `skip` from `messages.length` — the client's
   deduplicated/expanded array (`expandMessagesList`/`integrateMessages`
   can collapse near-duplicate raw DB rows into fewer client entries). This
   undercounts the real number of raw rows already fetched, so each "load
   older" click re-requests rows already seen; ID-based dedup in
   `integrateMessages` then discards almost all of the response, leaving
   ~1 genuinely new message per click.
3. `useEffect(scrollToBottom, [messages])` fires on every `messages`
   change, including a "load older" fetch — so even with pagination fixed,
   the view would snap back to the bottom immediately after loading older
   history, hiding it. Confirmed with the user this should be fixed as
   part of this change rather than left as a follow-up, since it directly
   undermines the pagination fix's usefulness.

## Approaches considered

- **Offset-counter fix**: keep offset-based pagination, but track a
  separate ref counting real raw rows fetched (decoupled from the
  rendered array) instead of using `messages.length`. Rejected as the
  primary mechanism: offset-based "older" pagination on a list ordered
  newest-first drifts when new messages are inserted between fetches
  (every poll re-fetches the newest window, shifting the offset boundary
  by however many new rows arrived) — small in practice but a real,
  avoidable class of bug for exactly the kind of pagination that just
  broke once already.
- **Cursor-based pagination (chosen)**: page "older" by
  `createdAt < <oldest loaded message's createdAt>`, ordered
  `desc`, `take: limit`. Immune to offset drift from concurrent inserts
  because it never counts rows — it filters by a real timestamp cursor
  each time. Also sidesteps the raw-vs-expanded-count mismatch entirely:
  the cursor comes from actual message data, not from any array length.

## Design

- `lib/services/message.ts`: `getMessagesByProjectId(projectId, limit,
  { order?: 'asc' | 'desc'; before?: Date })`. Drops the numeric
  `offset`/`skip` parameter (single caller — the route — confirmed via
  `trace_path`, safe to change). `desc` + no `before` → most recent
  `limit` rows. `desc` + `before` → the `limit` rows immediately
  preceding that timestamp.
- `app/api/chat/[project_id]/messages/route.ts`: adds `order` (default
  `asc`, so any future caller relying on the old default is unaffected)
  and `before` (ISO-8601 timestamp) query params, passed through.
  `pagination.hasMore` becomes "did this page come back full"
  (`serialized.length === limit`) instead of an offset+count comparison.
- `components/chat/ChatLog.tsx`:
  - Initial load and polling both fetch `order=desc&limit=200` (no
    `before`) — always the freshest window. Merge behavior via
    `integrateMessages` is unchanged (it already sorts ascending for
    display, so fetch order doesn't matter).
  - `rawLoadedCountRef` (real DB rows fetched so far) and
    `oldestLoadedCreatedAtRef` (cursor for "load older") replace
    `messages.length` as the pagination bookkeeping. Both advance only
    from server response data, never from the client array.
  - `loadOlderMessages` fetches `order=desc&limit=100&before=<cursor>`.
  - Scroll: capture the message container's `scrollHeight`/`scrollTop`
    before a "load older" update, restore the equivalent offset after
    render, and skip the bottom-scroll effect for that one update.
    Normal new-message/polling updates keep scrolling to bottom.

## Rejected

- Leaving scroll-to-bottom behavior untouched — see problem point 3;
  user confirmed fixing it as part of this change.
- Changing the batch sizes (200 initial / 100 per "load older" click) —
  not reported as wrong; the bug was in the offset math, not the limits.
