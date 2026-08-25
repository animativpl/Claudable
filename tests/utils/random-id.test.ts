import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomId } from '@/lib/utils/random-id';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('randomId', () => {
  it('zwraca inny identyfikator przy każdym wywołaniu', () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomId()));
    expect(ids.size).toBe(100);
  });

  it('używa crypto.randomUUID, gdy przeglądarka je udostępnia', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid' });
    expect(randomId()).toBe('fixed-uuid');
  });

  it('dokleja prefiks, gdy podany', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid' });
    expect(randomId('msg')).toBe('msg_fixed-uuid');
  });

  it('działa w niezabezpieczonym kontekście, gdzie randomUUID nie istnieje', () => {
    vi.stubGlobal('crypto', {});
    const id = randomId();
    expect(id.length).toBeGreaterThan(0);
    expect(randomId()).not.toBe(id);
  });

  it('prefiksuje także zejście awaryjne', () => {
    vi.stubGlobal('crypto', {});
    expect(randomId('msg')).toMatch(/^msg_.+/);
  });

  it('działa, gdy globalne crypto w ogóle nie istnieje', () => {
    vi.stubGlobal('crypto', undefined);
    expect(randomId('req').length).toBeGreaterThan('req_'.length);
  });
});
