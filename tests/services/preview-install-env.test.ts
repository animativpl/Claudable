import { describe, expect, it } from 'vitest';
import { buildInstallEnv } from '@/lib/services/preview';

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

  // Same list as `preview-dev-env.test.ts`, taken from a real session rather
  // than from memory (`CLAUDE_JOB_DIR` is easy to forget by enumeration).
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
    const env = withEnv(overrides, () => buildInstallEnv());

    for (const key of sessionVars) {
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
