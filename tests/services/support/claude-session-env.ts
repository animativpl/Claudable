// Wspólna lista zmiennych sesji Claude Code i helper do ich tymczasowego
// wstrzykiwania, dzielone przez `preview-dev-env.test.ts` i
// `preview-install-env.test.ts`. Wydzielone z dwóch osobnych kopii, bo cała
// teza scrubu w `preview.ts` (`scrubClaudeSessionEnv`) brzmi "nie wyliczaj
// zmiennych z pamięci, licz na prefiks" — dwie kopie tej samej wyliczonej
// listy w testach rozjadą się dokładnie tym samym trybem.
//
// Lista wzięta z realnego środowiska sesji, nie wymyślona z pamięci:
// `CLAUDE_JOB_DIR` zabrakło w wersji z Task 13 właśnie dlatego, że ktoś
// wyliczał z pamięci zamiast sprawdzić `env`. Stan na Task 17: `env | grep
// CLAUDE` w tej sesji daje 12 z poniższych 14; `CLAUDE_CODE_OAUTH_TOKEN` i
// `CLAUDE_CONFIG_DIR` nie występują tu (ta sesja nie loguje się przez OAuth
// ani nie ma niestandardowego config-dir), ale są realnymi zmiennymi sesji
// Claude Code w innych konfiguracjach (patrz allowlist w
// `lib/services/cli/claude-options.ts`) i scrub musi je łapać tak samo.
export const CLAUDE_SESSION_VARS = [
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
] as const;

export function withEnv<T>(overrides: Record<string, string>, run: () => T): T {
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
}
