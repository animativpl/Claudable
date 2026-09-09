import { describe, expect, it } from 'vitest';
import { shouldStickToBottom } from '@/lib/utils/scroll';

describe('shouldStickToBottom', () => {
  it('true, gdy kontener jest przewinięty blisko dołu', () => {
    // scrollHeight 1000, scrollTop 900, clientHeight 90 -> 10px od dołu
    expect(shouldStickToBottom(1000, 900, 90)).toBe(true);
  });

  it('false, gdy użytkownik przewinął daleko w górę', () => {
    expect(shouldStickToBottom(1000, 100, 200)).toBe(false);
  });

  it('respektuje niestandardowy threshold', () => {
    expect(shouldStickToBottom(1000, 700, 200, 150)).toBe(true);
    expect(shouldStickToBottom(1000, 700, 200, 50)).toBe(false);
  });
});
