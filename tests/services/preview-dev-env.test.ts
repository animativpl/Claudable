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

  // Obraz kontenera ustawia `NODE_ENV=production` dla samej platformy i tak ma
  // zostać. Dziedziczenie tej zmiennej przez dev-server cudzego projektu to już
  // co innego: Next wypisuje ostrzeżenie o niestandardowym NODE_ENV i dociąga w
  // czasie startu pakiety, które `npm install` pominął jako devDependencies.
  it('nie przekazuje NODE_ENV platformy', () => {
    const env = withEnv({ NODE_ENV: 'production' }, () =>
      buildDevServerEnv(3107, 'http://localhost:3107')
    );

    expect(env).not.toHaveProperty('NODE_ENV');
  });

  // Wyjście standalone: `/app/server.js` ustawia w swoim procesie
  // `__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)`, czyli
  // konfigurację Nexta PLATFORMY (`output: 'standalone'`, `distDir`,
  // `outputFileTracingRoot: /app`). Dev-server cudzego projektu dziedziczył tę
  // zmienną i czytał z niej swoją konfigurację zamiast własnej — `next dev`
  // wstawał, ale każde żądanie kończyło się 500 i ENOENT na
  // `.next/fallback-build-manifest.json`. Zmierzone w kontenerze; ten sam
  // projekt uruchomiony poza nim odpowiadał 200.
  it('nie przekazuje prywatnej konfiguracji Nexta platformy', () => {
    const env = withEnv(
      {
        __NEXT_PRIVATE_STANDALONE_CONFIG: '{"distDir":"./.next"}',
        __NEXT_PRIVATE_ORIGIN: 'http://localhost:3000',
      },
      () => buildDevServerEnv(3107, 'http://localhost:3107')
    );

    expect(env).not.toHaveProperty('__NEXT_PRIVATE_STANDALONE_CONFIG');
    expect(env).not.toHaveProperty('__NEXT_PRIVATE_ORIGIN');
  });

  // Sekret platformy, nie projektu: `ENCRYPTION_KEY` odszyfrowuje tokeny usług
  // i zaszyfrowane `EnvVar` w bazie Claudable. Dev-server cudzego projektu (i
  // każdy `postinstall`, który agent uruchomi) dziedziczył go razem z resztą
  // środowiska.
  it('nie przekazuje ENCRYPTION_KEY platformy, a port i PATH zostawia', () => {
    const env = withEnv({ ENCRYPTION_KEY: 'a'.repeat(64) }, () =>
      buildDevServerEnv(3107, 'http://localhost:3107')
    );

    expect(env).not.toHaveProperty('ENCRYPTION_KEY');
    expect(env.PORT).toBe('3107');
    expect(env.PATH).toBe(process.env.PATH);
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
