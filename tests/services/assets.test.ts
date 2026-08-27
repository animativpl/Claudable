import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { mirrorAssetToPublic } from '@/lib/services/assets';

describe('lib/services/assets — mirrorAssetToPublic', () => {
  let tmpProjectRoot: string;
  let sourceFile: string;
  const testFilename = 'assets-test-mirror-artifact.png';
  // mirrorAssetToPublic's "host" mirror is hardcoded to process.cwd(), not
  // parameterized -- this test's own artifact there, so it must clean up
  // after itself instead of leaving a stray file in the real repo tree.
  const hostArtifactPath = path.join(process.cwd(), 'public', 'uploads', testFilename);

  beforeEach(async () => {
    tmpProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-test-'));
    sourceFile = path.join(tmpProjectRoot, 'source.png');
    await fs.writeFile(sourceFile, Buffer.from('fake-image-bytes'));
  });

  afterEach(async () => {
    await fs.rm(tmpProjectRoot, { recursive: true, force: true });
    await fs.rm(hostArtifactPath, { force: true });
  });

  it('kopiuje plik do public/uploads projektu i zwraca ścieżkę', async () => {
    const result = await mirrorAssetToPublic(tmpProjectRoot, testFilename, sourceFile);
    expect(result.publicPath).toBeTruthy();
    const copied = await fs.readFile(path.join(tmpProjectRoot, 'public', 'uploads', testFilename));
    expect(copied.toString()).toBe('fake-image-bytes');
  });
});
