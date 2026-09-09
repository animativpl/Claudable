import { describe, expect, it, beforeEach } from 'vitest';
import { readShowToolCalls, writeShowToolCalls } from '@/lib/utils/tool-visibility-storage';

describe('lib/utils/tool-visibility-storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('domyślnie zwraca false (wywołania narzędzi ukryte)', () => {
    expect(readShowToolCalls()).toBe(false);
  });

  it('zapisuje i odczytuje wybraną wartość', () => {
    writeShowToolCalls(true);
    expect(readShowToolCalls()).toBe(true);

    writeShowToolCalls(false);
    expect(readShowToolCalls()).toBe(false);
  });
});
