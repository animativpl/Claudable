import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { killProcessTree } from '@/lib/services/process-tree';

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('killProcessTree', () => {
  it('zwraca signalled: false dla braku pid', () => {
    expect(killProcessTree(undefined)).toEqual({ signalled: false, scope: 'single' });
  });

  it.skipIf(process.platform === 'win32')('ubija wnuka, nie tylko lidera grupy, i raportuje scope: group', async () => {
    // Asercja MUSI dotyczyć wnuka. Gdyby sprawdzała tylko pid `sh`, przeszłaby
    // także dla `process.kill(pid)` — czyli dla wadliwego zachowania, które to
    // zadanie naprawia.
    const marker = path.join(os.tmpdir(), `ptree-${process.pid}-${Date.now()}.pid`);
    const child = spawn(
      'sh',
      ['-c', `node -e "setTimeout(()=>{}, 60000)" & echo $! > ${marker}; wait`],
      { detached: true, stdio: 'ignore' }
    );
    await wait(900);

    const grandchildPid = Number.parseInt(await fs.readFile(marker, 'utf8'), 10);
    expect(Number.isInteger(grandchildPid)).toBe(true);
    expect(isAlive(grandchildPid)).toBe(true);

    expect(killProcessTree(child.pid!)).toEqual({ signalled: true, scope: 'group' });
    await wait(900);

    expect(isAlive(grandchildPid)).toBe(false);
    expect(isAlive(child.pid!)).toBe(false);
    await fs.rm(marker, { force: true });
  });

  // Linchpin test (review finding 1c): without `detached`, the child is not a
  // group leader, so `process.kill(-pid)` must ESRCH and fall back to
  // signalling the pid alone — scope: 'single'. This is the exact distinction
  // the fallback used to hide: it returned the same `true` for both cases, so
  // a missing `detached: true` on the preview spawn would fail silently.
  it.skipIf(process.platform === 'win32')('raportuje scope: single, gdy proces nie jest liderem grupy (brak detached)', async () => {
    const child = spawn('sh', ['-c', 'sleep 5'], { stdio: 'ignore' });
    await wait(200);
    const pid = child.pid!;

    expect(killProcessTree(pid)).toEqual({ signalled: true, scope: 'single' });
    await wait(300);

    expect(isAlive(pid)).toBe(false);
  });
});
