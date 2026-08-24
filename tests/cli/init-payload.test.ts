import { describe, expect, it } from 'vitest';
import { summarizeInitPayload } from '@/lib/services/cli/init-payload';

const raw = {
  type: 'system',
  subtype: 'init',
  session_id: 'sess-1',
  cwd: '/data/projects/proj-1',
  model: 'claude-sonnet-5',
  permissionMode: 'bypassPermissions',
  claude_code_version: '2.1.0',
  apiKeySource: 'ANTHROPIC_API_KEY',
  tools: ['Read', 'Write', 'Bash'],
  skills: ['debug', 'simplify'],
  slash_commands: ['review', 'simplify'],
  agents: ['general-purpose', 'Explore'],
  mcp_servers: [{ name: 'codebase-memory-mcp', status: 'connected' }],
  plugins: [{ name: 'demo', path: '/x' }],
} as never;

describe('summarizeInitPayload', () => {
  it('wyciąga pola diagnostyczne z wiadomości init', () => {
    const summary = summarizeInitPayload(raw);
    expect(summary.sessionId).toBe('sess-1');
    expect(summary.cwd).toBe('/data/projects/proj-1');
    expect(summary.claudeCodeVersion).toBe('2.1.0');
    expect(summary.apiKeySource).toBe('ANTHROPIC_API_KEY');
    expect(summary.toolCount).toBe(3);
    expect(summary.skills).toEqual(['debug', 'simplify']);
    expect(summary.slashCommands).toEqual(['review', 'simplify']);
    expect(summary.agents).toEqual(['general-purpose', 'Explore']);
    expect(summary.mcpServers).toEqual([{ name: 'codebase-memory-mcp', status: 'connected' }]);
    expect(summary.plugins).toEqual(['demo']);
  });

  it('znosi brakujące agents — jedyne pole opcjonalne w kontrakcie SDK obok betas', () => {
    // W SDKSystemMessage (sdk.d.ts) tylko `agents?` i `betas?` są opcjonalne;
    // tools/skills/slash_commands/mcp_servers/plugins/claude_code_version/apiKeySource
    // są wymagane i zawsze obecne w realnym payloadzie z subprocessu.
    const summary = summarizeInitPayload({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-2',
      cwd: '/tmp',
      model: 'claude-sonnet-5',
      permissionMode: 'default',
      claude_code_version: '2.1.0',
      apiKeySource: 'ANTHROPIC_API_KEY',
      tools: [],
      skills: [],
      slash_commands: [],
      mcp_servers: [],
      plugins: [],
    } as never);
    expect(summary.agents).toEqual([]);
  });

  it('broni się przed niezgodnym z kontraktem payloadem z subprocessu (pola formalnie wymagane, ale brakujące)', () => {
    // Ten test nie odpowiada żadnemu prawdziwemu payloadowi SDK — tools, skills,
    // slash_commands, mcp_servers i plugins są w typie wymagane. Pokrywa wyłącznie
    // obronę `?? []` w implementacji na wypadek zdeformowanego payloadu z subprocessu,
    // nie zachowanie kontraktowe.
    const summary = summarizeInitPayload({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-3',
      cwd: '/tmp',
      model: 'claude-sonnet-5',
      permissionMode: 'default',
      claude_code_version: '2.1.0',
      apiKeySource: 'ANTHROPIC_API_KEY',
    } as never);
    expect(summary.toolCount).toBe(0);
    expect(summary.skills).toEqual([]);
    expect(summary.slashCommands).toEqual([]);
    expect(summary.agents).toEqual([]);
    expect(summary.mcpServers).toEqual([]);
    expect(summary.plugins).toEqual([]);
  });
});
