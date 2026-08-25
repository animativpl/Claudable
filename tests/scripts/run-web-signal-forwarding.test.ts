import { describe, expect, it, vi } from 'vitest';
import { forwardSignalToChild } from '@/scripts/run-web';

// Review finding 4: `kill -TERM` on the run-web.js wrapper pid used to just
// terminate the wrapper via the default signal action, leaving its `next
// dev` child (and everything the child spawns, including preview dev
// servers) unsignalled and running. `forwardSignalToChild` is the piece that
// makes an explicit `kill -TERM <run-web.js pid>` propagate to the child, the
// way Ctrl+C already does via the foreground process group.
describe('forwardSignalToChild', () => {
  it('forwards the signal to a still-running child', () => {
    const child = { killed: false, kill: vi.fn() };
    forwardSignalToChild(child as unknown as { killed: boolean; kill: (s: string) => void }, 'SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('does nothing once the child has already exited', () => {
    const child = { killed: true, kill: vi.fn() };
    forwardSignalToChild(child as unknown as { killed: boolean; kill: (s: string) => void }, 'SIGTERM');
    expect(child.kill).not.toHaveBeenCalled();
  });
});
