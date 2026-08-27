import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('lib/crypto — ENCRYPTION_KEY handling', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it('nie rzuca przy samym imporcie, gdy ENCRYPTION_KEY nie jest ustawiony', async () => {
    delete process.env.ENCRYPTION_KEY;
    await expect(import('@/lib/crypto')).resolves.toBeDefined();
  });

  it('rzuca dopiero przy realnym użyciu encrypt/decrypt, gdy klucza brak', async () => {
    delete process.env.ENCRYPTION_KEY;
    const { encrypt } = await import('@/lib/crypto');
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
  });

  it('decrypt też rzuca, gdy klucza brak', async () => {
    delete process.env.ENCRYPTION_KEY;
    const { decrypt } = await import('@/lib/crypto');
    expect(() => decrypt('00:00')).toThrow(/ENCRYPTION_KEY/);
  });

  it('szyfruje i odszyfrowuje poprawnie, gdy ENCRYPTION_KEY jest ustawiony', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const plaintext = 'a secret value';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });
});
