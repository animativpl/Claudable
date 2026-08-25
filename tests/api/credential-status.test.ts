import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeCredentialStatus } from '@/lib/services/cli/credential-status';

const originalDir = process.env.CLAUDE_CONFIG_DIR;
const originalKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (originalDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalDir;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

describe('describeCredentialStatus', () => {
  it('rozpoznaje login OAuth po pliku poświadczeń', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    await fs.writeFile(path.join(dir, '.credentials.json'), '{}');
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;

    const status = await describeCredentialStatus();
    expect(status.hasCredentials).toBe(true);
    expect(status.source).toBe('oauth');
    expect(status.configDir).toBe(dir);
  });

  it('rozpoznaje klucz API, gdy nie ma pliku poświadczeń', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const status = await describeCredentialStatus();
    expect(status.source).toBe('api-key');
    expect(status.hasCredentials).toBe(true);
  });

  it('zgłasza brak poświadczeń', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;

    const status = await describeCredentialStatus();
    expect(status.hasCredentials).toBe(false);
    expect(status.source).toBe('none');
  });
});
