import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClaudeConfigDir } from '@/lib/services/cli/claude-config-dir';

const original = process.env.CLAUDE_CONFIG_DIR;

afterEach(() => {
  if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = original;
});

describe('resolveClaudeConfigDir', () => {
  it('honoruje CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = '/mnt/claude-home';
    expect(resolveClaudeConfigDir()).toBe('/mnt/claude-home');
  });

  it('schodzi do ~/.claude', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(resolveClaudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });

  it('ignoruje pustą wartość', () => {
    process.env.CLAUDE_CONFIG_DIR = '   ';
    expect(resolveClaudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });
});
