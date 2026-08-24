import type { SDKSystemMessage } from '@anthropic-ai/claude-agent-sdk';

export interface InitSummary {
  sessionId: string;
  cwd: string;
  model: string;
  permissionMode: string;
  claudeCodeVersion: string; // Task 20: czy kontener ma tę samą wersję CLI co terminal
  apiKeySource: string; // Task 20: czy poświadczenia przyszły z mountu, czy z klucza
  toolCount: number;
  skills: string[];
  slashCommands: string[]; // Task 13/14: dowód równorzędny ze skills — z dysku czy wbudowane
  agents: string[];
  mcpServers: { name: string; status: string }[];
  plugins: string[];
}

/**
 * SDK raportuje w wiadomości init faktyczną konfigurację sesji. Bez tego
 * jedynym źródłem wiedzy o katalogu roboczym i widocznych skillach jest
 * czytanie typów — a te nie mówią, co naprawdę weszło z dysku.
 */
export function summarizeInitPayload(message: SDKSystemMessage): InitSummary {
  return {
    sessionId: message.session_id,
    cwd: message.cwd,
    model: message.model,
    permissionMode: message.permissionMode,
    claudeCodeVersion: message.claude_code_version,
    apiKeySource: message.apiKeySource,
    toolCount: (message.tools ?? []).length,
    skills: message.skills ?? [],
    slashCommands: message.slash_commands ?? [],
    agents: message.agents ?? [],
    mcpServers: message.mcp_servers ?? [],
    plugins: (message.plugins ?? []).map((plugin) => plugin.name),
  };
}
