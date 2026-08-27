import { describe, expect, it } from 'vitest';
import { TOOL_NAME_ACTION_MAP } from '@/lib/services/cli/claude';

describe('TOOL_NAME_ACTION_MAP — Task tools (Agent SDK 0.3, replaces TodoWrite)', () => {
  it('mapuje warianty TaskCreate na Generated, tak jak dawne TodoWrite', () => {
    expect(TOOL_NAME_ACTION_MAP['task_create']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['taskcreate']).toBe('Generated');
  });

  it('mapuje warianty TaskUpdate na Generated', () => {
    expect(TOOL_NAME_ACTION_MAP['task_update']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['taskupdate']).toBe('Generated');
  });

  it('mapuje warianty TaskList i TaskGet na Generated', () => {
    expect(TOOL_NAME_ACTION_MAP['task_list']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['tasklist']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['task_get']).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['taskget']).toBe('Generated');
  });
});
