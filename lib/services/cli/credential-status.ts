import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveClaudeConfigDir } from './claude-config-dir';

export interface CredentialStatus {
  configDir: string;
  hasCredentials: boolean;
  source: 'oauth-token' | 'credentials-file' | 'api-key' | 'none';
}

/**
 * SDK ma własny bundlowany cli.js, więc obecność binarki `claude` na PATH
 * nic nie mówi o gotowości agenta. Znaczenie ma to, czy są poświadczenia.
 *
 * Trzy żywe ścieżki uwierzytelnienia i ich kolejność:
 *
 * 1. CLAUDE_CODE_OAUTH_TOKEN — potwierdzone w `cli.js` SDK (funkcje `bx()`
 *    i `z4()`): obie sprawdzają tę zmienną środowiskową PRZED odczytem pliku
 *    `.credentials.json`, więc token env zawsze wygrywa z plikiem w tej samej
 *    rodzinie OAuth.
 * 2. .credentials.json (`credentials-file`) — login OAuth zapisany na dysku.
 * 3. ANTHROPIC_API_KEY — osobna, niezależna metoda; SDK nie ustala między nią
 *    a CLAUDE_CODE_OAUTH_TOKEN jednego liniowego pierwszeństwa (przy obu
 *    obecnych `cli.js` pokazuje ostrzeżenie o konflikcie zamiast po cichu
 *    wybierać). Trzymamy ją na końcu, bo tak było w dotychczasowej kolejności
 *    (plik/oauth przed kluczem) — to założenie, nie potwierdzony fakt SDK.
 */
export async function describeCredentialStatus(): Promise<CredentialStatus> {
  const configDir = resolveClaudeConfigDir();

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    return { configDir, hasCredentials: true, source: 'oauth-token' };
  }

  let hasCredentialsFile = false;
  try {
    await fs.access(path.join(configDir, '.credentials.json'));
    hasCredentialsFile = true;
  } catch {
    hasCredentialsFile = false;
  }

  if (hasCredentialsFile) {
    return { configDir, hasCredentials: true, source: 'credentials-file' };
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { configDir, hasCredentials: true, source: 'api-key' };
  }

  return { configDir, hasCredentials: false, source: 'none' };
}
