import { describe, expect, it } from 'vitest';
import { buildInstallEnv } from '@/lib/services/preview';
import { CLAUDE_SESSION_VARS, withEnv } from './support/claude-session-env';

// `PreviewManager.installDependencies()` (the standalone `npm install` path
// behind `POST /api/projects/[project_id]/install-dependencies`, independent
// of starting a dev server) used to hand `runInstallWithPreferredManager` a
// raw `{ ...process.env }`. That runs the user project's install lifecycle
// scripts (postinstall etc.) with the platform's full session environment,
// `CLAUDE_CODE_OAUTH_TOKEN` included — the same credential-exposure argument
// as `buildDevServerEnv`, in a place that fix did not cover.
//
// Unlike the dev server, an `npm install` is not a long-lived server: it has
// no port and no URL to advertise, so this scrub does not take a port/url
// pair or inject PORT/WEB_PORT/NEXT_PUBLIC_APP_URL. Widening
// `buildDevServerEnv`'s signature to fit here would mean inventing a fake
// port just to satisfy it — this is the lower seam instead: scrubbing alone.
describe('buildInstallEnv', () => {
  it('odcina wszystkie zmienne sesji Claude Code, bez allowlisty', () => {
    const overrides = Object.fromEntries(CLAUDE_SESSION_VARS.map((key) => [key, 'x']));
    const env = withEnv(overrides, () => buildInstallEnv());

    for (const key of CLAUDE_SESSION_VARS) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it('zostawia resztę środowiska nietkniętą i nie dokłada PORT/WEB_PORT/NEXT_PUBLIC_APP_URL', () => {
    // Drugi kierunek. Bez niego scrub zwracający pusty obiekt przechodzi.
    const env = withEnv({ CLAUDECODE: '1', ORDINARY_VAR: 'keep-me' }, () =>
      buildInstallEnv()
    );

    expect(env.ORDINARY_VAR).toBe('keep-me');
    expect(env.PATH).toBe(process.env.PATH);
    // Instalacja nie jest dev-serverem: nie ma portu ani URL-a do ogłoszenia,
    // więc te klucze mają zostać takie, jakie były w otoczeniu — nie
    // fabrykowane, jak robi to `buildDevServerEnv`.
    expect(env.PORT).toBe(process.env.PORT);
    expect(env.WEB_PORT).toBe(process.env.WEB_PORT);
    expect(env.NEXT_PUBLIC_APP_URL).toBe(process.env.NEXT_PUBLIC_APP_URL);
  });
});
