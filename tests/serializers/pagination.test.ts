import { describe, expect, it } from 'vitest';
import { getPageCursor } from '@/lib/serializers/client/pagination';

describe('getPageCursor', () => {
  it('zwraca null dla pustej listy', () => {
    expect(getPageCursor([])).toBeNull();
  });

  it('zwraca (createdAt, id) ostatniego elementu partii', () => {
    // Task 1's route always returns batches pre-sorted by (createdAt, id)
    // in the requested order — for order=desc, the last element is the
    // oldest row, exactly the cursor the next "load older" call needs.
    const messages = [
      { createdAt: '2026-01-05T00:00:00.000Z', id: 'c' },
      { createdAt: '2026-01-03T00:00:00.000Z', id: 'b' },
      { createdAt: '2026-01-01T00:00:00.000Z', id: 'a' },
    ];
    expect(getPageCursor(messages)).toEqual({ createdAt: '2026-01-01T00:00:00.000Z', id: 'a' });
  });

  it('zwraca null, gdy ostatniemu elementowi brakuje createdAt lub id', () => {
    expect(getPageCursor([{ createdAt: '2026-01-01T00:00:00.000Z' }])).toBeNull();
    expect(getPageCursor([{ id: 'a' }])).toBeNull();
  });
});
