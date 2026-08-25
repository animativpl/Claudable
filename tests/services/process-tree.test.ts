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
  it('zwraca false dla braku pid', () => {
    expect(killProcessTree(undefined)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('ubija wnuka, nie tylko lidera grupy', async () => {
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

    expect(killProcessTree(child.pid!)).toBe(true);
    await wait(900);

    expect(isAlive(grandchildPid)).toBe(false);
    expect(isAlive(child.pid!)).toBe(false);
    await fs.rm(marker, { force: true });
  });
});
