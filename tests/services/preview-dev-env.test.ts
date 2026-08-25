import { describe, expect, it } from 'vitest';
import { buildDevServerEnv } from '@/lib/services/preview';
import { CLAUDE_SESSION_VARS, withEnv } from './support/claude-session-env';

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
  it('odcina wszystkie zmienne sesji Claude Code, bez allowlisty', () => {
    const overrides = Object.fromEntries(CLAUDE_SESSION_VARS.map((key) => [key, 'x']));
    const env = withEnv(overrides, () =>
      buildDevServerEnv(3107, 'http://localhost:3107')
    );

    for (const key of CLAUDE_SESSION_VARS) {
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
