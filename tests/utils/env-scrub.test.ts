import { describe, expect, it } from 'vitest';
import { scrubProcessEnv } from '@/lib/utils/env-scrub';
import { CLAUDE_SESSION_VARS, withEnv } from '../services/support/claude-session-env';

// Pomocnik dzielony przez `cli/claude-options.ts` (proces agenta) i
// `services/preview.ts` (procesy projektu użytkownika). Różnią się wyłącznie
// allowlistą przekazaną przez wywołującego — zestaw odcinanych kategorii jest
// ten sam po obu stronach: prefiks sesji Claude Code, NODE_ENV platformy,
// prywatna konfiguracja Nexta platformy. Czyta `process.env` bezpośrednio
// (nie przez wstrzykiwany parametr), tak samo jak dawne `scrubPlatformEnv` w
// `preview.ts` i dawne `childEnv` w `claude-options.ts` — testy mutują
// `process.env` na czas wywołania, jak reszta pakietu testów tego scrubu.
describe('scrubProcessEnv', () => {
  it('odcina cały prefiks zmiennych sesji Claude Code, bez allowlisty', () => {
    const overrides = Object.fromEntries(CLAUDE_SESSION_VARS.map((key) => [key, 'x']));
    const env = withEnv(overrides, () => scrubProcessEnv());

    for (const key of CLAUDE_SESSION_VARS) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it('odcina NODE_ENV platformy', () => {
    const env = withEnv({ NODE_ENV: 'production' }, () => scrubProcessEnv());

    expect(env).not.toHaveProperty('NODE_ENV');
  });

  it('odcina prywatną konfigurację Nexta platformy', () => {
    const env = withEnv(
      {
        __NEXT_PRIVATE_STANDALONE_CONFIG: '{"distDir":"./.next"}',
        __NEXT_PRIVATE_ORIGIN: 'http://localhost:3000',
      },
      () => scrubProcessEnv()
    );

    expect(env).not.toHaveProperty('__NEXT_PRIVATE_STANDALONE_CONFIG');
    expect(env).not.toHaveProperty('__NEXT_PRIVATE_ORIGIN');
  });

  it('zostawia w allowliście zmienne, które inaczej pasowałyby do prefiksu', () => {
    const env = withEnv(
      { CLAUDE_CONFIG_DIR: '/mnt/claude-home', CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth', CLAUDECODE: '1' },
      () => scrubProcessEnv(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN'])
    );

    expect(env.CLAUDE_CONFIG_DIR).toBe('/mnt/claude-home');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-oauth');
    expect(env).not.toHaveProperty('CLAUDECODE');
  });

  it('bez allowlisty nie zostawia żadnej zmiennej CLAUDE_*', () => {
    const env = withEnv({ CLAUDE_CONFIG_DIR: '/mnt/claude-home' }, () => scrubProcessEnv());

    expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
  });

  it('zostawia resztę środowiska nietkniętą', () => {
    // Drugi kierunek. Bez niego scrub zwracający pusty obiekt przechodzi.
    const env = withEnv({ CLAUDECODE: '1', ORDINARY_VAR: 'keep-me' }, () => scrubProcessEnv());

    expect(env.ORDINARY_VAR).toBe('keep-me');
    expect(env.PATH).toBe(process.env.PATH);
  });
});
