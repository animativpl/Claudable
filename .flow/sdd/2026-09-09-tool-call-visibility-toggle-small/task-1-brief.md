## Global Constraints

- TypeScript strict (`npm run type-check` must pass).
- ESLint 9 flat config (`npm run lint` must pass).
- Tests: Vitest, `npm test`; test files mirror `app/`/`lib/` structure
  under `tests/`.
- No new dependencies.
- Match existing code style (Polish `it()`/`describe()` descriptions in
  `tests/utils/`, matching `tests/utils/model-selection-storage.test.ts`).

---

### Task 1: Tool-call visibility toggle, default off

**Files:**
- Create: `lib/utils/tool-visibility-storage.ts`
- Create: `tests/utils/tool-visibility-storage.test.ts`
- Modify: `components/chat/ChatLog.tsx`

**Interfaces:**
- Produces: `readShowToolCalls(): boolean` (returns `false` when nothing
  stored or `sessionStorage` is unavailable — that's what makes the
  default "off"), `writeShowToolCalls(show: boolean): void`.

For reference, the existing pattern this mirrors —
`lib/utils/model-selection-storage.ts`:

```ts
const STORAGE_KEY = 'selectedModel';

export function readStoredModel(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function writeStoredModel(modelId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, modelId);
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/utils/tool-visibility-storage.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { readShowToolCalls, writeShowToolCalls } from '@/lib/utils/tool-visibility-storage';

describe('lib/utils/tool-visibility-storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('domyślnie zwraca false (wywołania narzędzi ukryte)', () => {
    expect(readShowToolCalls()).toBe(false);
  });

  it('zapisuje i odczytuje wybraną wartość', () => {
    writeShowToolCalls(true);
    expect(readShowToolCalls()).toBe(true);

    writeShowToolCalls(false);
    expect(readShowToolCalls()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/utils/tool-visibility-storage.test.ts`
Expected: FAIL — `lib/utils/tool-visibility-storage.ts` does not exist yet
(module not found).

- [ ] **Step 3: Write the minimal implementation**

Create `lib/utils/tool-visibility-storage.ts`:

```ts
const STORAGE_KEY = 'showToolCalls';

export function readShowToolCalls(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(STORAGE_KEY) === 'true';
}

export function writeShowToolCalls(show: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, String(show));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/utils/tool-visibility-storage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the toggle into `ChatLog.tsx`**

Add the import after the existing `lib/utils/scroll` import (currently
`components/chat/ChatLog.tsx:21`):

```ts
import { readShowToolCalls, writeShowToolCalls } from '@/lib/utils/tool-visibility-storage';
```

Add state next to the existing pagination state (currently lines
417-418: `const [hasMoreMessages, ...` / `const [isLoadingOlder, ...`):

```ts
  const [showToolCalls, setShowToolCalls] = useState(false);
```

Add an effect to pick up the persisted value after mount — put it near
the other one-time setup effects (e.g. right after the `stickToBottomRef`
declaration around line 430, or any other top-level spot alongside the
component's other small `useEffect`s; exact position doesn't matter, only
that it runs once on mount):

```ts
  useEffect(() => {
    setShowToolCalls(readShowToolCalls());
  }, []);
```

Add a toggle handler near `isToolUsageMessage` (currently declared around
line 846) or any other `useCallback`/handler in the component — again,
exact position doesn't matter:

```ts
  const handleToggleShowToolCalls = useCallback(() => {
    setShowToolCalls((prev) => {
      const next = !prev;
      writeShowToolCalls(next);
      return next;
    });
  }, []);
```

- [ ] **Step 6: Gate tool messages in `shouldDisplayMessage`**

Find `shouldDisplayMessage`'s "always display messages that include
attachments" block:

```ts
    // **Important**: Always display messages that include attachments
    if (metadata && metadata.attachments && Array.isArray(metadata.attachments) && metadata.attachments.length > 0) {
      return true;
    }

    if (message.messageType === 'tool_result') {
```

Insert a new check between those two blocks — after the attachments
check (which must keep taking priority: an attachment-bearing message
stays visible even with the toggle off), before the `tool_result` block:

```ts
    // **Important**: Always display messages that include attachments
    if (metadata && metadata.attachments && Array.isArray(metadata.attachments) && metadata.attachments.length > 0) {
      return true;
    }

    if (!showToolCalls && (message.messageType === 'tool_result' || message.messageType === 'tool_use' || isToolUsageMessage(message))) {
      return false;
    }

    if (message.messageType === 'tool_result') {
```

This placement matters: it runs *after* the transient-tool-message
special case (which only prevents an early `return false` for in-flight
tool updates, it doesn't force an early `return true`), so in-flight tool
activity is hidden by the toggle too, not just settled tool results — and
*after* the attachments check, so an attachment on a tool message still
shows regardless of the toggle, unchanged from today's behavior.

- [ ] **Step 7: Add the toggle control to the rendered UI**

Find the top of the component's return statement (currently
`components/chat/ChatLog.tsx:1636-1683`) — the error-display block, then
the scrollable messages container:

```tsx
  return (
    <div className="flex flex-col h-full bg-white ">

      {/* Error Display */}
      {hasError && (
        ...
      )}

      {/* Display chat messages */}
      <div
        ref={logsContainerRef}
        onScroll={...}
        className="flex-1 overflow-y-auto px-8 py-3 space-y-2 custom-scrollbar "
      >
```

Insert a small toggle row between the error-display block and the
`{/* Display chat messages */}` comment:

```tsx
      {/* Tool call visibility toggle */}
      <div className="flex justify-end px-8 pt-2">
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showToolCalls}
            onChange={handleToggleShowToolCalls}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Show tool calls
        </label>
      </div>

      {/* Display chat messages */}
```

- [ ] **Step 8: Type-check, lint, and run the full test suite**

Run: `npm run type-check`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm test`
Expected: all tests pass, including the new
`tests/utils/tool-visibility-storage.test.ts`.

- [ ] **Step 9: Manual smoke check**

This is a small UI change with no component test harness in this repo
(no jsdom/testing-library — confirmed in prior work on this file). Start
`npm run dev`, open any project's chat with some tool-call activity in
its history (or trigger one), and confirm: (a) tool call messages are
hidden by default, (b) checking "Show tool calls" reveals them
immediately without a page reload, (c) unchecking hides them again, (d)
reloading the page keeps the last-chosen state within the same browser
tab/session (sessionStorage), but a fresh tab defaults back to hidden.
If you don't have browser access in this environment, say so explicitly
in your report rather than claiming this step passed.

- [ ] **Step 10: Commit**

```bash
git add lib/utils/tool-visibility-storage.ts tests/utils/tool-visibility-storage.test.ts components/chat/ChatLog.tsx
git commit -m "feat: add tool-call visibility toggle to chat log, default hidden"
```
