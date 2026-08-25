import os from 'node:os';
import path from 'node:path';

/**
 * Katalog, z którego agent bierze ustawienia, skille, hooki, MCP i CLAUDE.md
 * — dokładnie ten, którego użyłby `claude` w terminalu. W kontenerze wskazuje
 * na zamontowany wolumen.
 */
export function resolveClaudeConfigDir(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) {
    return configured;
  }
  return path.join(os.homedir(), '.claude');
}
