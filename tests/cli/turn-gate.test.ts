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
