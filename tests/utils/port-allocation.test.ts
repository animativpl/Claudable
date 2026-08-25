import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { findAvailablePort } from '@/lib/utils/ports';

// Porty testowe leżą CELOWO poniżej `ip_local_port_range` (na tym hoście
// 32768–60999). W zakresie efemerycznym jądro przydziela porty dowolnemu
// połączeniu wychodzącemu, więc `occupy()` potrafiło dostać EADDRINUSE od
// procesu niezwiązanego z testem i przewrócić go losowo.
const FREE_RANGE_START = 18_500;
const FREE_RANGE_END = 18_503;
const TAKEN_PORT = 18_510;
const NEXT_PORT = 18_511;

const servers: net.Server[] = [];

const occupy = (port: number) =>
  new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      servers.push(server);
      resolve();
    });
  });

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((r) => server.close(r))));
});

describe('findAvailablePort', () => {
  it('zwraca wolny port z zakresu', async () => {
    const port = await findAvailablePort(FREE_RANGE_START, FREE_RANGE_END);
    expect(port).toBeGreaterThanOrEqual(FREE_RANGE_START);
    expect(port).toBeLessThanOrEqual(FREE_RANGE_END);
  });

  it('pomija port zajęty', async () => {
    await occupy(TAKEN_PORT);
    const port = await findAvailablePort(TAKEN_PORT, NEXT_PORT);
    expect(port).toBe(NEXT_PORT);
  });

  // Wyczerpanie zakresu sprawdza `ports-default-range.test.ts`: zajmuje realne
  // 3100–3131 i żąda błędu nazywającego koniec domyślnego zakresu. Kopia na
  // dwóch portach atrapach dowodziła mniej, więc jej tu nie ma.
});
