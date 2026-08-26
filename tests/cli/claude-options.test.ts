import { describe, expect, it } from 'vitest';
import { buildClaudeQueryOptions } from '@/lib/services/cli/claude-options';
import { withEnv } from '../services/support/claude-session-env';

describe('buildClaudeQueryOptions', () => {
  const input = {
    projectPath: '/data/projects/proj-1',
    model: 'claude-sonnet-5',
  };

  it('ustawia cwd na katalog projektu, nie workingDirectory', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.cwd).toBe('/data/projects/proj-1');
    expect(options).not.toHaveProperty('workingDirectory');
  });

  it('domyka bypassPermissions wymaganą flagą', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
  });

  it('przekazuje model i pomija resume, gdy nie ma sesji', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.model).toBe('claude-sonnet-5');
    expect(options.resume).toBeUndefined();
  });

  it('przekazuje resume, gdy sesja jest podana', () => {
    const options = buildClaudeQueryOptions({ ...input, sessionId: 'sess-9' });
    expect(options.resume).toBe('sess-9');
  });

  it('nie ustawia systemPrompt — prompt pochodzi z katalogu .claude', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.systemPrompt).toBeUndefined();
  });

  it('włącza wszystkie źródła ustawień z dysku', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
  });

  it('odcina wszystkie zmienne sesji Claude Code po prefiksie, zachowując allowlistę', () => {
    // Wyliczanie zawiodło już pięć razy w tym runie (patrz dispatch Task 13
    // fixup) — realne środowisko sesji ma więcej zmiennych CLAUDE_* niż
    // pierwotna lista trzech. Scrub musi łapać cały prefiks, nie znane nazwy.
    const sessionVars = [
      'CLAUDECODE',
      'CLAUDE_CODE_EXECPATH',
      'CLAUDE_CODE_ATTRIBUTION_HEADER',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_CODE_ENABLE_TELEMETRY',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_EFFORT',
      'CLAUDE_CODE_SSE_PORT',
      'CLAUDE_PID',
    ];
    const previous: Record<string, string | undefined> = {};
    for (const key of sessionVars) {
      previous[key] = process.env[key];
      process.env[key] = 'x';
    }
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const previousOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CONFIG_DIR = '/mnt/claude-home';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-oauth-test';
    try {
      const options = buildClaudeQueryOptions(input);
      expect(options.env).toBeDefined();
      for (const key of sessionVars) {
        expect(options.env).not.toHaveProperty(key);
      }
      // Allowlista musi przeżyć: bez CLAUDE_CONFIG_DIR agent nie widzi
      // zamontowanego katalogu konfiguracyjnego i całe zadanie nie działa.
      expect(options.env?.CLAUDE_CONFIG_DIR).toBe('/mnt/claude-home');
      expect(options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-oauth-test');
      // reszta środowiska (nie-Claude) musi przejść nietknięta
      expect(options.env?.PATH).toBe(process.env.PATH);
    } finally {
      for (const key of sessionVars) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      if (previousOauthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOauthToken;
    }
  });

  it('odcina NODE_ENV platformy i prywatną konfigurację Nexta ze środowiska agenta', () => {
    // Recenzent Task 19 przechwycił żywy proces agenta w kontenerze: dostawał
    // NODE_ENV=production z obrazu, mimo że ścieżka preview ten sam scrub już
    // miała. Agent instaluje pakiety i uruchamia buildy w projekcie
    // użytkownika przez Bash — pod NODE_ENV=production `npm install`
    // odpalony przez agenta pomija devDependencies, dokładnie ten sam objaw,
    // dla którego scrub w preview.ts powstał, tylko na drugiej trasie.
    const env = withEnv(
      {
        NODE_ENV: 'production',
        __NEXT_PRIVATE_STANDALONE_CONFIG: '{"distDir":"./.next"}',
        ORDINARY_VAR: 'keep-me',
      },
      () => buildClaudeQueryOptions(input).env
    );

    expect(env).not.toHaveProperty('NODE_ENV');
    expect(env).not.toHaveProperty('__NEXT_PRIVATE_STANDALONE_CONFIG');
    // Drugi kierunek: reszta środowiska, w tym zmienne niezwiązane z
    // platformą, ma przeżyć nietknięta.
    expect(env?.ORDINARY_VAR).toBe('keep-me');
  });

  it('przekazuje wczytanych subagentów', () => {
    const agents = { reviewer: { description: 'd', prompt: 'p' } };
    const options = buildClaudeQueryOptions({ ...input, agents });
    expect(options.agents).toEqual(agents);
  });

  it('pomija pole agents, gdy nic nie wczytano', () => {
    expect(buildClaudeQueryOptions(input).agents).toBeUndefined();
    expect(buildClaudeQueryOptions({ ...input, agents: {} }).agents).toBeUndefined();
  });

  it('przekazuje wczytane serwery MCP scope user', () => {
    const mcpServers = { figma: { command: 'npx', args: ['figma-console-mcp@latest'] } };
    const options = buildClaudeQueryOptions({ ...input, mcpServers });
    expect(options.mcpServers).toEqual(mcpServers);
  });

  it('pomija pole mcpServers, gdy nic nie wczytano', () => {
    expect(buildClaudeQueryOptions(input).mcpServers).toBeUndefined();
    expect(buildClaudeQueryOptions({ ...input, mcpServers: {} }).mcpServers).toBeUndefined();
  });
});
