import type { SDKSystemMessage } from '@anthropic-ai/claude-agent-sdk';

export interface InitSummary {
  sessionId: string;
  cwd: string;
  model: string;
  permissionMode: string;
  toolCount: number;
  skills: string[];
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
    toolCount: (message.tools ?? []).length,
    skills: message.skills ?? [],
    agents: message.agents ?? [],
    mcpServers: message.mcp_servers ?? [],
    plugins: (message.plugins ?? []).map((plugin) => plugin.name),
  };
}
