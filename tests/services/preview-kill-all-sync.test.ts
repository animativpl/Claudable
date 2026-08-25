import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { previewManager } from '@/lib/services/preview';

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// killAllSync is the shutdown-handler path: it must do only synchronous work
// (no DB writes, no await) because a signal handler under `next dev` races
// Next's own exit path and loses anything asynchronous. This test injects a
// tracked process directly (bypassing start()'s DB/network side effects) and
// asserts the process tree is dead and the internal map is cleared, entirely
// through the synchronous return value of killAllSync().
describe('PreviewManager.killAllSync', () => {
  it.skipIf(process.platform === 'win32')(
    'kills tracked process trees synchronously and returns the count killed',
    async () => {
      const child = spawn('sh', ['-c', 'sleep 30'], {
        detached: true,
        stdio: 'ignore',
      });
      const pid = child.pid!;

      (previewManager as unknown as { processes: Map<string, unknown> }).processes.set(
        'killallsync-test-project',
        {
          process: child,
          port: 39999,
          url: 'http://localhost:39999',
          status: 'running',
          logs: [],
          startedAt: new Date(),
        }
      );

      const killed = previewManager.killAllSync();

      expect(killed).toEqual({ group: 1, single: 0 });
      expect(previewManager.getStatus('killallsync-test-project').status).toBe(
        'stopped'
      );

      await wait(500);
      expect(isAlive(pid)).toBe(false);
    }
  );

  // The detached child above is a process group leader, so it is always
  // killed with scope 'group'. This test covers the other branch: a tracked
  // process that is NOT a group leader must be counted as 'single', not
  // silently folded into the same success count (review finding 1).
  it.skipIf(process.platform === 'win32')(
    'counts a non-detached tracked process under single, not group',
    async () => {
      const child = spawn('sh', ['-c', 'sleep 30'], { stdio: 'ignore' });
      const pid = child.pid!;

      (previewManager as unknown as { processes: Map<string, unknown> }).processes.set(
        'killallsync-single-test-project',
        {
          process: child,
          port: 39998,
          url: 'http://localhost:39998',
          status: 'running',
          logs: [],
          startedAt: new Date(),
        }
      );

      const killed = previewManager.killAllSync();

      expect(killed).toEqual({ group: 0, single: 1 });

      await wait(500);
      expect(isAlive(pid)).toBe(false);
    }
  );

  it('returns group: 0, single: 0 when there is nothing tracked', () => {
    expect(previewManager.killAllSync()).toEqual({ group: 0, single: 0 });
  });
});
