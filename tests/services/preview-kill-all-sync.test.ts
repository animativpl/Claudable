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

      expect(killed).toBe(1);
      expect(previewManager.getStatus('killallsync-test-project').status).toBe(
        'stopped'
      );

      await wait(500);
      expect(isAlive(pid)).toBe(false);
    }
  );

  it('returns 0 when there is nothing tracked', () => {
    expect(previewManager.killAllSync()).toBe(0);
  });
});
