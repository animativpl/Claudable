import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

let projectDir: string;

vi.mock('@/lib/services/project', () => ({
  getProjectById: vi.fn(async (id: string) => ({ id, repoPath: projectDir })),
}));

import { listProjectDirectory, FileBrowserError } from '@/lib/services/file-browser';

describe('file-browser path traversal guard', () => {
  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-browser-test-'));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('odrzuca próbę wyjścia poza katalog projektu, gdy katalog bazowy realnie istnieje', async () => {
    await expect(
      listProjectDirectory('proj-1', '../../../../etc')
    ).rejects.toThrow(FileBrowserError);
  });

  it('akceptuje ścieżkę wewnątrz katalogu projektu', async () => {
    await expect(listProjectDirectory('proj-1', '.')).resolves.toBeDefined();
  });
});
