import { describe, expect, it, vi } from 'vitest';

const updateMany = vi.fn();

vi.mock('@/lib/db/client', () => ({
  prisma: {
    project: { updateMany },
  },
}));

describe('reconcileStalePreviews', () => {
  it('wyzerowuje previewUrl/previewPort i status dla projektów z zapisanym previewUrl', async () => {
    updateMany.mockResolvedValueOnce({ count: 2 });
    const { reconcileStalePreviews } = await import('@/lib/services/preview');

    const count = await reconcileStalePreviews();

    expect(count).toBe(2);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ NOT: { previewUrl: null } });
    expect(args.data).toEqual({
      previewUrl: null,
      previewPort: null,
      status: 'idle',
    });
  });

  it('zwraca zero i nie wybucha, gdy zapis padnie (np. baza jeszcze nie istnieje)', async () => {
    updateMany.mockRejectedValueOnce(new Error('no such table: projects'));
    const { reconcileStalePreviews } = await import('@/lib/services/preview');

    await expect(reconcileStalePreviews()).resolves.toBe(0);
  });
});
