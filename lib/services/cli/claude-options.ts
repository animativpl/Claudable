import type { Options } from '@anthropic-ai/claude-agent-sdk';

// Zmienne, które muszą przeżyć scrub mimo pasowania do prefiksu CLAUDE_:
// CLAUDE_CONFIG_DIR wskazuje zamontowany katalog konfiguracyjny (bez niego
// agent nie widzi skilli/CLAUDE.md), CLAUDE_CODE_OAUTH_TOKEN to poświadczenie
// agenta, jeśli kontener nim uwierzytelnia zamiast kluczem API.
const CLAUDE_ENV_ALLOWLIST = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN'] as const;

function isClaudeSessionVar(key: string): boolean {
  return key === 'CLAUDECODE' || key.startsWith('CLAUDE_');
}

/**
 * Claudable osadza SDK, więc nie jest zagnieżdżoną sesją Claude Code — ale
 * odpalony z terminala, w którym Claude Code działa, dziedziczy jego zmienne
 * i SDK odmawia startu. Odcinamy cały prefiks zmiennych sesji dla procesu
 * potomnego zamiast wyliczać znane nazwy: sesja nadrzędna ma ich więcej niż
 * dało się przewidzieć z góry (IPC, telemetria, ID sesji), a wyliczanie
 * zostawia dokładnie te, których nie przewidzieliśmy.
 */
function childEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (isClaudeSessionVar(key) && !(CLAUDE_ENV_ALLOWLIST as readonly string[]).includes(key)) {
      delete env[key];
    }
  }
  return env;
}

export interface BuildClaudeOptionsInput {
  projectPath: string;
  model: string;
  sessionId?: string;
}

/**
 * Buduje opcje sesji agenta. Trzymane osobno od executeClaude, bo to jedyne
 * miejsce w aplikacji, w którym literówka w nazwie opcji jest niewidoczna
 * w czasie działania — więc musi być sprawdzalne typami i testem.
 */
export function buildClaudeQueryOptions(input: BuildClaudeOptionsInput): Options {
  return {
    cwd: input.projectPath,
    additionalDirectories: [input.projectPath],
    model: input.model,
    resume: input.sessionId,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // Preset, nie string: string ZASTĘPUJE prompt Claude Code, a pominięcie
    // opcji daje prompt PUSTY (`sdk.mjs`: `if (Y === void 0) G = ""`). Wchodzi
    // już tutaj, nie w Task 13, bo między tymi zadaniami dowody z uruchomienia
    // zbierałyby się na agencie bez żadnych instrukcji.
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // Nowe w tym zadaniu: skille, CLAUDE.md, hooki i MCP z katalogu
    // konfiguracyjnego. Bez tego SDK działa w trybie izolacji i nie czyta
    // z dysku nic.
    settingSources: ['user', 'project', 'local'],
    env: childEnv(),
  };
}
