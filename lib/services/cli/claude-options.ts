import type { AgentDefinition, McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';
import { scrubProcessEnv } from '@/lib/utils/env-scrub';

// Zmienne, które muszą przeżyć scrub mimo pasowania do prefiksu CLAUDE_:
// CLAUDE_CONFIG_DIR wskazuje zamontowany katalog konfiguracyjny (bez niego
// agent nie widzi skilli/CLAUDE.md), CLAUDE_CODE_OAUTH_TOKEN to poświadczenie
// agenta, jeśli kontener nim uwierzytelnia zamiast kluczem API.
const CLAUDE_ENV_ALLOWLIST = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN'] as const;

/**
 * Claudable osadza SDK, więc nie jest zagnieżdżoną sesją Claude Code — ale
 * odpalony z terminala, w którym Claude Code działa, dziedziczy jego zmienne
 * i SDK odmawia startu. Odcinamy cały prefiks zmiennych sesji dla procesu
 * potomnego zamiast wyliczać znane nazwy: sesja nadrzędna ma ich więcej niż
 * dało się przewidzieć z góry (IPC, telemetria, ID sesji), a wyliczanie
 * zostawia dokładnie te, których nie przewidzieliśmy.
 *
 * Agent uruchamia `npm install` i buildy w projekcie użytkownika przez swoje
 * narzędzie Bash — ta sama trasa wycieku `NODE_ENV`/`__NEXT_PRIVATE_*` co w
 * `preview.ts`, więc scrub jest ten sam współdzielony pomocnik, różniący się
 * tu tylko allowlistą.
 */
function childEnv(): NodeJS.ProcessEnv {
  return scrubProcessEnv(CLAUDE_ENV_ALLOWLIST);
}

export interface BuildClaudeOptionsInput {
  projectPath: string;
  model: string;
  sessionId?: string;
  agents?: Record<string, AgentDefinition>;
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Buduje opcje sesji agenta. Trzymane osobno od executeClaude, bo to jedyne
 * miejsce w aplikacji, w którym literówka w nazwie opcji jest niewidoczna
 * w czasie działania — więc musi być sprawdzalne typami i testem.
 */
export function buildClaudeQueryOptions(input: BuildClaudeOptionsInput): Options {
  return {
    cwd: input.projectPath,
    model: input.model,
    resume: input.sessionId,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: ['user', 'project', 'local'],
    env: childEnv(),
    ...(input.agents && Object.keys(input.agents).length > 0 ? { agents: input.agents } : {}),
    ...(input.mcpServers && Object.keys(input.mcpServers).length > 0
      ? { mcpServers: input.mcpServers }
      : {}),
  };
}
