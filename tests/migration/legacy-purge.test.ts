import { describe, expect, it, vi } from 'vitest';
import { purgeLegacyProviders } from '../../scripts/migrate-drop-legacy.js';

type Row = { provider: string };

/** Minimalna atrapa tabeli: trzyma wiersze w pamięci i realizuje deleteMany. */
const fakeTable = (rows: Row[]) => ({
  async deleteMany({ where }: { where: { provider: { in: string[] } } }) {
    const before = rows.length;
    const kept = rows.filter((row) => !where.provider.in.includes(row.provider));
    rows.length = 0;
    rows.push(...kept);
    return { count: before - rows.length };
  },
});

describe('purgeLegacyProviders', () => {
  it('czyści obie tabele, zostawiając GitHuba w każdej', async () => {
    const connections = [{ provider: 'github' }, { provider: 'vercel' }, { provider: 'supabase' }];
    const tokens = [{ provider: 'vercel' }, { provider: 'github' }];

    const removed = await purgeLegacyProviders({
      projectServiceConnection: fakeTable(connections),
      serviceToken: fakeTable(tokens),
    });

    expect(removed).toEqual({ connections: 2, tokens: 1 });
    expect(connections).toEqual([{ provider: 'github' }]);
    expect(tokens).toEqual([{ provider: 'github' }]);
  });

  it('nie rusza tabeli bez starych providerów', async () => {
    const connections = [{ provider: 'github' }];
    const tokens = [{ provider: 'github' }];
    const removed = await purgeLegacyProviders({
      projectServiceConnection: fakeTable(connections),
      serviceToken: fakeTable(tokens),
    });
    expect(removed).toEqual({ connections: 0, tokens: 0 });
    expect(connections).toEqual([{ provider: 'github' }]);
    expect(tokens).toEqual([{ provider: 'github' }]);
  });

  it('nie obejmuje githuba w liście usuwanych', async () => {
    // Regresja: gdyby ktoś dopisał 'github' do LEGACY_PROVIDERS, ten test padnie.
    const tokens = [{ provider: 'github' }];
    await purgeLegacyProviders({
      projectServiceConnection: fakeTable([]),
      serviceToken: fakeTable(tokens),
    });
    expect(tokens).toHaveLength(1);
  });
});
