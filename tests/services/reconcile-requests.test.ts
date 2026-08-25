import { describe, expect, it, vi } from 'vitest';
import { RECONCILABLE_STATUSES, reconcileStaleRequests } from '@/lib/services/user-requests';

describe('reconcileStaleRequests', () => {
  it('oznacza wszystkie niedomknięte statusy jako failed', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const count = await reconcileStaleRequests({ userRequest: { updateMany } });

    expect(count).toBe(3);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: { in: RECONCILABLE_STATUSES } });
    expect(args.data.status).toBe('failed');
    expect(args.data.errorMessage).toMatch(/restart/i);
    expect(args.data.completedAt).toBeInstanceOf(Date);
  });

  it('zwraca zero i nie wybucha, gdy zapis padnie', async () => {
    const updateMany = vi.fn().mockRejectedValue(new Error('db locked'));
    await expect(reconcileStaleRequests({ userRequest: { updateMany } })).resolves.toBe(0);
  });

  it('nie obejmuje statusów terminalnych', () => {
    expect(RECONCILABLE_STATUSES).not.toContain('completed');
    expect(RECONCILABLE_STATUSES).not.toContain('failed');
  });
});
