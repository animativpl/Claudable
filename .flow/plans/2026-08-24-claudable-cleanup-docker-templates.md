# Claudable: odchudzenie, parytet agenta, Docker i template'y — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zredukować Claudable do jednego agenta (Claude Code) z parytetem wobec terminala, naprawić flickerowanie czatu i regresję katalogu roboczego, dodać template Astro obok Next.js i zapakować całość w Dockera z mapowanym katalogiem projektów.

**Architecture:** Aplikacja pozostaje monolitem Next.js 15 (App Router) z route handlerami jako backendem, SQLite przez Prismę i SSE jako jedynym transportem realtime. Zmiana idzie w sześciu fazach: najpierw fundament testowy i cofnięcie regresji `cwd`, potem usunięcia (WebSockety, inne CLI, Vercel/Supabase), potem naprawy z audytu, potem parytet agenta z terminalem, potem rejestr template'ów, na końcu konteneryzacja.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5.7, Prisma 6 + SQLite, `@anthropic-ai/claude-agent-sdk` 0.2.68, Vitest (nowy), Docker + Compose.

**Spec:** projekt nie ma living speca (`spec.md`). Bootstrap speca to osobna robota (skill `writing-specs`) i nie jest częścią tego runu — nie ma więc zadania synchronizującego spec. Zamiast tego Task 24 aktualizuje `README.md` i komentarze w schemacie, czyli jedyną dokumentację, jaką ten projekt ma.

**Design record:** `.flow/specs/2026-08-24-claudable-cleanup-docker-templates-design.md` (29 decyzji, 19 znalezisk)

## Global Constraints

- Node `>=20.0.0`, npm `>=10.0.0` (`package.json` → `engines`) — nie podnosić.
- TypeScript `strict: true` (`tsconfig.json`). Żadnego nowego `as any` ani `@ts-ignore`.
- ID modeli Claude dokładnie w formie: `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`. **Nigdy** nie doklejać sufiksu daty. Domyślny model: `claude-sonnet-5`.
- Zakres portów preview: `3100`–`3131` (32 slotów). Ta sama wartość w `.env`, `scripts/setup-env.js` i `docker-compose.yml`.
- Opcja katalogu roboczego agenta w SDK 0.2.68 nazywa się **`cwd`**. `workingDirectory` nie istnieje w tym SDK.
- Chirurgia, nie remont: dotykamy wyłącznie tego, co wynika z zadania. Nie dekomponujemy `app/[project_id]/chat/page.tsx` ani `components/chat/ChatLog.tsx` — mimo rozmiaru.
- Integracja GitHub zostaje nietknięta (`lib/services/{github,git,tokens}.ts`, `components/modals/GitHubRepoModal.tsx`, model `ServiceToken`).
- Każde zadanie kończy się commitem. Wiadomości commitów po angielsku, tryb rozkazujący.

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
  };
}
```

- [ ] **Step 6: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/cli/claude-options.test.ts`
Expected: PASS — 4 testy

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
        maxOutputTokens,
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

Uwaga: `systemPrompt` znika z tego wywołania — obsługuje je Task 13. `maxOutputTokens` zostaje na razie i wypada w Task 13. Rzutowanie `as any` musi zniknąć bez śladu.

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
    toolCount: number;
    skills: string[];
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

### Task 3: Usuń warstwę WebSocket (decyzja 1, znalezisko C)

**Files:**
- Delete: `lib/server/websocket-manager.ts`
- Delete: `hooks/useWebSocket.ts`
- Modify: `lib/services/stream.ts` (usuń import i `websocketManager.broadcast`)
- Modify: `lib/config/constants.ts` (usuń `WEBSOCKET_CONFIG`)
- Modify: `components/chat/ChatLog.tsx` (usuń `useWebSocket`, `isConnected`, `isConnecting`)
- Modify: `package.json` (usuń `ws` i `@types/ws`)

**Interfaces:**
- Consumes: nic.
- Produces: `streamManager.publish(projectId, event)` zachowuje sygnaturę — zmienia się tylko to, że nie rozgłasza już do nieistniejącego managera WS. `ChatLog` przestaje eksponować stan połączenia WS; Task 8 opiera się na tym, że został jeden transport.

- [ ] **Step 1: Usuń pliki serwera i hooka**

```bash
git rm lib/server/websocket-manager.ts hooks/useWebSocket.ts
```

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

- [ ] **Step 3: Usuń `WEBSOCKET_CONFIG`**

W `lib/config/constants.ts` usuń cały blok `export const WEBSOCKET_CONFIG = { ... } as const;` razem z komentarzem `// WebSocket Configuration`.

- [ ] **Step 4: Wypnij WebSocket z `ChatLog.tsx`**

W `components/chat/ChatLog.tsx`:
1. Usuń import `useWebSocket`.
2. Usuń całe wywołanie `const { isConnected, isConnecting } = useWebSocket({ ... });` (~linie 1510-1533).
3. Wszędzie, gdzie w warunkach występuje `isConnected` lub `isConnecting`, potraktuj je jak `false` i uprość wyrażenie. Konkretnie:
   - efekt reagujący na `isConnected`/`isConnecting` (~1535-1570) — zostaje tylko gałąź ustawiająca fallback SSE; jeśli po uproszczeniu efekt nie robi nic, usuń go razem z deps.
   - `if (isConnected || isSseConnected)` → `if (isSseConnected)`.
   - `const shouldPoll = !isConnected && !isSseConnected && enableSseFallback;` → `const shouldPoll = !isSseConnected && enableSseFallback;`
   - log `Stopping polling due to active connection: WebSocket=...` → zostaw tylko część o SSE.
4. W handlerze `handleWebSocketData` zmień nazwę na `handleRealtimeLogEntry` — jego treść zostaje.
5. Usuń `activeTransport.current = 'websocket'` i wszystkie odwołania do wartości `'websocket'`; jeśli `activeTransport` ma po tym jedną możliwą wartość, zostaw ref, ale bez gałęzi WS.

- [ ] **Step 5: Usuń zależności `ws`**

```bash
npm uninstall ws @types/ws
```

- [ ] **Step 6: Dowiedź, że nie ma referencji**

Run:
```bash
grep -rn "useWebSocket\|websocketManager\|websocket-manager\|WEBSOCKET_CONFIG\|from 'ws'\|isConnecting" --include=*.ts --include=*.tsx app components lib hooks types
```
Expected: brak wyników (exit 1). Każdy wynik to niedokończone zadanie.

- [ ] **Step 7: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: drop the dead WebSocket transport

The server side never accepted a connection: addConnection was
unreachable and no upgrade handler existed, so the client hook
reconnected against nothing while SSE carried every event. Removing it
leaves one transport instead of two, one of which was fictional."
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

Run:
```bash
grep -rni "vercel\|supabase" --include=*.ts --include=*.tsx app components lib hooks types
```
Expected: brak wyników. Dwa dopuszczalne wyjątki, jeśli wyjdą: link `vercel.com/templates` w treści strony szablonu w `lib/utils/scaffold.ts` (zostaje do Task 16) i słowo w komentarzu bez znaczenia funkcjonalnego — wtedy usuń komentarz i link.

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
- Modify: `lib/serializers/project.ts`, `lib/services/project.ts`
- Modify: `types/backend/cli.ts`, `types/backend/project.ts`

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
- `lib/services/project.ts` — usuń `preferredCli` z `createProject` i `updateProject` (kolumnę zdejmuje Task 7); w `getAllProjects`/`getProjectById` zamień `normalizeModelId(project.preferredCli ?? 'claude', ...)` na `normalizeModelId(null, ...)`.
- `lib/serializers/project.ts` — usuń `preferredCli` z serializowanego kształtu.
- `types/backend/cli.ts`, `types/backend/project.ts` — usuń union typów CLI innych niż `'claude'` i pola `preferredCli`/`fallbackEnabled`.

- [ ] **Step 5: Dowiedź, że nie ma referencji**

Run:
```bash
grep -rn "codex\|Codex\|qwen\|Qwen\|glm\|GLM\|gemini\|Gemini\|cursorModels\|cli/cursor\|activeCursorSessionId" --include=*.ts --include=*.tsx app components lib hooks types scripts
```
Expected: brak wyników. Referencje w UI (`components/`, `app/page.tsx`, `app/[project_id]/chat/page.tsx`) usuwa Task 6 — jeśli wyjdą tutaj, wypisz je i przejdź dalej; grep musi być czysty **po** Task 6.

- [ ] **Step 6: Sprawdź typy i testy**

Run: `npm run type-check`
Expected: błędy wyłącznie w plikach UI, które obsługuje Task 6. Wypisz je do raportu zadania. `npm test` musi być zielony.

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
- Modify: `components/settings/AIAssistantSettings.tsx`, `components/settings/GlobalSettings.tsx`, `components/settings/GeneralSettings.tsx`
- Modify: `components/modals/CreateProjectModal.tsx`
- Modify: `components/chat/ChatInput.tsx`
- Modify: `app/page.tsx`, `app/[project_id]/chat/page.tsx`
- Modify: `app/api/chat/[project_id]/cli-preference/route.ts` (usunięcie trasy)

**Interfaces:**
- Consumes: `getModelDefinitionsForCli`, `normalizeModelId`, `getDefaultModelForCli` z Task 5.
- Produces: UI zna tylko wybór modelu. `CreateProjectModal` przestaje przyjmować i wysyłać `preferredCli`; Task 18 dokłada do niego wybór template'u.

- [ ] **Step 1: Usuń hooka, mapy opcji i typy CLI**

```bash
git rm hooks/useCLI.ts lib/utils/cliOptions.ts types/cli.ts types/shared/cli.ts
git rm -r "app/api/chat/[project_id]/cli-preference"
```

- [ ] **Step 2: Usuń selektor CLI z ustawień**

W `components/settings/AIAssistantSettings.tsx` usuń dropdown wyboru CLI, listę `ACTIVE_CLI_OPTIONS`, ikony i kolory marek oraz stan `fallbackEnabled`. Zostaje wyłącznie wybór modelu, karmiony z `getModelDefinitionsForCli(null)`. To samo w `components/settings/GlobalSettings.tsx` i `GeneralSettings.tsx` — usuń sekcje per-CLI, zostaw model domyślny.

- [ ] **Step 3: Usuń wybór CLI z modala tworzenia projektu**

W `components/modals/CreateProjectModal.tsx` usuń: stan `selectedCLI`, `fallbackEnabled`, `enabledCLIs`, `cliStatus`, `showCLIDropdown`, cały dropdown CLI i pole `preferredCli` w ciele żądania POST. `selectedModel` inicjalizuj z `getDefaultModelForCli(null)`, a listę modeli bierz z `getModelDefinitionsForCli(null)`.

- [ ] **Step 4: Usuń wskaźniki CLI z czatu i listy projektów**

W `components/chat/ChatInput.tsx`, `app/page.tsx` i `app/[project_id]/chat/page.tsx` usuń badge'e i przełączniki CLI, `updatePreferredCli`, `handleCliChange`, `loadCliStatuses` oraz stan `cliStatuses`. Zostaw `handleModelChange` i `updateSelectedModel`, przestawiając ich wywołania `normalizeModelId(cli, model)` na `normalizeModelId(null, model)`.

- [ ] **Step 5: Domknij typ statusu, który zostaje po usuniętych plikach**

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

- [ ] **Step 6: Dowiedź, że nie ma referencji**

Run:
```bash
grep -rn "useCLI\|cliOptions\|ACTIVE_CLI\|CLI_OPTIONS\|preferredCli\|preferred_cli\|fallbackEnabled\|fallback_enabled\|cli-preference" --include=*.ts --include=*.tsx app components lib hooks types
```
Expected: brak wyników

Run (powtórka grepu z Task 5, teraz musi być czysty):
```bash
grep -rn "codex\|Codex\|qwen\|Qwen\|glm\|GLM\|gemini\|Gemini" --include=*.ts --include=*.tsx app components lib hooks types scripts
```
Expected: brak wyników

- [ ] **Step 7: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 8: Commit**

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
- Modify: `package.json` (skrypt `db:backup`)

**Interfaces:**
- Consumes: nic.
- Produces:
  ```ts
  // scripts/migrate-drop-legacy.js
  module.exports = { legacyProviderFilter };  // { provider: { in: ['vercel','supabase'] } }
  ```
  Task 22 dokumentuje `db:backup` w README.

- [ ] **Step 1: Napisz failujący test filtra usuwania**

Utwórz `tests/migration/legacy-purge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// @ts-expect-error - skrypt migracji jest zwykłym CommonJS bez typów
import { legacyProviderFilter } from '../../scripts/migrate-drop-legacy.js';

describe('legacyProviderFilter', () => {
  it('celuje wyłącznie w usunięte providery', () => {
    expect(legacyProviderFilter).toEqual({ provider: { in: ['vercel', 'supabase'] } });
  });

  it('nie obejmuje githuba', () => {
    expect(legacyProviderFilter.provider.in).not.toContain('github');
  });
});
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/migration/legacy-purge.test.ts`
Expected: FAIL — nie da się rozwiązać importu

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

const legacyProviderFilter = { provider: { in: ['vercel', 'supabase'] } };

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
    const removed = await prisma.projectServiceConnection.deleteMany({
      where: legacyProviderFilter,
    });
    console.log(`🧹 Removed ${removed.count} legacy service connection(s)`);
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

module.exports = { legacyProviderFilter, main };
```

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/migration/legacy-purge.test.ts`
Expected: PASS — 2 testy

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
npx prisma db push
```
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

Przyczyna, dla porządku: rodzic przekazuje `onSessionStatusChange` i `onAddUserMessage` jako inline arrow, więc przy każdym jego renderze `checkActiveSession` dostaje nową tożsamość, efekt montujący z deps `[projectId, checkActiveSession, loadChatHistory]` re-runuje się i woła `loadChatHistory({ showLoading: true })` — pełny refetch 200 wiadomości plus `setIsLoading(true)`.

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

Logikę auto-startu preview, która była w inline handlerze (`hasInitialPrompt && !agentWorkComplete && !previewUrl` → `start()`), przenieś do osobnego efektu reagującego na `isRunning`:

```ts
  useEffect(() => {
    if (isRunning) return;
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

Run: `npm run dev`
Następnie w przeglądarce otwórz projekt, zakładkę Network, filtr `messages`, i wyślij do agenta prompt („dodaj nagłówek na stronie głównej").
Expected: **jedno** `GET /api/chat/<id>/messages` przy wejściu na stronę i żadnego kolejnego w trakcie pracy agenta. Wiadomości dochodzą przez SSE, lista nie mruga, skeleton nie wraca. Zapisz w raporcie zadania liczbę zaobserwowanych żądań `messages` w trakcie jednego runu agenta.

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

  it.skipIf(process.platform === 'win32')('ubija proces razem z jego dzieckiem', async () => {
    // sh uruchamia node jako dziecko: kill samego sh zostawiłby wnuka żywym
    const child = spawn('sh', ['-c', 'node -e "setTimeout(()=>{}, 60000)" & wait'], {
      detached: true,
      stdio: 'ignore',
    });
    await wait(700);
    const pid = child.pid!;
    expect(isAlive(pid)).toBe(true);

    expect(killProcessTree(pid)).toBe(true);
    await wait(700);
    expect(isAlive(pid)).toBe(false);
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

Run:
```bash
npm run dev
# w UI: uruchom preview dowolnego projektu, zaczekaj na "ready"
# w drugim terminalu:
ps -ef | grep -c "[d]ata/projects"
# Ctrl+C na Claudable, potem znowu:
ps -ef | grep -c "[d]ata/projects"
```
Expected: pierwszy odczyt ≥ 1, drugi `0`. Wklej oba do raportu zadania.

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
- Modify: `lib/services/cli/claude.ts` (usunięcie guardu ścieżki i `maxOutputTokens`)

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

- [ ] **Step 2: Rozszerz test opcji o parytet**

W `tests/cli/claude-options.test.ts` dodaj do bloku `describe('buildClaudeQueryOptions', ...)`:

```ts
  it('używa presetowego promptu Claude Code, bez nadpisania i bez append', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
  });

  it('włącza wszystkie źródła ustawień z dysku', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
  });

  it('nie nakłada limitu tokenów wyjścia', () => {
    const options = buildClaudeQueryOptions(input);
    expect(options.maxOutputTokens).toBeUndefined();
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
    // Preset, nie string: string ZASTĘPUJE prompt Claude Code, a pominięcie
    // opcji daje prompt pusty. Preset bez `append` to jedyny sposób na
    // zachowanie się jak `claude` w terminalu.
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // Skille, CLAUDE.md, hooki i MCP z katalogu konfiguracyjnego.
    settingSources: ['user', 'project', 'local'],
  };
}
```

- [ ] **Step 6: Uruchom testy i potwierdź, że przechodzą**

Run: `npx vitest run tests/cli/`
Expected: PASS — 7 testów w `claude-options`, 3 w `claude-config-dir`, 2 w `init-payload`

- [ ] **Step 7: Zdejmij limit tokenów i guard ścieżki z `claude.ts`**

W `lib/services/cli/claude.ts`:
1. Usuń `const configuredMaxTokens = ...` i `const maxOutputTokens = ...` (~582-585) oraz `maxOutputTokens,` z obiektu opcji `query()`.
2. Usuń cały blok walidacji ścieżki — od `// Security: Verify project path is within allowed directory` do `throw new Error(errorMessage);` włącznie z obliczaniem `allowedBasePath`, `relativeToBase` i `isWithinBase` (~684-700). Zostaje samo wyliczenie `absoluteProjectPath` oraz tworzenie katalogu, jeśli nie istnieje.
3. Zamień lokalne wyliczenie `absoluteProjectPath` na `resolveProjectRoot` z Task 10:
   ```ts
   import { resolveProjectRoot } from '@/lib/utils/project-path';
   // ...
   const absoluteProjectPath = resolveProjectRoot(projectId, projectPath);
   ```

- [ ] **Step 8: Dowód z uruchomienia — payload `init` potwierdza parytet**

Run: `npm run dev`, wyślij dowolny prompt do agenta i odczytaj log serwera z Task 2.
Expected w `Session initialized`:
- `cwd` = ścieżka katalogu projektu (**nie** katalog Claudable),
- `permissionMode` = `bypassPermissions`,
- `skills` — liczba większa niż liczba skilli wbudowanych w CLI (czyli ładują się te z katalogu konfiguracyjnego),
- `mcpServers` — zawiera serwery z konfiguracji katalogu, jeśli są tam zdefiniowane.

Wklej cały obiekt `Session initialized` do raportu zadania. Puste `skills` przy niepustym katalogu `skills/` znaczy, że montowanie/symlinki nie działają — zgłoś to jako BLOCKED, nie obchodź.

- [ ] **Step 9: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 10: Commit**

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
- Create: `lib/templates/index.ts`
- Create: `lib/templates/nextjs.ts`
- Create: `tests/templates/registry.test.ts`
- Delete: `lib/utils/scaffold.ts`
- Modify: `lib/services/preview.ts` (import scaffoldu)

**Interfaces:**
- Consumes: nic.
- Produces:
  ```ts
  // lib/templates/index.ts
  export type TemplateId = 'nextjs' | 'astro';
  export interface ProjectTemplate {
    id: TemplateId;
    label: string;
    description: string;
    scaffold(projectPath: string, projectId: string): Promise<void>;
  }
  export const TEMPLATES: Record<TemplateId, ProjectTemplate>;
  export const TEMPLATE_LIST: ProjectTemplate[];
  export const DEFAULT_TEMPLATE_ID: TemplateId;      // 'nextjs'
  export function getTemplate(id?: string | null): ProjectTemplate;  // nieznane → domyślny
  ```
  Task 17 dodaje wpis `astro`; Task 18 podłącza `templateType` z bazy.

Rejestr nie ma pola `devCommand`: każdy template scaffolduje własny `scripts/run-dev.js` i `"dev": "node scripts/run-dev.js"` w `package.json`, więc `PreviewManager` dalej odpala `npm run dev -- --port N` i nie musi wiedzieć nic o frameworku.

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/templates/registry.test.ts`:

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_ID, TEMPLATES, getTemplate } from '@/lib/templates';

const scaffoldInto = async (id: 'nextjs' | 'astro') => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `tpl-${id}-`));
  await TEMPLATES[id].scaffold(dir, 'proj-test');
  return dir;
};

const readJson = async (dir: string, file: string) =>
  JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));

describe('getTemplate', () => {
  it('domyślnym template jest nextjs', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe('nextjs');
    expect(getTemplate(null).id).toBe('nextjs');
    expect(getTemplate(undefined).id).toBe('nextjs');
  });

  it('nieznane id schodzi do domyślnego, nie wybucha', () => {
    expect(getTemplate('vue').id).toBe('nextjs');
  });

  it('zwraca wskazany template', () => {
    expect(getTemplate('nextjs').id).toBe('nextjs');
  });
});

describe('template nextjs', () => {
  it('scaffolduje uruchamialny projekt', async () => {
    const dir = await scaffoldInto('nextjs');
    for (const file of [
      'package.json', 'tsconfig.json', 'next.config.js',
      'app/layout.tsx', 'app/page.tsx', 'app/globals.css',
      'scripts/run-dev.js', 'CLAUDE.md',
    ]) {
      await expect(fs.access(path.join(dir, file))).resolves.toBeUndefined();
    }
  });

  it('uruchamia dev przez własny wrapper', async () => {
    const dir = await scaffoldInto('nextjs');
    const pkg = await readJson(dir, 'package.json');
    expect(pkg.scripts.dev).toBe('node scripts/run-dev.js');
    expect(pkg.name).toBe('proj-test');
  });

  it('binduje wszystkie interfejsy, żeby port dał się opublikować', async () => {
    const dir = await scaffoldInto('nextjs');
    const runDev = await fs.readFile(path.join(dir, 'scripts/run-dev.js'), 'utf8');
    expect(runDev).toContain('0.0.0.0');
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
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/templates/registry.test.ts`
Expected: FAIL — nie da się rozwiązać importu `@/lib/templates`

- [ ] **Step 3: Przenieś scaffold Next.js do template'u**

Utwórz `lib/templates/nextjs.ts`. Przenieś do niego **całą** treść `lib/utils/scaffold.ts` (helper `writeFileIfMissing` oraz wszystkie bloki zapisujące pliki), z czterema zmianami:

1. Eksport nazwij `scaffoldNextApp` zamiast `scaffoldBasicNextApp`.
2. W generowanym `scripts/run-dev.js` dodaj bindowanie wszystkich interfejsów — w tablicy argumentów `next dev`:
   ```js
   ['next', 'dev', '--port', String(port), '--hostname', '0.0.0.0', ...passthrough]
   ```
   Bez tego opublikowany port kontenera nie dosięgnie procesu.
3. Usuń z generowanej `app/page.tsx` link do `vercel.com/templates` razem z jego blokiem `<a>` (zostały po usuniętej integracji).
4. Dopisz nowy plik `CLAUDE.md`:

```ts
  await writeFileIfMissing(
    path.join(projectPath, 'CLAUDE.md'),
    `# Project conventions

This is a Next.js 15 application using the App Router.

- TypeScript everywhere; no plain \`.js\` source files.
- Styling with Tailwind CSS. Install it yourself if it is not present yet.
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
```

- [ ] **Step 4: Napisz rejestr**

Utwórz `lib/templates/index.ts`:

```ts
import { scaffoldNextApp } from './nextjs';

export type TemplateId = 'nextjs' | 'astro';

export interface ProjectTemplate {
  id: TemplateId;
  label: string;
  description: string;
  scaffold(projectPath: string, projectId: string): Promise<void>;
}

export const DEFAULT_TEMPLATE_ID: TemplateId = 'nextjs';

export const TEMPLATES: Record<TemplateId, ProjectTemplate> = {
  nextjs: {
    id: 'nextjs',
    label: 'Next.js',
    description: 'React with the App Router, server components and API routes',
    scaffold: scaffoldNextApp,
  },
} as Record<TemplateId, ProjectTemplate>;

export const TEMPLATE_LIST: ProjectTemplate[] = Object.values(TEMPLATES);

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

Uwaga: rzutowanie `as Record<TemplateId, ProjectTemplate>` istnieje tylko dlatego, że wpis `astro` dochodzi w Task 17. **Usuń je w Task 17**, gdy mapa będzie kompletna — inaczej zostanie w kodzie jako trwała dziura w typach.

- [ ] **Step 5: Usuń stary scaffold i przekieruj `PreviewManager`**

```bash
git rm lib/utils/scaffold.ts
```

W `lib/services/preview.ts` zamień import `scaffoldBasicNextApp` na:

```ts
import { getTemplate } from '@/lib/templates';
```

i w obu miejscach (`installDependencies` i `start`) zamień wywołanie `await scaffoldBasicNextApp(projectPath, projectId);` na:

```ts
      await getTemplate(project.templateType).scaffold(projectPath, projectId);
```

- [ ] **Step 6: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/templates/registry.test.ts`
Expected: PASS — 9 testów

- [ ] **Step 7: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: turn the Next.js scaffold into a template registry

Templates become entries in a registry instead of one hardcoded
function, so adding a framework is one file. Framework conventions go
into the generated project's CLAUDE.md, which the agent reads from its
working directory, rather than into the system prompt. The dev wrapper
binds all interfaces so a published container port can reach it."
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
      'scripts/run-dev.js', 'CLAUDE.md',
    ]) {
      await expect(fs.access(path.join(dir, file))).resolves.toBeUndefined();
    }
  });

  it('uruchamia dev przez własny wrapper i zależy od astro', async () => {
    const dir = await scaffoldInto('astro');
    const pkg = await readJson(dir, 'package.json');
    expect(pkg.scripts.dev).toBe('node scripts/run-dev.js');
    expect(pkg.dependencies.astro).toMatch(/^\^\d+\.0\.0$/);
    expect(pkg.dependencies).not.toHaveProperty('next');
  });

  it('binduje wszystkie interfejsy', async () => {
    const dir = await scaffoldInto('astro');
    const runDev = await fs.readFile(path.join(dir, 'scripts/run-dev.js'), 'utf8');
    expect(runDev).toContain('0.0.0.0');
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
    path.join(projectPath, 'scripts/run-dev.js'),
    `#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const isWindows = process.platform === 'win32';

function parseCliArgs(argv) {
  const passthrough = [];
  let preferredPort;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--port' || arg === '-p') {
      const value = argv[i + 1];
      if (value && !value.startsWith('-')) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed)) {
          preferredPort = parsed;
        }
        i += 1;
        continue;
      }
    } else if (arg.startsWith('--port=')) {
      const parsed = Number.parseInt(arg.slice('--port='.length), 10);
      if (!Number.isNaN(parsed)) {
        preferredPort = parsed;
      }
      continue;
    }

    passthrough.push(arg);
  }

  return { preferredPort, passthrough };
}

function resolvePort(preferredPort) {
  const candidates = [preferredPort, process.env.PORT, process.env.PREVIEW_PORT_START, 3100];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const numeric = typeof candidate === 'number' ? candidate : Number.parseInt(String(candidate), 10);
    if (!Number.isNaN(numeric) && numeric > 0 && numeric <= 65535) {
      return numeric;
    }
  }
  return 3100;
}

(async () => {
  const { preferredPort, passthrough } = parseCliArgs(process.argv.slice(2));
  const port = resolvePort(preferredPort);
  const url = process.env.NEXT_PUBLIC_APP_URL || \`http://localhost:\${port}\`;

  process.env.PORT = String(port);
  process.env.NEXT_PUBLIC_APP_URL = url;

  console.log(\`🚀 Starting Astro dev server on \${url}\`);

  const child = spawn(
    'npx',
    ['astro', 'dev', '--port', String(port), '--host', '0.0.0.0', ...passthrough],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: isWindows,
      env: { ...process.env, PORT: String(port), NEXT_PUBLIC_APP_URL: url },
    }
  );

  child.on('exit', (code) => {
    if (typeof code === 'number' && code !== 0) {
      console.error(\`❌ Astro dev server exited with code \${code}\`);
      process.exit(code);
    }
  });

  child.on('error', (error) => {
    console.error('❌ Failed to start Astro dev server');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
})();
`
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

Run:
```bash
TMP=$(mktemp -d)
node -e "require('tsx/cjs');" 2>/dev/null || npx tsx -e "
  import('./lib/templates/index.ts').then(async (m) => {
    await m.TEMPLATES.astro.scaffold(process.env.TMP, 'astro-smoke');
  })
" || echo "użyj vitesta do wygenerowania katalogu, jeśli tsx nie jest dostępny"
cd $TMP && npm install --no-audit --no-fund && timeout 60 npm run dev -- --port 3199 &
sleep 25 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3199/
```
Expected: `200`. Jeśli `tsx` nie jest dostępny, wygeneruj katalog jednorazowym testem Vitesta wypisującym ścieżkę (`console.log(dir)`) i wykonaj resztę kroków na niej. Wklej kod odpowiedzi i wersję Astro do raportu. Posprzątaj `$TMP` po próbie.

- [ ] **Step 8: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 9: Commit**

```bash
git add lib/templates/astro.ts lib/templates/index.ts tests/templates/registry.test.ts
git commit -m "feat: add an Astro project template

Second entry in the registry, with its own dev wrapper binding all
interfaces and its own CLAUDE.md so the agent works to Astro's
conventions instead of Next's. The registry map is now complete, so the
placeholder cast is gone."
```

### Task 18: Podłącz `templateType` od bazy do UI (decyzja 8, znalezisko H)

**Files:**
- Modify: `lib/services/project.ts`
- Modify: `app/api/projects/route.ts`
- Modify: `lib/serializers/project.ts`
- Modify: `components/modals/CreateProjectModal.tsx`
- Modify: `types/backend/project.ts`, `types/shared/project.ts`
- Create: `tests/services/create-project-input.test.ts`

**Interfaces:**
- Consumes: `TemplateId`, `TEMPLATE_LIST`, `getTemplate` (Task 16, 17).
- Produces:
  ```ts
  export function normalizeTemplateType(value?: string | null): TemplateId;  // lib/templates/index.ts
  ```
  `CreateProjectInput` zyskuje `templateType?: TemplateId`.

Dziś `templateType` jest zapisywany na sztywno jako `'nextjs'` i nigdzie nie czytany, a typ `TemplateType` jest zdublowany w dwóch plikach z wartościami, których nie ma (`react`, `vue`).

- [ ] **Step 1: Napisz failujący test**

Utwórz `tests/services/create-project-input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeTemplateType } from '@/lib/templates';

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
```

- [ ] **Step 2: Uruchom test i potwierdź, że failuje**

Run: `npx vitest run tests/services/create-project-input.test.ts`
Expected: FAIL — `normalizeTemplateType is not a function`

- [ ] **Step 3: Dodaj normalizator do rejestru**

W `lib/templates/index.ts` dodaj:

```ts
export function normalizeTemplateType(value?: string | null): TemplateId {
  const candidate = value?.trim().toLowerCase();
  if (candidate && candidate in TEMPLATES) {
    return candidate as TemplateId;
  }
  return DEFAULT_TEMPLATE_ID;
}
```

- [ ] **Step 4: Uruchom test i potwierdź, że przechodzi**

Run: `npx vitest run tests/services/create-project-input.test.ts`
Expected: PASS — 3 testy

- [ ] **Step 5: Zapisuj wybrany template**

- `types/backend/project.ts` i `types/shared/project.ts` — usuń zdublowany `export type TemplateType = 'nextjs' | 'react' | 'vue' | 'custom';` z oba plików i zamiast tego reeksportuj jedną definicję: `export type { TemplateId as TemplateType } from '@/lib/templates';`. Pole `templateType?: TemplateType` zostaje.
- `types/backend/project.ts` — dodaj `templateType?: TemplateType;` do `CreateProjectInput`, jeśli go tam nie ma.
- `lib/services/project.ts` — w `createProject` zamień `templateType: 'nextjs',` na `templateType: normalizeTemplateType(input.templateType),` i dodaj import `import { normalizeTemplateType } from '@/lib/templates';`.
- `app/api/projects/route.ts` — w budowanym `input` dodaj `templateType: normalizeTemplateType(body.templateType ?? body.template_type),`.
- `lib/serializers/project.ts` — dopisz `templateType` do serializowanego kształtu, żeby UI mógł go pokazać.

- [ ] **Step 6: Dodaj wybór template'u w modalu**

W `components/modals/CreateProjectModal.tsx`:
1. Dodaj import `import { TEMPLATE_LIST, DEFAULT_TEMPLATE_ID } from '@/lib/templates';`
2. Dodaj stan `const [selectedTemplate, setSelectedTemplate] = useState<string>(DEFAULT_TEMPLATE_ID);`
3. W miejscu, gdzie był dropdown CLI (usunięty w Task 6), wstaw wybór template'u: prosty rząd przycisków po jednym na `TEMPLATE_LIST`, z `label` jako treścią i `description` w `title`. Aktywny wyróżnij tak, jak wyróżniany był aktywny CLI — nie wprowadzaj nowego języka wizualnego.
4. W ciele żądania POST dodaj `templateType: selectedTemplate,`.

- [ ] **Step 7: Dowód z uruchomienia — projekt z Astro**

Run: `npm run dev`, utwórz nowy projekt z template'em Astro i promptem „dodaj stronę /about z nagłówkiem About".
Expected:
- w `data/projects/<id>` jest `astro.config.mjs` i `src/pages/index.astro`, nie ma `next.config.js`,
- preview startuje i iframe pokazuje stronę,
- agent tworzy `src/pages/about.astro` (a nie `app/about/page.tsx`) — dowód, że przeczytał `CLAUDE.md` template'u.
Wklej do raportu listing katalogu projektu i ścieżkę pliku, który agent utworzył.

- [ ] **Step 8: Sprawdź typy, testy i build**

Run: `npm run type-check && npm test && npm run build`
Expected: zero błędów, testy zielone, build przechodzi

- [ ] **Step 9: Commit**

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
- Modify: `next.config.js` (tryb `standalone`, jeśli nie jest ustawiony)

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

- [ ] **Step 2: Upewnij się, że Next buduje standalone**

W `next.config.js` sprawdź, czy jest `output: 'standalone'`. Jeśli nie, dodaj do obiektu konfiguracji:

```js
  output: 'standalone',
```

(`package.json` → `build.files` już odwołuje się do `.next/standalone`, więc tryb jest oczekiwany przez electron-buildera.)

- [ ] **Step 3: Napisz `Dockerfile`**

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

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/lib ./lib

# Katalog danych: projekty użytkownika, baza i ustawienia globalne.
RUN mkdir -p /data/projects
VOLUME ["/data"]

EXPOSE 3000
EXPOSE 3100-3131

# Dev-servery projektów są procesami potomnymi tego kontenera, więc PID 1
# musi je zbierać. `init: true` w compose zapewnia reaper.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx next start --port 3000 --hostname 0.0.0.0"]
```

- [ ] **Step 4: Zbuduj obraz**

Run: `docker build -t claudable:dev .`
Expected: build kończy się sukcesem. Jeśli `npm run build` w etapie `build` failuje na brakującym `.env`, dodaj przed `npm run build` linię `RUN node scripts/setup-env.js || true` i zanotuj to w raporcie.

- [ ] **Step 5: Sprawdź, co jest w obrazie**

Run:
```bash
docker run --rm claudable:dev sh -c "git --version && python3 --version && bash --version | head -1 && node --version"
```
Expected: wszystkie cztery wersje wypisane. Wklej wynik do raportu.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore next.config.js
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
- Modify: `scripts/setup-env.js` (górna granica zakresu portów)
- Modify: `.env` (zakres portów)

**Interfaces:**
- Consumes: obraz z Task 19, `resolveClaudeConfigDir` z Task 13.
- Produces: uruchamialny `docker compose up`. Zmienne: `CLAUDABLE_DATA`, `CLAUDABLE_CLAUDE_DIR`, `CLAUDABLE_SYMLINK_ROOT`.

- [ ] **Step 1: Zwęź zakres portów do publikowalnego**

W `scripts/setup-env.js` znajdź domyślną górną granicę zakresu preview (obecnie `3999`) i zmień ją na `3131`. To samo w `.env` i `.env.local`, jeśli tam są wpisane. Zakres 32 portów wynika z decyzji 5: publikowanie 900 portów wydłuża start kontenera do absurdu.

Sprawdź też `lib/utils/ports.ts` i `lib/config/constants.ts` — jeśli mają własny fallback `3999`, zmień na `3131`, żeby wartość była jedna.

- [ ] **Step 2: Napisz `docker-compose.yml`**

Utwórz `docker-compose.yml`:

```yaml
services:
  claudable:
    build: .
    image: claudable:dev
    # Dev-servery projektów są dziećmi tego kontenera — PID 1 musi je zbierać.
    init: true
    ports:
      - "3000:3000"
      - "3100-3131:3100-3131"
    environment:
      PROJECTS_DIR: /data/projects
      DATABASE_URL: file:/data/cc.db
      SETTINGS_DIR: /data
      PREVIEW_PORT_START: "3100"
      PREVIEW_PORT_END: "3131"
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      # Katalog, z którego agent bierze CLAUDE.md, skille, hooki i MCP —
      # dokładnie tak jak `claude` w terminalu.
      CLAUDE_CONFIG_DIR: /root/.claude
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:?ustaw ENCRYPTION_KEY w .env}
    volumes:
      # Projekty, baza i ustawienia globalne. Podmień CLAUDABLE_DATA, żeby
      # trzymać projekty gdzie indziej.
      - ${CLAUDABLE_DATA:-./data}:/data
      # Konfiguracja agenta. Musi być zapisywalna: odświeżenie tokenu OAuth
      # pisze do .credentials.json, a przy :ro agent padnie po jego wygaśnięciu.
      - ${CLAUDABLE_CLAUDE_DIR:-${HOME}/.claude}:/root/.claude
      # Jeśli pliki w katalogu wyżej są symlinkami (np. do dotfiles), ich cel
      # musi być widoczny pod tą samą ścieżką absolutną, inaczej zawisną.
      # Zostaw domyślne /dev/null, gdy symlinków nie ma.
      - ${CLAUDABLE_SYMLINK_ROOT:-/dev/null}:${CLAUDABLE_SYMLINK_ROOT:-/dev/null}:ro
```

- [ ] **Step 3: Napisz przykładowy plik zmiennych**

Utwórz `.env.docker.example`:

```bash
# Skopiuj do .env i uzupełnij przed `docker compose up`.

# Klucz szyfrowania zmiennych środowiskowych projektów (32 bajty hex).
# Wygeneruj: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=

# Gdzie trzymać projekty, bazę i ustawienia. Domyślnie ./data w repo.
# CLAUDABLE_DATA=/srv/claudable-data

# Katalog konfiguracyjny agenta: CLAUDE.md, skille, hooki, MCP, poświadczenia.
# Domyślnie ~/.claude, czyli to samo, co widzi `claude` w terminalu.
# CLAUDABLE_CLAUDE_DIR=/srv/claudable-claude-home

# Ustaw TYLKO jeśli pliki w katalogu wyżej są symlinkami wychodzącymi poza
# niego — podaj wspólny katalog docelowy, np. /home/ty/dotfiles.
# CLAUDABLE_SYMLINK_ROOT=/home/ty/dotfiles
```

- [ ] **Step 4: Uruchom stack**

Run:
```bash
cp -n .env.docker.example .env.docker 2>/dev/null || true
docker compose up --build -d
docker compose logs --tail 40 claudable
```
Expected: `prisma db push` przechodzi, Next startuje na 3000. Jeśli brakuje `ENCRYPTION_KEY`, compose zatrzyma się z czytelnym komunikatem — to zamierzone.

- [ ] **Step 5: Dowód — parytet agenta w kontenerze**

Run: otwórz `http://localhost:3000`, utwórz projekt i wyślij prompt. Potem:
```bash
docker compose logs claudable | grep -A 20 "Session initialized"
```
Expected w payloadzie: `cwd` = `/data/projects/<id>`, `skills` zawiera skille z zamontowanego katalogu, `mcpServers` zawiera serwery z jego konfiguracji, `agents` zawiera definicje z `agents/*.md`. Wklej cały payload do raportu. Puste `skills` przy niepustym `skills/` po stronie hosta = wiszące symlinki: ustaw `CLAUDABLE_SYMLINK_ROOT` i powtórz.

- [ ] **Step 6: Dowód — preview dosięgalne z hosta**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/
```
(albo port, który przydzielił PreviewManager — odczytaj z logów)
Expected: `200`. To sprawdza jednocześnie publikację zakresu portów i bindowanie na `0.0.0.0` z Task 16/17.

- [ ] **Step 7: Dowód — dane przeżywają restart**

Run:
```bash
docker compose restart claudable
sleep 15
curl -s http://localhost:3000/api/projects | head -c 300
```
Expected: utworzony projekt jest na liście. Wklej fragment odpowiedzi do raportu.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml .env.docker.example scripts/setup-env.js .env lib/utils/ports.ts lib/config/constants.ts
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
- Modify: `components/chat/ChatLog.tsx`
- Modify: `lib/services/cli/claude.ts`

**Interfaces:**
- Consumes: nic.
- Produces: nic. Czysta redukcja szumu.

Usuwamy wyłącznie logi diagnostyczne dodane przy debugowaniu konkretnych problemów. **Nie** usuwamy `console.error` z obsługi błędów ani logu `Session initialized` z Task 2 — ten jest celowym narzędziem dowodowym.

- [ ] **Step 1: Usuń logi z trasy `act`**

W `app/api/chat/[project_id]/act/route.ts` usuń oba bloki `console.log('📸 Creating message with attachments:', {...})` i `console.log('📸 Message created successfully:', {...})` w całości. Zostaw `console.warn`/`console.error` w blokach `catch`.

- [ ] **Step 2: Usuń logi z `ChatLog.tsx`**

Usuń: `console.log('[ChatLog] Loaded messages from API:', {...})`, pętlę `normalized.forEach` logującą `🖼️ DB loaded message with attachments`, `console.log('[ChatLog] Loaded ${...} messages')` oraz `console.log('🔄 [HandlerSetup] ...')`, jeśli jeszcze został po Task 8. Zostaw `console.debug` pollingu — jest za flagą poziomu i przydaje się przy diagnozie transportu.

- [ ] **Step 3: Przytnij log startowy adaptera**

W `lib/services/cli/claude.ts` zredukuj blok otwierający `executeClaude` (ramka z `====`, `Project:`, `Model:`, `Session ID:`, `Instruction:`) do jednej linii:

```ts
  console.log(`[ClaudeService] Starting agent for ${projectId} on ${modelLabel} [${resolvedModel}]${aliasNote}`);
```

Zachowaj wyliczenia `resolvedModel`, `modelLabel` i `aliasNote` — są używane.

- [ ] **Step 4: Sprawdź, że emoji-logi zniknęły z gorących ścieżek**

Run:
```bash
grep -rn "📸\|🖼️\|🔄 \[HandlerSetup\]" --include=*.ts --include=*.tsx app components lib
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

- [ ] **Step 1: Popraw listę wspieranych agentów**

W `README.md` usuń sekcje „Supported AI Coding Agents" dotyczące Codex CLI, Cursor CLI, Qwen Code i Z.AI GLM-4.6 wraz z ich instrukcjami instalacji oraz sekcje demo („Codex CLI Example", „Qwen Code Example"). Zostaw Claude Code. Popraw w niej „Context: Native 200k tokens" — Opus 5 i Sonnet 5 mają 1M, Haiku 4.5 ma 200K — i wymień modele dokładnymi id: `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`.

- [ ] **Step 2: Popraw listę integracji**

Usuń Vercela i Supabase z „Features", „Technology Stack" i „Integration Guide". Zostaw GitHuba. Usuń zdanie o deploju jednym kliknięciem i o darmowym PostgreSQL.

- [ ] **Step 3: Napraw obiecane skrypty npm**

Sekcja „Additional Commands" wymienia `npm run db:backup`, `db:reset` i `clean`. `db:backup` istnieje od Task 7 — zostaw z poprawnym opisem. `db:reset` zamień na istniejące `npm run prisma:reset`. `clean` albo usuń z README, albo dodaj do `package.json`:

```json
    "clean": "rm -rf node_modules package-lock.json",
```
Wybierz dodanie skryptu, jeśli zostawiasz wpis w README — dokumentacja i `package.json` muszą się zgadzać.

- [ ] **Step 4: Dopisz sekcję Dockera**

Po „Quick Start" dodaj:

```markdown
## Docker

```bash
cp .env.docker.example .env
# uzupełnij ENCRYPTION_KEY
docker compose up --build
```

Aplikacja stoi na http://localhost:3000, a preview projektów na portach 3100-3131.

Dwa mapowania mają znaczenie:

- `CLAUDABLE_DATA` (domyślnie `./data`) → `/data` w kontenerze. Trzyma projekty,
  bazę SQLite i ustawienia globalne. Przestaw, żeby trzymać projekty poza repo.
- `CLAUDABLE_CLAUDE_DIR` (domyślnie `~/.claude`) → `/root/.claude`. To z tego
  katalogu agent bierze `CLAUDE.md`, skille, subagentów, hooki i serwery MCP —
  dokładnie tak, jak `claude` uruchomiony w terminalu. Mount musi być
  zapisywalny, bo odświeżenie tokenu OAuth pisze do `.credentials.json`.

Jeśli pliki w tym katalogu są symlinkami wychodzącymi poza niego (typowe przy
dotfiles), ustaw `CLAUDABLE_SYMLINK_ROOT` na wspólny katalog docelowy —
inaczej symlinki zawisną i ustawienia po cichu nie wejdą.
```

- [ ] **Step 5: Dopisz sekcję o template'ach**

W „Usage" dodaj akapit: nowy projekt wybiera template (Next.js albo Astro); template scaffolduje minimalny projekt i zapisuje `CLAUDE.md` z konwencjami frameworka, które agent czyta z katalogu projektu.

- [ ] **Step 6: Zweryfikuj każdy skrypt wymieniony w README**

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

- [ ] **Step 7: Ostatnia weryfikacja całości**

Run: `npm run type-check && npm test && npm run lint && npm run build`
Expected: wszystko zielone. To jest brama wyjściowa planu.

- [ ] **Step 8: Commit**

```bash
git add README.md package.json
git commit -m "docs: bring the README in line with the code

It advertised four agents that are gone, deploy targets that are gone,
a 200k context that is wrong, and three npm scripts that never existed.
Adds the Docker section, including which two mounts matter and why the
agent config directory has to be writable."
```
