# Claudable: odchudzenie, parytet agenta, Docker i template'y — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zredukować Claudable do jednego agenta (Claude Code) z parytetem wobec terminala, naprawić flickerowanie czatu i regresję katalogu roboczego, dodać template Astro obok Next.js i zapakować całość w Dockera z mapowanym katalogiem projektów.

**Architecture:** Aplikacja pozostaje monolitem Next.js 15 (App Router) z route handlerami jako backendem, SQLite przez Prismę i SSE jako jedynym transportem realtime. Zmiana idzie w sześciu fazach: najpierw fundament testowy i cofnięcie regresji `cwd`, potem usunięcia (WebSockety, inne CLI, Vercel/Supabase), potem naprawy z audytu, potem parytet agenta z terminalem, potem rejestr template'ów, na końcu konteneryzacja.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5.7, Prisma 6 + SQLite, `@anthropic-ai/claude-agent-sdk` 0.2.68, Vitest (nowy), Docker + Compose.

**Spec:** projekt nie ma living speca (`spec.md`). Bootstrap speca to osobna robota (skill `writing-specs`) i nie jest częścią tego runu — nie ma więc zadania synchronizującego spec. Zamiast tego Task 22 aktualizuje `README.md`, a Task 12 komentarz w schemacie, czyli jedyną dokumentację, jaką ten projekt ma.

**Design record:** `.flow/specs/2026-08-24-claudable-cleanup-docker-templates-design.md` (29 decyzji, 19 znalezisk)

## Global Constraints

- Node `>=20.0.0`, npm `>=10.0.0` (`package.json` → `engines`) — nie podnosić.
- TypeScript `strict: true` (`tsconfig.json`). Żadnego nowego `as any` ani `@ts-ignore`.
- ID modeli Claude dokładnie w formie: `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`. **Nigdy** nie doklejać sufiksu daty. Domyślny model: `claude-sonnet-5`.
- Zakres portów preview: `3100`–`3131` (32 slotów). Ta sama wartość w `scripts/setup-env.js`, `lib/utils/ports.ts`, `lib/services/preview.ts`, `lib/config/constants.ts` i `docker-compose.yml`.
- **Nigdy nie commituj `.env` ani `.env.local`** — są w `.gitignore` i zawierają `ENCRYPTION_KEY`. Zmieniaj je lokalnie, gdy zadanie tego wymaga, ale nie dodawaj do commitu.
- Opcja katalogu roboczego agenta w SDK 0.2.68 nazywa się **`cwd`**. `workingDirectory` nie istnieje w tym SDK.
- Chirurgia, nie remont: dotykamy wyłącznie tego, co wynika z zadania. Nie dekomponujemy `app/[project_id]/chat/page.tsx` ani `components/chat/ChatLog.tsx` — mimo rozmiaru.
- Integracja GitHub zostaje nietknięta (`lib/services/{github,git,tokens}.ts`, `components/modals/GitHubRepoModal.tsx`, model `ServiceToken`).
- Każde zadanie kończy się commitem. Wiadomości commitów po angielsku, tryb rozkazujący.
**Zasięg grepów w tym planie jest celowo całodrzewowy, nie listą katalogów.** Cztery razy w tym runie dziurą w weryfikacji była lista katalogów, nie wzorzec: handler WebSocket leżał w `pages/`, którego grep nie obejmował, a domyślne ustawienia z usuniętymi agentami w `contexts/`, którego też nie obejmował. Wzorzec był poprawny za każdym razem. Jeśli dopisujesz własny grep weryfikacyjny, użyj tej samej formy — wykluczenia zamiast allowlisty.


---

## Faza 0 — fundament testowy i regresja katalogu roboczego

### Task 1: Vitest + poprawne opcje `query()` (znaleziska N, O, Q)

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/services/cli/claude-options.ts`
- Create: `tests/cli/claude-options.test.ts`
- Modify: `package.json` (skrypt `test`, devDependency `vitest`)
- Modify: `lib/services/cli/claude.ts:718-766` (użycie nowej funkcji, usunięcie `as any`)

**Interfaces:**
- Consumes: nic.
- Produces:
  ```ts
  // lib/services/cli/claude-options.ts
  export interface BuildClaudeOptionsInput {
    projectPath: string;      // absolutna ścieżka katalogu projektu
    model: string;            // już znormalizowane id modelu
    sessionId?: string;       // do resume
  }
  export function buildClaudeQueryOptions(input: BuildClaudeOptionsInput): Options;
  ```
  `Options` importowane jako `import type { Options } from '@anthropic-ai/claude-agent-sdk'`.
  Task 13 rozszerza tę funkcję i jej testy; Task 14 dokłada do niej `agents`.

- [ ] **Step 1: Zainstaluj Vitest i dodaj skrypt**

```bash
npm install -D vitest
```

W `package.json`, w sekcji `scripts`, dodaj po `"lint"`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 2: Skonfiguruj Vitest z aliasem `@/`**

Utwórz `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Napisz failujący test**

Utwórz `tests/cli/claude-options.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildClaudeQueryOptions } from '@/lib/services/cli/claude-options';

describe('buildClaudeQueryOptions', () => {
  const input = {
    projectPath: '/data/projects/proj-1',
    model: 'claude-sonnet-5',
  };

  it('ustawia cwd na katalog projektu, nie workingDirectory', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.cwd).toBe('/data/projects/proj-1');
    expect(options).not.toHaveProperty('workingDirectory');
  });

  it('domyka bypassPermissions wymaganą flagą', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
  });

  it('przekazuje model i pomija resume, gdy nie ma sesji', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.model).toBe('claude-sonnet-5');
    expect(options.resume).toBeUndefined();
  });

  it('przekazuje resume, gdy sesja jest podana', () => {
    const options = buildClaudeQueryOptions({ ...input, sessionId: 'sess-9' });
    expect(options.resume).toBe('sess-9');
  });

  it('używa presetowego promptu Claude Code, bez nadpisania i bez append', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
  });
});
```

- [ ] **Step 4: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/cli/claude-options.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/services/cli/claude-options"`

- [ ] **Step 5: Napisz minimalną implementację**

Utwórz `lib/services/cli/claude-options.ts`:

```ts
import type { Options } from '@anthropic-ai/claude-agent-sdk';

export interface BuildClaudeOptionsInput {
  projectPath: string;
  model: string;
  sessionId?: string;
}

/**
 * Buduje opcje sesji agenta. Trzymane osobno od executeClaude, bo to jedyne
 * miejsce w aplikacji, w którym literówka w nazwie opcji jest niewidoczna
 * w czasie działania — więc musi być sprawdzalne typami i testem.
 */
export function buildClaudeQueryOptions(input: BuildClaudeOptionsInput): Options {
  return {
    cwd: input.projectPath,
    additionalDirectories: [input.projectPath],
    model: input.model,
    resume: input.sessionId,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // Preset, nie string: string ZASTĘPUJE prompt Claude Code, a pominięcie
    // opcji daje prompt PUSTY (`sdk.mjs`: `if (Y === void 0) G = ""`). Wchodzi
    // już tutaj, nie w Task 13, bo między tymi zadaniami dowody z uruchomienia
    // zbierałyby się na agencie bez żadnych instrukcji.
    systemPrompt: { type: 'preset', preset: 'claude_code' },
  };
}
```

- [ ] **Step 6: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/cli/claude-options.test.ts`
Expected: PASS — 5 testów

- [ ] **Step 7: Podłącz funkcję w `claude.ts` i usuń `as any`**

W `lib/services/cli/claude.ts` dodaj import obok pozostałych:

```ts
import { buildClaudeQueryOptions } from './claude-options';
```

Zastąp całe wywołanie `query({ ... } as any)` (linie ~718-766) tym:

```ts
    const response = query({
      prompt: instruction,
      options: {
        ...buildClaudeQueryOptions({
          projectPath: absoluteProjectPath,
          model: resolvedModel,
          sessionId,
        }),
        stderr: (data: string) => {
          const line = String(data).trimEnd();
          if (!line) return;
          if (stderrBuffer.length > 200) stderrBuffer.shift();
          stderrBuffer.push(line);
          console.error(`[ClaudeSDK][stderr] ${line}`);
        },
      },
    });
```

Uwagi:
- `systemPrompt` i `maxOutputTokens` znikają z tego wywołania. `maxOutputTokens` **nie istnieje** w typie `Options` SDK 0.2.68 (linia 604 `sdk.d.ts` to `ModelUsage`, nie `Options`) — czyli był ignorowany dokładnie tak samo jak `workingDirectory`, a rzutowanie `as any` to ukryło. Usuń też martwe wyliczenia `configuredMaxTokens` i `maxOutputTokens` powyżej (~582-585) razem z nimi.
- Rzutowanie `as any` musi zniknąć bez śladu. To ono przepuściło oba te błędy.

- [ ] **Step 8: Sprawdź typy**

Run: `npm run type-check`
Expected: zero błędów. Jeśli `tsc` zgłosi nieznaną właściwość w obiekcie opcji — to właśnie sens tej zmiany: usuń tę właściwość, nie przywracaj rzutowania.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/services/cli/claude-options.ts tests/cli/claude-options.test.ts lib/services/cli/claude.ts
git commit -m "fix: restore the agent working directory and type-check its options

The cwd option was replaced with a workingDirectory key that does not
exist in claude-agent-sdk 0.2.68, so the agent ran in the Claudable
checkout instead of the project. An as any cast on the options object
hid it, along with the allowDangerouslySkipPermissions flag that
bypassPermissions requires. Options now come from a typed builder with
tests, and the cast is gone."
```

### Task 2: Ujawnij payload `init` z SDK (znalezisko R, decyzja 27)

**Files:**
- Create: `lib/services/cli/init-payload.ts`
- Create: `tests/cli/init-payload.test.ts`
- Modify: `lib/services/cli/claude.ts:953-975`

**Interfaces:**
- Consumes: `buildClaudeQueryOptions` z Task 1 (tylko kontekst, bez zależności w kodzie).
- Produces:
  ```ts
  export interface InitSummary {
    sessionId: string;
    cwd: string;
    model: string;
    permissionMode: string;
    claudeCodeVersion: string;   // Task 20: czy kontener ma tę samą wersję CLI co terminal
    apiKeySource: string;        // Task 20: czy poświadczenia przyszły z mountu, czy z klucza
    toolCount: number;
    skills: string[];
    slashCommands: string[];     // Task 13/14: dowód równorzędny ze skills — z dysku czy wbudowane
    agents: string[];
    mcpServers: { name: string; status: string }[];
    plugins: string[];
  }
  export function summarizeInitPayload(message: SDKSystemMessage): InitSummary;
  ```
  To jest narzędzie dowodowe dla Task 13 i 14 — tam sprawdzasz nim, czy skille, hooki i subagenci faktycznie weszli.

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/cli/init-payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeInitPayload } from '@/lib/services/cli/init-payload';

const raw = {
  type: 'system',
  subtype: 'init',
  session_id: 'sess-1',
  cwd: '/data/projects/proj-1',
  model: 'claude-sonnet-5',
  permissionMode: 'bypassPermissions',
  tools: ['Read', 'Write', 'Bash'],
  skills: ['debug', 'simplify'],
  agents: ['general-purpose', 'Explore'],
  mcp_servers: [{ name: 'codebase-memory-mcp', status: 'connected' }],
  plugins: [{ name: 'demo', path: '/x' }],
} as never;

describe('summarizeInitPayload', () => {
  it('wyciąga pola diagnostyczne z wiadomości init', () => {
    const summary = summarizeInitPayload(raw);
    expect(summary.sessionId).toBe('sess-1');
    expect(summary.cwd).toBe('/data/projects/proj-1');
    expect(summary.toolCount).toBe(3);
    expect(summary.skills).toEqual(['debug', 'simplify']);
    expect(summary.agents).toEqual(['general-purpose', 'Explore']);
    expect(summary.mcpServers).toEqual([{ name: 'codebase-memory-mcp', status: 'connected' }]);
    expect(summary.plugins).toEqual(['demo']);
  });

  it('znosi brakujące pola opcjonalne', () => {
    const summary = summarizeInitPayload({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-2',
      cwd: '/tmp',
      model: 'claude-sonnet-5',
      permissionMode: 'default',
      tools: [],
    } as never);
    expect(summary.skills).toEqual([]);
    expect(summary.agents).toEqual([]);
    expect(summary.mcpServers).toEqual([]);
    expect(summary.plugins).toEqual([]);
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/cli/init-payload.test.ts`
Expected: FAIL — nie da się rozwiązać importu

- [ ] **Step 3: Napisz implementację**

Utwórz `lib/services/cli/init-payload.ts`:

```ts
import type { SDKSystemMessage } from '@anthropic-ai/claude-agent-sdk';

export interface InitSummary {
  sessionId: string;
  cwd: string;
  model: string;
  permissionMode: string;
  toolCount: number;
  skills: string[];
  agents: string[];
  mcpServers: { name: string; status: string }[];
  plugins: string[];
}

/**
 * SDK raportuje w wiadomości init faktyczną konfigurację sesji. Bez tego
 * jedynym źródłem wiedzy o katalogu roboczym i widocznych skillach jest
 * czytanie typów — a te nie mówią, co naprawdę weszło z dysku.
 */
export function summarizeInitPayload(message: SDKSystemMessage): InitSummary {
  return {
    sessionId: message.session_id,
    cwd: message.cwd,
    model: message.model,
    permissionMode: message.permissionMode,
    toolCount: (message.tools ?? []).length,
    skills: message.skills ?? [],
    agents: message.agents ?? [],
    mcpServers: message.mcp_servers ?? [],
    plugins: (message.plugins ?? []).map((plugin) => plugin.name),
  };
}
```

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/cli/init-payload.test.ts`
Expected: PASS — 2 testy

- [ ] **Step 5: Zaloguj podsumowanie w handlerze init**

W `lib/services/cli/claude.ts` dodaj import:

```ts
import { summarizeInitPayload } from './init-payload';
```

W bloku `if (message.type === 'system' && message.subtype === 'init') {` zastąp linię
`console.log(`[ClaudeService] Session initialized: ${currentSessionId}`);` tym:

```ts
        const initSummary = summarizeInitPayload(message);
        console.log('[ClaudeService] Session initialized:', JSON.stringify(initSummary, null, 2));
```

Reszta bloku (zapis `activeClaudeSessionId`, publikacja `connected`) zostaje bez zmian.

- [ ] **Step 6: Sprawdź typy i cały zestaw testów**

Run: `npm run type-check && npm test`
Expected: zero błędów typów, wszystkie testy zielone

- [ ] **Step 7: Commit**

```bash
git add lib/services/cli/init-payload.ts tests/cli/init-payload.test.ts lib/services/cli/claude.ts
git commit -m "feat: log the SDK init payload for each agent session

The init message reports the session's real working directory, tools,
skills, subagents and MCP servers. The handler took only the session id
and discarded the rest, which is why a broken cwd option stayed
invisible. It is now logged in full."
```

---

## Faza 1 — usunięcia

Zadania 3-6 to usunięcia. **Nie dostają nowych testów jednostkowych** — nie ma czego testować, gdy kod przestaje istnieć. Ich cyklem weryfikacji jest: grep dowodzący zera referencji, `npm run type-check` i `npm run build`. To pełnoprawny cykl (uruchom → oczekiwany wynik), tylko nie unit test. Zestaw testów z Fazy 0 musi zostać zielony po każdym z nich.

### Task 3: Usuń warstwę WebSocket i zwiń SSE do jedynego transportu (decyzja 1, znalezisko C — sprostowane)

**Files:**
- Delete: `pages/api/ws/[projectId].ts` (po nim katalog `pages/` jest pusty — usuń go w całości)
- Delete: `lib/server/websocket-manager.ts`
- Delete: `hooks/useWebSocket.ts`
- Modify: `lib/services/stream.ts` (usuń import i `websocketManager.broadcast`)
- Modify: `lib/config/constants.ts` (usuń `WEBSOCKET_CONFIG`)
- Modify: `components/chat/ChatLog.tsx` (usuń transport WS i zwiń SSE z fallbacku w jedyny kanał)
- Modify: `components/modals/CreateProjectModal.tsx` (usuń użycie `NEXT_PUBLIC_WS_BASE`)
- Modify: `package.json` (usuń `ws` i `@types/ws`)

**Interfaces:**
- Consumes: nic.
- Produces: `streamManager.publish(projectId, event)` zachowuje sygnaturę — przestaje tylko rozgłaszać do usuniętego managera. `ChatLog` nie eksponuje już stanu transportu ani trybu fallback; SSE jest podłączane bezwarunkowo. Task 8 opiera się na tym, że został jeden transport.

**Dlaczego usuwamy, a nie naprawiamy — zmierzone, nie założone.** Warstwa WS **nie jest** martwym kodem: `pages/api/ws/[projectId].ts` tworzy `WebSocketServer({ noServer: true })`, podpina listener `upgrade` i woła `websocketManager.addConnection()`, a klient celuje w dokładnie tę trasę (`hooks/useWebSocket.ts:99`). Jest natomiast zepsuta. Pomiar na uruchomionej aplikacji, konsola przeglądarki:

```
🔌 [Transport] WebSocket connected, switching to WebSocket transport
🔌 [Transport] WebSocket disconnected, preparing SSE fallback
[WebSocket] Reconnecting in 1746ms (attempt 1/10)
🔄 [Transport] SSE connection established
🔌 [Transport] WebSocket connected …                ← i od nowa
```

Trzy pełne cykle w siedem sekund, bez końca — licznik prób resetuje się przy każdym `onopen`, więc reconnect nigdy się nie wyczerpuje. Każdy cykl woła `recoverMissingMessages()` i otwiera nowy `EventSource`: w jednym wejściu na stronę policzono **ponad 15** pełnych pobrań `messages?limit=200&offset=0`, a `/api/chat/<id>/stream` zwrócił **503 siedem razy**, zanim dał 200 — wyciekłe połączenia SSE wyczerpują limit przeglądarki na host. Trzepanie WS jest więc **drugim silnikiem flickera**, obok kaskady z Task 8, i degraduje własny fallback.

Heartbeat jest 30-sekundowy (`websocket-manager.ts:139`), więc nie on zrywa połączenie po sekundzie; przyczyna siedzi w zszyciu `noServer` z serwerem deweloperskim Nexta i naprawa wymagałaby ponownej weryfikacji pod `next start` oraz w kontenerze. Do jednokierunkowego strumienia serwer→klient wystarcza SSE, które i tak obsługuje wszystkie zdarzenia — `streamManager.publish` pisze do obu kanałów tą samą treścią.

To zadanie **nie dostaje testu jednostkowego** — nie ma czego testować, gdy kod przestaje istnieć. Cykl weryfikacji: grep na zero referencji, `type-check`, `build` i pomiar w przeglądarce w kroku 8.

- [ ] **Step 1: Usuń trasę upgrade'u, manager i hooka**

```bash
git rm -r pages
git rm lib/server/websocket-manager.ts hooks/useWebSocket.ts
```

`git rm -r pages` usuwa cały katalog Pages Routera — po tej trasie nie zostaje w nim nic, a pusty `pages/` obok `app/` tylko myli następnego czytelnika.

- [ ] **Step 2: Odetnij rozgłaszanie WS w `stream.ts`**

W `lib/services/stream.ts` usuń linię importu:

```ts
import { websocketManager } from '@/lib/server/websocket-manager';
```

oraz pierwszą linię ciała metody `publish`:

```ts
    websocketManager.broadcast(projectId, event);
```

Reszta `publish` (enkodowanie SSE, iteracja po kontrolerach, sprzątanie martwych) zostaje bez zmian.

- [ ] **Step 3: Usuń `WEBSOCKET_CONFIG` i `NEXT_PUBLIC_WS_BASE`**

W `lib/config/constants.ts` usuń cały blok `export const WEBSOCKET_CONFIG = { ... } as const;` razem z komentarzem `// WebSocket Configuration`.

W `components/modals/CreateProjectModal.tsx` usuń **cały drugi klient WS**, nie tylko odczyt `NEXT_PUBLIC_WS_BASE`:

1. Funkcję `connectToProjectWebSocket` (~226-312) w całości, razem z jej `resolveWebSocketUrl`, logiką reconnectu i handlerami.
2. Wywołanie `const wsCleanup = connectToProjectWebSocket(projectUuid);` (~416) i każde późniejsze użycie `wsCleanup`.

**Dlaczego to nie jest samo usunięcie martwego kodu.** Ten klient napędzał UI tworzenia projektu: `setInitializationStep(message)` z granularnym postępem i `handleInitializationComplete()` po `status === 'active'`. Po usunięciu trasy socket nie wstanie, `onclose` odpali pięć prób z backoffem (1+2+4+8+10 ≈ 25 s), a potem ustawi `setInitializationStep('Connection lost. Please refresh the page.')`. Ponieważ `npm install` świeżego projektu trwa dłużej niż 25 s, **każdy nowo tworzony projekt pokazywałby fałszywy błąd**, podczas gdy inicjalizacja leci dalej.

Mechanizm zastępczy **już istnieje i już działa**: polling `GET /api/projects/<id>` co 3 s (~470-500) obsługuje `active` i `failed`, i sam woła `handleInitializationComplete`. Po usunięciu klienta WS zostaje jedynym sterownikiem tego ekranu — i jest tym, który realnie domykał flow, bo socket flapował tak samo jak w czacie.

**Świadomy koszt:** ginie granularny tekst postępu, który przychodził w zdarzeniach `project_status`. Polling pokazuje stałe komunikaty („Setting up environment…", „Project ready! Redirecting…"). Nie odbudowuj tego na SSE w tym zadaniu — jeśli granularny postęp przy tworzeniu projektu okaże się potrzebny, to osobna, mała robota na istniejącym strumieniu.

- [ ] **Step 4: Zwiń SSE z fallbacku w jedyny transport**

W `components/chat/ChatLog.tsx`:

1. Usuń import `useWebSocket` i całe wywołanie `const { isConnected, isConnecting } = useWebSocket({ ... });` (~1510-1533).
2. Usuń efekt reagujący na `isConnected`/`isConnecting` (~1535-1570) w całości.
3. Usuń stan i refy obsługujące tryb fallback: `enableSseFallback`, `sseFallbackTimerRef`, `hasLoggedSseFallbackRef`, `activeTransport`. Prop `onSseFallbackActive` zostaje w sygnaturze (rodzic go przekazuje), ale wołaj go **raz, z `false`**, przy nawiązaniu SSE — usunięcie propa to zmiana kontraktu komponentu, a to nie jest zadanie na to.
4. Efekt nawiązujący SSE (~1583-1670) przestaje być warunkowany `enableSseFallback` — łączy się bezwarunkowo, gdy jest `projectId`. Zostaw istniejący reconnect SSE (`setTimeout(connectSse, 2000)`).
5. Usuń `recoverMissingMessages()` razem z jej wywołaniami. Istniała po to, żeby nadrobić zdarzenia zgubione przy przełączaniu transportów; przy jednym transporcie z własnym reconnectem i pełnym doczytaniem historii przy montowaniu nie ma czego nadrabiać, a każde jej wywołanie to było kolejne pobranie listy.
6. `if (isConnected || isSseConnected)` → `if (isSseConnected)`; `const shouldPoll = !isConnected && !isSseConnected && enableSseFallback;` → `const shouldPoll = !isSseConnected;`. Log `Stopping polling due to active connection: WebSocket=...` zostaw tylko w części o SSE.
7. Zmień nazwę `handleWebSocketData` na `handleRealtimeLogEntry` — treść zostaje.

- [ ] **Step 5: Usuń zależności `ws`**

```bash
npm uninstall ws @types/ws
```

- [ ] **Step 6: Dowiedź, że nie ma referencji**

Run:
```bash
grep -rnE "useWebSocket|websocketManager|websocket-manager|WEBSOCKET_CONFIG|NEXT_PUBLIC_WS_BASE|ensureHeartbeat|isConnecting|enableSseFallback|recoverMissingMessages|connectToProjectWebSocket|new WebSocket|/api/ws|from 'ws'" --include=*.ts --include=*.tsx --include=*.js --include=*.json --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=data --exclude-dir=.flow . 2>/dev/null
```
Expected: brak wyników (katalog `pages` już nie istnieje, dlatego `2>/dev/null`).

**Grep MUSI obejmować `pages`** — albo potwierdzić, że katalogu nie ma. Pierwotna analiza tej warstwy uznała ją za martwą właśnie dlatego, że grepowała `app components lib hooks types` i pominęła Pages Router.

**I MUSI zawierać `new WebSocket` oraz `/api/ws`.** Pierwsza wersja tego kroku wymieniała tylko nazwy z modułu `websocket-manager` i hooka — a `CreateProjectModal` ma własnego klienta WS, zbudowanego bez żadnej z tych nazw. Grep bez tych dwóch wzorców przechodzi, zostawiając drugi klient celujący w usuniętą trasę.

- [ ] **Step 7: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi. W wyjściu builda **nie może** być już sekcji `Route (pages)` z `/api/ws/[projectId]`.

- [ ] **Step 8: Dowód z uruchomienia — koniec trzepania i mniej pobrań**

Run: `npm run build && npm start`, otwórz projekt, konsola i zakładka Network.

Expected:
- **Zero** linii `[Transport] WebSocket` i `[WebSocket] Reconnecting` w konsoli. To jest dowód właściwy dla tego zadania.
- Liczba pobrań `messages?limit=200&offset=0` przy wejściu na stronę: **wyraźnie poniżej 15** — tyle zmierzono przed zmianą.
- `🔄 [Transport] SSE connection established` będzie się jeszcze powtarzać. Nie jest to regresja tego zadania: efekt SSE remountuje się, bo `handleRealtimeEnvelope` siedzi w jego deps i jest niestabilne przez `handleRealtimeStatus` → `onSessionStatusChange`, które rodzic podaje jako inline arrow. Domyka to Task 8 Step 1.

**Nie mierz odpowiedzi `503` w logu sieciowym przeglądarki.** Zbadane: serwer odpowiada `200` na **każde** żądanie strumienia (log dev-servera: `GET /api/chat/<id>/stream 200` plus `[SSE] Stream cancelled`), a `curl` — 10 równoległych i 30 szybkich otwórz-porzuć — nigdy nie dostaje 503. W kodzie aplikacji nie ma źródła 503: brak `middleware.ts`, trasa nie ma ścieżki błędu, `StreamManager.addStream` nie ma limitu. `503` jest **artefaktem instrumentacji** — tak czytnik sieci raportuje żądanie strumieniowe przerwane przez klienta przed zakończeniem odpowiedzi. Kryterium „zero 503" mierzyłoby narzędzie, nie kod.

**Miarą zastępczą jest liczba linii `[SSE] Client connected to project` w logu serwera** (`app/api/chat/[project_id]/stream/route.ts:26`) na jedno wejście na stronę — jedna linia na każdy przyjęty strumień, czyli dokładnie jedna na każde utworzone `EventSource`.

Nie licz linii teardownu. Ten plik ma **dwie** ścieżki rozpadu — `[SSE] Client disconnected` (`:65`, abort żądania) i `[SSE] Stream cancelled` (`:72`, cancel strumienia) — a od sposobu zamknięcia zależy, która się odpali. Task 8 zmienia moment i sposób zamykania `EventSource`, więc mógłby przesunąć teardowny z jednej linii na drugą i **zbić licznik do zera bez zmniejszenia churnu ani o jedno połączenie**. Liczby połączeń nie da się przenieść do innej linii; liczby rozłączeń da się.

Zmierzone po usunięciu WS na **dev-serverze**: 13 przyjętych strumieni na jedno wejście. Zapisz swoją liczbę w raporcie.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: drop the WebSocket transport, leaving SSE alone

The WebSocket layer was wired - a Pages Router route installed the
upgrade handler and registered connections - but it never held a
connection: measured on a running instance, it connected and dropped
three times in seven seconds, and the reconnect counter reset on every
open so it never gave up. Each cycle refetched the message list and
leaked an EventSource, which is why the stream endpoint answered 503
seven times before succeeding. Its flapping was a second engine behind
the chat flicker.

SSE carries every event already, so it stops being a fallback and
becomes the transport. The dual-transport branching, the fallback
timers and the missing-message recovery go with it."
```

### Task 4: Usuń integracje Vercel i Supabase (decyzja 3)

**Files:**
- Delete: `lib/services/vercel.ts`, `lib/services/supabase.ts`
- Delete: `app/api/vercel/`, `app/api/supabase/`, `app/api/projects/[project_id]/vercel/`, `app/api/projects/[project_id]/supabase/`
- Delete: `components/modals/VercelProjectModal.tsx`, `components/modals/SupabaseModal.tsx`
- Delete: `types/shared/vercel.ts`
- Modify: `app/[project_id]/chat/page.tsx` (usuń sekcje deployu i polling wdrożeń)
- Modify: `components/modals/ServiceConnectionModal.tsx`, `components/settings/ServiceSettings.tsx`, `components/settings/GlobalSettings.tsx`
- Modify: `lib/services/service-integration.ts`, `lib/services/tokens.ts`
- Modify: `types/shared/index.ts`, `types/shared/service.ts`, `types/client/modal.ts`, `types/client/project.ts`, `types/project.ts`
- Modify: `app/api/tokens/[...segments]/route.ts`

**Interfaces:**
- Consumes: nic.
- Produces: typ providera usług zawęża się do `'github'`. Każdy pozostały kod czytający `provider` może zakładać wyłącznie tę wartość. Task 7 usuwa odpowiadające wiersze z bazy.

- [ ] **Step 1: Usuń serwisy, trasy, modale i typy**

```bash
git rm -r lib/services/vercel.ts lib/services/supabase.ts \
  app/api/vercel app/api/supabase \
  "app/api/projects/[project_id]/vercel" "app/api/projects/[project_id]/supabase" \
  components/modals/VercelProjectModal.tsx components/modals/SupabaseModal.tsx \
  types/shared/vercel.ts
```

- [ ] **Step 2: Zawęź typ providera do GitHuba**

W `types/shared/service.ts` znajdź union providerów (wartości `'github' | 'vercel' | 'supabase'`) i zawęź go do `'github'`. To samo w `types/client/modal.ts`, `types/client/project.ts`, `types/project.ts` i `types/shared/index.ts` — usuń reeksport `./vercel`. Pozwól `tsc` z kroku 6 wskazać każde miejsce, które przestaje się zgadzać.

- [ ] **Step 3: Wyczyść serwis integracji i tokenów**

W `lib/services/service-integration.ts` usuń gałęzie i mapy dotyczące `vercel` i `supabase`, zostawiając wyłącznie ścieżkę GitHuba. W `lib/services/tokens.ts` usuń te providery z walidacji/list. W `app/api/tokens/[...segments]/route.ts` usuń obsługę tych segmentów.

- [ ] **Step 4: Wyczyść UI**

- `components/modals/ServiceConnectionModal.tsx` — usuń warianty Vercel/Supabase i ich importy modali.
- `components/settings/ServiceSettings.tsx` i `components/settings/GlobalSettings.tsx` — usuń karty/sekcje tych usług.
- `app/[project_id]/chat/page.tsx` — usuń `loadDeployStatus`, `startDeploymentPolling`, `checkCurrentDeployment`, `deployPollRef`, przyciski deployu i cały stan wdrożenia. To usuwa jeden z pollerów napędzających re-render rodzica, co pomaga zadaniu 8.

- [ ] **Step 5: Dowiedź, że nie ma referencji**

**Trzy miejsca są jawnie NIE do ruszania** — nie dotyczą integracji, tylko projektów generowanych przez agenta, i ich usunięcie sprawiłoby, że te projekty zaczną commitować katalog `.vercel`:
- `lib/services/git.ts:32` — `'.vercel/'` w szablonie `.gitignore`
- `lib/services/git.ts:102` — `.vercel` w `pathsToUntrack`
- `lib/services/file-browser.ts:17` — `'.vercel'` w liście ignorowanych katalogów

Run (grep zawężony do warstwy integracji):
```bash
grep -rniE "(from|import).*(vercel|supabase)|VercelProjectModal|SupabaseModal|services/vercel|services/supabase" --include=*.ts --include=*.tsx --include=*.js --include=*.json --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=data --exclude-dir=.flow .
```
Expected: brak wyników. Osobno usuń link `vercel.com/templates` z treści strony szablonu w `lib/utils/scaffold.ts` — Task 16 przenosi ten plik i zakłada, że linku już nie ma.

- [ ] **Step 6: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove the Vercel and Supabase integrations

Deploy targets and hosted Postgres leave the product; GitHub stays as
the way code gets out. Service providers narrow to a single value, and
the deployment pollers that kept the chat page re-rendering go with
them."
```

### Task 5: Usuń adaptery i modele agentów innych niż Claude — backend (decyzja 2)

**Files:**
- Delete: `lib/services/cli/codex.ts`, `cursor.ts`, `qwen.ts`, `glm.ts`
- Delete: `lib/constants/codexModels.ts`, `cursorModels.ts`, `qwenModels.ts`, `glmModels.ts`
- Delete: `claude_code_zai_env.sh`
- Modify: `lib/constants/cliModels.ts` (zwija się do Claude)
- Modify: `app/api/chat/[project_id]/act/route.ts` (jeden executor)
- Modify: `app/api/settings/cli-status/route.ts` (tylko Claude — pełna przebudowa w Task 14)
- Modify: `lib/services/settings.ts` (`DEFAULT_SETTINGS`)
- Modify: `types/cli.ts` (usunięcie importów usuwanych stałych)

**Interfaces:**
- Consumes: `buildClaudeQueryOptions` (Task 1) — bez zmian w sygnaturze.
- Produces:
  ```ts
  // lib/constants/cliModels.ts — po zwinięciu
  export function getDefaultModelForCli(cli?: string | null): string;   // zawsze CLAUDE_DEFAULT_MODEL
  export function normalizeModelId(cli: string | null | undefined, model?: string | null): string; // deleguje do normalizeClaudeModelId
  export function getModelDisplayName(cli: string | null | undefined, modelId?: string | null): string;
  export function getModelDefinitionsForCli(cli?: string | null): ClaudeModelDefinition[];
  ```
  Sygnatury zostają (wołane z wielu miejsc), zmienia się tylko to, że parametr `cli` przestaje mieć znaczenie. Task 12 podmienia listę modeli pod tym API.

- [ ] **Step 1: Usuń adaptery, stałe modeli i skrypt GLM**

```bash
git rm lib/services/cli/codex.ts lib/services/cli/cursor.ts lib/services/cli/qwen.ts lib/services/cli/glm.ts \
  lib/constants/codexModels.ts lib/constants/cursorModels.ts lib/constants/qwenModels.ts lib/constants/glmModels.ts \
  claude_code_zai_env.sh
```

- [ ] **Step 2: Zwiń `cliModels.ts` do Claude**

Zastąp całą zawartość `lib/constants/cliModels.ts`:

```ts
import {
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_MODEL_DEFINITIONS,
  getClaudeModelDisplayName,
  normalizeClaudeModelId,
  type ClaudeModelDefinition,
} from './claudeModels';

/**
 * Claude Code jest jedynym agentem. Te funkcje trzymają parametr `cli`, bo
 * wołają je dziesiątki miejsc, ale nie rozgałęziają już na nim niczego.
 */
export function getDefaultModelForCli(_cli?: string | null): string {
  return CLAUDE_DEFAULT_MODEL;
}

export function normalizeModelId(_cli: string | null | undefined, model?: string | null): string {
  return normalizeClaudeModelId(model);
}

export function getModelDisplayName(_cli: string | null | undefined, modelId?: string | null): string {
  return getClaudeModelDisplayName(normalizeClaudeModelId(modelId));
}

export function getModelDefinitionsForCli(_cli?: string | null): ClaudeModelDefinition[] {
  return CLAUDE_MODEL_DEFINITIONS;
}
```

- [ ] **Step 3: Jeden executor w trasie `act`**

W `app/api/chat/[project_id]/act/route.ts`:
1. Usuń importy `initialize*Project` / `apply*Changes` dla codex, cursor, qwen, glm. Zostaw tylko import z `@/lib/services/cli/claude`, bez aliasów:
   ```ts
   import { initializeNextJsProject, applyChanges } from '@/lib/services/cli/claude';
   ```
2. Usuń całe wyliczanie `cliPreference` (`coerceString(body.cliPreference) ?? ... ?? 'claude'`) i wszystkie jego użycia.
3. Usuń blok `if (project.preferredCli !== cliPreference || ...) { updateProject(...) }` — zostaje tylko zapis modelu, gdy się zmienił:
   ```ts
   const existingSelected = normalizeModelId(null, project.selectedModel ?? undefined);
   if (existingSelected !== selectedModel) {
     try {
       await updateProject(project_id, { selectedModel });
     } catch (error) {
       console.error('[API] Failed to persist project model:', error);
     }
   }
   ```
4. Zastąp obie drabinki wyboru executora bezpośrednim wywołaniem:
   ```ts
   if (isInitialPrompt) {
     initializeNextJsProject(project_id, projectPath, finalInstruction, selectedModel, requestId)
       .catch((error) => console.error('[API] Failed to initialize project:', error));
   } else {
     applyChanges(
       project_id, projectPath, finalInstruction, selectedModel,
       project.activeClaudeSessionId || undefined, requestId,
     ).catch((error) => console.error('[API] Failed to execute AI:', error));
   }
   ```
5. `createMessage({ ... cliSource: cliPreference ... })` → `cliSource: 'claude'`.

- [ ] **Step 4: Wyczyść resztę backendu**

- `app/api/settings/cli-status/route.ts` — usuń `checkCodexCLI`, `checkQwenCLI`, `checkGLMCLI`, `checkCursorCLI` i importy usuniętych stałych modeli; zostaw wyłącznie gałąź Claude. Trasa zostaje na miejscu, jej semantykę zmienia Task 15.
- `lib/services/settings.ts` — `DEFAULT_SETTINGS.cli_settings` zostaje tylko z kluczem `claude`.
- `types/cli.ts` — usuń cztery importy usuwanych stałych (`CODEX_MODEL_DEFINITIONS`, `CURSOR_MODEL_DEFINITIONS`, `QWEN_MODEL_DEFINITIONS`, `GLM_MODEL_DEFINITIONS`) i wpisy `CLI_OPTIONS`, które z nich korzystały. Sam plik znika w Task 6 — tutaj tylko odcinamy go od usuwanych modułów, żeby repozytorium kompilowało się po tym commicie.

**Czego to zadanie NIE rusza, świadomie:** `preferredCli`, `fallbackEnabled`, `ProjectCliPreference`, `getProjectCliPreference`, `updateProjectCliPreference` w `lib/services/project.ts`, `preferredCli` w `app/api/projects/route.ts` i unionów w `types/backend/*`. Te funkcje woła wyłącznie trasa `cli-preference`, którą usuwa Task 6 — usunięcie ich tutaj zepsułoby kompilację tego commitu. Cała plomba preferencji CLI wypada w Task 6, atomowo.

- [ ] **Step 5: Dowiedź, że nie ma referencji**

Run:
```bash
grep -rn "codexModels\|cursorModels\|qwenModels\|glmModels\|cli/codex\|cli/cursor\|cli/qwen\|cli/glm" --include=*.ts --include=*.tsx --include=*.js --include=*.json --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=data --exclude-dir=.flow .
```
Expected: brak wyników. Nazwy agentów jako **wartości** (`'codex'` w `CLI_OPTIONS`, badge'e w UI) zostają do Task 6 — nie goń ich tutaj.

- [ ] **Step 6: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: **zero błędów** i zielony build. To zadanie musi się kompilować samo — jeśli `tsc` zgłasza cokolwiek, to znaczy, że usunąłeś coś, co ma jeszcze żywego konsumenta, i trzeba to przenieść do Task 6, nie zostawić zepsute.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: reduce the backend to the Claude Code agent

Four adapters implemented the same flow with different stream parsers.
Claude Code stays; codex, cursor, qwen and glm go, along with their
model tables and the executor ladders that picked between them. The
cliModels helpers keep their signatures because dozens of call sites
use them, but they no longer branch."
```

### Task 6: Usuń wybór agenta z UI (decyzja 2, 11)

**Files:**
- Delete: `hooks/useCLI.ts`, `lib/utils/cliOptions.ts`, `types/cli.ts`, `types/shared/cli.ts`
- Delete: `app/api/chat/[project_id]/cli-preference/`
- Modify: `lib/services/project.ts` (usunięcie `ProjectCliPreference`, `getProjectCliPreference`, `updateProjectCliPreference` i `preferredCli`)
- Modify: `app/api/projects/route.ts` (usunięcie `preferredCli`)
- Modify: `lib/serializers/project.ts`
- Modify: `types/backend/cli.ts`, `types/backend/project.ts`
- Modify: `components/settings/AIAssistantSettings.tsx`, `components/settings/GlobalSettings.tsx`, `components/settings/GeneralSettings.tsx`
- Delete: `components/modals/CreateProjectModal.tsx` (martwy kod — patrz niżej)
- Modify: `components/settings/ServiceSettings.tsx` (jedna rzecz — patrz krok 4)
- Modify: `components/chat/ChatInput.tsx`
- Modify: `app/page.tsx`, `app/[project_id]/chat/page.tsx`
- Modify: `app/api/chat/[project_id]/cli-preference/route.ts` (usunięcie trasy)

**Interfaces:**
- Consumes: `getModelDefinitionsForCli`, `normalizeModelId`, `getDefaultModelForCli` z Task 5.
- Produces: UI zna tylko wybór modelu. Po tym zadaniu żadne miejsce w kodzie nie czyta ani nie zapisuje `preferredCli` i `fallbackEnabled` — Task 7 może bezpiecznie zdjąć kolumny.

**`CreateProjectModal` jest martwy i zostaje usunięty, nie wyczyszczony.** Sprawdzone: plik (893 linie) jest importowany w `app/page.tsx:5`, stan `showCreate` zadeklarowany w `:44`, ale `setShowCreate` nie jest wołane ani razu i komponent nie występuje w JSX. Prawdziwa droga tworzenia projektu to pole na stronie głównej — `app/page.tsx:482` robi POST `/api/projects`, `:589` przekierowuje na czat; przejście tej drogi w przeglądarce nie dotyka modala. Czyszczenie w nim selektora CLI byłoby robotą na kodzie, którego nikt nie uruchamia, a zostawienie go bez zmian zepsułoby kompilację, bo używa zawężanych tu typów. Decyzja użytkownika: usunąć.

To zadanie jest atomowe z konieczności: zawężenie unionów typów CLI, usunięcie trasy `cli-preference` i usunięcie funkcji preferencji z `project.ts` muszą wejść jednym commitem, bo każde z nich osobno zostawia drugiego bez konsumenta albo bez definicji.

- [ ] **Step 1: Usuń hooka, mapy opcji i typy CLI**

```bash
git rm hooks/useCLI.ts lib/utils/cliOptions.ts types/cli.ts types/shared/cli.ts
git rm -r "app/api/chat/[project_id]/cli-preference"
```

Następnie usuń plombę preferencji CLI, którą ta trasa była jedynym konsumentem:
- `lib/services/project.ts` — usuń `ProjectCliPreference`, `getProjectCliPreference`, `updateProjectCliPreference` (linie ~163-225) w całości. W `createProject` usuń `preferredCli: input.preferredCli || 'claude',` i zamień `normalizeModelId(input.preferredCli || 'claude', ...)` na `normalizeModelId(null, ...)`. W `updateProject` usuń pobranie `existing` z `select: { preferredCli: true }` i wyliczanie `targetCli` — normalizuj przez `normalizeModelId(null, input.selectedModel)`. W `getAllProjects` i `getProjectById` zamień `normalizeModelId(project.preferredCli ?? 'claude', ...)` na `normalizeModelId(null, ...)`.
- `app/api/projects/route.ts` — usuń `const preferredCli = ...` (linia 34) oraz pole `preferredCli` z `input`; `selectedModel` normalizuj przez `normalizeModelId(null, requestedModel ?? getDefaultModelForCli(null))`.
- `lib/serializers/project.ts` — usuń `preferredCli` z serializowanego kształtu.
- `types/backend/cli.ts`, `types/backend/project.ts` — zawęź uniony CLI do `'claude'` i usuń pola `preferredCli` / `fallbackEnabled`.

- [ ] **Step 2: Usuń selektor CLI z ustawień**

W `components/settings/AIAssistantSettings.tsx` usuń dropdown wyboru CLI, listę `ACTIVE_CLI_OPTIONS`, ikony i kolory marek oraz stan `fallbackEnabled`. Zostaje wyłącznie wybór modelu, karmiony z `getModelDefinitionsForCli(null)`. To samo w `components/settings/GlobalSettings.tsx` i `GeneralSettings.tsx` — usuń sekcje per-CLI, zostaw model domyślny.

- [ ] **Step 3: Usuń wybór CLI z modala tworzenia projektu**

Usuń martwy modal razem z jego śladami:

```bash
git rm components/modals/CreateProjectModal.tsx
```

W `app/page.tsx` usuń import z linii 5 oraz deklarację `const [showCreate, setShowCreate] = useState(false);` (~44). Sprawdź grepem, czy `showCreate` nie jest nigdzie czytany — nie powinien być.

Modal był jedynym konsumentem części importów w `app/page.tsx` (np. `createCliStatusFallback`, typy `CLIOption`/`CLIStatus`). Usuń te, które po nim osierocieją; `tsc` z kroku 7 wskaże każdy.

- [ ] **Step 4: Usuń zdarzenie osierocone przez Task 4**

W `components/settings/ServiceSettings.tsx:126` usuń `window.dispatchEvent(new CustomEvent('services-updated'))` razem z komentarzem nad nim. Jedynego słuchacza tego zdarzenia (`app/[project_id]/chat/page.tsx`) usunęło Task 4 przy wycinaniu pollerów wdrożeń — grep po całym drzewie pokazuje teraz jedno wystąpienie tej nazwy, czyli nadawcę bez odbiorcy. To dokładnie „usuń to, co Twoja zmiana osierociła"; przypisane tutaj, bo Task 4 zamknął się przed tym ustaleniem.

- [ ] **Step 5: Usuń wskaźniki CLI z czatu i listy projektów**

W `components/chat/ChatInput.tsx`, `app/page.tsx` i `app/[project_id]/chat/page.tsx` usuń badge'e i przełączniki CLI, `updatePreferredCli`, `handleCliChange`, `loadCliStatuses` oraz stan `cliStatuses`. Zostaw `handleModelChange` i `updateSelectedModel`, przestawiając ich wywołania `normalizeModelId(cli, model)` na `normalizeModelId(null, model)`.

- [ ] **Step 6: Domknij typ statusu, który zostaje po usuniętych plikach**

`app/api/settings/cli-status/route.ts` importuje `CLIStatus`. Jeśli `types/backend/cli.ts` bierze ten typ z usuwanego `types/cli.ts` albo `types/shared/cli.ts`, przenieś jego definicję do `types/backend/cli.ts` w zawężonej formie:

```ts
export interface CLIStatusEntry {
  installed: boolean;
  available?: boolean;
  configured?: boolean;
  checking?: boolean;
  version?: string;
  error?: string;
  models?: string[];
}
export type CLIStatus = { claude: CLIStatusEntry };
```

Bez tego kroku `type-check` w kroku 7 padnie na zerwanym imporcie. Task 15 przepisuje tę trasę do końca, ale między tym zadaniem a Task 15 repozytorium musi się kompilować.

- [ ] **Step 7: Dowiedź, że nie ma referencji**

Run:
```bash
grep -rn "useCLI\|cliOptions\|ACTIVE_CLI\|CLI_OPTIONS\|preferredCli\|preferred_cli\|fallbackEnabled\|fallback_enabled\|cli-preference" --include=*.ts --include=*.tsx --include=*.js --include=*.json --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=data --exclude-dir=.flow .
```
Expected: brak wyników

Run (powtórka grepu z Task 5, teraz musi być czysty):
```bash
grep -rn "codex\|Codex\|qwen\|Qwen\|glm\|GLM\|gemini\|Gemini" --include=*.ts --include=*.tsx --include=*.js --include=*.json --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=data --exclude-dir=.flow .
```
Expected: brak wyników

- [ ] **Step 8: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: drop agent selection from the interface

With one agent there is nothing to pick between, so the CLI dropdowns,
brand colours, install-status badges and the fallback toggle go. Model
selection stays, since Claude has several."
```

### Task 7: Migracja schematu — usuń martwe kolumny i wiersze (decyzja 10)

**Files:**
- Create: `scripts/migrate-drop-legacy.js`
- Create: `tests/migration/legacy-purge.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `package.json` (skrypty `db:backup`, `db:migrate-legacy`)
- Verify (nie modyfikuj): `lib/services/project.ts`, `lib/serializers/project.ts` — po Task 6 nie mogą już zawierać `preferredCli` ani `fallbackEnabled`. Jeśli zawierają, wróć do Task 6; zdjęcie kolumn przy żywym konsumencie zepsuje kompilację po regeneracji klienta.

**Interfaces:**
- Consumes: nic.
- Produces:
  ```ts
  // scripts/migrate-drop-legacy.js
  module.exports = { LEGACY_PROVIDERS, purgeLegacyProviders, main };
  // purgeLegacyProviders(client) => Promise<{ connections: number; tokens: number }>
  ```
  Task 22 dokumentuje `db:backup` w README.

- [ ] **Step 1: Napisz failujący test na tymczasowej bazie**

Utwórz `tests/migration/legacy-purge.test.ts`. Test sprawdza **zachowanie** — że po przebiegu zostaje GitHub, a znikają Vercel i Supabase — a nie że stała równa się literałowi przepisanemu z implementacji:

```ts
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error - skrypt migracji jest zwykłym CommonJS bez typów
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
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/migration/legacy-purge.test.ts`
Expected: FAIL — `purgeLegacyProviders is not a function`

- [ ] **Step 3: Napisz skrypt migracji z backupem**

Utwórz `scripts/migrate-drop-legacy.js`:

```js
#!/usr/bin/env node
/**
 * Jednorazowe czyszczenie po usunięciu Vercela, Supabase i agentów innych
 * niż Claude. Robi kopię bazy przed czymkolwiek, bo `prisma db push` na
 * SQLite przebudowuje tabele.
 */
const fs = require('fs');
const path = require('path');

const LEGACY_PROVIDERS = ['vercel', 'supabase'];

/**
 * Wydzielone, żeby dało się przetestować bez prawdziwej bazy.
 * Czyści OBIE tabele niosące providera. Po zawężeniu `isProvider` w Task 4
 * nie istnieje już trasa, którą użytkownik mógłby usunąć stary token —
 * `DELETE /api/tokens/vercel` zwraca 400 „Invalid provider" — więc wiersz
 * pominięty tutaj zostaje w bazie na zawsze i nieusuwalny.
 */
async function purgeLegacyProviders(client) {
  const connections = await client.projectServiceConnection.deleteMany({
    where: { provider: { in: LEGACY_PROVIDERS } },
  });
  const tokens = await client.serviceToken.deleteMany({
    where: { provider: { in: LEGACY_PROVIDERS } },
  });
  return { connections: connections.count, tokens: tokens.count };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');

  const dbPath = path.join(__dirname, '..', 'data', 'cc.db');
  if (fs.existsSync(dbPath)) {
    const backupDir = path.join(__dirname, '..', 'data', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `cc_backup_${stamp}.db`);
    fs.copyFileSync(dbPath, backupPath);
    console.log(`🗃️  Backup: ${backupPath}`);
  }

  const prisma = new PrismaClient();
  try {
    const removed = await purgeLegacyProviders(prisma);
    console.log(
      `🧹 Removed ${removed.connections} legacy service connection(s) and ${removed.tokens} legacy token(s)`
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Legacy migration failed:', error);
    process.exit(1);
  });
}

module.exports = { LEGACY_PROVIDERS, purgeLegacyProviders, main };
```

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/migration/legacy-purge.test.ts`
Expected: PASS — 3 testy

- [ ] **Step 5: Zdejmij kolumny ze schematu**

W `prisma/schema.prisma`, w modelu `Project`, usuń trzy linie:

```
  activeCursorSessionId String? @map("active_cursor_session_id")
  preferredCli  String? @map("preferred_cli")
  fallbackEnabled Boolean @default(false) @map("fallback_enabled")
```

Zaktualizuj też komentarz przy `selectedModel` (znalezisko M) — nowa treść wchodzi w Task 11, tu wystarczy usunąć nieistniejące ID:

```
  selectedModel String? @map("selected_model") // znormalizowane id modelu Claude
```

- [ ] **Step 6: Dodaj skrypt backupu do `package.json`**

W `scripts`, po `"prisma:reset"`:

```json
    "db:backup": "node -e \"const f=require('fs'),p=require('path');const s=p.join('data','cc.db');if(!f.existsSync(s)){console.log('no database yet');process.exit(0)}const d=p.join('data','backups');f.mkdirSync(d,{recursive:true});const t=new Date().toISOString().replace(/[:.]/g,'-');const o=p.join(d,'cc_backup_'+t+'.db');f.copyFileSync(s,o);console.log('backup: '+o)\"",
    "db:migrate-legacy": "node scripts/migrate-drop-legacy.js",
```

- [ ] **Step 7: Wykonaj migrację na lokalnej bazie**

Run:
```bash
npm run db:migrate-legacy
npx prisma generate
npx prisma db push --accept-data-loss
```
`--accept-data-loss` jest konieczne: zdjęcie trzech kolumn to na SQLite przebudowa tabeli, a bez flagi Prisma czeka na interaktywne potwierdzenie i w nieinteraktywnej powłoce zawiesza się albo pada. Backup zrobił już krok wcześniej.

Expected: log backupu, log liczby usuniętych połączeń, `prisma db push` kończy się sukcesem. Sprawdź, że projekt przeżył:
```bash
node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().project.findMany().then(r=>{console.log(r.length,'projekt(y):',r.map(p=>p.name));process.exit(0)})"
```
Expected: istniejący projekt na liście, z zachowaną nazwą i `selectedModel`.

- [ ] **Step 8: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: drop schema columns for removed agents and services

preferredCli, activeCursorSessionId and fallbackEnabled describe
choices the product no longer offers, and service connections for
Vercel and Supabase point at integrations that are gone. A column
nobody reads misrepresents what the application can do. The migration
backs up the database first, since db push rebuilds SQLite tables."
```

---

## Faza 2 — flickerowanie czatu i naprawy z audytu

### Task 8: Zatrzymaj kaskadę re-fetchowania czatu (znalezisko B, decyzja 13)

**Files:**
- Modify: `components/chat/ChatLog.tsx` (~1004-1016, ~1993-2020, ~2055-2165)
- Modify: `app/[project_id]/chat/page.tsx` (~2271-2300)

**Interfaces:**
- Consumes: brak `isConnected` po Task 3.
- Produces: `ChatLog` przestaje przeładowywać historię przy re-renderze rodzica. Żadnych zmian w propsach — kontrakt komponentu zostaje.

Flicker miał **dwie** przyczyny. Pierwszą — trzepanie transportu WS, które przy każdym cyklu wołało `recoverMissingMessages()` i otwierało nowy `EventSource` — usunął Task 3. To zadanie zamyka drugą, niezależną od transportu: rodzic przekazuje `onSessionStatusChange` i `onAddUserMessage` jako inline arrow, więc przy każdym jego renderze `checkActiveSession` dostaje nową tożsamość, efekt montujący z deps `[projectId, checkActiveSession, loadChatHistory]` re-runuje się i woła `loadChatHistory({ showLoading: true })` — pełny refetch 200 wiadomości plus `setIsLoading(true)`.

Punkt odniesienia z pomiaru: **przed jakąkolwiek zmianą jedno wejście na stronę projektu dawało ponad 15 pobrań** `messages?limit=200&offset=0`. Task 3 miał to obniżyć; to zadanie ma dowieźć próg z kroku 8.

- [ ] **Step 1: Ustabilizuj handlery od rodzica przez ref**

W `components/chat/ChatLog.tsx`, zaraz po deklaracjach propsów w ciele komponentu, dodaj:

```ts
  const parentHandlersRef = useRef({ onSessionStatusChange, onProjectStatusUpdate, onSseFallbackActive, onAddUserMessage });
  useEffect(() => {
    parentHandlersRef.current = { onSessionStatusChange, onProjectStatusUpdate, onSseFallbackActive, onAddUserMessage };
  }, [onSessionStatusChange, onProjectStatusUpdate, onSseFallbackActive, onAddUserMessage]);
```

Następnie w `checkActiveSession`, `startSessionPolling` i wszędzie tam, gdzie te propsy są wołane, zamień `onSessionStatusChange?.(x)` na `parentHandlersRef.current.onSessionStatusChange?.(x)` (analogicznie dla pozostałych trzech) i **usuń je z tablic deps** tych `useCallback`. Po tej zmianie `checkActiveSession` ma deps `[projectId, startSessionPolling]`, a `startSessionPolling` ma `[projectId]`.

- [ ] **Step 2: Zawęź deps efektu montującego**

Znajdź efekt kończący się na `}, [projectId, checkActiveSession, loadChatHistory]);` (~2155). Zmień tablicę deps na `[projectId]` i dodaj nad nim komentarz:

```ts
  // Ładowanie startowe dla danego projektu. Deps to wyłącznie projectId:
  // handlery od rodzica są niestabilne, a ich zmiana nie jest powodem, by
  // przeładować historię czatu.
  // eslint-disable-next-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Rozdziel `pollIntervalRef` na dwa niezależne refy**

W deklaracjach (~1012) zastąp:

```ts
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
```

dwoma:

```ts
  const sessionPollRef = useRef<NodeJS.Timeout | null>(null);
  const historyPollRef = useRef<NodeJS.Timeout | null>(null);
```

W `startSessionPolling` (~1993) i w cleanupie efektu montującego używaj `sessionPollRef`. W efekcie pollingu historii (~2107) i jego cleanupie używaj `historyPollRef`. Dziś oba konsumenty czyszczą sobie interwały wzajemnie.

- [ ] **Step 4: Wyjmij `messages` z deps efektu pollingu**

W efekcie pollingu historii (~2055) zastąp:

```ts
    const isStreamingMessagePending = messages.some(
      (message) => message.role === 'assistant' && message.isStreaming && !message.isFinal
    );
```

odczytem z refu. Dodaj obok deklaracji refów:

```ts
  const hasStreamingMessageRef = useRef(false);
  useEffect(() => {
    hasStreamingMessageRef.current = messages.some(
      (message) => message.role === 'assistant' && message.isStreaming && !message.isFinal
    );
  }, [messages]);
```

i w efekcie pollingu użyj `hasStreamingMessageRef.current`. Usuń `messages` z tablicy deps tego efektu — dziś każda przychodząca wiadomość niszczy i odtwarza interwał.

- [ ] **Step 5: Przestań gubić flagę „już wczytane" przy końcu sesji**

W `startSessionPolling`, w gałęzi `if (sessionStatus.status !== 'active')`, zastąp `setHasLoadedOnce(false);` (co powoduje pokazanie skeletonu) odświeżeniem bez migotania:

```ts
              setNeedsHistoryRefresh(true);
```

- [ ] **Step 6: Ustabilizuj propsy po stronie rodzica**

W `app/[project_id]/chat/page.tsx` wynieś oba inline handlery przekazywane do `<ChatLog>` do `useCallback` zadeklarowanych w ciele komponentu, powyżej JSX:

```ts
  const handleChatHandlersReady = useCallback((handlers: MessageHandlers) => {
    messageHandlersRef.current = handlers;
  }, []);

  const handleSessionStatusChange = useCallback((isRunningValue: boolean) => {
    setIsRunning(isRunningValue);
  }, []);
```

W JSX podmień `onAddUserMessage={(handlers) => {...}}` na `onAddUserMessage={handleChatHandlersReady}` i `onSessionStatusChange={(isRunningValue) => {...}}` na `onSessionStatusChange={handleSessionStatusChange}`.

Logikę auto-startu preview, która była w inline handlerze (`hasInitialPrompt && !agentWorkComplete && !previewUrl` → `start()`), przenieś do osobnego efektu — ale reagującego na **przejście** `true → false`, nie na sam fakt, że `isRunning` jest `false`. Bez refu efekt odpaliłby się na pierwszym renderze, przed startem agenta, i uruchomił preview na pustym projekcie:

```ts
  const prevIsRunningRef = useRef(false);
  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    prevIsRunningRef.current = isRunning;
    // Tylko zbocze opadające: agent skończył pracę, a nie „agent nie pracuje".
    if (!wasRunning || isRunning) return;
    if (!hasInitialPrompt || agentWorkComplete || previewUrl) return;
    setAgentWorkComplete(true);
    localStorage.setItem(`project_${projectId}_taskComplete`, 'true');
    start();
  }, [isRunning, hasInitialPrompt, agentWorkComplete, previewUrl, projectId, start]);
```

Typ `MessageHandlers` weź z istniejącej deklaracji propsa `onAddUserMessage` w `ChatLogProps` — jeśli jest tam typ inline, wyeksportuj go z `ChatLog.tsx` i zaimportuj tutaj, zamiast powtarzać kształt.

- [ ] **Step 7: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 8: Dowód z uruchomienia — brak pętli refetchowania**

Mierz na buildzie produkcyjnym, nie w dev: `next.config.js:3` ma `reactStrictMode: true`, więc w dev każdy efekt montujący biegnie dwa razy i licznik żądań jest z definicji podwojony.

Run:
```bash
npm run build && npm start
```
Następnie w przeglądarce otwórz projekt, zakładkę Network, filtr `messages`, i wyślij do agenta prompt („dodaj nagłówek na stronie głównej").

Expected — progi zachowaniowe, nie równości (punkt startowy: 15+ pobrań przed zmianami):
- **Skeleton nie wraca ani razu** po pierwszym wczytaniu. To jest właściwy objaw: `setIsLoading(true)` nie może się już odpalić w trakcie runu.
- **Liczba linii `[SSE] Client connected to project` w logu serwera na jedno wejście: 0 albo 1.**

  **Zmierz własny baseline, nie porównuj z liczbą z Task 3.** Tam wyszło 13, ale na dev-serverze, gdzie `reactStrictMode: true` (`next.config.js:3`) dubluje efekty montujące — a Ty mierzysz na buildzie produkcyjnym. Porównywanie tych dwóch liczb to porównywanie dwóch instrumentów. Zrób tak: **przed** swoimi zmianami w kodzie odpal `npm run build && npm start`, wejdź na stronę projektu, policz linie `Client connected`, zapisz jako „przed". Potem wprowadź zmiany, powtórz, zapisz jako „po". Oba pomiary na tym samym instrumencie, wykonane przez tę samą osobę.

  Licz **połączenia**, nie rozłączenia: trasa ma dwie ścieżki teardownu (`:65` i `:72`) i zmiana sposobu zamykania `EventSource` — czyli dokładnie to, co robisz — może przesunąć zdarzenia między nimi, dając spadek licznika bez spadku churnu. Nie mierz też odpowiedzi `503` w logu sieciowym: serwer zawsze odpowiada 200, a 503 jest artefaktem raportowania przerwanego strumienia (zbadane przy Task 3).
- **≤ 2 żądania `messages`** na wejście na stronę, plus **najwyżej jedno** po zakończeniu runu (to zamierzone — krok 5 ustawia `setNeedsHistoryRefresh(true)`, żeby dociągnąć końcówkę bez migotania).
- **Zero żądań `messages` w trakcie** pracy agenta — wiadomości dochodzą przez SSE.

Zapisz w raporcie liczbę żądań w każdej z tych trzech faz. Jeśli w trakcie runu leci choć jedno, kaskada nie jest domknięta.

- [ ] **Step 9: Commit**

```bash
git add components/chat/ChatLog.tsx "app/[project_id]/chat/page.tsx"
git commit -m "fix: stop the chat log from re-fetching on every parent render

The mount effect depended on callbacks whose identity changed whenever
the parent re-rendered, so it re-ran and re-fetched two hundred
messages with the loading state on. Parent handlers now live behind a
ref, the session and history pollers stop clobbering each other's
shared interval handle, and an arriving message no longer tears down
the polling interval."
```

### Task 9: Przestań osieracać dev-servery preview (znalezisko A)

**Files:**
- Create: `lib/services/process-tree.ts`
- Create: `tests/services/process-tree.test.ts`
- Modify: `lib/services/preview.ts` (~854 spawn, ~938 stop)
- Create: `instrumentation.ts` (obsługa sygnałów procesu serwera)

**Interfaces:**
- Consumes: nic.
- Produces:
  ```ts
  export function killProcessTree(pid: number | undefined, signal?: NodeJS.Signals): boolean;
  // lib/services/preview.ts
  export const previewManager: PreviewManager;  // bez zmian
  // nowa metoda publiczna:
  //   public async stopAll(): Promise<void>
  ```
  `stopAll()` jest wołane z `instrumentation.ts`, który powstaje w tym zadaniu
  i który Task 11 rozszerza.

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/services/process-tree.test.ts`:

```ts
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { killProcessTree } from '@/lib/services/process-tree';

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('killProcessTree', () => {
  it('zwraca false dla braku pid', () => {
    expect(killProcessTree(undefined)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('ubija wnuka, nie tylko lidera grupy', async () => {
    // Asercja MUSI dotyczyć wnuka. Gdyby sprawdzała tylko pid `sh`, przeszłaby
    // także dla `process.kill(pid)` — czyli dla wadliwego zachowania, które to
    // zadanie naprawia.
    const marker = path.join(os.tmpdir(), `ptree-${process.pid}-${Date.now()}.pid`);
    const child = spawn(
      'sh',
      ['-c', `node -e "setTimeout(()=>{}, 60000)" & echo $! > ${marker}; wait`],
      { detached: true, stdio: 'ignore' }
    );
    await wait(900);

    const grandchildPid = Number.parseInt(await fs.readFile(marker, 'utf8'), 10);
    expect(Number.isInteger(grandchildPid)).toBe(true);
    expect(isAlive(grandchildPid)).toBe(true);

    expect(killProcessTree(child.pid!)).toBe(true);
    await wait(900);

    expect(isAlive(grandchildPid)).toBe(false);
    expect(isAlive(child.pid!)).toBe(false);
    await fs.rm(marker, { force: true });
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/services/process-tree.test.ts`
Expected: FAIL — nie da się rozwiązać importu

- [ ] **Step 3: Napisz implementację**

Utwórz `lib/services/process-tree.ts`:

```ts
/**
 * Dev-server projektu to `npm run dev`, który spawnuje własne dziecko.
 * Zabicie samego npm zostawia wnuka trzymającego port, dlatego procesy
 * startują jako liderzy grupy (`detached: true`) i giną całą grupą.
 */
export function killProcessTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    // Ujemny pid = cała grupa procesów, której liderem jest pid.
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/services/process-tree.test.ts`
Expected: PASS — 2 testy

- [ ] **Step 5: Startuj dev-server jako lidera grupy**

W `lib/services/preview.ts`, w wywołaniu `spawn` uruchamiającym `npm run dev` (~854), dodaj `detached` do opcji:

```ts
      {
        cwd: projectPath,
        env,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      }
```

- [ ] **Step 6: Ubijaj grupę w `stop()` i dodaj `stopAll()`**

W `lib/services/preview.ts` dodaj import:

```ts
import { killProcessTree } from './process-tree';
```

W metodzie `stop()` zastąp `processInfo.process?.kill('SIGTERM');` tym:

```ts
      killProcessTree(processInfo.process?.pid, 'SIGTERM');
```

Dodaj nową metodę publiczną w klasie `PreviewManager`, obok `stop()`:

```ts
  /**
   * Zamyka wszystkie dev-servery. Wołane z handlera sygnałów procesu —
   * bez tego ubicie Claudable zostawia je żywe, trzymające porty.
   */
  public async stopAll(): Promise<void> {
    const ids = Array.from(this.processes.keys());
    for (const projectId of ids) {
      try {
        await this.stop(projectId);
      } catch (error) {
        console.error(`[PreviewManager] Failed to stop preview for ${projectId}:`, error);
      }
    }
  }
```

- [ ] **Step 7: Podłącz handler sygnałów w `instrumentation.ts`**

`index.js` to wyłącznie entrypoint Electrona (`module.exports = require('./electron/main.js')`) — nie proces, w którym żyje `previewManager`. Właściwym miejscem jest hook instrumentacji Nexta: `register()` wykonuje się raz na proces serwera.

Utwórz `instrumentation.ts` w katalogu głównym repozytorium:

```ts
/**
 * Uruchamiane raz na proces serwera Next.js. Dev-servery projektów są
 * dziećmi tego procesu — bez tego ubicie Claudable zostawia je żywe,
 * trzymające porty z puli preview.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { previewManager } = await import('@/lib/services/preview');

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Shutdown] ${signal} received — stopping preview servers...`);
    try {
      await previewManager.stopAll();
    } catch (error) {
      console.error('[Shutdown] Failed to stop preview servers cleanly:', error);
    }
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}
```

Sprawdź, czy `next.config.js` nie wyłącza instrumentacji. W Next 15 hook jest domyślnie włączony i nie wymaga flagi.

- [ ] **Step 8: Dowód z uruchomienia — brak sierot**

**Nie używaj Ctrl+C jako dowodu.** Dziś preview startuje bez `detached`, więc siedzi w tej samej grupie procesów pierwszoplanowych co Claudable i Ctrl+C już go zabija — test przeszedłby przed zmianą. Po dodaniu `detached: true` Ctrl+C przestaje go dosięgać i jedyną obroną jest handler z kroku 7. Dowód musi więc celować w realny scenariusz z audytu: sygnał do samego procesu serwera.

Run:
```bash
npm run dev &
# w UI: uruchom preview dowolnego projektu, zaczekaj na "ready"
ps -ef | grep "[d]ata/projects" | wc -l          # oczekiwane: >= 1
SERVER_PID=$(pgrep -f "next dev" | head -1)
kill -TERM $SERVER_PID
sleep 3
ps -ef | grep "[d]ata/projects" | wc -l          # oczekiwane: 0
```
Expected: pierwszy odczyt ≥ 1, drugi `0`, a w logach linia `[Shutdown] SIGTERM received`.

Dołóż log **po** `stopAll()`, żeby udowodnić, że handler dobiegł do końca, a nie że Next zawołał `process.exit` w trakcie:

```ts
    console.log('[Shutdown] Preview servers stopped');
```

Jeśli tej linii nie ma w logach, handler jest wyprzedzany przez cudzy `process.exit` — zgłoś jako BLOCKED wraz z logiem, nie obchodź.

Powtórz ten sam pomiar dla kontenera w Task 20: `docker compose stop` i `ps` w środku kontenera przed zatrzymaniem.

- [ ] **Step 9: Commit**

```bash
git add lib/services/process-tree.ts tests/services/process-tree.test.ts lib/services/preview.ts instrumentation.ts
git commit -m "fix: stop leaking preview dev servers

Preview processes spawned without detached, and stop() signalled npm
rather than the tree below it, so the next dev grandchild survived and
kept its port. Nothing handled SIGINT or SIGTERM at all, so killing
Claudable orphaned every preview. They now start as group leaders, die
as a group, and get stopped on shutdown."
```

### Task 10: Jeden resolver ścieżek projektu i guard na assetach (znaleziska E, F)

**Files:**
- Create: `lib/utils/project-path.ts`
- Create: `tests/utils/project-path.test.ts`
- Modify: `app/api/chat/[project_id]/act/route.ts` (usuń lokalne kopie resolvera)
- Modify: `lib/services/preview.ts` (dwa miejsca liczące ścieżkę projektu)
- Modify: `app/api/assets/[project_id]/[filename]/route.ts`

**Interfaces:**
- Consumes: nic.
- Produces:
  ```ts
  export const PROJECTS_DIR_ABSOLUTE: string;
  export function resolveProjectRoot(projectId: string, repoPath?: string | null): string;
  export function resolveSafeProjectPath(projectRoot: string, relativePath: string): string; // rzuca przy wyjściu poza root
  ```
  Task 13 i 14 używają `resolveProjectRoot`; nie definiuj drugiej kopii.

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/utils/project-path.test.ts`:

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECTS_DIR_ABSOLUTE, resolveProjectRoot, resolveSafeProjectPath } from '@/lib/utils/project-path';

describe('resolveProjectRoot', () => {
  it('używa repoPath, gdy jest absolutny', () => {
    expect(resolveProjectRoot('p1', '/srv/projects/p1')).toBe('/srv/projects/p1');
  });

  it('rozwiązuje relatywny repoPath względem cwd', () => {
    expect(resolveProjectRoot('p1', './data/projects/p1')).toBe(path.resolve(process.cwd(), 'data/projects/p1'));
  });

  it('bez repoPath schodzi do katalogu projektów, nie do cwd/projects', () => {
    expect(resolveProjectRoot('p1')).toBe(path.join(PROJECTS_DIR_ABSOLUTE, 'p1'));
    expect(resolveProjectRoot('p1', null)).toBe(path.join(PROJECTS_DIR_ABSOLUTE, 'p1'));
  });
});

describe('resolveSafeProjectPath', () => {
  const root = '/srv/projects/p1';

  it('przepuszcza ścieżkę wewnątrz katalogu', () => {
    expect(resolveSafeProjectPath(root, 'assets/logo.png')).toBe('/srv/projects/p1/assets/logo.png');
  });

  it('przepuszcza sam katalog', () => {
    expect(resolveSafeProjectPath(root, '.')).toBe(root);
  });

  it('blokuje wyjście przez ..', () => {
    expect(() => resolveSafeProjectPath(root, '../../etc/passwd')).toThrow(/outside/i);
  });

  it('blokuje wyjście przez zagnieżdżone ..', () => {
    expect(() => resolveSafeProjectPath(root, 'assets/../../../secrets.env')).toThrow(/outside/i);
  });

  it('blokuje ścieżkę absolutną', () => {
    expect(() => resolveSafeProjectPath(root, '/etc/passwd')).toThrow(/outside/i);
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/utils/project-path.test.ts`
Expected: FAIL — nie da się rozwiązać importu

- [ ] **Step 3: Napisz implementację**

Utwórz `lib/utils/project-path.ts`:

```ts
import path from 'node:path';

const PROJECTS_DIR = process.env.PROJECTS_DIR || './data/projects';

export const PROJECTS_DIR_ABSOLUTE = path.isAbsolute(PROJECTS_DIR)
  ? PROJECTS_DIR
  : path.resolve(process.cwd(), PROJECTS_DIR);

/**
 * Jedyne miejsce liczące katalog projektu. Trzy kopie tej logiki rozjechały
 * się wcześniej na fallbacku `cwd/projects/<id>`, którego walidacja adaptera
 * nie akceptowała — użytkownik dostawał błąd bezpieczeństwa zamiast projektu.
 */
export function resolveProjectRoot(projectId: string, repoPath?: string | null): string {
  if (repoPath) {
    return path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath);
  }
  return path.join(PROJECTS_DIR_ABSOLUTE, projectId);
}

/**
 * Rozwiązuje ścieżkę względną wewnątrz katalogu projektu i odrzuca każdą,
 * która z niego wychodzi.
 */
export function resolveSafeProjectPath(projectRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(projectRoot);
  const resolved = path.resolve(normalizedRoot, relativePath);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path escapes the project directory: resolved outside ${normalizedRoot}`);
  }
  return resolved;
}
```

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/utils/project-path.test.ts`
Expected: PASS — 8 testów

- [ ] **Step 5: Zastąp kopie resolvera**

- `app/api/chat/[project_id]/act/route.ts` — usuń lokalne `PROJECTS_DIR`, `PROJECTS_DIR_ABSOLUTE`, `resolveProjectRoot`, `resolveAssetsPath` i `ensureAbsoluteAssetPath`; importuj z `@/lib/utils/project-path`. `resolveAssetsPath` zamień na `path.join(resolveProjectRoot(projectId, null), 'assets')`, a `ensureAbsoluteAssetPath` na `resolveSafeProjectPath(resolveProjectRoot(projectId, null), inputPath)` owinięte w `try/catch`, które przy rzuceniu zwraca `null` z tej samej ścieżki, którą dziś obsługuje brak pliku. Usuń też fallback `path.join(process.cwd(), 'projects', project_id)` przy `projectPath` — użyj `resolveProjectRoot(project_id, project.repoPath)`.
- `lib/services/preview.ts` — w `installDependencies` i `start` zamień oba wystąpienia
  `project.repoPath ? path.resolve(project.repoPath) : path.join(process.cwd(), 'projects', projectId)`
  na `resolveProjectRoot(projectId, project.repoPath)`.

- [ ] **Step 6: Domknij guard na serwowaniu assetów**

W `app/api/assets/[project_id]/[filename]/route.ts` zastąp

```ts
    const filePath = path.join(PROJECTS_DIR_ABSOLUTE, project_id, 'assets', filename);
```

tym:

```ts
    const assetsRoot = path.join(resolveProjectRoot(project_id, project.repoPath), 'assets');
    let filePath: string;
    try {
      filePath = resolveSafeProjectPath(assetsRoot, filename);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid filename' }, { status: 400 });
    }
```

i podmień import lokalnych stałych na `import { resolveProjectRoot, resolveSafeProjectPath } from '@/lib/utils/project-path';`. Usuń lokalne `PROJECTS_DIR`/`PROJECTS_DIR_ABSOLUTE` z tego pliku.

- [ ] **Step 7: Sprawdź, że traversal jest odrzucany**

Run: `npm run dev` i w drugim terminalu:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/assets/<istniejacy-project-id>/..%2f..%2f..%2f.env"
```
Expected: `400` (albo `404` — nigdy `200` z treścią pliku `.env`). Wklej kod odpowiedzi do raportu.

- [ ] **Step 8: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 9: Commit**

```bash
git add lib/utils/project-path.ts tests/utils/project-path.test.ts "app/api/chat/[project_id]/act/route.ts" lib/services/preview.ts "app/api/assets/[project_id]/[filename]/route.ts"
git commit -m "fix: resolve project paths in one place and guard asset reads

Three copies of the path logic disagreed: two fell back to
cwd/projects/<id>, which the adapter's validation rejected, so a
project without repoPath produced a security error instead of a
project. The asset route joined a raw URL segment onto a directory with
no traversal check, while the file browser already had a helper for
exactly that."
```

### Task 11: Rekoncyliacja zawieszonych zgłoszeń przy starcie (znalezisko D)

**Files:**
- Modify: `lib/services/user-requests.ts`
- Create: `tests/services/reconcile-requests.test.ts`
- Modify: `instrumentation.ts` (utworzony w Task 9)

**Interfaces:**
- Consumes: `instrumentation.ts` z Task 9.
- Produces:
  ```ts
  export interface StaleRequestClient {
    userRequest: {
      updateMany(args: {
        where: { status: { in: string[] } };
        data: { status: string; errorMessage: string; completedAt: Date };
      }): Promise<{ count: number }>;
    };
  }
  export const RECONCILABLE_STATUSES: string[];  // ['pending','processing','active','running']
  export async function reconcileStaleRequests(client?: StaleRequestClient): Promise<number>;
  ```

Dlaczego to jest potrzebne: jedynym pisarzem statusu jest proces, który wykonuje agenta. Gdy padnie w trakcie, wiersz zostaje w `processing` na zawsze, `/requests/active` liczy go jako aktywny, a UI pollinguje co 500 ms run, którego nie ma.

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/services/reconcile-requests.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { RECONCILABLE_STATUSES, reconcileStaleRequests } from '@/lib/services/user-requests';

describe('reconcileStaleRequests', () => {
  it('oznacza wszystkie niedomknięte statusy jako failed', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const count = await reconcileStaleRequests({ userRequest: { updateMany } });

    expect(count).toBe(3);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: { in: RECONCILABLE_STATUSES } });
    expect(args.data.status).toBe('failed');
    expect(args.data.errorMessage).toMatch(/restart/i);
    expect(args.data.completedAt).toBeInstanceOf(Date);
  });

  it('zwraca zero i nie wybucha, gdy zapis padnie', async () => {
    const updateMany = vi.fn().mockRejectedValue(new Error('db locked'));
    await expect(reconcileStaleRequests({ userRequest: { updateMany } })).resolves.toBe(0);
  });

  it('nie obejmuje statusów terminalnych', () => {
    expect(RECONCILABLE_STATUSES).not.toContain('completed');
    expect(RECONCILABLE_STATUSES).not.toContain('failed');
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/services/reconcile-requests.test.ts`
Expected: FAIL — `reconcileStaleRequests is not a function`

- [ ] **Step 3: Napisz implementację**

W `lib/services/user-requests.ts` dodaj na końcu pliku:

```ts
export const RECONCILABLE_STATUSES = ['pending', 'processing', 'active', 'running'];

export interface StaleRequestClient {
  userRequest: {
    updateMany(args: {
      where: { status: { in: string[] } };
      data: { status: string; errorMessage: string; completedAt: Date };
    }): Promise<{ count: number }>;
  };
}

/**
 * Statusy zgłoszeń pisze wyłącznie proces wykonujący agenta. Jeśli padnie
 * w trakcie, wiersz zostaje w `processing` na zawsze i UI pokazuje run,
 * którego nie ma. Przy starcie każdy niedomknięty run jest z definicji
 * martwy — nie ma go kto kontynuować.
 */
export async function reconcileStaleRequests(client: StaleRequestClient = prisma): Promise<number> {
  try {
    const result = await client.userRequest.updateMany({
      where: { status: { in: RECONCILABLE_STATUSES } },
      data: {
        status: 'failed',
        errorMessage: 'Interrupted by a server restart',
        completedAt: new Date(),
      },
    });
    if (result.count > 0) {
      console.log(`[UserRequests] Reconciled ${result.count} request(s) interrupted by a restart`);
    }
    return result.count;
  } catch (error) {
    console.error('[UserRequests] Failed to reconcile stale requests:', error);
    return 0;
  }
}
```

Sprawdź, czy `prisma` jest już zaimportowane w tym pliku; jeśli nie, dodaj `import { prisma } from '@/lib/db/client';`.

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/services/reconcile-requests.test.ts`
Expected: PASS — 3 testy

- [ ] **Step 5: Odpal rekoncyliację raz na proces**

W `instrumentation.ts` (powstał w Task 9) dodaj rekoncyliację na początku `register()`, przed rejestracją handlerów sygnałów:

```ts
  const { reconcileStaleRequests } = await import('@/lib/services/user-requests');
  await reconcileStaleRequests();
```

To jest właściwe miejsce: wykonuje się raz na proces serwera, przed obsługą pierwszego żądania — a każdy run niedomknięty w chwili startu jest z definicji martwy, bo nie ma go kto kontynuować.

- [ ] **Step 6: Dowód z uruchomienia**

Run:
```bash
npm run dev
# W UI wyślij prompt do agenta, a gdy zacznie pracować, ubij serwer (Ctrl+C).
node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().userRequest.findMany({where:{status:'processing'}}).then(r=>{console.log('processing przed restartem:',r.length);process.exit(0)})"
npm run dev
# Otwórz projekt w UI, potem:
node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().userRequest.findMany({where:{status:'processing'}}).then(r=>{console.log('processing po restarcie:',r.length);process.exit(0)})"
```
Expected: pierwszy odczyt ≥ 1, drugi `0`, a UI nie pokazuje trwającego runu. Wklej oba odczyty do raportu.

- [ ] **Step 7: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 8: Commit**

```bash
git add lib/services/user-requests.ts tests/services/reconcile-requests.test.ts instrumentation.ts
git commit -m "fix: reconcile requests interrupted by a restart

Only the process running the agent writes request status, so a crash
mid-run left the row in processing forever. The active-requests
endpoint then reported a run that did not exist and the client polled
it twice a second indefinitely. Unfinished runs are marked failed once
per process."
```

---

## Faza 3 — modele i parytet agenta z terminalem

### Task 12: Aktualna lista modeli Claude (decyzje 17, 18)

**Files:**
- Modify: `lib/constants/claudeModels.ts`
- Create: `tests/constants/claude-models.test.ts`
- Modify: `prisma/schema.prisma` (komentarz przy `selectedModel`)

**Interfaces:**
- Consumes: nic.
- Produces:
  ```ts
  export type ClaudeModelId = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5';
  export const CLAUDE_DEFAULT_MODEL: ClaudeModelId;  // 'claude-sonnet-5'
  ```
  `normalizeClaudeModelId`, `getClaudeModelDefinition`, `getClaudeModelDisplayName`, `CLAUDE_MODEL_DEFINITIONS` — sygnatury bez zmian.

Generacja 4.6 nie jest usuwana, tylko schodzi do `aliases` — to konwencja już obecna w tym pliku (leżą tam `claude-opus-4-5`, `claude-sonnet-4-5` i starsze). Dzięki temu wiersz w bazie z `claude-sonnet-4-6` rozwiąże się jawnie na Sonnet 5, a nie po cichu na default.

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/constants/claude-models.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_MODEL_DEFINITIONS,
  getClaudeModelDisplayName,
  normalizeClaudeModelId,
} from '@/lib/constants/claudeModels';

describe('lista modeli Claude', () => {
  it('zawiera dokładnie trzy aktualne modele', () => {
    expect(CLAUDE_MODEL_DEFINITIONS.map((d) => d.id)).toEqual([
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
  });

  it('domyślnym modelem jest Sonnet 5', () => {
    expect(CLAUDE_DEFAULT_MODEL).toBe('claude-sonnet-5');
  });

  it('żadne id nie nosi sufiksu daty', () => {
    for (const definition of CLAUDE_MODEL_DEFINITIONS) {
      expect(definition.id).not.toMatch(/-\d{8}$/);
    }
  });
});

describe('normalizeClaudeModelId', () => {
  it('rozwiązuje skróty', () => {
    expect(normalizeClaudeModelId('opus')).toBe('claude-opus-5');
    expect(normalizeClaudeModelId('sonnet')).toBe('claude-sonnet-5');
    expect(normalizeClaudeModelId('haiku')).toBe('claude-haiku-4-5');
  });

  it('podnosi generację 4.6 na piątkę', () => {
    expect(normalizeClaudeModelId('claude-opus-4-6')).toBe('claude-opus-5');
    expect(normalizeClaudeModelId('claude-sonnet-4-6')).toBe('claude-sonnet-5');
  });

  it('przyjmuje starą datowaną formę Haiku', () => {
    expect(normalizeClaudeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
  });

  it('schodzi do domyślnego przy braku i przy śmieciu', () => {
    expect(normalizeClaudeModelId(undefined)).toBe('claude-sonnet-5');
    expect(normalizeClaudeModelId('gpt-4')).toBe('claude-sonnet-5');
  });
});

describe('getClaudeModelDisplayName', () => {
  it('zwraca nazwy czytelne dla człowieka', () => {
    expect(getClaudeModelDisplayName('claude-sonnet-5')).toBe('Claude Sonnet 5');
    expect(getClaudeModelDisplayName('claude-opus-5')).toBe('Claude Opus 5');
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/constants/claude-models.test.ts`
Expected: FAIL — lista modeli nie zgadza się z oczekiwaną

- [ ] **Step 3: Podmień listę modeli**

W `lib/constants/claudeModels.ts` zastąp typ `ClaudeModelId`, tablicę `CLAUDE_MODEL_DEFINITIONS` i `CLAUDE_DEFAULT_MODEL`. Reszta pliku (`CLAUDE_MODEL_ALIAS_MAP`, `normalizeClaudeModelId`, `getClaudeModelDefinition`, `getClaudeModelDisplayName`) zostaje **bez zmian**.

```ts
export type ClaudeModelId =
  | 'claude-opus-5'
  | 'claude-sonnet-5'
  | 'claude-haiku-4-5';
```

```ts
export const CLAUDE_MODEL_DEFINITIONS: ClaudeModelDefinition[] = [
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    description: 'The most intelligent model for building agents and coding',
    supportsImages: true,
    aliases: [
      'claude-opus-5', 'claude-opus', 'opus-5', 'opus',
      // Poprzednie generacje: rozwiązują się w górę, nie na default
      'claude-opus-4-6', 'claude-opus-4.6',
      'claude-opus-4-5-20251101', 'claude-opus-4-5', 'claude-opus-4.5',
      'claude-opus-4-1-20250805', 'claude-opus-4-1', 'claude-opus-4.1',
      'claude-opus-4', 'opus-4-6', 'opus-4.6', 'opus-4',
      'claude-3-opus', 'claude-3-opus-20240229', 'claude-3-opus-latest',
    ],
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    description: 'The best combination of speed and intelligence',
    supportsImages: true,
    aliases: [
      'claude-sonnet-5', 'claude-sonnet', 'sonnet-5', 'sonnet',
      'claude-sonnet-4-6', 'claude-sonnet-4.6',
      'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5', 'claude-sonnet-4.5',
      'claude-sonnet-4', 'sonnet-4-6', 'sonnet-4.6', 'sonnet-4',
      'claude-3.5-sonnet', 'claude-3-5-sonnet',
      'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-latest',
    ],
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    description: 'The fastest model with near-frontier intelligence',
    supportsImages: true,
    aliases: [
      'claude-haiku-4-5', 'claude-haiku-4.5', 'claude-haiku', 'haiku-4-5', 'haiku-4.5', 'haiku',
      'claude-haiku-4-5-20251001', 'haiku-4-5-20251001',
      'claude-haiku-4', 'haiku-4',
      'claude-3-haiku', 'claude-3-haiku-20240307', 'claude-3-haiku-latest', 'claude-haiku-3.5',
    ],
  },
];
```

```ts
export const CLAUDE_DEFAULT_MODEL: ClaudeModelId = 'claude-sonnet-5';
```

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/constants/claude-models.test.ts`
Expected: PASS — 9 testów

- [ ] **Step 5: Popraw komentarz w schemacie**

W `prisma/schema.prisma` ustaw komentarz przy `selectedModel` na:

```
  selectedModel String? @map("selected_model") // claude-opus-5 | claude-sonnet-5 | claude-haiku-4-5
```

- [ ] **Step 6: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 7: Commit**

```bash
git add lib/constants/claudeModels.ts tests/constants/claude-models.test.ts prisma/schema.prisma
git commit -m "feat: offer Opus 5 and Sonnet 5, defaulting to Sonnet 5

The 4.6 generation moves into aliases rather than being deleted, which
is how this file has always handled superseded ids, so a stored
claude-sonnet-4-6 resolves up to Sonnet 5 instead of silently falling
back to the default. Haiku's canonical id loses the date suffix it kept
by mistake, and the old form stays as an alias."
```

### Task 13: Parytet agenta z terminalem (decyzje 23, 24, 25, 26)

**Files:**
- Create: `lib/services/cli/claude-config-dir.ts`
- Modify: `lib/services/cli/claude-options.ts`
- Modify: `tests/cli/claude-options.test.ts`
- Create: `tests/cli/claude-config-dir.test.ts`
- Modify: `lib/services/cli/claude.ts` (usunięcie guardu ścieżki)

**Interfaces:**
- Consumes: `buildClaudeQueryOptions` (Task 1).
- Produces:
  ```ts
  // lib/services/cli/claude-config-dir.ts
  export function resolveClaudeConfigDir(): string;  // CLAUDE_CONFIG_DIR → $HOME/.claude
  ```
  `buildClaudeQueryOptions` zwraca teraz dodatkowo `systemPrompt: { type: 'preset', preset: 'claude_code' }` i `settingSources: ['user','project','local']`, i **nie** zwraca `maxOutputTokens`. Task 14 dokłada `agents`. Task 15 i 20 używają `resolveClaudeConfigDir`.

Zmierzone (design record, sekcja 4.8): `settingSources` wnosi skille, `CLAUDE.md`, serwery MCP z katalogu konfiguracyjnego i hooki z `settings.json`. Nie wnosi subagentów z plików — to Task 14. Pominięcie `systemPrompt` **nie** daje domyślnego promptu, a pusty (`sdk.mjs`: `if (Y === void 0) G = ""`), więc preset musi być podany jawnie.

- [ ] **Step 1: Napisz failujący test katalogu konfiguracyjnego**

Utwórz `tests/cli/claude-config-dir.test.ts`:

```ts
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClaudeConfigDir } from '@/lib/services/cli/claude-config-dir';

const original = process.env.CLAUDE_CONFIG_DIR;

afterEach(() => {
  if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = original;
});

describe('resolveClaudeConfigDir', () => {
  it('honoruje CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = '/mnt/claude-home';
    expect(resolveClaudeConfigDir()).toBe('/mnt/claude-home');
  });

  it('schodzi do ~/.claude', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(resolveClaudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });

  it('ignoruje pustą wartość', () => {
    process.env.CLAUDE_CONFIG_DIR = '   ';
    expect(resolveClaudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });
});
```

- [ ] **Step 2: Rozszerz test opcji o źródła ustawień**

Preset promptu wszedł już w Task 1 (i ma tam swój test) — tutaj dochodzi tylko ładowanie z dysku. W `tests/cli/claude-options.test.ts` dodaj do bloku `describe('buildClaudeQueryOptions', ...)`:

```ts
  it('włącza wszystkie źródła ustawień z dysku', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
  });
```

- [ ] **Step 3: Uruchom testy i potwierdź, że failują**

Run: `npx vitest run tests/cli/`
Expected: FAIL — brak modułu `claude-config-dir` oraz trzy nowe asercje w `claude-options`

- [ ] **Step 4: Napisz resolver katalogu konfiguracyjnego**

Utwórz `lib/services/cli/claude-config-dir.ts`:

```ts
import os from 'node:os';
import path from 'node:path';

/**
 * Katalog, z którego agent bierze ustawienia, skille, hooki, MCP i CLAUDE.md
 * — dokładnie ten, którego użyłby `claude` w terminalu. W kontenerze wskazuje
 * na zamontowany wolumen.
 */
export function resolveClaudeConfigDir(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) {
    return configured;
  }
  return path.join(os.homedir(), '.claude');
}
```

- [ ] **Step 5: Dołóż parytet do budowania opcji**

W `lib/services/cli/claude-options.ts` zmień zwracany obiekt:

```ts
export function buildClaudeQueryOptions(input: BuildClaudeOptionsInput): Options {
  return {
    cwd: input.projectPath,
    additionalDirectories: [input.projectPath],
    model: input.model,
    resume: input.sessionId,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // Nowe w tym zadaniu: skille, CLAUDE.md, hooki i MCP z katalogu
    // konfiguracyjnego. Bez tego SDK działa w trybie izolacji i nie czyta z dysku nic.
    settingSources: ['user', 'project', 'local'],
  };
}
```

- [ ] **Step 6: Uruchom testy i potwierdź, że przechodzą**

Run: `npx vitest run tests/cli/`
Expected: PASS — 6 testów w `claude-options`, 3 w `claude-config-dir`, 2 w `init-payload`

- [ ] **Step 7: Odetnij zmienne sesji Claude Code od procesu agenta**

**Zmierzone na uruchomionej aplikacji.** Claudable odpalony z terminala, w którym działa Claude Code, dziedziczy zmienną `CLAUDECODE` — i agent nie startuje wcale:

```
[ClaudeSDK][stderr] Error: Claude Code cannot be launched inside another Claude Code session.
Nested sessions share runtime resources and will crash all active sessions.
To bypass this check, unset the CLAUDECODE environment variable.
[API] Failed to execute AI: Error: Claude Code process exited with code 1
```

Claudable **nie jest** zagnieżdżoną sesją Claude Code — to aplikacja osadzająca SDK, więc ta blokada jej nie dotyczy, a dziedziczenie zmiennej jest przypadkiem. W kontenerze problem nie wystąpi (czyste środowisko), ale lokalnie zabija agenta bez śladu w UI: użytkownik widzi tylko nieudane zgłoszenie.

Dodaj do `buildClaudeQueryOptions` czyszczenie tych zmiennych w środowisku procesu potomnego:

```ts
const CLAUDE_SESSION_VARS = ['CLAUDECODE', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_ENTRYPOINT'] as const;

/**
 * Claudable osadza SDK, więc nie jest zagnieżdżoną sesją Claude Code — ale
 * odpalony z terminala, w którym Claude Code działa, dziedziczy jego zmienne
 * i SDK odmawia startu. Odcinamy je dla procesu potomnego.
 */
function childEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of CLAUDE_SESSION_VARS) {
    delete env[key];
  }
  return env;
}
```

i zwróć `env: childEnv()` w obiekcie opcji.

Test do dopisania w `tests/cli/claude-options.test.ts`:

```ts
  it('odcina zmienne sesji Claude Code od procesu potomnego', () => {
    process.env.CLAUDECODE = '1';
    process.env.CLAUDE_CODE_SSE_PORT = '12345';
    try {
      const options = buildClaudeQueryOptions(input);
      expect(options.env).toBeDefined();
      expect(options.env).not.toHaveProperty('CLAUDECODE');
      expect(options.env).not.toHaveProperty('CLAUDE_CODE_SSE_PORT');
      // reszta środowiska musi przejść nietknięta
      expect(options.env?.PATH).toBe(process.env.PATH);
    } finally {
      delete process.env.CLAUDECODE;
      delete process.env.CLAUDE_CODE_SSE_PORT;
    }
  });
```

Uruchom `npx vitest run tests/cli/claude-options.test.ts` — najpierw musi failować na `options.env` równym `undefined`.

- [ ] **Step 8: Zdejmij guard ścieżki z `claude.ts`**

`maxOutputTokens` wypadło już w Task 1 razem z rzutowaniem `as any` — i, jak się okazało, nigdy nie działało (nie ma tej właściwości w typie `Options` SDK), więc decyzja 25 nie zmienia żadnego zachowania. Tutaj zostaje guard ścieżki.

W `lib/services/cli/claude.ts`:
1. Usuń cały blok walidacji ścieżki — od `// Security: Verify project path is within allowed directory` do `throw new Error(errorMessage);` włącznie z obliczaniem `allowedBasePath`, `relativeToBase` i `isWithinBase` (~684-700). Zostaje samo wyliczenie `absoluteProjectPath` oraz tworzenie katalogu, jeśli nie istnieje.
2. Zamień lokalne wyliczenie `absoluteProjectPath` na `resolveProjectRoot` z Task 10:
   ```ts
   import { resolveProjectRoot } from '@/lib/utils/project-path';
   // ...
   const absoluteProjectPath = resolveProjectRoot(projectId, projectPath);
   ```

- [ ] **Step 9: Dowód z uruchomienia — payload `init` potwierdza parytet**

Run: `npm run dev`, wyślij dowolny prompt do agenta i odczytaj log serwera z Task 2.
Expected w `Session initialized`:
- `cwd` = ścieżka katalogu projektu (**nie** katalog Claudable),
- `permissionMode` = `bypassPermissions`,
- `skills` — liczba większa niż liczba skilli wbudowanych w CLI (czyli ładują się te z katalogu konfiguracyjnego),
- `slashCommands` — również dłuższa lista niż przed zmianą; to dowód równorzędny ze `skills`, bo komendy również pochodzą z plików,
- `mcpServers` — zawiera serwery z konfiguracji katalogu, jeśli są tam zdefiniowane.

Punkt odniesienia z pomiaru wykonanego przy bramce designu, na tym samym koncie: bez `settingSources` sesja widziała **5 skilli i 15 slash-komend**; z `settingSources` — **24 skille i 36 komend**. Jeśli po zmianie liczby zostają przy 5 i 15, ładowanie z dysku nie działa.

Wklej cały obiekt `Session initialized` do raportu zadania. Puste `skills` przy niepustym katalogu `skills/` znaczy, że montowanie/symlinki nie działają — zgłoś to jako BLOCKED, nie obchodź.

- [ ] **Step 10: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 11: Commit**

```bash
git add lib/services/cli/claude-config-dir.ts tests/cli/claude-config-dir.test.ts lib/services/cli/claude-options.ts tests/cli/claude-options.test.ts lib/services/cli/claude.ts
git commit -m "feat: run the agent with terminal parity

A raw systemPrompt string replaced the Claude Code preset rather than
extending it, and without settingSources nothing loaded from disk: no
skills, no CLAUDE.md, no MCP servers, no hooks. The agent now reads its
instructions from the configured .claude directory exactly as the
terminal does. The output-token cap and the projects-directory guard go
per the design record; containment is the container's job."
```

### Task 14: Subagenci z plików (decyzja 28)

**Files:**
- Create: `lib/services/cli/agents-loader.ts`
- Create: `tests/cli/agents-loader.test.ts`
- Modify: `lib/services/cli/claude-options.ts`
- Modify: `tests/cli/claude-options.test.ts`
- Modify: `lib/services/cli/claude.ts`

**Interfaces:**
- Consumes: `resolveClaudeConfigDir` (Task 13), `resolveProjectRoot` (Task 10).
- Produces:
  ```ts
  export function parseAgentMarkdown(source: string): { name: string; definition: AgentDefinition } | null;
  export async function loadAgentDefinitions(dirs: string[]): Promise<Record<string, AgentDefinition>>;
  ```
  `BuildClaudeOptionsInput` zyskuje opcjonalne `agents?: Record<string, AgentDefinition>`.

Zmierzone: `settingSources` **nie** ładuje definicji subagentów z plików — pięć plików w katalogu użytkownika i jeden w katalogu projektu nie pojawiły się w `agents` payloadu `init`. Terminal je widzi, więc parytet wymaga wczytania ich samodzielnie.

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/cli/agents-loader.test.ts`:

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAgentDefinitions, parseAgentMarkdown } from '@/lib/services/cli/agents-loader';

const AGENT_MD = `---
name: reviewer
description: Reviews a diff and reports findings.
tools: Read, Grep, Bash
model: opus
---
You are a reviewer. Report findings, do not fix them.
`;

describe('parseAgentMarkdown', () => {
  it('czyta frontmatter i treść promptu', () => {
    const parsed = parseAgentMarkdown(AGENT_MD);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('reviewer');
    expect(parsed!.definition.description).toBe('Reviews a diff and reports findings.');
    expect(parsed!.definition.tools).toEqual(['Read', 'Grep', 'Bash']);
    expect(parsed!.definition.model).toBe('opus');
    expect(parsed!.definition.prompt).toContain('You are a reviewer.');
  });

  it('pomija plik bez frontmatteru', () => {
    expect(parseAgentMarkdown('Just a note.')).toBeNull();
  });

  it('pomija plik bez nazwy albo bez opisu', () => {
    expect(parseAgentMarkdown('---\ndescription: no name\n---\nbody')).toBeNull();
    expect(parseAgentMarkdown('---\nname: nameless\n---\nbody')).toBeNull();
  });

  it('pomija nieznany model zamiast go przepuszczać', () => {
    const parsed = parseAgentMarkdown('---\nname: a\ndescription: d\nmodel: gpt-4\n---\nbody');
    expect(parsed!.definition.model).toBeUndefined();
  });
});

describe('loadAgentDefinitions', () => {
  it('zbiera definicje z wielu katalogów, późniejszy wygrywa', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-'));
    const userDir = path.join(base, 'user', 'agents');
    const projectDir = path.join(base, 'project', 'agents');
    await fs.mkdir(userDir, { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(userDir, 'reviewer.md'), AGENT_MD);
    await fs.writeFile(path.join(userDir, 'notes.txt'), 'ignored');
    await fs.writeFile(
      path.join(projectDir, 'reviewer.md'),
      '---\nname: reviewer\ndescription: Project override.\n---\nProject prompt.\n'
    );

    const agents = await loadAgentDefinitions([userDir, projectDir]);
    expect(Object.keys(agents)).toEqual(['reviewer']);
    expect(agents.reviewer.description).toBe('Project override.');
  });

  it('znosi nieistniejący katalog', async () => {
    await expect(loadAgentDefinitions(['/nope/nowhere'])).resolves.toEqual({});
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/cli/agents-loader.test.ts`
Expected: FAIL — nie da się rozwiązać importu

- [ ] **Step 3: Napisz implementację**

Utwórz `lib/services/cli/agents-loader.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

const ALLOWED_MODELS = new Set(['sonnet', 'opus', 'haiku', 'inherit']);

const splitList = (value: string): string[] =>
  value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);

/**
 * `settingSources` wnosi z dysku skille, hooki i CLAUDE.md, ale nie definicje
 * subagentów — te trafiają do sesji wyłącznie przez opcję `agents`. Terminal
 * je widzi, więc żeby zachować parytet, czytamy je sami.
 */
export function parseAgentMarkdown(source: string): { name: string; definition: AgentDefinition } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) {
    return null;
  }
  const [, frontmatter, body] = match;

  const fields = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key) fields.set(key, value);
  }

  const name = fields.get('name');
  const description = fields.get('description');
  if (!name || !description) {
    return null;
  }

  const rawModel = fields.get('model');
  const tools = fields.get('tools');
  const disallowedTools = fields.get('disallowedtools');

  const definition: AgentDefinition = {
    description,
    prompt: body.trim(),
    ...(tools ? { tools: splitList(tools) } : {}),
    ...(disallowedTools ? { disallowedTools: splitList(disallowedTools) } : {}),
    ...(rawModel && ALLOWED_MODELS.has(rawModel)
      ? { model: rawModel as AgentDefinition['model'] }
      : {}),
  };

  return { name, definition };
}

/**
 * Katalogi są przetwarzane w podanej kolejności — późniejszy nadpisuje
 * wcześniejszego, więc definicja z katalogu projektu wygrywa z globalną.
 */
export async function loadAgentDefinitions(dirs: string[]): Promise<Record<string, AgentDefinition>> {
  const agents: Record<string, AgentDefinition> = {};

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      try {
        const source = await fs.readFile(path.join(dir, entry), 'utf8');
        const parsed = parseAgentMarkdown(source);
        if (parsed) {
          agents[parsed.name] = parsed.definition;
        }
      } catch (error) {
        console.warn(`[AgentsLoader] Skipped ${path.join(dir, entry)}:`, error);
      }
    }
  }

  return agents;
}
```

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/cli/agents-loader.test.ts`
Expected: PASS — 6 testów

- [ ] **Step 5: Rozszerz test opcji o subagentów**

W `tests/cli/claude-options.test.ts` dodaj:

```ts
  it('przekazuje wczytanych subagentów', () => {
    const agents = { reviewer: { description: 'd', prompt: 'p' } };
    const options = buildClaudeQueryOptions({ ...input, agents });
    expect(options.agents).toEqual(agents);
  });

  it('pomija pole agents, gdy nic nie wczytano', () => {
    expect(buildClaudeQueryOptions(input).agents).toBeUndefined();
    expect(buildClaudeQueryOptions({ ...input, agents: {} }).agents).toBeUndefined();
  });
```

- [ ] **Step 6: Uruchom test i potwierdź, że failuje, potem dołóż pole**

Run: `npx vitest run tests/cli/claude-options.test.ts`
Expected: FAIL — `options.agents` jest `undefined`

W `lib/services/cli/claude-options.ts` dodaj do `BuildClaudeOptionsInput`:

```ts
  agents?: Record<string, AgentDefinition>;
```
(z importem `import type { AgentDefinition, Options } from '@anthropic-ai/claude-agent-sdk';`)

i do zwracanego obiektu, na końcu:

```ts
    ...(input.agents && Object.keys(input.agents).length > 0 ? { agents: input.agents } : {}),
```

Run: `npx vitest run tests/cli/claude-options.test.ts`
Expected: PASS — 9 testów

- [ ] **Step 7: Wczytaj subagentów przed startem sesji**

W `lib/services/cli/claude.ts` dodaj importy:

```ts
import { loadAgentDefinitions } from './agents-loader';
import { resolveClaudeConfigDir } from './claude-config-dir';
import path from 'path';
```
(`path` jest już zaimportowane — nie dubluj)

Bezpośrednio przed wywołaniem `query(...)`:

```ts
    const agents = await loadAgentDefinitions([
      path.join(resolveClaudeConfigDir(), 'agents'),
      path.join(absoluteProjectPath, '.claude', 'agents'),
    ]);
    if (Object.keys(agents).length > 0) {
      console.log(`[ClaudeService] Loaded ${Object.keys(agents).length} subagent definition(s)`);
    }
```

i przekaż `agents` do `buildClaudeQueryOptions({ ..., agents })`.

- [ ] **Step 8: Dowód z uruchomienia**

Run: `npm run dev`, wyślij prompt do agenta, odczytaj log `Session initialized`.
Expected: pole `agents` zawiera nazwy z plików `agents/*.md` obok czterech wbudowanych (`general-purpose`, `statusline-setup`, `Explore`, `Plan`). Jeśli katalog konfiguracyjny nie ma żadnych definicji, utwórz tymczasowo jedną i pokaż, że się pojawia. Wklej listę `agents` do raportu.

- [ ] **Step 9: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 10: Commit**

```bash
git add lib/services/cli/agents-loader.ts tests/cli/agents-loader.test.ts lib/services/cli/claude-options.ts tests/cli/claude-options.test.ts lib/services/cli/claude.ts
git commit -m "feat: load subagent definitions from disk

settingSources brings in skills, hooks, MCP servers and CLAUDE.md but
not subagents: definitions on disk never reach the session, which the
init payload confirmed. They are read from the config directory and the
project's own .claude/agents, with the project winning on a name
collision."
```

### Task 15: `cli-status` sprawdza poświadczenia, nie binarkę (decyzja 12, znalezisko G)

**Files:**
- Modify: `app/api/settings/cli-status/route.ts`
- Create: `tests/api/credential-status.test.ts`
- Create: `lib/services/cli/credential-status.ts`

**Interfaces:**
- Consumes: `resolveClaudeConfigDir` (Task 13).
- Produces:
  ```ts
  export interface CredentialStatus {
    configDir: string;
    hasCredentials: boolean;
    source: 'oauth' | 'api-key' | 'none';
  }
  export async function describeCredentialStatus(): Promise<CredentialStatus>;
  ```

`@anthropic-ai/claude-agent-sdk` ma własny bundlowany `cli.js` i nie potrzebuje globalnej binarki `claude` na PATH — dotychczasowy `claude --version` mógł zawieść przy w pełni działającym SDK i odwrotnie.

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/api/credential-status.test.ts`:

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeCredentialStatus } from '@/lib/services/cli/credential-status';

const originalDir = process.env.CLAUDE_CONFIG_DIR;
const originalKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (originalDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalDir;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

describe('describeCredentialStatus', () => {
  it('rozpoznaje login OAuth po pliku poświadczeń', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    await fs.writeFile(path.join(dir, '.credentials.json'), '{}');
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;

    const status = await describeCredentialStatus();
    expect(status.hasCredentials).toBe(true);
    expect(status.source).toBe('oauth');
    expect(status.configDir).toBe(dir);
  });

  it('rozpoznaje klucz API, gdy nie ma pliku poświadczeń', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const status = await describeCredentialStatus();
    expect(status.source).toBe('api-key');
    expect(status.hasCredentials).toBe(true);
  });

  it('zgłasza brak poświadczeń', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;

    const status = await describeCredentialStatus();
    expect(status.hasCredentials).toBe(false);
    expect(status.source).toBe('none');
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/api/credential-status.test.ts`
Expected: FAIL — nie da się rozwiązać importu

- [ ] **Step 3: Napisz implementację**

Utwórz `lib/services/cli/credential-status.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveClaudeConfigDir } from './claude-config-dir';

export interface CredentialStatus {
  configDir: string;
  hasCredentials: boolean;
  source: 'oauth' | 'api-key' | 'none';
}

/**
 * SDK ma własny bundlowany cli.js, więc obecność binarki `claude` na PATH
 * nic nie mówi o gotowości agenta. Znaczenie ma to, czy są poświadczenia.
 */
export async function describeCredentialStatus(): Promise<CredentialStatus> {
  const configDir = resolveClaudeConfigDir();

  let hasOauth = false;
  try {
    await fs.access(path.join(configDir, '.credentials.json'));
    hasOauth = true;
  } catch {
    hasOauth = false;
  }

  if (hasOauth) {
    return { configDir, hasCredentials: true, source: 'oauth' };
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { configDir, hasCredentials: true, source: 'api-key' };
  }

  return { configDir, hasCredentials: false, source: 'none' };
}
```

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/api/credential-status.test.ts`
Expected: PASS — 3 testy

- [ ] **Step 5: Przepisz trasę**

Zastąp całą zawartość `app/api/settings/cli-status/route.ts`:

```ts
/**
 * Agent Status API Route
 * GET /api/settings/cli-status - Czy agent ma czym się uwierzytelnić
 */

import { NextResponse } from 'next/server';
import { describeCredentialStatus } from '@/lib/services/cli/credential-status';
import { CLAUDE_MODEL_DEFINITIONS } from '@/lib/constants/claudeModels';

export async function GET() {
  const credentials = await describeCredentialStatus();

  return NextResponse.json({
    claude: {
      installed: credentials.hasCredentials,
      available: credentials.hasCredentials,
      configured: credentials.hasCredentials,
      checking: false,
      source: credentials.source,
      configDir: credentials.configDir,
      models: CLAUDE_MODEL_DEFINITIONS.map((definition) => definition.id),
      ...(credentials.hasCredentials
        ? {}
        : { error: `No Claude credentials in ${credentials.configDir} and no ANTHROPIC_API_KEY` }),
    },
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

Jeśli po Task 6 któryś komponent nadal czyta tę trasę, upewnij się, że kształt `{ claude: { installed, available, configured, checking, models } }` mu wystarcza — był to dotychczasowy kształt wpisu per-CLI.

- [ ] **Step 6: Sprawdź odpowiedź trasy**

Run: `npm run dev` i w drugim terminalu:
```bash
curl -s http://localhost:3000/api/settings/cli-status | head -20
```
Expected: `"source": "oauth"` i `"available": true` przy zalogowanym Claude Code. Wklej odpowiedź do raportu.

- [ ] **Step 7: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 8: Commit**

```bash
git add lib/services/cli/credential-status.ts tests/api/credential-status.test.ts "app/api/settings/cli-status/route.ts"
git commit -m "fix: report agent readiness from credentials, not a binary

The SDK ships its own cli.js, so claude --version on PATH said nothing
about whether the agent could run: it could fail with a working SDK and
pass with no credentials. The endpoint now reports which config
directory is in use and where the credentials come from."
```

---

## Faza 4 — rejestr template'ów

Instrukcje specyficzne dla frameworka **nie** idą do system promptu (decyzja 23 zakazuje `append`). Idą do `CLAUDE.md` w katalogu generowanego projektu — mechanizm potwierdzony pomiarem z sekcji 4.8 design recordu: agent czyta `CLAUDE.md` z katalogu roboczego, gdy `settingSources` zawiera `'project'`. Każdy template scaffolduje więc własny `CLAUDE.md`.

### Task 16: Rejestr template'ów i template Next.js (decyzje 8, 9, znalezisko K)

**Files:**
- Create: `lib/templates/meta.ts` (czysty — importowalny z klienta)
- Create: `lib/templates/run-dev.ts` (jeden generator wrappera dev)
- Create: `lib/templates/index.ts` (tylko serwer — dotyka `fs`)
- Create: `lib/templates/nextjs.ts`
- Create: `tests/templates/registry.test.ts`
- Delete: `lib/utils/scaffold.ts`
- Modify: `lib/services/preview.ts` (import scaffoldu)

**Interfaces:**
- Consumes: nic.
- Produces:
  ```ts
  // lib/templates/meta.ts — BEZ importów node:fs, wolno importować z klienta
  export type TemplateId = 'nextjs' | 'astro';
  export interface TemplateMeta { id: TemplateId; label: string; description: string }
  export const TEMPLATE_META: Record<TemplateId, TemplateMeta>;
  export const TEMPLATE_META_LIST: TemplateMeta[];
  export const DEFAULT_TEMPLATE_ID: TemplateId;                      // 'nextjs'
  export function normalizeTemplateType(value?: string | null): TemplateId;

  // lib/templates/run-dev.ts
  export interface RunDevSpec { label: string; binary: string; preArgs: string[]; postArgs: string[] }
  export function renderRunDevScript(spec: RunDevSpec): string;       // treść skryptu ESM

  // lib/templates/index.ts — TYLKO SERWER
  export interface ProjectTemplate extends TemplateMeta {
    scaffold(projectPath: string, projectId: string): Promise<void>;
  }
  export const TEMPLATES: Record<TemplateId, ProjectTemplate>;
  export function getTemplate(id?: string | null): ProjectTemplate;   // nieznane → domyślny
  ```
  Task 17 dodaje wpis `astro`; Task 18 podłącza `templateType` z bazy i importuje **wyłącznie** `meta.ts`.

**Dlaczego dwa pliki, a nie jeden.** `index.ts` importuje scaffold, ten importuje `fs/promises`, a webpackowy fallback w `next.config.js` pokrywa tylko `fs`, `path` i `os` — nie `fs/promises`. Import rejestru z komponentu klienckiego wywali build na `Module not found: Can't resolve 'fs/promises'`. `meta.ts` jest szwem: same dane, zero `fs`.

**Wrapper dev jest jeden, generowany.** Każdy template zapisuje `scripts/run-dev.mjs` wyprodukowany przez `renderRunDevScript` i wpis `"dev": "node scripts/run-dev.mjs"`. Rozszerzenie `.mjs` jest celowe: template Astro ma `"type": "module"`, więc wrapper z `require()` nie uruchomiłby się wcale, a `.mjs` jest ESM niezależnie od typu pakietu. `PreviewManager` dalej odpala `npm run dev -- --port N` i nie wie nic o frameworku, ale parser argumentów i resolver portu istnieją raz — testują się raz i psują się raz.

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/templates/registry.test.ts`:

```ts
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_ID, TEMPLATES, getTemplate, normalizeTemplateType } from '@/lib/templates';

const execFileAsync = promisify(execFile);

const scaffoldInto = async (id: 'nextjs' | 'astro') => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `tpl-${id}-`));
  await TEMPLATES[id].scaffold(dir, 'proj-test');
  return dir;
};

const readJson = async (dir: string, file: string) =>
  JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));

describe('normalizeTemplateType', () => {
  it('przepuszcza znane template\'y', () => {
    expect(normalizeTemplateType('nextjs')).toBe('nextjs');
    expect(normalizeTemplateType('astro')).toBe('astro');
  });

  it('znosi różnice w wielkości liter i spacje', () => {
    expect(normalizeTemplateType(' Astro ')).toBe('astro');
  });

  it('nieznane i puste schodzą do nextjs', () => {
    expect(normalizeTemplateType('vue')).toBe('nextjs');
    expect(normalizeTemplateType(null)).toBe('nextjs');
    expect(normalizeTemplateType(undefined)).toBe('nextjs');
  });
});

describe('getTemplate', () => {
  it('domyślnym template jest nextjs', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe('nextjs');
    expect(getTemplate(null).id).toBe('nextjs');
    expect(getTemplate(undefined).id).toBe('nextjs');
  });

  it('nieznane id schodzi do domyślnego, nie wybucha', () => {
    expect(getTemplate('vue').id).toBe('nextjs');
  });
});

describe('template nextjs', () => {
  it('scaffolduje uruchamialny projekt', async () => {
    const dir = await scaffoldInto('nextjs');
    for (const file of [
      'package.json', 'tsconfig.json', 'next.config.js',
      'app/layout.tsx', 'app/page.tsx', 'app/globals.css',
      'scripts/run-dev.mjs', 'CLAUDE.md',
    ]) {
      await expect(fs.access(path.join(dir, file))).resolves.toBeUndefined();
    }
  });

  it('uruchamia dev przez wygenerowany wrapper', async () => {
    const dir = await scaffoldInto('nextjs');
    const pkg = await readJson(dir, 'package.json');
    expect(pkg.scripts.dev).toBe('node scripts/run-dev.mjs');
    expect(pkg.name).toBe('proj-test');
  });

  it('zostawia agentowi instrukcje w CLAUDE.md', async () => {
    const dir = await scaffoldInto('nextjs');
    const claudeMd = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toMatch(/Next\.js/);
    expect(claudeMd).toMatch(/preview/i);
  });

  it('nie nadpisuje istniejących plików', async () => {
    const dir = await scaffoldInto('nextjs');
    await fs.writeFile(path.join(dir, 'app/page.tsx'), 'export default function X() { return null; }');
    await TEMPLATES.nextjs.scaffold(dir, 'proj-test');
    const page = await fs.readFile(path.join(dir, 'app/page.tsx'), 'utf8');
    expect(page).toContain('function X');
  });
});

// Te trzy asercje pilnują błędu, który w duplikowanym wrapperze pojawił się
// natychmiast: `require()` w pakiecie ESM to błąd czasu wykonania, więc
// sprawdzanie samej obecności stringu w kodzie by go nie wyłapało.
describe('wygenerowany wrapper dev', () => {
  it.each(['nextjs', 'astro'] as const)('%s: jest ESM, bez require', async (id) => {
    if (!TEMPLATES[id]) return; // astro dochodzi w Task 17
    const dir = await scaffoldInto(id);
    const runDev = await fs.readFile(path.join(dir, 'scripts/run-dev.mjs'), 'utf8');
    expect(runDev).toMatch(/^import /m);
    expect(runDev).not.toMatch(/\brequire\(/);
    expect(runDev).not.toMatch(/__dirname/);
  });

  it.each(['nextjs', 'astro'] as const)('%s: parsuje się jako moduł', async (id) => {
    if (!TEMPLATES[id]) return;
    const dir = await scaffoldInto(id);
    await expect(
      execFileAsync(process.execPath, ['--check', path.join(dir, 'scripts/run-dev.mjs')])
    ).resolves.toBeTruthy();
  });

  it.each(['nextjs', 'astro'] as const)('%s: binduje wszystkie interfejsy', async (id) => {
    if (!TEMPLATES[id]) return;
    const dir = await scaffoldInto(id);
    const runDev = await fs.readFile(path.join(dir, 'scripts/run-dev.mjs'), 'utf8');
    expect(runDev).toContain('0.0.0.0');
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/templates/registry.test.ts`
Expected: FAIL — nie da się rozwiązać importu `@/lib/templates`

- [ ] **Step 3: Napisz generator wrappera dev**

Utwórz `lib/templates/run-dev.ts`:

```ts
export interface RunDevSpec {
  /** Nazwa w logu startowym, np. "Next.js" */
  label: string;
  /** Binarka odpalana przez npx, np. "next" albo "astro" */
  binary: string;
  /** Argumenty przed --port, np. ["dev"] */
  preArgs: string[];
  /** Argumenty po --port, np. ["--hostname", "0.0.0.0"] */
  postArgs: string[];
}

/**
 * Jeden generator dla wszystkich template'ów. Emituje ESM, bo template
 * z `"type": "module"` nie uruchomi wrappera z `require()`. Parser argumentów
 * i resolver portu istnieją tu raz, a nie raz na framework.
 */
export function renderRunDevScript(spec: RunDevSpec): string {
  // Port jest znany w czasie działania, nie generowania — stąd marker.
  const argTemplate = JSON.stringify([...spec.preArgs, '--port', '__PORT__', ...spec.postArgs]);

  return [
    '#!/usr/bin/env node',
    "import { spawn } from 'node:child_process';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    '',
    "const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');",
    "const isWindows = process.platform === 'win32';",
    '',
    'function parseCliArgs(argv) {',
    '  const passthrough = [];',
    '  let preferredPort;',
    '  for (let i = 0; i < argv.length; i += 1) {',
    '    const arg = argv[i];',
    "    if (arg === '--port' || arg === '-p') {",
    '      const value = argv[i + 1];',
    "      if (value && !value.startsWith('-')) {",
    '        const parsed = Number.parseInt(value, 10);',
    '        if (!Number.isNaN(parsed)) preferredPort = parsed;',
    '        i += 1;',
    '        continue;',
    '      }',
    "    } else if (arg.startsWith('--port=')) {",
    "      const parsed = Number.parseInt(arg.slice('--port='.length), 10);",
    '      if (!Number.isNaN(parsed)) preferredPort = parsed;',
    '      continue;',
    '    }',
    '    passthrough.push(arg);',
    '  }',
    '  return { preferredPort, passthrough };',
    '}',
    '',
    'function resolvePort(preferredPort) {',
    '  const candidates = [preferredPort, process.env.PORT, process.env.PREVIEW_PORT_START, 3100];',
    '  for (const candidate of candidates) {',
    '    if (candidate === undefined || candidate === null) continue;',
    "    const numeric = typeof candidate === 'number' ? candidate : Number.parseInt(String(candidate), 10);",
    '    if (!Number.isNaN(numeric) && numeric > 0 && numeric <= 65535) return numeric;',
    '  }',
    '  return 3100;',
    '}',
    '',
    'const { preferredPort, passthrough } = parseCliArgs(process.argv.slice(2));',
    'const port = resolvePort(preferredPort);',
    'const url = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${port}`;',
    '',
    'process.env.PORT = String(port);',
    'process.env.NEXT_PUBLIC_APP_URL = url;',
    '',
    `console.log(\`🚀 Starting ${spec.label} dev server on \${url}\`);`,
    '',
    `const args = ${argTemplate}.map((arg) => (arg === '__PORT__' ? String(port) : arg));`,
    `const child = spawn('npx', ['${spec.binary}', ...args, ...passthrough], {`,
    '  cwd: projectRoot,',
    "  stdio: 'inherit',",
    '  shell: isWindows,',
    "  env: { ...process.env, PORT: String(port), NEXT_PUBLIC_APP_URL: url, NEXT_TELEMETRY_DISABLED: '1' },",
    '});',
    '',
    "child.on('exit', (code) => {",
    "  if (typeof code === 'number' && code !== 0) {",
    `    console.error(\`❌ ${spec.label} dev server exited with code \${code}\`);`,
    '    process.exit(code);',
    '  }',
    '});',
    '',
    "child.on('error', (error) => {",
    `  console.error('❌ Failed to start the ${spec.label} dev server');`,
    '  console.error(error instanceof Error ? error.message : error);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Napisz metadane template'ów**

Utwórz `lib/templates/meta.ts`:

```ts
export type TemplateId = 'nextjs' | 'astro';

export interface TemplateMeta {
  id: TemplateId;
  label: string;
  description: string;
}

/** Bez importów `fs` — ten plik musi być importowalny z komponentu klienckiego. */
export const TEMPLATE_META: Record<TemplateId, TemplateMeta> = {
  nextjs: {
    id: 'nextjs',
    label: 'Next.js',
    description: 'React with the App Router, server components and API routes',
  },
  astro: {
    id: 'astro',
    label: 'Astro',
    description: 'Content-first static site generator with island hydration',
  },
};

export const TEMPLATE_META_LIST: TemplateMeta[] = Object.values(TEMPLATE_META);

export const DEFAULT_TEMPLATE_ID: TemplateId = 'nextjs';

export function normalizeTemplateType(value?: string | null): TemplateId {
  const candidate = value?.trim().toLowerCase();
  if (candidate && candidate in TEMPLATE_META) {
    return candidate as TemplateId;
  }
  return DEFAULT_TEMPLATE_ID;
}
```

- [ ] **Step 5: Przenieś scaffold Next.js do template'u**

Utwórz `lib/templates/nextjs.ts`. Przenieś do niego **całą** treść `lib/utils/scaffold.ts` (helper `writeFileIfMissing` i wszystkie bloki zapisujące pliki), z pięcioma zmianami:

1. Eksport nazwij `scaffoldNextApp` zamiast `scaffoldBasicNextApp`.
2. W generowanym `package.json` ustaw `dev: 'node scripts/run-dev.mjs'`.
3. **Usuń w całości** blok generujący `scripts/run-dev.js` (~90 linii) i zastąp go wywołaniem generatora:
   ```ts
   await writeFileIfMissing(
     path.join(projectPath, 'scripts/run-dev.mjs'),
     renderRunDevScript({
       label: 'Next.js',
       binary: 'next',
       preArgs: ['dev'],
       postArgs: ['--hostname', '0.0.0.0'],
     })
   );
   ```
   z importem `import { renderRunDevScript } from './run-dev';`. `--hostname 0.0.0.0` jest konieczne — bez niego opublikowany port kontenera nie dosięgnie procesu.
4. Usuń z generowanej `app/page.tsx` link do `vercel.com/templates` razem z jego blokiem `<a>`.
5. Dopisz nowy plik `CLAUDE.md`:

```ts
  await writeFileIfMissing(
    path.join(projectPath, 'CLAUDE.md'),
    `# Project conventions

This is a Next.js 15 application using the App Router.

- TypeScript everywhere; no plain .js source files.
- Styling with Tailwind CSS. Install it yourself if it is not present yet.
- Keep every file directly under this project root. Never scaffold a
  framework into a subdirectory — run generators against the current
  directory instead.
- The platform installs dependencies and runs the preview dev server for
  you. You do not need to start one, and a second dev server on another
  port will not be reachable.
- The live preview URL is in NEXT_PUBLIC_APP_URL. Read it rather than
  assuming a port.
`
  );
```

- [ ] **Step 6: Napisz rejestr**

Utwórz `lib/templates/index.ts`:

```ts
import { scaffoldNextApp } from './nextjs';
import { DEFAULT_TEMPLATE_ID, TEMPLATE_META, type TemplateId, type TemplateMeta } from './meta';

export type { TemplateId, TemplateMeta } from './meta';
export { DEFAULT_TEMPLATE_ID, TEMPLATE_META, TEMPLATE_META_LIST, normalizeTemplateType } from './meta';

export interface ProjectTemplate extends TemplateMeta {
  scaffold(projectPath: string, projectId: string): Promise<void>;
}

export const TEMPLATES: Record<TemplateId, ProjectTemplate> = {
  nextjs: { ...TEMPLATE_META.nextjs, scaffold: scaffoldNextApp },
} as Record<TemplateId, ProjectTemplate>;

/**
 * Nieznane albo brakujące id schodzi do domyślnego template'u — istniejące
 * projekty nie mają zapisanego typu, a wybuch przy ich otwieraniu byłby
 * gorszy niż założenie Next.js, którym i tak wszystkie są.
 */
export function getTemplate(id?: string | null): ProjectTemplate {
  if (id && id in TEMPLATES) {
    return TEMPLATES[id as TemplateId];
  }
  return TEMPLATES[DEFAULT_TEMPLATE_ID];
}
```

Rzutowanie `as Record<TemplateId, ProjectTemplate>` istnieje **tylko** dlatego, że wpis `astro` dochodzi w Task 17. Usuń je w Task 17, gdy mapa będzie kompletna — inaczej zostanie w kodzie jako trwała dziura w typach.

- [ ] **Step 7: Usuń stary scaffold i przekieruj `PreviewManager`**

```bash
git rm lib/utils/scaffold.ts
```

W `lib/services/preview.ts` zamień import `scaffoldBasicNextApp` na:

```ts
import { getTemplate } from '@/lib/templates';
```

i w obu miejscach (`installDependencies` i `start`) zamień `await scaffoldBasicNextApp(projectPath, projectId);` na:

```ts
      await getTemplate(project.templateType).scaffold(projectPath, projectId);
```

- [ ] **Step 8: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/templates/registry.test.ts`
Expected: PASS. Testy `it.each` dla `astro` przechodzą przez wczesny `return` (wpis dochodzi w Task 17) — to zamierzone, tam zaczną realnie sprawdzać.

- [ ] **Step 9: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: turn the Next.js scaffold into a template registry

Templates become registry entries instead of one hardcoded function, so
adding a framework is one file. Framework conventions go into the
generated project's CLAUDE.md, which the agent reads from its working
directory, rather than into the system prompt. One generator emits the
dev wrapper for every template - as ESM, since a template package can
be type: module - and metadata lives in a separate fs-free module so
client components can import it."
```

### Task 17: Template Astro (decyzja 8)

**Files:**
- Create: `lib/templates/astro.ts`
- Modify: `lib/templates/index.ts`
- Modify: `tests/templates/registry.test.ts`

**Interfaces:**
- Consumes: `ProjectTemplate` z Task 16.
- Produces: `TEMPLATES.astro`. Task 18 wystawia go w UI.

- [ ] **Step 1: Ustal aktualną główną wersję Astro**

Run: `npm view astro version`
Zanotuj wynik i użyj w scaffoldzie zakresu `^<major>.0.0` (np. dla `6.1.3` → `^6.0.0`). Nie wpisuj `latest` do generowanego `package.json` — projekt użytkownika ma być odtwarzalny. Zapisz odczytaną wersję w raporcie zadania.

- [ ] **Step 2: Napisz failujący test**

W `tests/templates/registry.test.ts` dodaj:

```ts
describe('template astro', () => {
  it('jest w rejestrze', () => {
    expect(getTemplate('astro').id).toBe('astro');
    expect(TEMPLATES.astro.label).toBe('Astro');
  });

  it('scaffolduje uruchamialny projekt', async () => {
    const dir = await scaffoldInto('astro');
    for (const file of [
      'package.json', 'astro.config.mjs', 'tsconfig.json',
      'src/pages/index.astro', 'src/layouts/Layout.astro',
      'scripts/run-dev.mjs', 'CLAUDE.md',
    ]) {
      await expect(fs.access(path.join(dir, file))).resolves.toBeUndefined();
    }
  });

  it('jest pakietem ESM zależnym od astro, nie od nexta', async () => {
    const dir = await scaffoldInto('astro');
    const pkg = await readJson(dir, 'package.json');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.dev).toBe('node scripts/run-dev.mjs');
    expect(pkg.dependencies.astro).toMatch(/^\^\d+\.0\.0$/);
    expect(pkg.dependencies).not.toHaveProperty('next');
    // astro check bez @astrojs/check pada przy pierwszym użyciu
    expect(pkg.devDependencies).toHaveProperty('@astrojs/check');
  });

  it('mówi agentowi, że to Astro, a nie Next', async () => {
    const dir = await scaffoldInto('astro');
    const claudeMd = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toMatch(/Astro/);
    expect(claudeMd).not.toMatch(/Next\.js/);
  });
});
```

- [ ] **Step 3: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/templates/registry.test.ts`
Expected: FAIL — `TEMPLATES.astro` jest `undefined`

- [ ] **Step 4: Napisz template Astro**

Utwórz `lib/templates/astro.ts` (podstaw odczytaną wersję w miejsce `^6.0.0`, jeśli różna):

```ts
import fs from 'fs/promises';
import path from 'path';
import { renderRunDevScript } from './run-dev';

async function writeFileIfMissing(filePath: string, contents: string) {
  try {
    await fs.access(filePath);
    return;
  } catch {
    // plik nie istnieje — zapisujemy
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf8');
}

export async function scaffoldAstroApp(projectPath: string, projectId: string) {
  await fs.mkdir(projectPath, { recursive: true });

  const packageJson = {
    name: projectId,
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'node scripts/run-dev.js',
      build: 'astro build',
      preview: 'astro preview',
      check: 'astro check',
    },
    dependencies: {
      astro: '^6.0.0',
    },
    devDependencies: {
      '@astrojs/check': '^0.9.0',
      typescript: '^5.7.2',
    },
  };

  await writeFileIfMissing(
    path.join(projectPath, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  );

  await writeFileIfMissing(
    path.join(projectPath, 'astro.config.mjs'),
    `import { defineConfig } from 'astro/config';

export default defineConfig({});
`
  );

  await writeFileIfMissing(
    path.join(projectPath, 'tsconfig.json'),
    `{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "node_modules"]
}
`
  );

  await writeFileIfMissing(
    path.join(projectPath, 'src/layouts/Layout.astro'),
    `---
interface Props {
  title: string;
}

const { title } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>

<style is:global>
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-height: 100vh;
    font-family: system-ui, sans-serif;
  }
</style>
`
  );

  await writeFileIfMissing(
    path.join(projectPath, 'src/pages/index.astro'),
    `---
import Layout from '../layouts/Layout.astro';
---

<Layout title="Astro app">
  <main
    style="display:grid;place-items:center;min-height:100vh;gap:2rem;padding:2rem;text-align:center"
  >
    <h1 style="font-size:3rem;font-weight:600;margin:0">Get started by editing</h1>
    <code style="font-family:monospace;padding:12px 20px;background:rgba(0,0,0,0.05);border-radius:8px">
      src/pages/index.astro
    </code>
  </main>
</Layout>
`
  );

  await writeFileIfMissing(
    path.join(projectPath, 'scripts/run-dev.mjs'),
    renderRunDevScript({
      label: 'Astro',
      binary: 'astro',
      preArgs: ['dev'],
      postArgs: ['--host', '0.0.0.0'],
    })
  );

  await writeFileIfMissing(
    path.join(projectPath, 'CLAUDE.md'),
    `# Project conventions

This is an Astro application.

- Pages are files under \`src/pages\`; routing comes from the file tree.
- Shared page shells live in \`src/layouts\`. Components go in \`src/components\`.
- Component frontmatter (between \`---\` fences) runs at build time on the
  server. Client-side interactivity needs an explicit \`client:*\` directive.
- Keep every file directly under this project root. Never scaffold a
  framework into a subdirectory — run generators against the current
  directory instead.
- The platform installs dependencies and runs the preview dev server for
  you. You do not need to start one, and a second dev server on another
  port will not be reachable.
- The live preview URL is in \`NEXT_PUBLIC_APP_URL\`. Read it rather than
  assuming a port.
`
  );
}
```

- [ ] **Step 5: Zarejestruj template i usuń rzutowanie**

W `lib/templates/index.ts` dodaj import `import { scaffoldAstroApp } from './astro';`, dopisz wpis do mapy i **usuń** `as Record<TemplateId, ProjectTemplate>`:

```ts
export const TEMPLATES: Record<TemplateId, ProjectTemplate> = {
  nextjs: { /* bez zmian */ },
  astro: {
    id: 'astro',
    label: 'Astro',
    description: 'Content-first static site generator with island hydration',
    scaffold: scaffoldAstroApp,
  },
};
```

- [ ] **Step 6: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/templates/registry.test.ts`
Expected: PASS — 14 testów

- [ ] **Step 7: Dowód, że scaffold naprawdę się uruchamia**

To jest krok obowiązkowy, nie opcjonalny — testy jednostkowe czytają wygenerowany wrapper, ale go nie uruchamiają. Duplikat wrappera, którego to zadanie już nie tworzy, miał `require()` w pakiecie ESM: błąd czasu wykonania, niewidoczny dla żadnej asercji na treści pliku.

Dodaj tymczasowy plik `tests/templates/astro-smoke.test.ts`:

```ts
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/templates';

const execFileAsync = promisify(execFile);
const PORT = 3199;
let dir = '';
let child: ReturnType<typeof spawn> | undefined;

afterAll(async () => {
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* już nie żyje */ }
  }
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe('smoke: projekt Astro startuje', () => {
  it('odpowiada 200 na porcie przydzielonym przez wrapper', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-smoke-'));
    await TEMPLATES.astro.scaffold(dir, 'astro-smoke');

    await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir });

    child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
    });

    let status = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/`);
        status = response.status;
        if (status === 200) break;
      } catch { /* jeszcze nie wstał */ }
    }

    expect(status).toBe(200);
  }, 180_000);
});
```

Run: `npx vitest run tests/templates/astro-smoke.test.ts`
Expected: PASS. Wklej do raportu wersję Astro odczytaną w kroku 1 i wynik testu.

Po zielonym przebiegu **usuń ten plik** — `npm install` w teście to kilkadziesiąt sekund i sieć, więc nie ma go w stałym zestawie. W raporcie zadania zapisz, że został usunięty po przejściu.

- [ ] **Step 8: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 9: Commit**

```bash
git add lib/templates/astro.ts lib/templates/index.ts tests/templates/registry.test.ts
git commit -m "feat: add an Astro project template

Second entry in the registry, sharing the generated dev wrapper and
carrying its own CLAUDE.md so the agent works to Astro's conventions
instead of Next's. Verified by installing the scaffold and serving it,
not just by reading the generated files. The registry map is now
complete, so the placeholder cast is gone."
```

### Task 18: Podłącz `templateType` od bazy do UI (decyzja 8, znalezisko H)

**Files:**
- Modify: `lib/services/project.ts`
- Modify: `app/api/projects/route.ts`
- Modify: `lib/serializers/project.ts`
- Modify: `app/page.tsx` (wybór template'u przy polu tworzenia projektu)
- Modify: `types/backend/project.ts`, `types/shared/project.ts`

**Interfaces:**
- Consumes: `normalizeTemplateType`, `TEMPLATE_META_LIST`, `DEFAULT_TEMPLATE_ID` z `lib/templates/meta.ts` (Task 16), `getTemplate` z `lib/templates` (Task 16, 17).
- Produces: `CreateProjectInput` zyskuje `templateType?: TemplateId`. Ostatnie zadanie fazy 4.

To zadanie jest wyłącznie podłączeniem istniejących części — `normalizeTemplateType` powstało w Task 16 i ma tam swoje testy. **Nie dostaje nowego testu jednostkowego**: nie ma tu nowej logiki, jest przepływ wartości od modala do scaffoldu. Weryfikuje go dowód z uruchomienia w kroku 3, `type-check` i `build`.

Dziś `templateType` jest zapisywany na sztywno jako `'nextjs'` i nigdzie nie czytany, a typ `TemplateType` jest zdublowany w dwóch plikach z wartościami, których nie ma (`react`, `vue`).

- [ ] **Step 1: Zapisuj wybrany template**
- `types/backend/project.ts` i `types/shared/project.ts` — usuń zdublowany `export type TemplateType = 'nextjs' | 'react' | 'vue' | 'custom';` z oba plików i zamiast tego reeksportuj jedną definicję: `export type { TemplateId as TemplateType } from '@/lib/templates/meta';` (z `meta`, nie z `index` — reeksport typu jest bezpieczny, ale trzymamy jedno źródło dla obu stron). Pole `templateType?: TemplateType` zostaje.
- `types/backend/project.ts` — dodaj `templateType?: TemplateType;` do `CreateProjectInput`, jeśli go tam nie ma.
- `lib/services/project.ts` — w `createProject` zamień `templateType: 'nextjs',` na `templateType: normalizeTemplateType(input.templateType),` i dodaj import `import { normalizeTemplateType } from '@/lib/templates/meta';`.
- `app/api/projects/route.ts` — w budowanym `input` dodaj `templateType: normalizeTemplateType(body.templateType ?? body.template_type),`.
- `lib/serializers/project.ts` — dopisz `templateType` do serializowanego kształtu, żeby UI mógł go pokazać.

- [ ] **Step 2: Dodaj wybór template'u tam, gdzie projekty faktycznie powstają**

**Nie w `CreateProjectModal`** — ten plik został usunięty w Task 6 jako martwy kod (importowany, nigdy nierenderowany). Jedyna działająca droga tworzenia projektu to pole na stronie głównej.

W `app/page.tsx`:

1. Dodaj import `import { TEMPLATE_META_LIST, DEFAULT_TEMPLATE_ID } from '@/lib/templates/meta';`
   **Importuj z `meta`, nigdy z `@/lib/templates`.** To komponent kliencki; rejestr ciągnie za sobą scaffold, ten `fs/promises`, a webpackowy fallback w `next.config.js` pokrywa tylko `fs`, `path` i `os` — build padnie na `Module not found: Can't resolve 'fs/promises'`.
2. Dodaj stan `const [selectedTemplate, setSelectedTemplate] = useState<string>(DEFAULT_TEMPLATE_ID);`
3. Wstaw wybór template'u w rzędzie kontrolek pod polem promptu — tam, gdzie dziś stoją selektory agenta i modelu (te pierwsze usuwa Task 6, więc miejsce się zwolni). Jeden przycisk na wpis `TEMPLATE_META_LIST`, `label` jako treść, `description` w `title`. Aktywny wyróżnij tak, jak wyróżniany był aktywny model — nie wprowadzaj nowego języka wizualnego.
4. W ciele żądania POST przy `~482` dodaj `templateType: selectedTemplate,`.

- [ ] **Step 3: Dowód z uruchomienia — projekt z Astro**

Run: `npm run dev`, utwórz nowy projekt z template'em Astro i promptem „dodaj stronę /about z nagłówkiem About".
Expected:
- w `data/projects/<id>` jest `astro.config.mjs` i `src/pages/index.astro`, nie ma `next.config.js`,
- preview startuje i iframe pokazuje stronę,
- agent tworzy `src/pages/about.astro` (a nie `app/about/page.tsx`) — dowód, że przeczytał `CLAUDE.md` template'u.
Wklej do raportu listing katalogu projektu i ścieżkę pliku, który agent utworzył.

- [ ] **Step 4: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi. Build jest tu bramką kluczową — złapie import rejestru z komponentu klienckiego, gdyby przeszedł mimo ostrzeżenia w kroku 2.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: let a new project pick its template

templateType was written as a constant and never read, and the
TemplateType union was duplicated across two files listing frameworks
that did not exist. The value now comes from the create dialog, decides
which scaffold runs, and has one definition."
```

---

## Faza 5 — konteneryzacja

### Task 19: Obraz Dockera (decyzje 5, 6, 7, 29)

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

`next.config.js` **nie jest ruszany**: `output: 'standalone'` jest tam od dawna (linia 5). Obraz nie korzysta ze standalone — startuje przez `next start` z pełnym `node_modules`, bo tak samo robi `electron-builder` i nie mnożymy trybów uruchamiania. Standalone zostaje dla buildu desktopowego.

**Interfaces:**
- Consumes: nic.
- Produces: obraz z Node 22, `git`, `python3` i `bash`; wolumen `/data`; katalog konfiguracyjny agenta pod `/root/.claude`. Task 20 podaje mu zmienne i mapowania.

Obraz musi mieć `git` (woła go `lib/services/git.ts`) oraz `python3` i `bash` — hooki z zamontowanego katalogu `.claude` wykonują się jako procesy i bez interpretera nie ruszą, cicho.

- [ ] **Step 1: Napisz `.dockerignore`**

Utwórz `.dockerignore`:

```
node_modules
.next
.git
.flow
data
dist
npm-debug.log*
.env
.env.local
*.md
!README.md
tests
vitest.config.ts
```

- [ ] **Step 2: Napisz `Dockerfile`**

Utwórz `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# git: wołany przez lib/services/git.ts przy integracji z GitHubem.
# python3 i bash: hooki z zamontowanego katalogu .claude wykonują się jako
# procesy — bez interpretera nie uruchomią się i nikt tego nie zauważy.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 bash ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# node_modules z etapu BUILD, nie deps: `prisma generate` zapisuje wygenerowany
# klient do node_modules, a `npm ci --ignore-scripts` w deps go nie tworzy.
# Kopiowanie z deps daje obraz, w którym pierwszy dostęp do bazy leci
# "@prisma/client did not initialize yet".
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

# Katalog danych: projekty użytkownika, baza i ustawienia globalne.
RUN mkdir -p /data/projects
VOLUME ["/data"]

EXPOSE 3000
EXPOSE 3100-3131

# Dev-servery projektów są procesami potomnymi tego kontenera, więc PID 1
# musi je zbierać. `init: true` w compose zapewnia reaper.
# --accept-data-loss: `db push` na SQLite przebudowuje tabele przy drifcie
# schematu i bez flagi czeka na interaktywne potwierdzenie, którego w
# kontenerze nikt nie udzieli.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && npx next start --port 3000 --hostname 0.0.0.0"]
```

- [ ] **Step 3: Zbuduj obraz**

Run: `docker build -t claudable:dev .`
Expected: build kończy się sukcesem. Jeśli `npm run build` w etapie `build` failuje na brakującym `.env`, dodaj przed `npm run build` linię `RUN node scripts/setup-env.js || true` i zanotuj to w raporcie.

- [ ] **Step 4: Sprawdź, co jest w obrazie**

Run:
```bash
docker run --rm claudable:dev sh -c "git --version && python3 --version && bash --version | head -1 && node --version"
docker run --rm claudable:dev sh -c "ls node_modules/.prisma/client/ | head -5"
```
Expected: cztery wersje wypisane, a drugi listing pokazuje wygenerowanego klienta Prismy (m.in. `index.js`, `schema.prisma`). Pusty listing znaczy, że `node_modules` przyszło z niewłaściwego etapu. Wklej oba wyniki do raportu.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: add a container image

Multi-stage build over node:22-slim. The runtime layer carries git for
the GitHub integration and python3 plus bash so hooks from the mounted
.claude directory have an interpreter to run under - without one they
fail silently. Project data lives on a /data volume."
```

### Task 20: Compose z mapowanym katalogiem projektów (decyzje 5, 6, 7, 24)

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.docker.example`
- Create: `tests/utils/port-allocation.test.ts`
- Modify: `scripts/setup-env.js` (górna granica zakresu portów)
- Modify: `lib/utils/ports.ts`, `lib/services/preview.ts`, `lib/config/constants.ts` (ta sama granica)

**`.env` i `.env.local` NIE są commitowane** — są w `.gitignore` (linie 29-30) i zawierają `ENCRYPTION_KEY`. Zmień w nich zakres portów lokalnie, żeby środowisko dev się zgadzało, ale nie dodawaj ich do commitu; `git add .env` albo padnie na ignorowanej ścieżce, albo — z `-f` — wypchnie sekret do repozytorium.

**Interfaces:**
- Consumes: obraz z Task 19, `resolveClaudeConfigDir` z Task 13.
- Produces: uruchamialny `docker compose up`. Zmienne: `CLAUDABLE_DATA`, `CLAUDABLE_CLAUDE_DIR`, `CLAUDABLE_SYMLINK_ROOT`.

- [ ] **Step 1: Zwęź zakres portów do publikowalnego**

Zakres 32 portów wynika z decyzji 5: publikowanie 900 portów wydłuża start kontenera do absurdu.

Granica jest wpisana w **czterech** miejscach i wszystkie muszą się zgadzać:
- `scripts/setup-env.js` — generator plików env
- `lib/utils/ports.ts` — `resolveDefaultBounds()` (~linia 23)
- `lib/services/preview.ts` — **drugi, niezależny parser** `resolvePreviewBounds()` (~linia 195). Łatwo go przeoczyć: czyta te same zmienne środowiskowe, ale ma własny fallback.
- `lib/config/constants.ts` — `PREVIEW_CONFIG.FALLBACK_PORT_END`

Zmień też lokalnie w `.env` i `.env.local` (bez commitowania — patrz Files).

- [ ] **Step 2: Napisz test wyczerpania zakresu portów**

Decyzja 14 obiecuje pokrycie alokacji portu, a ryzyko 3 wymaga czytelnego błędu przy wyczerpaniu slotów. Przy 32 miejscach zamiast 900 to przestaje być teoretyczne.

Utwórz `tests/utils/port-allocation.test.ts`:

```ts
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
```

Run: `npx vitest run tests/utils/port-allocation.test.ts`
Expected: PASS. Jeśli trzeci test failuje, bo komunikat nie nazywa zakresu, popraw treść błędu w `lib/utils/ports.ts:113` tak, żeby zawierał granice — użytkownik z 32 zajętymi slotami musi z logu wiedzieć, co się stało.

- [ ] **Step 3: Napisz `docker-compose.yml`**

Utwórz `docker-compose.yml`:

```yaml
services:
  claudable:
    build: .
    image: claudable:dev
    # Dev-servery projektów są dziećmi tego kontenera — PID 1 musi je zbierać.
    init: true
    # KLUCZOWE: bez tego kontener działa jako root i po pierwszym odświeżeniu
    # tokenu OAuth pliki w zamontowanym katalogu .claude po stronie HOSTA
    # zmieniają właściciela na root — a wtedy `claude` w twoim terminalu
    # przestaje działać. Ustaw HOST_UID/HOST_GID w .env.docker.
    user: "${HOST_UID:-1000}:${HOST_GID:-1000}"
    env_file:
      - .env.docker
    ports:
      - "3000:3000"
      - "3100-3131:3100-3131"
    environment:
      HOME: /home/app
      PROJECTS_DIR: /data/projects
      DATABASE_URL: file:/data/cc.db
      SETTINGS_DIR: /data
      PREVIEW_PORT_START: "3100"
      PREVIEW_PORT_END: "3131"
      # Katalog, z którego agent bierze CLAUDE.md, skille, hooki i MCP —
      # dokładnie tak jak `claude` w terminalu.
      CLAUDE_CONFIG_DIR: /home/app/.claude
    volumes:
      # Projekty, baza i ustawienia globalne.
      - ${CLAUDABLE_DATA:-./data}:/data
      # Konfiguracja agenta. Musi być zapisywalna: odświeżenie tokenu OAuth
      # pisze do .credentials.json, a przy :ro agent padnie po jego wygaśnięciu.
      - ${CLAUDABLE_CLAUDE_DIR:-${HOME}/.claude}:/home/app/.claude
```

`ENCRYPTION_KEY` wchodzi przez `env_file`, nie przez interpolację — jeden plik `.env.docker` jest jedynym źródłem sekretów i nie ma go w repozytorium.

Jeśli pliki w zamontowanym katalogu `.claude` są symlinkami wychodzącymi poza niego (typowe przy dotfiles), **nie** obchodź tego trikiem w głównym compose. Utwórz `docker-compose.override.yml` (Docker Compose wczytuje go automatycznie i nie jest commitowany):

```yaml
services:
  claudable:
    volumes:
      - /absolutna/sciezka/do/dotfiles:/absolutna/sciezka/do/dotfiles:ro
```

Ścieżka musi być identyczna w kontenerze i na hoście, bo symlink jest absolutny. Dopisz `docker-compose.override.yml` do `.gitignore`.

- [ ] **Step 4: Napisz przykładowy plik zmiennych**

Utwórz `.env.docker.example`:

```bash
# Skopiuj do .env.docker i uzupełnij przed `docker compose up`.
# Ten plik NIE jest commitowany.

# Klucz szyfrowania zmiennych środowiskowych projektów (32 bajty hex).
# Wygeneruj: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=

# Twoje UID i GID. Bez nich kontener działa jako root i przejmie na własność
# pliki w zamontowanym katalogu .claude, psując `claude` w twoim terminalu.
# Odczytaj: id -u ; id -g
HOST_UID=1000
HOST_GID=1000

# Adres, pod którym otwierasz aplikację. Uwaga: NEXT_PUBLIC_* jest zapiekane
# w `next build`, więc zmiana tutaj nie wpłynie na kod po stronie przeglądarki
# — po zmianie przebuduj obraz.
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Gdzie trzymać projekty, bazę i ustawienia. Domyślnie ./data w repo.
# CLAUDABLE_DATA=/srv/claudable-data

# Katalog konfiguracyjny agenta: CLAUDE.md, skille, subagenci, hooki, MCP,
# poświadczenia. Domyślnie ~/.claude, czyli to samo, co widzi `claude`
# w terminalu. Przestaw, żeby dać instancji własny, dostosowany katalog.
# CLAUDABLE_CLAUDE_DIR=/srv/claudable-claude-home
```

Dopisz do `.gitignore`:

```
.env.docker
docker-compose.override.yml
```

- [ ] **Step 5: Uruchom stack**

Run:
```bash
cp -n .env.docker.example .env.docker
sed -i "s/^HOST_UID=.*/HOST_UID=$(id -u)/; s/^HOST_GID=.*/HOST_GID=$(id -g)/" .env.docker
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))" >> .env.docker
docker compose up --build -d
docker compose logs --tail 40 claudable
```
Expected: `prisma db push` przechodzi, Next startuje na 3000.

Sprawdź od razu, że kontener nie jest rootem — to zabezpieczenie twojego katalogu `.claude`:
```bash
docker compose exec claudable id
```
Expected: `uid=` równe twojemu `id -u`, nie `0`.

- [ ] **Step 6: Dowód — parytet agenta w kontenerze**

Run: otwórz `http://localhost:3000`, utwórz projekt i wyślij prompt. Potem:
```bash
docker compose logs claudable | grep -A 20 "Session initialized"
```
Expected w payloadzie: `cwd` = `/data/projects/<id>`, `claudeCodeVersion` **identyczna** jak zgłaszana przez sesję na hoście (inaczej kontener uruchamia inne CLI, niż testowałeś), `apiKeySource` wskazujący na poświadczenia z mountu, `skills` i `slashCommands` z zamontowanego katalogu, `agents` z `agents/*.md`, a każdy wpis w `mcpServers` ma **`status: "connected"`** — nie tylko istnieje. Niepusta lista dowodzi jedynie, że pliki się wczytały; `status` dowodzi, że serwer naprawdę wstał w kontenerze.

Osobno udowodnij, że hooki się **wykonują**, a nie tylko wczytują — hook bez interpretera albo z odwołaniem do ścieżki hosta, której w kontenerze nie ma, milczy. Podłóż w katalogu projektu `.claude/settings.json` z hookiem `PreToolUse` na `Write`, który zwraca `permissionDecision: "deny"`, poproś agenta o utworzenie pliku i pokaż w logach, że narzędzie zostało zablokowane. Usuń hook po próbie.

Wklej do raportu: cały payload `init`, statusy serwerów MCP i dowód odpalenia hooka. Puste `skills` przy niepustym `skills/` po stronie hosta = wiszące symlinki: dodaj `docker-compose.override.yml` z katalogiem docelowym i powtórz.

- [ ] **Step 7: Dowód — preview dosięgalne z hosta**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/
```
(albo port, który przydzielił PreviewManager — odczytaj z logów)
Expected: `200`. To sprawdza jednocześnie publikację zakresu portów i bindowanie na `0.0.0.0` z Task 16/17.

- [ ] **Step 8: Dowód — dane przeżywają restart**

Run:
```bash
docker compose restart claudable
sleep 15
curl -s http://localhost:3000/api/projects | head -c 300
```
Expected: utworzony projekt jest na liście. Wklej fragment odpowiedzi do raportu.

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml .env.docker.example .gitignore tests/utils/port-allocation.test.ts scripts/setup-env.js lib/utils/ports.ts lib/services/preview.ts lib/config/constants.ts
git commit -m "build: run the stack from compose with a mapped projects volume

One /data mount carries projects, the SQLite database and global
settings, so a restart does not leave files on disk with an empty
project list. The preview port range narrows to 3100-3131 because
publishing nine hundred ports makes container startup absurd, and the
agent's .claude directory is a variable so it can be pointed anywhere."
```

---

## Faza 6 — sprzątanie i dokumentacja

### Task 21: Usuń debug-logi z gorących ścieżek (znalezisko J)

**Files:**
- Modify: `app/api/chat/[project_id]/act/route.ts`
- Modify: `app/api/assets/[project_id]/[filename]/route.ts`
- Modify: `components/chat/ChatLog.tsx`
- Modify: `app/page.tsx`
- Modify: `app/[project_id]/chat/page.tsx`
- Modify: `components/chat/ChatInput.tsx`
- Modify: `lib/services/cli/claude.ts`

Pięć plików ma logi `📸` — nie tylko trasa `act`. Grep w kroku 4 obejmuje wszystkie, więc lista plików musi się z nim zgadzać.

**Interfaces:**
- Consumes: nic.
- Produces: nic. Czysta redukcja szumu.

Usuwamy wyłącznie logi diagnostyczne dodane przy debugowaniu konkretnych problemów. **Nie** usuwamy `console.error` z obsługi błędów ani logu `Session initialized` z Task 2 — ten jest celowym narzędziem dowodowym.

- [ ] **Step 1: Usuń logi z tras serwerowych**

W `app/api/assets/[project_id]/[filename]/route.ts` usuń bloki `console.log('📸 Asset serving request:', {...})`, `console.log('📸 Checking file path:', {...})` i `console.log('📸 Asset serving failed: ...')` — zostaw same zwracane odpowiedzi błędu. W `app/api/chat/[project_id]/act/route.ts` usuń oba bloki `console.log('📸 Creating message with attachments:', {...})` i `console.log('📸 Message created successfully:', {...})` w całości. Zostaw `console.warn`/`console.error` w blokach `catch`.

- [ ] **Step 2: Usuń logi z warstwy klienckiej**

W `components/chat/ChatLog.tsx` usuń: `console.log('[ChatLog] Loaded messages from API:', {...})`, pętlę `normalized.forEach` logującą `🖼️ DB loaded message with attachments`, `console.log('[ChatLog] Loaded ${...} messages')` oraz `console.log('🔄 [HandlerSetup] ...')`, jeśli jeszcze został po Task 8. Zostaw `console.debug` pollingu — jest za flagą poziomu i przydaje się przy diagnozie transportu.

W `app/page.tsx`, `app/[project_id]/chat/page.tsx` i `components/chat/ChatInput.tsx` usuń pozostałe `console.log` z emoji `📸` dotyczące załączników. Nie ruszaj `console.error` w blokach `catch`.

- [ ] **Step 3: Przytnij log startowy adaptera**

W `lib/services/cli/claude.ts` zredukuj blok otwierający `executeClaude` (ramka z `====`, `Project:`, `Model:`, `Session ID:`, `Instruction:`) do jednej linii:

```ts
  console.log(`[ClaudeService] Starting agent for ${projectId} on ${modelLabel} [${resolvedModel}]${aliasNote}`);
```

Zachowaj wyliczenia `resolvedModel`, `modelLabel` i `aliasNote` — są używane.

- [ ] **Step 4: Sprawdź, że emoji-logi zniknęły z gorących ścieżek**

Run:
```bash
grep -rn "📸\|🖼️\|🔄 \[HandlerSetup\]" --include=*.ts --include=*.tsx --include=*.js --include=*.json --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=data --exclude-dir=.flow .
```
Expected: brak wyników

- [ ] **Step 5: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 6: Commit**

```bash
git add "app/api/chat/[project_id]/act/route.ts" components/chat/ChatLog.tsx lib/services/cli/claude.ts
git commit -m "chore: drop debug logging from hot paths

Attachment diagnostics fired on every message and history load. The
init-payload log stays: it is deliberate evidence, not leftovers."
```

### Task 22: Zaktualizuj README (znaleziska I, M)

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: wszystko powyżej.
- Produces: dokumentacja zgodna z kodem. Ostatnie zadanie planu.

Projekt nie ma living speca, więc nie ma sekcji speca do synchronizacji — README jest jedyną dokumentacją, jaką ten projekt utrzymuje, i to ono musi przestać kłamać.

- [ ] **Step 1: Popraw nieaktualne teksty w samej aplikacji**

README nie jest jedynym miejscem, które obiecuje zdolności, których produkt już nie ma. Trzy teksty w UI reklamują deploy, usunięty w Task 4:
- `components/settings/GlobalSettings.tsx:745` — kafel „Fast Deploy" w zakładce About. Zdanie dwa wiersze wyżej zostało już poprawione w Task 4, kafel nie — niekonsekwencja w obrębie jednego elementu.
- `app/page.tsx:928` — hasło „Connect CLI Agent • Build what you want • Deploy instantly".
- Sprawdź grepem `-i "deploy\|publish"` po `app components`, czy nie ma więcej. Nie ruszaj nazw technicznych (`deployment` w typach, jeśli jakieś zostały) — tylko treść widzianą przez użytkownika.

- [ ] **Step 2: Popraw listę wspieranych agentów**

W `README.md` usuń sekcje „Supported AI Coding Agents" dotyczące Codex CLI, Cursor CLI, Qwen Code i Z.AI GLM-4.6 wraz z ich instrukcjami instalacji oraz sekcje demo („Codex CLI Example", „Qwen Code Example"). Zostaw Claude Code. Popraw w niej „Context: Native 200k tokens" — Opus 5 i Sonnet 5 mają 1M, Haiku 4.5 ma 200K — i wymień modele dokładnymi id: `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`.

- [ ] **Step 3: Popraw listę integracji**

Usuń Vercela i Supabase z „Features", „Technology Stack" i „Integration Guide". Zostaw GitHuba. Usuń zdanie o deploju jednym kliknięciem i o darmowym PostgreSQL.

- [ ] **Step 4: Napraw obiecane skrypty npm**

Sekcja „Additional Commands" wymienia `npm run db:backup`, `db:reset` i `clean`. `db:backup` istnieje od Task 7 — zostaw z poprawnym opisem. `db:reset` zamień na istniejące `npm run prisma:reset`. `clean` albo usuń z README, albo dodaj do `package.json`:

```json
    "clean": "rm -rf node_modules package-lock.json",
```
Wybierz dodanie skryptu, jeśli zostawiasz wpis w README — dokumentacja i `package.json` muszą się zgadzać.

- [ ] **Step 5: Dopisz sekcję Dockera**

Po „Quick Start" dodaj:

```markdown
## Docker

```bash
cp .env.docker.example .env.docker
# uzupełnij ENCRYPTION_KEY, HOST_UID i HOST_GID
docker compose up --build
```

Aplikacja stoi na http://localhost:3000, a preview projektów na portach 3100-3131.

Dwa mapowania mają znaczenie:

- `CLAUDABLE_DATA` (domyślnie `./data`) → `/data` w kontenerze. Trzyma projekty,
  bazę SQLite i ustawienia globalne. Przestaw, żeby trzymać projekty poza repo.
- `CLAUDABLE_CLAUDE_DIR` (domyślnie `~/.claude`) → `/home/app/.claude`. To z tego
  katalogu agent bierze `CLAUDE.md`, skille, subagentów, hooki i serwery MCP —
  dokładnie tak, jak `claude` uruchomiony w terminalu. Mount musi być
  zapisywalny, bo odświeżenie tokenu OAuth pisze do `.credentials.json`.

Ustaw `HOST_UID` i `HOST_GID` na własne (`id -u`, `id -g`). Bez nich kontener
działa jako root i po pierwszym odświeżeniu tokenu przejmie na własność pliki
w zamontowanym katalogu `.claude`, psując `claude` w twoim terminalu.

Jeśli pliki w tym katalogu są symlinkami wychodzącymi poza niego (typowe przy
dotfiles), dodaj `docker-compose.override.yml` montujący katalog docelowy pod
tą samą ścieżką absolutną — inaczej symlinki zawisną i ustawienia po cichu
nie wejdą.
```

- [ ] **Step 6: Dopisz sekcję o template'ach**

W „Usage" dodaj akapit: nowy projekt wybiera template (Next.js albo Astro); template scaffolduje minimalny projekt i zapisuje `CLAUDE.md` z konwencjami frameworka, które agent czyta z katalogu projektu.

- [ ] **Step 7: Zweryfikuj każdy skrypt wymieniony w README**

Run:
```bash
node -e "
const pkg = require('./package.json');
const readme = require('fs').readFileSync('README.md','utf8');
const promised = [...readme.matchAll(/npm run ([a-z0-9:-]+)/g)].map(m => m[1]);
const missing = [...new Set(promised)].filter(s => !pkg.scripts[s]);
console.log(missing.length ? 'BRAKUJE: ' + missing.join(', ') : 'wszystkie skrypty z README istnieją');
"
```
Expected: `wszystkie skrypty z README istnieją`. Wklej wynik do raportu.

- [ ] **Step 8: Ostatnia weryfikacja całości**

Run: `npm run type-check && npm test && npm run lint && npm run build`
Expected: wszystko zielone. To jest brama wyjściowa planu.

- [ ] **Step 9: Commit**

```bash
git add README.md package.json
git commit -m "docs: bring the README in line with the code

It advertised four agents that are gone, deploy targets that are gone,
a 200k context that is wrong, and three npm scripts that never existed.
Adds the Docker section, including which two mounts matter and why the
agent config directory has to be writable."
```
