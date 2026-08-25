import { describe, expect, it } from 'vitest';
import { PREVIEW_CONFIG } from '@/lib/config/constants';
import { FALLBACK_PORT_END as SETUP_ENV_FALLBACK_PORT_END } from '@/scripts/setup-env';
import { FALLBACK_PORT_END as PORTS_FALLBACK_PORT_END } from '@/lib/utils/ports';

// Global Constraint: zakres portów preview kończy się na 3131 (32 sloty),
// ta sama wartość w każdym miejscu, które ją zna. `lib/config/constants.ts`
// miał 3999 podczas gdy `lib/utils/ports.ts` miał już 3131 — a `preview.ts`
// czyta granice z `constants.ts` i przekazuje je explicit do
// `findAvailablePort`, więc własny domyślny koniec `ports.ts` nigdy się przy
// starcie preview nie stosował. Obraz publikuje tylko `3100-3131`, więc port
// przydzielony powyżej 3131 jest z zewnątrz kontenera nieosiągalny.
//
// Ten test failuje, gdy którekolwiek z tych trzech miejsc rozjedzie się
// z pozostałymi — sam test jednej stałej by tego nie złapał.
describe('koniec zakresu portów preview to 3131 wszędzie', () => {
  it('constants.ts, ports.ts i setup-env.js zgadzają się', () => {
    expect(PREVIEW_CONFIG.FALLBACK_PORT_END).toBe(3131);
    expect(PORTS_FALLBACK_PORT_END).toBe(3131);
    expect(SETUP_ENV_FALLBACK_PORT_END).toBe(3131);
  });
});
