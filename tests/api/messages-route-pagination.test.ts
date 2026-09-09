import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getMessagesByProjectId = vi.fn();

vi.mock('@/lib/services/message', () => ({
  getMessagesByProjectId,
  createMessage: vi.fn(),
  deleteMessagesByProjectId: vi.fn(),
}));

const fixtureMessage = (overrides: Partial<Record<string, unknown>> = {}) => ({
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
  createdAt: new Date('2026-01-05T00:00:00.000Z'),
  updatedAt: new Date('2026-01-05T00:00:00.000Z'),
  requestId: null,
  ...overrides,
});

const callGet = async (query: string) => {
  const { GET } = await import('@/app/api/chat/[project_id]/messages/route');
  const request = new NextRequest(`http://localhost/api/chat/proj1/messages${query}`);
  return GET(request, { params: Promise.resolve({ project_id: 'proj1' }) });
};

describe('GET /api/chat/[project_id]/messages — paginacja kursorowa', () => {
  it('domyślnie przekazuje order=asc i brak kursora', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);

    await callGet('?limit=50');

    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 50, {
      order: 'asc',
      before: undefined,
    });
  });

  it('order=desc&before=<iso>&beforeId=<id> przekazuje złożony kursor', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);
    const iso = '2026-01-05T00:00:00.000Z';

    await callGet(`?limit=100&order=desc&before=${encodeURIComponent(iso)}&beforeId=m50`);

    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 100, {
      order: 'desc',
      before: { createdAt: new Date(iso), id: 'm50' },
    });
  });

  it('before bez beforeId (albo odwrotnie) jest ignorowany zamiast wywalać żądanie', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);

    const response = await callGet('?limit=50&order=desc&before=2026-01-05T00:00:00.000Z');

    expect(response.status).toBe(200);
    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 50, {
      order: 'desc',
      before: undefined,
    });
  });

  it('nieprawidłowy before jest ignorowany zamiast wywalać żądanie', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);

    const response = await callGet('?limit=50&order=desc&before=not-a-date&beforeId=m50');

    expect(response.status).toBe(200);
    expect(getMessagesByProjectId).toHaveBeenCalledWith('proj1', 50, {
      order: 'desc',
      before: undefined,
    });
  });

  it('hasMore=true gdy strona jest pełna, false gdy niepełna', async () => {
    getMessagesByProjectId
      .mockReset()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => fixtureMessage({ id: `m${i}` })));
    const full = await callGet('?limit=100&order=desc');
    expect((await full.json()).pagination.hasMore).toBe(true);

    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);
    const partial = await callGet('?limit=100&order=desc');
    expect((await partial.json()).pagination.hasMore).toBe(false);
  });

  it('odpowiedź nie zawiera już totalCount', async () => {
    getMessagesByProjectId.mockReset().mockResolvedValueOnce([fixtureMessage()]);

    const response = await callGet('?limit=50');
    const body = await response.json();

    expect(body.totalCount).toBeUndefined();
  });
});
