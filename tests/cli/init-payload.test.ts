import { describe, expect, it } from 'vitest';
import { summarizeInitPayload } from '@/lib/services/cli/init-payload';

const raw = {
  type: 'system',
  subtype: 'init',
  session_id: 'sess-1',
  cwd: '/data/projects/proj-1',
  model: 'claude-sonnet-5',
  permissionMode: 'bypassPermissions',
  tools: ['Read', 'Write', 'Bash'],
  skills: ['debug', 'simplify'],
  agents: ['general-purpose', 'Explore'],
  mcp_servers: [{ name: 'codebase-memory-mcp', status: 'connected' }],
  plugins: [{ name: 'demo', path: '/x' }],
} as never;

describe('summarizeInitPayload', () => {
  it('wyciąga pola diagnostyczne z wiadomości init', () => {
    const summary = summarizeInitPayload(raw);
    expect(summary.sessionId).toBe('sess-1');
    expect(summary.cwd).toBe('/data/projects/proj-1');
    expect(summary.toolCount).toBe(3);
    expect(summary.skills).toEqual(['debug', 'simplify']);
    expect(summary.agents).toEqual(['general-purpose', 'Explore']);
    expect(summary.mcpServers).toEqual([{ name: 'codebase-memory-mcp', status: 'connected' }]);
    expect(summary.plugins).toEqual(['demo']);
  });

  it('znosi brakujące pola opcjonalne', () => {
    const summary = summarizeInitPayload({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-2',
      cwd: '/tmp',
      model: 'claude-sonnet-5',
      permissionMode: 'default',
      tools: [],
    } as never);
    expect(summary.skills).toEqual([]);
    expect(summary.agents).toEqual([]);
    expect(summary.mcpServers).toEqual([]);
    expect(summary.plugins).toEqual([]);
  });
});
