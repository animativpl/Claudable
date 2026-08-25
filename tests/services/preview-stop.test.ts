import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

// stop() writes project state via lib/services/project, which hits the real
// DB. Mock it so this test exercises only PreviewManager.stop()'s own logic
// (the warning on scope 'single'), not project persistence.
vi.mock('@/lib/services/project', () => ({
  getProjectById: vi.fn().mockResolvedValue(null),
  updateProject: vi.fn().mockResolvedValue(undefined),
  updateProjectStatus: vi.fn().mockResolvedValue(undefined),
}));

const { previewManager } = await import('@/lib/services/preview');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// stop() is the "Stop preview" API path. When killProcessTree only managed to
// signal the wrapper (scope 'single' — no process group, e.g. a non-detached
// child or Windows), a child may still hold the port. killAllSync() already
// warns on this branch (see preview-kill-all-sync.test.ts); stop() must too,
// instead of silently discarding the result (review finding: fix round 3).
describe('PreviewManager.stop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.skipIf(process.platform === 'win32')(
    'warns when killProcessTree only signalled the wrapper, not the process group',
    async () => {
      const child = spawn('sh', ['-c', 'sleep 30'], { stdio: 'ignore' });
      const pid = child.pid!;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      (previewManager as unknown as { processes: Map<string, unknown> }).processes.set(
        'stop-single-scope-test-project',
        {
          process: child,
          port: 39997,
          url: 'http://localhost:39997',
          status: 'running',
          logs: [],
          startedAt: new Date(),
        }
      );

      await previewManager.stop('stop-single-scope-test-project');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('stop-single-scope-test-project')
      );

      await wait(500);
    }
  );
});
