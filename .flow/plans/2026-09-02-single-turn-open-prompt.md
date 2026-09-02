# Single-Turn Open Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Agent SDK from killing a still-running backgrounded Task-tool subagent the instant a chat turn's main result arrives — the dominant, restart-independent cause of agents "dying on their own" — without introducing a hang or a false "completed" status.

**Architecture:** `executeClaude()` keeps its exact current shape — one fresh `query()` per chat message, `resume: sessionId` unchanged, `buildClaudeQueryOptions()` called per message exactly as today. The only change: `prompt` becomes a tiny async generator instead of a plain string, gated by a `TurnGate` that tracks the SDK's own `background_tasks_changed` **level** signal (replace-the-whole-set semantics, not edge-pairing `task_started`/`task_notification` — the SDK's own docs warn edge-pairing can wedge on a missed bookend) plus a bounded timeout and a `finally`-guaranteed force-close, so the generator always eventually returns no matter what.

**Not in this plan:** the design record's Part C (auto-resume interrupted requests on restart) was drafted as this plan's Task 4 and cut after two more red-team passes found hazards specific to it (a race with `reconcileProjectPaths()`, a single write failure aborting reconciliation for every project, an unbounded crash loop, unattended agent dispatch on every restart including routine dev-server restarts) — see Task 4's note. `reconcileStaleRequests()` is unchanged by this plan: interrupted requests are still simply marked `failed` on restart.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, `@anthropic-ai/claude-agent-sdk`, Prisma/SQLite, Vitest.

**Spec:** `/home/m/work/Claudable/spec.md`, decision 11.

**Design record:** `/home/m/work/Claudable/.flow/specs/2026-09-02-single-turn-open-prompt-design.md` (supersedes `.flow/specs/2026-09-02-persistent-agent-session-design.md`).

**Revision note:** this is the third revision of this plan. Pass one found the TurnGate/completion design had four blocking issues (edge-pairing `task_started`/`task_notification` could wedge forever; marking `completed` the instant `result` arrived reopened a concurrent-turn hazard; undocumented UX consequences; a breaking change to an existing test the plan didn't list) and the auto-resume design (then Task 4) had its own serious issues on top. Pass two, after those fixes, found two more blocking issues (a `reconcileProjectPaths()` race, and the spike's second leg using the wrong `cwd` to test session-resume) plus confirmed the auto-resume hazards were specific to that feature and recommended cutting it rather than continuing to patch it — done, see Task 4. Do not revert to edge-pairing `task_started`/`task_notification`, do not move `safeMarkCompleted()` back into the `result` branch, and do not reintroduce auto-resume into this plan.

## Global Constraints

- TypeScript strict throughout (`npm run type-check` must pass) — spec.md §3.
- ESLint 9 flat config must pass (`npm run lint`) — spec.md §8.
- Tests via Vitest (`npm test`), mirroring `app/`/`lib/` structure under `tests/` — spec.md §8.
- Node `>=22.12.0` — spec.md decision 6.
- Claude Code only, via `@anthropic-ai/claude-agent-sdk` — spec.md decision 2.
- No `prisma/schema.prisma` changes in this plan.
- No process registry, no custom `spawnClaudeCodeProcess`, no `perTaskStopAffordance` — explicitly rejected by the design record. Do not reintroduce them.

---

### Task 1: Spike — confirm the gate mechanism against the real SDK, fresh and resumed

Throwaway verification, not production code.

**Files:**
- Create: `scripts/spike-open-prompt.mjs`

**Interfaces:**
- Consumes: `@anthropic-ai/claude-agent-sdk`'s `query()` directly — needs real Claude credentials (already available in this shell/environment).
- Produces: nothing consumed by later tasks. Leave it in the repo as a manually-run regression probe, same rationale as spec.md §8. Do not wire it into `npm test`.

**Why this tests a resumed session too, not just a fresh one:** the SDK's own docs say *"a resumed subagent is always registered in the background"* — meaning ordinary session-resume bookkeeping, not just a genuine Task-tool dispatch, can produce a backgrounded task entry. Since `buildClaudeQueryOptions` sets `resume: sessionId` on essentially every real turn, a spike that only exercises a fresh session would miss the exact configuration most likely to reveal a false-positive "still waiting on background work" state.

- [ ] **Step 1: Write the spike script**

```js
#!/usr/bin/env node
// THROWAWAY VERIFICATION, not production code. Confirms the mechanism Task
// 2/3 wire into executeClaude() for real: a prompt AsyncGenerator that
// yields one user message and keeps waiting until a `background_tasks_changed`
// level signal reports no live (non-ambient) tasks AND `result` has arrived,
// keeps a genuinely backgrounded Task-tool subagent alive past the main
// turn's `result`, and that returning the generator afterward closes the
// session cleanly. Run twice: once on a fresh session, once resuming it —
// see the file header note on why the resumed case matters.
//
// Run manually: node scripts/spike-open-prompt.mjs
// Needs real Claude credentials — same ones this shell already has.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Both legs share ONE cwd: Claude Code stores session transcripts keyed by
// (encoded) cwd, so resuming a session id under a DIFFERENT cwd than it was
// created in either errors or silently starts a fresh session — either way
// the second leg would prove nothing about resumed-session behavior, which
// is the whole reason it exists (see file header).
const cwd = mkdtempSync(path.join(tmpdir(), 'spike-'));
const SLEEP_SECONDS = 60; // long enough that model latency to `result` can't
// beat it and produce a flaky false negative on `markerPresentAtResult`.
const GATE_TIMEOUT_MS = 5 * 60 * 1000;

async function runOnce(label, { resumeSessionId } = {}) {
  // Unique per run so the second leg doesn't see the first leg's leftover
  // marker file and misread it as "already present at result".
  const markerFile = path.join(cwd, `background-task-done-${label.replace(/\s+/g, '-')}.txt`);
  const instruction =
    `Use the Task tool to dispatch a background subagent (general-purpose) ` +
    `whose ONLY job is: sleep ${SLEEP_SECONDS} seconds, then write the exact ` +
    `text DONE (no newline) to the file ${markerFile} using the Write tool. ` +
    `Dispatch it in the background, then immediately reply "dispatched" ` +
    `without waiting for it to finish.`;

  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const gateTimeout = setTimeout(() => {
    console.error(`[${label}] gate timed out after ${GATE_TIMEOUT_MS}ms — still-live task ids: ${[...liveTaskIds]}`);
    releaseGate();
  }, GATE_TIMEOUT_MS);
  gateTimeout.unref?.();

  async function* prompt() {
    yield {
      type: 'user',
      message: { role: 'user', content: instruction },
      parent_tool_use_id: null,
    };
    await gate;
  }

  const response = query({
    prompt: prompt(),
    options: {
      cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });

  let sessionId;
  const liveTaskIds = new Set();
  let sawBackgroundedTask = false;
  let resultSeen = false;
  let markerPresentAtResult = false;

  try {
    for await (const message of response) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
      } else if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
        liveTaskIds.clear();
        for (const t of message.tasks) {
          if (!t.ambient) {
            liveTaskIds.add(t.task_id);
            sawBackgroundedTask = true;
          }
        }
      } else if (message.type === 'result') {
        resultSeen = true;
        markerPresentAtResult = existsSync(markerFile);
        console.log(`[${label}] result received; marker already present: ${markerPresentAtResult}`);
      }
      if (resultSeen && liveTaskIds.size === 0) {
        releaseGate();
      }
    }
  } catch (error) {
    clearTimeout(gateTimeout);
    console.error(`[${label}] threw:`, error);
    return { ok: false, sessionId };
  }
  clearTimeout(gateTimeout);

  const survived =
    existsSync(markerFile) && readFileSync(markerFile, 'utf8').trim() === 'DONE';
  console.log(
    `[${label}] sawBackgroundedTask=${sawBackgroundedTask} markerPresentAtResult=${markerPresentAtResult} finalSurvived=${survived}`
  );
  if (markerPresentAtResult) {
    // Inconclusive, not a disproof: the background task simply finished
    // before `result` arrived (model was slower than SLEEP_SECONDS this
    // run). Re-run rather than treating this as a failed premise.
    console.error(`[${label}] INCONCLUSIVE — marker was already present at result. Re-run (consider raising SLEEP_SECONDS).`);
    return { ok: null, sessionId };
  }
  // Genuinely proves the premise only if: the task was actually reported as
  // backgrounded (not silently run in the foreground before result), it had
  // NOT yet finished at the moment result arrived, and it did finish
  // eventually.
  const ok = sawBackgroundedTask && survived;
  if (!ok) {
    console.error(`[${label}] FAILED`);
  }
  return { ok, sessionId };
}

const first = await runOnce('fresh session');
const second = first.sessionId
  ? await runOnce('resumed session', { resumeSessionId: first.sessionId })
  : { ok: false, sessionId: undefined };

console.log('\n=== RESULT ===');
console.log(`fresh session:   ${first.ok}`);
console.log(`resumed session: ${second.ok}`);
if (first.ok === null || second.ok === null) {
  console.error('\nINCONCLUSIVE run(s) above — re-run before drawing any conclusion.');
  process.exit(2);
}
const confirmed = first.ok === true && second.ok === true;
if (!confirmed) {
  console.error(
    '\nDESIGN PREMISE NOT CONFIRMED. Stop here — do not proceed to Task 2. ' +
      'Report this output and escalate.'
  );
}
process.exit(confirmed ? 0 : 1);
```

- [ ] **Step 2: Run it**

Run: `node scripts/spike-open-prompt.mjs`
Expected: exit code `0`, both `fresh session` and `resumed session` lines
`true`. Paste the full output into the task report.

If exit code is `2` (either leg printed `INCONCLUSIVE`), that is not a
result — re-run the script (raise `SLEEP_SECONDS` in the script first if it
happens more than once) until you get a real `0` or `1`.

- [ ] **Step 3: Gate on the result**

If exit code is `1`, STOP. Do not implement Task 2 onward. Report the
actual output and wait for direction.

- [ ] **Step 4: Commit**

```bash
git add scripts/spike-open-prompt.mjs
git commit -m "spike: confirm background_tasks_changed gate on fresh and resumed sessions"
```

---

### Task 2: `TurnGate` and `singleTurnPrompt`

Pure logic — fully unit-testable without touching the real SDK.

**Revision note (why this isn't edge-pairing `task_started`/`task_notification`):**
a prior version of this task tracked individual `task_started`/`task_notification`
pairs. Red-team found that construction can wedge forever: `sdk.d.ts`
documents that `task_started` fires with `is_backgrounded: true` for *every*
resumed subagent (not just genuine new dispatches) and for ambient
housekeeping tasks (`skip_transcript`, auto-started watchers) — either can
leave a `task_id` tracked with no `task_notification` ever coming, since
nothing else drives the loop that feeds the gate. The SDK ships a purpose-
built alternative for exactly this: `SDKBackgroundTasksChangedMessage`
(`subtype: 'background_tasks_changed'`) is a **level** signal — *"Every live
background task after the change. REPLACE semantics: swap your set for this
payload"* (`sdk.d.ts:3159-3174`) — so a single missed notification cannot
leave a stale entry; the next payload corrects it. It also carries `ambient`
per task, so housekeeping tasks are excluded by construction instead of by
guessing at which `task_started` frames to ignore.

**Files:**
- Create: `lib/services/cli/turn-gate.ts`
- Test: `tests/cli/turn-gate.test.ts`

**Interfaces:**
- Produces: `class TurnGate` with `markResultSeen(): void`, `setLiveTasks(tasks: Array<{ task_id: string; ambient?: boolean }>): void`, `forceClose(): void`, `whenSafeToClose(): Promise<void>`. `function singleTurnPrompt(instruction: string, gate: TurnGate): AsyncGenerator<SDKUserMessage>`. Task 3 consumes both.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cli/turn-gate.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnGate, singleTurnPrompt } from '@/lib/services/cli/turn-gate';

describe('TurnGate', () => {
  afterEach(() => {
    // Restores real timers even if the timeout test's assertion throws
    // partway through — a bare vi.useRealTimers() as the test's last
    // statement would leak fake timers into later tests on failure.
    vi.useRealTimers();
  });

  it('resolves immediately when result arrives with no live tasks reported', async () => {
    const gate = new TurnGate();
    let resolved = false;
    gate.whenSafeToClose().then(() => {
      resolved = true;
    });

    gate.markResultSeen();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('stays open while a live task is reported, even after the result', async () => {
    const gate = new TurnGate();
    let resolved = false;
    gate.whenSafeToClose().then(() => {
      resolved = true;
    });

    gate.setLiveTasks([{ task_id: 'task-1' }]);
    gate.markResultSeen();
    await Promise.resolve();
    expect(resolved).toBe(false);

    gate.setLiveTasks([]); // REPLACE semantics: empty payload clears it
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('excludes ambient tasks from the live set', async () => {
    const gate = new TurnGate();
    let resolved = false;
    gate.whenSafeToClose().then(() => {
      resolved = true;
    });

    gate.setLiveTasks([{ task_id: 'watcher-1', ambient: true }]);
    gate.markResultSeen();
    await Promise.resolve();
    expect(resolved).toBe(true); // ambient-only set counts as empty
  });

  it('a later payload replaces the whole set, not merges into it', async () => {
    const gate = new TurnGate();
    let resolved = false;
    gate.whenSafeToClose().then(() => {
      resolved = true;
    });

    gate.setLiveTasks([{ task_id: 'task-1' }, { task_id: 'task-2' }]);
    gate.markResultSeen();
    gate.setLiveTasks([{ task_id: 'task-2' }]); // task-1 silently dropped from this payload
    await Promise.resolve();
    expect(resolved).toBe(false); // task-2 still live

    gate.setLiveTasks([]);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('forceClose() resolves the gate unconditionally', async () => {
    const gate = new TurnGate();
    gate.setLiveTasks([{ task_id: 'stuck-forever' }]);
    gate.forceClose();
    await expect(gate.whenSafeToClose()).resolves.toBeUndefined();
  });

  it('times out and force-closes if live tasks never clear after the result', async () => {
    vi.useFakeTimers();
    const gate = new TurnGate();
    let resolved = false;
    gate.whenSafeToClose().then(() => {
      resolved = true;
    });

    gate.setLiveTasks([{ task_id: 'stuck-forever' }]);
    gate.markResultSeen();
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await Promise.resolve();

    expect(resolved).toBe(true);
  });
});

describe('singleTurnPrompt', () => {
  it('yields one user message for the instruction, then waits on the gate', async () => {
    const gate = new TurnGate();
    const generator = singleTurnPrompt('do the thing', gate);

    const first = await generator.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({
      type: 'user',
      message: { role: 'user', content: 'do the thing' },
      parent_tool_use_id: null,
    });

    const pending = generator.next();
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.markResultSeen();
    const second = await pending;
    expect(second.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/turn-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/services/cli/turn-gate.ts
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

// How long to keep a chat turn open after `result` waiting for backgrounded
// work to settle, before giving up and closing anyway. Named here as an
// explicit decision, not left as a guess: long enough for a real background
// subagent task to finish, short enough that a wedged/misreported task
// doesn't hold a `claude` subprocess (and the fire-and-forget promise behind
// it, see claude.ts's caller) open indefinitely.
const MAX_BACKGROUND_WAIT_MS = 10 * 60 * 1000;

/**
 * Tracks whether it is safe to end a chat turn's prompt stream: not until
 * the turn's `result` message has arrived AND the SDK's own
 * `background_tasks_changed` level signal reports no live, non-ambient
 * tasks. Fed by the same message-consumption loop executeClaude() already
 * runs — see lib/services/cli/claude.ts. A turn that never reports any live
 * task behaves exactly as before: markResultSeen() alone resolves the gate.
 *
 * Deliberately a LEVEL signal (setLiveTasks replaces the whole tracked set
 * every call), not edge-pairing task_started/task_notification — the SDK's
 * own doc comment on background_tasks_changed says this is precisely so "a
 * missed bookend cannot wedge a stale running indicator." forceClose() and
 * the timeout below are the remaining defense: a level signal removes the
 * common ways to wedge, not every conceivable one (a message the SDK never
 * sends, a hard crash mid-turn) — see claude.ts's `finally` for how
 * forceClose() is guaranteed to run regardless of how executeClaude() exits.
 */
export class TurnGate {
  private resultSeen = false;
  private liveTaskIds = new Set<string>();
  private resolveSafe: (() => void) | null = null;
  private safePromise = new Promise<void>((resolve) => {
    this.resolveSafe = resolve;
  });
  private timeout: ReturnType<typeof setTimeout> | null = null;

  markResultSeen(): void {
    if (this.resultSeen) return; // idempotent — don't re-arm the timeout
    this.resultSeen = true;
    this.timeout = setTimeout(() => {
      console.warn(
        `[TurnGate] Timed out after ${MAX_BACKGROUND_WAIT_MS}ms waiting for background tasks to settle; closing anyway.`
      );
      this.resolveNow();
    }, MAX_BACKGROUND_WAIT_MS);
    if (typeof this.timeout.unref === 'function') this.timeout.unref();
    this.checkSafe();
  }

  setLiveTasks(tasks: Array<{ task_id: string; ambient?: boolean }>): void {
    this.liveTaskIds = new Set(tasks.filter((t) => !t.ambient).map((t) => t.task_id));
    this.checkSafe();
  }

  forceClose(): void {
    this.resolveNow();
  }

  whenSafeToClose(): Promise<void> {
    return this.safePromise;
  }

  private checkSafe(): void {
    if (this.resultSeen && this.liveTaskIds.size === 0) {
      this.resolveNow();
    }
  }

  private resolveNow(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.resolveSafe) {
      this.resolveSafe();
      this.resolveSafe = null;
    }
  }
}

/**
 * The prompt passed to query() instead of a plain string. A string prompt
 * makes the SDK close stdin the instant the first `result` message arrives
 * (`isSingleUserTurn` in the SDK's own source), killing any still-running
 * backgrounded subagent. Yielding from an AsyncGenerator instead, and not
 * returning until `gate` says it's safe, keeps stdin open exactly as long
 * as needed, and returning is what makes the SDK close the session cleanly
 * (confirmed against sdk.mjs: streamInput() calls transport.endInput() once
 * this generator's own loop ends).
 */
export async function* singleTurnPrompt(
  instruction: string,
  gate: TurnGate
): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: instruction },
    parent_tool_use_id: null,
  };
  await gate.whenSafeToClose();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/turn-gate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/services/cli/turn-gate.ts tests/cli/turn-gate.test.ts
git commit -m "feat: add TurnGate — keep a chat turn open until backgrounded tasks settle"
```

---

### Task 3: Wire `TurnGate` into `executeClaude()`

**Revision note (two fixes from red-team, both in this task):**
1. **The gate must always resolve, no matter how `executeClaude()` exits** — not just on the happy path. Without a `finally`, a thrown error (or any exit the message loop doesn't reach `result` on) leaves the generator parked on the gate forever: the underlying `claude` process never gets `endInput()`, and the fire-and-forget promise `act/route.ts` started never settles. This task declares `turnGate` outside the `try` block specifically so a `finally` can reach it.
2. **`safeMarkCompleted()`/`publishStatus('completed')` move out of the `result` branch.** The previous version fired them the instant `result` arrived, before the turn was actually done waiting on background work — which both lies to the user (reports "completed" while the agent is still running) and reopens a real hazard: `act/route.ts` has no per-project concurrency guard, and a `UserRequest` marked `completed` looks free for a new message to start a *second* `query()` with the same `resume: sessionId` while the first CLI process is still alive holding that session. The fix is a deletion, not new code: the loop already has a post-loop fallback (`console.log('Streaming completed'); await safeMarkCompleted(); ...`) that only runs once the loop itself ends — which, after this change, is exactly when the gate resolves. Removing the early call from the `result` branch makes that existing fallback the *only* place completion is marked, and it now fires at the right time for free.

**Explicit, undone-on-purpose consequence — post-`result` subagent tool
activity:** `buildClaudeQueryOptions` never sets `forwardSubagentText`
(`claude-options.ts:40-54`), which per the SDK's own default means only
`tool_use`/`tool_result` blocks from a subagent are surfaced on the parent
stream, not its assistant prose (`sdk.d.ts:1703-1709`). So what can keep
arriving and getting persisted/streamed by the existing (unmodified) code
for as long as the gate stays open is `Using tool: X` entries via
`dispatchToolMessage` (`claude.ts:837-853`) — not new chat bubbles of
subagent narration. This is not new *code path* either way — foreground-
dispatched subagents already produce these same tool-activity entries today
while the main turn is visibly in progress. What's new is that it can now
happen *after* what used to be the last visible moment of the turn. Given
the completion-timing fix above, the request the UI shows is now honestly
still in progress during that window (not falsely "completed"), plus stays
in its loading/spinner state for that whole window (`ChatLog.tsx`'s
`isWaitingForResponse` only clears on `completed`) — so this is judged
correct-if-unpolished rather than a bug. Two follow-on UI effects worth
naming, not fixing here: the chat spinner now runs for the full background-
work duration instead of clearing at the visible result, and
`chat/page.tsx`'s preview auto-start (gated on the falling edge of
`hasActiveRequests`) is delayed by the same window on a project's first
message. Both are arguably more correct than today's premature "done," but
are UI-visible latency changes with no UI changes in this plan to soften
them — a real product-polish opportunity, out of scope here.

**Files:**
- Modify: `lib/services/cli/claude.ts:390-397` (declare `turnGate` before the `try`), `:532-553` (the `query({...})` call), the `else if` chain around `:757-886` (add one new branch, remove three lines from the `result` branch), and `:895-949` (wrap in `finally`).

**Interfaces:**
- Consumes: `TurnGate`, `singleTurnPrompt` (Task 2).
- Produces: `executeClaude()`'s public signature and every other message-type branch are unchanged. No new exports.

- [ ] **Step 1: Add the import and declare `turnGate` before the `try`**

At the top of `lib/services/cli/claude.ts`:

```typescript
import { TurnGate, singleTurnPrompt } from './turn-gate';
```

In `executeClaude`, near the other function-scoped state declared before the
`try` block (`hasMarkedTerminalStatus`, `emittedCompletedStatus`), add:

```typescript
let turnGate: TurnGate | undefined;
let sawResult = false;
```

Declaring `turnGate` here (not with `const` inside the `try`, where the
previous draft of this task had it) is what lets the `finally` block in
Step 4 reach it even if an error is thrown before the gate is ever created.
`sawResult` is used in Step 4 too — see the note there on why the `catch`
block needs to know whether the visible turn already succeeded before
something failed during the background-wait tail.

- [ ] **Step 2: Create the gate and change the prompt**

Inside the `try` block, right before `const response = query({...})`
(`claude.ts:532`), add:

```typescript
turnGate = new TurnGate();
```

Change the `query({...})` call's `prompt` field from:

```typescript
    const response = query({
      prompt: instruction,
```

to:

```typescript
    const response = query({
      prompt: singleTurnPrompt(instruction, turnGate),
```

Leave every other field of that call (`options: { ...buildClaudeQueryOptions({...}), stderr: (data: string) => {...} }`) exactly as it is today.

- [ ] **Step 3: Feed the gate from the existing message loop, and stop marking completion early**

Add one new `else if` branch to the chain around `claude.ts:757-886` (anywhere
before the final `result` branch — order among `else if` branches on
different `message.type`/`subtype` combinations doesn't matter):

```typescript
      } else if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
        turnGate.setLiveTasks(message.tasks);
```

Then change the existing `result` branch from:

```typescript
      } else if (message.type === 'result') {
        // Final result
        console.log('[ClaudeService] Task completed:', message.subtype);

        publishStatus('completed');
        emittedCompletedStatus = true;
        await safeMarkCompleted();
      }
```

to:

```typescript
      } else if (message.type === 'result') {
        // Final result — completion is marked once the loop itself ends
        // (see the post-loop fallback below), not here: a backgrounded
        // Task-tool subagent may still be running, and turnGate is what's
        // keeping this loop alive to find out.
        console.log('[ClaudeService] Task completed:', message.subtype);
        sawResult = true;
        turnGate.markResultSeen();
      }
```

Do not touch the `init` or `assistant` branches, or anything inside
`stream_event` handling — they are unchanged.

- [ ] **Step 4: Guarantee the gate closes on every exit path, and don't report a succeeded turn as failed**

Two changes to the `catch` block, both needed together:

**4a — the gate must resolve regardless of how the function exits.** Change
the function's `try { ... } catch (error) { ... }` (`claude.ts:474-949`) to
`try { ... } catch (error) { ... } finally { ... }` by adding, after the
existing `catch` block's closing brace:

```typescript
  } finally {
    turnGate?.forceClose();
  }
```

`forceClose()` is a safe no-op if the gate already resolved normally — see
Task 2's `resolveNow()`. This is what guarantees `singleTurnPrompt`'s
generator eventually returns (and the SDK closes the session) even if the
message loop throws, or exits some way that never reaches `result`.

**4b — a failure *after* `result` must not overwrite a succeeded turn as
`failed`.** Before this change, the window between `result` arriving and the
process actually exiting was milliseconds; `safeMarkCompleted()` fired
immediately on `result` (`hasMarkedTerminalStatus = true`), so anything that
threw afterward hit `safeMarkFailed`'s own early-return guard and changed
nothing. After Step 3 removes that immediate call, the window is however
long backgrounded work takes — up to `TurnGate`'s 10-minute timeout — and
`hasMarkedTerminalStatus` is still `false` for that whole window. A CLI
crash or transport error *after* the user's actual request already
succeeded must not flip a completed request to `failed`.

In the `catch (error) { ... }` block, change the line `await
safeMarkFailed(errorMessage);` to:

```typescript
    if (sawResult) {
      await safeMarkCompleted();
    } else {
      await safeMarkFailed(errorMessage);
    }
```

Leave everything else in the `catch` block unchanged — the `errorMessage`
construction, `publishStatus('error', errorMessage)`, the SSE `error`
publish, and the final `throw new Error(errorMessage)` all still run either
way, so the failure is still visible in logs/SSE even when the DB row itself
is left `completed` (the visible turn genuinely did succeed; only the
background-wait bookkeeping failed).

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions. `executeClaude` has no direct unit test
today (spec.md §8) — this step is a regression check on everything else.

- [ ] **Step 7: Manual smoke check — required, not optional**

`executeClaude` has no automated test (Step 6 only regression-checks
everything else), and Task 1's spike exercises `TurnGate`'s mechanism in
isolation, not this task's actual wiring into the 950-line function. This
step is therefore the only verification that the wiring itself is correct,
and is a hard gate on this task, not a nice-to-have: **do not mark this task
done, and do not start Task 4, without it having actually run.**

Run `npm run dev`, open a project, send a chat message asking the agent to
dispatch a background Task-tool subagent (same shape as Task 1's spike
instruction). Confirm in the server logs: `background_tasks_changed` fires
with the task's id, the request's status only reaches `completed` (in the
UI/SSE) after the background work finishes, and — the specific hang Step 4
exists to prevent — sending a *second*, unrelated message afterward
completes normally too (proving the process didn't leak).

If no browser/dev-server is available in this environment: say so
explicitly in the task report, and report this task as **blocked, not
done** — per spec.md §8's own convention for changes that can't always be
verified this way ("flagged, not silently treated as verified"). Escalate
for the verification to happen before proceeding, rather than treating a
green `npm test` as sufficient sign-off for this specific change.

- [ ] **Step 8: Commit**

```bash
git add lib/services/cli/claude.ts
git commit -m "fix: keep chat turn open until backgrounded Task-tool subagents settle"
```

---

### Task 4: Update spec.md

**Note on scope:** the design record's Part C (auto-resume interrupted
requests on restart) is **not implemented by this plan**. It was drafted and
red-teamed twice more as this plan's Task 4, and both passes found real,
specific hazards concentrated entirely in that feature (a race with
`reconcileProjectPaths()` that can run an unattended agent against a stale
project path; a single DB write failure aborting reconciliation for every
project; an unbounded-by-design crash-loop; unattended `bypassPermissions`
agents dispatching in parallel at every server restart, including routine
`next dev` restarts during development) that Tasks 1-3 do not share and do
not depend on. Auto-resume is deferred to its own follow-up plan, to be
designed opt-in (`AUTO_RESUME=1`, default off — inverting this plan's
earlier opt-out framing) rather than layered onto an already-three-times-
revised change. Until that follow-up lands, `reconcileStaleRequests()` is
unchanged from its behavior before this plan: every interrupted request is
marked `failed` on restart, full stop.

**Files:**
- Modify: `spec.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update §3 Architecture**

In `spec.md`'s `## 3. Architecture` section, in the `lib/services/` bullet,
add `cli/turn-gate.ts` to the file list next to `cli/claude.ts`, and extend
the description: "... `cli/claude.ts` (the Claude Agent SDK orchestration —
building the query, streaming tool events back to the client; the prompt is
an AsyncGenerator gated by `cli/turn-gate.ts`'s `TurnGate`, tracking the
SDK's `background_tasks_changed` signal, so a backgrounded Task-tool
subagent isn't killed when the turn's main result arrives)."

- [ ] **Step 2: Update decision 11's row to reflect what's actually built**

In `## 2. Decisions in force`, decision 11's row: replace the whole
"Choice" cell with a description of only what this plan implements — the
`TurnGate`/`singleTurnPrompt` mechanism (Step 1's wording, condensed) —
and drop every sentence about auto-resume, `reconcileStaleRequests()`
creating new rows, or `SKIP_AUTO_RESUME`; none of that is built. Replace
the trailing "**Decided 2026-09-02, not yet implemented — see §3 for
current (pre-change) architecture.**" with "**Implemented 2026-09-02 for
the turn-gate mechanism; auto-resume on restart (this decision's original
second half) deferred to a separate follow-up — see
`.flow/specs/2026-09-02-single-turn-open-prompt-design.md`'s Part C and
this plan's Task 4 note for why.**"

- [ ] **Step 3: Commit**

```bash
git add spec.md
git commit -m "docs: spec.md reflects the single-turn open-prompt architecture"
```
