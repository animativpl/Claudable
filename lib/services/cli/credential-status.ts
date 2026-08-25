import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveClaudeConfigDir } from './claude-config-dir';

export interface CredentialStatus {
  configDir: string;
  hasCredentials: boolean;
  source: 'oauth' | 'api-key' | 'none';
}

/**
 * SDK ma własny bundlowany cli.js, więc obecność binarki `claude` na PATH
 * nic nie mówi o gotowości agenta. Znaczenie ma to, czy są poświadczenia.
 */
export async function describeCredentialStatus(): Promise<CredentialStatus> {
  const configDir = resolveClaudeConfigDir();

  let hasOauth = false;
  try {
    await fs.access(path.join(configDir, '.credentials.json'));
    hasOauth = true;
  } catch {
    hasOauth = false;
  }

  if (hasOauth) {
    return { configDir, hasCredentials: true, source: 'oauth' };
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { configDir, hasCredentials: true, source: 'api-key' };
  }

  return { configDir, hasCredentials: false, source: 'none' };
}
