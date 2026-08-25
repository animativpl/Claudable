/**
 * Wspólny pomocnik scrubowania środowiska dla obu granic
 * platforma → proces potomny: `cli/claude-options.ts` (proces agenta) i
 * `services/preview.ts` (procesy projektu użytkownika — dev-server, `npm
 * install`). Wydzielony z dwóch niezależnych kopii w Task 19 fixup: agent
 * uruchamia `npm install` i buildy w projekcie użytkownika przez swoje
 * narzędzie Bash, więc potrzebuje dokładnie tego samego scrubu co ścieżka
 * preview — dwie kopie tej samej logiki rozjechały się właśnie tym, że jedna
 * z nich (agenta) nie nadążyła za rozszerzeniem drugiej o `NODE_ENV` i
 * `__NEXT_PRIVATE_*`.
 *
 * Miejsca różnią się wyłącznie allowlistą: agent potrzebuje
 * `CLAUDE_CONFIG_DIR` (zamontowany katalog konfiguracyjny — bez niego nie
 * widzi skilli/CLAUDE.md) i `CLAUDE_CODE_OAUTH_TOKEN` (własne poświadczenie);
 * procesy projektu użytkownika nie potrzebują żadnej zmiennej `CLAUDE_*`.
 *
 * Odcina cztery niezależne kategorie:
 * - `CLAUDECODE`/`CLAUDE_*`: zmienne sesji Claude Code. Terminal, z którego
 *   Claudable jest odpalany, może sam być sesją Claude Code — SDK odmawia
 *   wtedy startu zagnieżdżonej sesji.
 * - `NODE_ENV`: obraz kontenera ustawia `NODE_ENV=production` dla samej
 *   platformy. Proces cudzego kodu (npm install/dev-server projektu
 *   użytkownika, ALBO Bash agenta) dziedziczący tę wartość zmienia jej
 *   znaczenie — `npm install` pomija wtedy devDependencies.
 * - `__NEXT_PRIVATE_*`: `/app/server.js` ustawia
 *   `__NEXT_PRIVATE_STANDALONE_CONFIG` z konfiguracją Nexta PLATFORMY;
 *   proces czytający tę zmienną jako własną dostaje cudzy `distDir` i
 *   `outputFileTracingRoot`.
 * - `ENCRYPTION_KEY`: jedyny sekret platformy bez kopii na dysku w `/data`.
 *   Baza jest w mouncie i tak widoczna, ale jej `ServiceToken` i `EnvVar` są
 *   zaszyfrowane tym kluczem, więc odcięcie go realnie zmniejsza ekspozycję.
 *   `DATABASE_URL` świadomie zostaje: plik bazy leży pod znaną ścieżką w tym
 *   samym mouncie, więc ukrycie samej ścieżki byłoby pozorem ochrony.
 */
function isPlatformOnlyVar(key: string): boolean {
  return (
    key === 'CLAUDECODE' ||
    key.startsWith('CLAUDE_') ||
    key === 'NODE_ENV' ||
    key.startsWith('__NEXT_PRIVATE_') ||
    key === 'ENCRYPTION_KEY'
  );
}

export function scrubProcessEnv(allowlist: readonly string[] = []): NodeJS.ProcessEnv {
  // Kasowanie po `key` z `Object.keys`, nie `delete env.NODE_ENV`: Next
  // deklaruje `NODE_ENV` w `ProcessEnv` jako readonly, więc dostęp po
  // właściwości nie kompiluje się bez `as any`.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (isPlatformOnlyVar(key) && !allowlist.includes(key)) {
      delete env[key];
    }
  }
  return env;
}
