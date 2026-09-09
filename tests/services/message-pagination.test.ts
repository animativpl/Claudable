import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();

vi.mock('@/lib/db/client', () => ({
  prisma: {
    message: { findMany },
  },
}));

beforeEach(() => {
  findMany.mockReset();
});

const fixtureRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1',
  projectId: 'proj1',
  conversationId: null,
  sessionId: null,
  role: 'user',
  content: 'hello',
  messageType: 'chat',
  metadataJson: null,
  parentMessageId: null,
  cliSource: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  requestId: null,
  ...overrides,
});

describe('getMessagesByProjectId — paginacja kursorowa', () => {
  it('domyślnie sortuje rosnąco (createdAt, id) i nie filtruje', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');

    await getMessagesByProjectId('proj1', 50);

    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj1' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
  });

  it('order=desc bez before zwraca najnowsze wiadomości malejąco', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');

    await getMessagesByProjectId('proj1', 200, { order: 'desc' });

    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
  });

  it('order=desc z before filtruje po złożonym kursorze (createdAt, id) malejąco', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');
    const before = { createdAt: new Date('2026-01-05T00:00:00.000Z'), id: 'm50' };

    await getMessagesByProjectId('proj1', 100, { order: 'desc', before });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'proj1',
        OR: [
          { createdAt: { lt: before.createdAt } },
          { createdAt: before.createdAt, id: { lt: before.id } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  });

  it('order=asc z before filtruje po złożonym kursorze (createdAt, id) rosnąco', async () => {
    findMany.mockResolvedValueOnce([fixtureRow()]);
    const { getMessagesByProjectId } = await import('@/lib/services/message');
    const before = { createdAt: new Date('2026-01-05T00:00:00.000Z'), id: 'm50' };

    await getMessagesByProjectId('proj1', 100, { order: 'asc', before });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'proj1',
        OR: [
          { createdAt: { gt: before.createdAt } },
          { createdAt: before.createdAt, id: { gt: before.id } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  });
});
