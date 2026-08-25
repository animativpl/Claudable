import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { findAvailablePort } from '@/lib/utils/ports';

// Global Constraint: zakres portów preview to 3100–3131 (32 sloty), ta sama
// wartość w każdym miejscu, które ją zna. `lib/utils/ports.ts` miał 3100–3999,
// czyli 900 slotów — obraz eksponuje `3100-3131`, więc każdy port powyżej 3131
// przydzielony przez ten fallback jest z zewnątrz kontenera nieosiągalny.
//
// Test dowodzi końca zakresu przez wyczerpanie: zajmuje 3100–3131 i oczekuje
// błędu, który ten koniec nazywa. Przy zakresie do 3999 funkcja zamiast błędu
// zwraca 3132.
const RANGE_START = 3_100;
const RANGE_END = 3_131;

const servers: net.Server[] = [];
const ENV_KEYS = ['PORT', 'PREVIEW_PORT_START', 'PREVIEW_PORT_END'] as const;
const savedEnv = new Map<string, string | undefined>();

// EADDRINUSE jest tu sukcesem: port zajmuje ktoś inny, a nam chodzi wyłącznie
// o to, żeby żaden port z zakresu nie był wolny. Bez tego test przewraca się
// na hoście, na którym akurat działa preview.
function occupy(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve();
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      servers.push(server);
      resolve();
    });
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

describe('findAvailablePort: domyślny zakres', () => {
  it('kończy się na 3131, a nie na 3999', async () => {
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }

    for (let port = RANGE_START; port <= RANGE_END; port += 1) {
      // eslint-disable-next-line no-await-in-loop
      await occupy(port);
    }

    await expect(findAvailablePort()).rejects.toThrow(
      `Unable to find an available port between ${RANGE_START} and ${RANGE_END}`
    );
  });
});
