import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { findAvailablePort } from '@/lib/utils/ports';

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
    const port = await findAvailablePort(34100, 34103);
    expect(port).toBeGreaterThanOrEqual(34100);
    expect(port).toBeLessThanOrEqual(34103);
  });

  it('pomija port zajęty', async () => {
    await occupy(34110);
    const port = await findAvailablePort(34110, 34111);
    expect(port).toBe(34111);
  });

  it('rzuca czytelny błąd, gdy cały zakres jest zajęty', async () => {
    await occupy(34120);
    await occupy(34121);
    await expect(findAvailablePort(34120, 34121)).rejects.toThrow(/34120|34121|range|available/i);
  });
});
