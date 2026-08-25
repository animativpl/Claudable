import { describe, expect, it } from 'vitest';
import { buildDevServerEnv } from '@/lib/services/preview';

// Środowisko dev-servera projektu użytkownika dziedziczyło całe `process.env`
// platformy. Dwie konsekwencje, obie realne:
//   1. `CLAUDECODE` to marker, po którym `am-i-vibing` (a przez nie Astro 7)
//      rozpoznaje sesję agenta i forkuje dev-server w tło jako `detached`
//      demona — takiego, którego grupowy SIGTERM z `killProcessTree` już nie
//      dosięga. Każdy framework wykrywający środowisko agenta ma ten sam
//      wyzwalacz, więc odcinamy go raz, u źródła, nie raz na template.
//   2. `CLAUDE_CODE_OAUTH_TOKEN` to poświadczenie agenta. Kod użytkownika,
//      który uruchamiamy w dev-serverze, nie ma prawa go widzieć.
// W odróżnieniu od scrubu z `claude-options.ts` nie ma tu allowlisty:
// dev-server nie potrzebuje żadnej ze zmiennych sesji Claude Code.
describe('buildDevServerEnv', () => {
  const withEnv = <T>(overrides: Record<string, string>, run: () => T): T => {
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(overrides)) {
      previous[key] = process.env[key];
      process.env[key] = value;
    }
    try {
      return run();
    } finally {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  };

  // Lista wzięta z realnego środowiska sesji (12 zmiennych), a nie z pamięci —
  // `CLAUDE_JOB_DIR` nie było w liście z Task 13 i wyliczanie znowu by go
  // przepuściło. Scrub łapie prefiks, nie znane nazwy.
  const sessionVars = [
    'CLAUDECODE',
    'CLAUDE_CODE_ATTRIBUTION_HEADER',
    'CLAUDE_CODE_CHILD_SESSION',
    'CLAUDE_CODE_ENABLE_TELEMETRY',
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_EXECPATH',
    'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_EFFORT',
    'CLAUDE_JOB_DIR',
    'CLAUDE_PID',
  ];

  it('odcina wszystkie zmienne sesji Claude Code, bez allowlisty', () => {
    const overrides = Object.fromEntries(sessionVars.map((key) => [key, 'x']));
    const env = withEnv(overrides, () =>
      buildDevServerEnv(3107, 'http://localhost:3107')
    );

    for (const key of sessionVars) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it('zostawia port, URL i resztę środowiska nietknięte', () => {
    // Drugi kierunek. Bez niego scrub zwracający pusty obiekt przechodzi.
    const env = withEnv({ CLAUDECODE: '1', ORDINARY_VAR: 'keep-me' }, () =>
      buildDevServerEnv(3107, 'http://localhost:3107')
    );

    expect(env.PORT).toBe('3107');
    expect(env.WEB_PORT).toBe('3107');
    expect(env.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3107');
    expect(env.ORDINARY_VAR).toBe('keep-me');
    expect(env.PATH).toBe(process.env.PATH);
  });
});
