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
  // Declaration order matters: `resolveSafe` must come before `safePromise`.
  // The executor below runs synchronously during the `safePromise` field
  // initializer and assigns `resolveSafe` — if `resolveSafe`'s own `= null`
  // initializer ran after that (i.e. the fields were declared in the other
  // order), it would immediately overwrite the assignment and the gate would
  // never resolve, hanging every turn until the timeout.
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
