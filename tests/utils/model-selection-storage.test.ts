import { describe, expect, it, beforeEach } from 'vitest';
import { readStoredModel, writeStoredModel } from '@/lib/utils/model-selection-storage';

describe('lib/utils/model-selection-storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('zwraca null, gdy nic nie zapisano', () => {
    expect(readStoredModel()).toBeNull();
  });

  it('zapisuje i odczytuje wybrany model', () => {
    writeStoredModel('claude-opus-5');
    expect(readStoredModel()).toBe('claude-opus-5');
  });
});
