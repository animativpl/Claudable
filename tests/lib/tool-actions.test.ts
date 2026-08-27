import { describe, expect, it } from 'vitest';
import { TOOL_NAME_ACTION_MAP, extractPathFromInput, inferActionFromToolName } from '@/lib/tool-actions';

describe('lib/tool-actions — TodoWrite mislabeling', () => {
  it('mapuje TodoWrite na Generated, nie Created', () => {
    expect(inferActionFromToolName('TodoWrite')).toBe('Generated');
    expect(TOOL_NAME_ACTION_MAP['todowrite']).toBe('Generated');
  });
});

describe('lib/tool-actions — Task tool name field', () => {
  it('nie myli pola name (nazwa subagenta) ze ścieżką pliku', () => {
    const result = extractPathFromInput({ name: 'code-reviewer', prompt: 'review the diff' });
    expect(result).toBeUndefined();
  });

  it('nadal wyciąga realną ścieżkę pliku dla narzędzi plikowych', () => {
    expect(extractPathFromInput({ file_path: 'app/page.tsx' })).toBe('app/page.tsx');
  });
});

describe('lib/tool-actions — Task-tool subagent action variants map to Generated', () => {
  it.each(['task_create', 'taskcreate', 'task_update', 'taskupdate', 'task_get', 'taskget', 'task_list', 'tasklist'])(
    '%s maps to Generated',
    (key) => {
      expect(TOOL_NAME_ACTION_MAP[key]).toBe('Generated');
    }
  );
});
