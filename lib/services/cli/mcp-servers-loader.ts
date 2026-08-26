import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * Serwery MCP dodane `claude mcp add --scope user` (albo ręcznie w top-level
 * `mcpServers` w ~/.claude.json) czyta terminalowy `claude`, ale SDK ich nie
 * ładuje samo mimo `settingSources` — SDK podnosi z dysku wyłącznie
 * `.mcp.json` z roota projektu (scope project). Bez tego czytania sesja
 * agenta w Claudable widzi zero MCP servers, mimo że są globalnie
 * skonfigurowane i `claude` w terminalu ich używa. Ten sam problem i to samo
 * rozwiązanie co przy subagentach w agents-loader.ts.
 */
function isValidServerConfig(value: unknown): value is McpServerConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  if (typeof config.command === 'string') return true;
  if (
    (config.type === 'http' || config.type === 'sse') &&
    typeof config.url === 'string'
  ) {
    return true;
  }
  return false;
}

export async function loadUserScopeMcpServers(): Promise<Record<string, McpServerConfig>> {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');

  let raw: string;
  try {
    raw = await fs.readFile(claudeJsonPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      // Brak pliku (jeszcze nikt się nie zalogował / nie skonfigurował MCP) to
      // normalny stan, nie awaria.
      return {};
    }
    console.warn(`[McpServersLoader] Skipped ${claudeJsonPath}: could not read it`, error);
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`[McpServersLoader] Skipped ${claudeJsonPath}: invalid JSON`, error);
    return {};
  }

  const candidate = (parsed as Record<string, unknown> | null)?.mcpServers;
  if (!candidate || typeof candidate !== 'object') {
    return {};
  }

  const servers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(candidate as Record<string, unknown>)) {
    if (!isValidServerConfig(value)) {
      console.warn(`[McpServersLoader] Skipped server "${name}": unrecognized config shape`);
      continue;
    }
    servers[name] = value;
  }

  return servers;
}
