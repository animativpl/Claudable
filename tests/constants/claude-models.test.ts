import { describe, expect, it } from 'vitest';
import {
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_MODEL_DEFINITIONS,
  getClaudeModelDisplayName,
  normalizeClaudeModelId,
} from '@/lib/constants/claudeModels';

describe('lista modeli Claude', () => {
  it('zawiera dokładnie trzy aktualne modele', () => {
    expect(CLAUDE_MODEL_DEFINITIONS.map((d) => d.id)).toEqual([
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
  });

  it('domyślnym modelem jest Sonnet 5', () => {
    expect(CLAUDE_DEFAULT_MODEL).toBe('claude-sonnet-5');
  });

  it('żadne id nie nosi sufiksu daty', () => {
    for (const definition of CLAUDE_MODEL_DEFINITIONS) {
      expect(definition.id).not.toMatch(/-\d{8}$/);
    }
  });
});

describe('normalizeClaudeModelId', () => {
  it('rozwiązuje skróty', () => {
    expect(normalizeClaudeModelId('opus')).toBe('claude-opus-5');
    expect(normalizeClaudeModelId('sonnet')).toBe('claude-sonnet-5');
    expect(normalizeClaudeModelId('haiku')).toBe('claude-haiku-4-5');
  });

  it('podnosi generację 4.6 na piątkę', () => {
    expect(normalizeClaudeModelId('claude-opus-4-6')).toBe('claude-opus-5');
    expect(normalizeClaudeModelId('claude-sonnet-4-6')).toBe('claude-sonnet-5');
  });

  it('sonnet-4-6 jest jawnym aliasem sonnet-5, nie tylko wynikiem defaultu', () => {
    // Sonnet 5 jest jednocześnie celem tego aliasu i wartością CLAUDE_DEFAULT_MODEL,
    // więc sama normalizeClaudeModelId('claude-sonnet-4-6') nie odróżnia "rozwiązane
    // przez alias" od "spadło na default". Ta asercja sprawdza samą definicję.
    expect(
      CLAUDE_MODEL_DEFINITIONS.find((d) => d.id === 'claude-sonnet-5')!.aliases
    ).toContain('claude-sonnet-4-6');
  });

  it('opus-4-6 jest jawnym aliasem opus-5, nie tylko wynikiem defaultu', () => {
    // Analogicznie do sonnet-4-6: gdyby CLAUDE_DEFAULT_MODEL kiedyś wskazywał na
    // claude-opus-5, sama normalizeClaudeModelId('claude-opus-4-6') przestałaby
    // odróżniać "rozwiązane przez alias" od "spadło na default". Ta asercja
    // sprawdza samą definicję, niezależnie od aktualnej wartości defaultu.
    expect(
      CLAUDE_MODEL_DEFINITIONS.find((d) => d.id === 'claude-opus-5')!.aliases
    ).toContain('claude-opus-4-6');
  });

  it('przyjmuje starą datowaną formę Haiku', () => {
    expect(normalizeClaudeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
  });

  it('datowana forma Haiku jest jawnym aliasem haiku-4-5, nie tylko wynikiem defaultu', () => {
    // Analogicznie do sonnet-4-6: gdyby CLAUDE_DEFAULT_MODEL kiedyś wskazywał na
    // claude-haiku-4-5, sama normalizeClaudeModelId('claude-haiku-4-5-20251001')
    // przestałaby odróżniać "rozwiązane przez alias" od "spadło na default". Ta
    // asercja sprawdza samą definicję, niezależnie od aktualnej wartości defaultu.
    expect(
      CLAUDE_MODEL_DEFINITIONS.find((d) => d.id === 'claude-haiku-4-5')!.aliases
    ).toContain('claude-haiku-4-5-20251001');
  });

  it('schodzi do domyślnego przy braku i przy śmieciu', () => {
    expect(normalizeClaudeModelId(undefined)).toBe('claude-sonnet-5');
    expect(normalizeClaudeModelId('gpt-4')).toBe('claude-sonnet-5');
  });
});

describe('getClaudeModelDisplayName', () => {
  it('zwraca nazwy czytelne dla człowieka', () => {
    expect(getClaudeModelDisplayName('claude-sonnet-5')).toBe('Claude Sonnet 5');
    expect(getClaudeModelDisplayName('claude-opus-5')).toBe('Claude Opus 5');
  });
});
