import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/settings/cli-status/route';

const originalDir = process.env.CLAUDE_CONFIG_DIR;
const originalKey = process.env.ANTHROPIC_API_KEY;
const originalOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

afterEach(() => {
  if (originalDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalDir;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  if (originalOauthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOauthToken;
});

describe('GET /api/settings/cli-status', () => {
  it('zwraca configured=true i bez pola error, gdy są poświadczenia', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    await fs.writeFile(path.join(dir, '.credentials.json'), '{}');
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.claude.installed).toBe(true);
    expect(body.claude.available).toBe(true);
    expect(body.claude.configured).toBe(true);
    expect(body.claude.source).toBe('credentials-file');
    expect(body.claude.configDir).toBe(dir);
    expect(body.claude.error).toBeUndefined();
  });

  it('zwraca configured=false i pole error, gdy brak poświadczeń, ale status 200', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.claude.installed).toBe(false);
    expect(body.claude.available).toBe(false);
    expect(body.claude.configured).toBe(false);
    expect(body.claude.source).toBe('none');
    expect(typeof body.claude.error).toBe('string');
  });
});
