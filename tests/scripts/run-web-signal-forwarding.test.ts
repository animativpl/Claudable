import { describe, expect, it, vi } from 'vitest';
import { forwardSignalToChild } from '@/scripts/run-web';

// Review finding 4: `kill -TERM` on the run-web.js wrapper pid used to just
// terminate the wrapper via the default signal action, leaving its `next
// dev` child (and everything the child spawns, including preview dev
// servers) unsignalled and running. `forwardSignalToChild` is the piece that
// makes an explicit `kill -TERM <run-web.js pid>` propagate to the child, the
// way Ctrl+C already does via the foreground process group.
type FakeChild = { exitCode: number | null; signalCode: string | null; kill: (s: string) => void };

describe('forwardSignalToChild', () => {
  it('forwards the signal to a still-running child', () => {
    const child: FakeChild = { exitCode: null, signalCode: null, kill: vi.fn() };
    forwardSignalToChild(child as unknown as FakeChild, 'SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('does nothing once the child has already exited', () => {
    const child: FakeChild = { exitCode: 0, signalCode: null, kill: vi.fn() };
    forwardSignalToChild(child as unknown as FakeChild, 'SIGTERM');
    expect(child.kill).not.toHaveBeenCalled();
  });

  // Review finding (fix round 3, minor): `child.killed` means "we sent a
  // signal", not "the child is still alive". Node sets `killed` to true as
  // soon as `.kill()` is called, before the child has actually exited. A
  // wrapper that already forwarded one SIGTERM must still forward a second
  // one while the child is still shutting down.
  it('still forwards a second signal to a child that was already signalled once but has not exited', () => {
    const child: FakeChild = { exitCode: null, signalCode: null, kill: vi.fn() };
    forwardSignalToChild(child as unknown as FakeChild, 'SIGTERM');
    forwardSignalToChild(child as unknown as FakeChild, 'SIGTERM');
    expect(child.kill).toHaveBeenCalledTimes(2);
  });
});
