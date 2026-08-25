import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeCredentialStatus } from '@/lib/services/cli/credential-status';

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

describe('describeCredentialStatus', () => {
  it('rozpoznaje login OAuth po pliku poświadczeń', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    await fs.writeFile(path.join(dir, '.credentials.json'), '{}');
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    const status = await describeCredentialStatus();
    expect(status.hasCredentials).toBe(true);
    expect(status.source).toBe('credentials-file');
    expect(status.configDir).toBe(dir);
  });

  it('rozpoznaje klucz API, gdy nie ma pliku poświadczeń', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    const status = await describeCredentialStatus();
    expect(status.source).toBe('api-key');
    expect(status.hasCredentials).toBe(true);
  });

  it('zgłasza brak poświadczeń', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    const status = await describeCredentialStatus();
    expect(status.hasCredentials).toBe(false);
    expect(status.source).toBe('none');
  });

  it('rozpoznaje CLAUDE_CODE_OAUTH_TOKEN, gdy nie ma pliku poświadczeń ani klucza API', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'token-value';

    const status = await describeCredentialStatus();
    expect(status.hasCredentials).toBe(true);
    expect(status.source).toBe('oauth-token');
  });

  it('przedkłada CLAUDE_CODE_OAUTH_TOKEN nad plik poświadczeń, gdy oba są obecne', async () => {
    // Kolejność zgodna z SDK: cli.js (funkcje bx()/z4()) sprawdza
    // process.env.CLAUDE_CODE_OAUTH_TOKEN przed odczytem .credentials.json —
    // zmienna środowiskowa zawsze wygrywa z plikiem w tej samej rodzinie OAuth.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    await fs.writeFile(path.join(dir, '.credentials.json'), '{}');
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'token-value';

    const status = await describeCredentialStatus();
    expect(status.source).toBe('oauth-token');
  });

  it('przedkłada CLAUDE_CODE_OAUTH_TOKEN nad klucz API, gdy oba są obecne', async () => {
    // Kolejność między CLAUDE_CODE_OAUTH_TOKEN a ANTHROPIC_API_KEY nie jest
    // jednoznacznie ustalona przez SDK (cli.js traktuje je jako niezależne,
    // konkurencyjne metody i przy obu obecnych ostrzega, zamiast po cichu
    // wybierać) — patrz komentarz przy tym sprawdzeniu w credential-status.ts.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'token-value';

    const status = await describeCredentialStatus();
    expect(status.source).toBe('oauth-token');
  });
});
