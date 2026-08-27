import { describe, expect, it, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { directoryExists } from '@/lib/utils/fs';

describe('lib/utils/fs — directoryExists', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('zwraca true dla istniejącego katalogu', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-exists-test-'));
    expect(await directoryExists(tmpDir)).toBe(true);
  });

  it('zwraca false dla nieistniejącej ścieżki', async () => {
    expect(await directoryExists('/definitely/does/not/exist/anywhere')).toBe(false);
  });

  it('zwraca false dla ścieżki, która jest plikiem, nie katalogiem', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-exists-test-'));
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.writeFile(filePath, 'x');
    expect(await directoryExists(filePath)).toBe(false);
  });
});
