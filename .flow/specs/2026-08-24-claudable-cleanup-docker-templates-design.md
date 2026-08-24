# Claudable — odchudzenie, stabilizacja UI, Docker, template'y

Data: 2026-08-24
Run: `claudable-cleanup-docker-templates`
Status: zapis deliberacji (dokument datowany, nie aktualizowany później)

## 1. Kontekst

Claudable to lokalny builder aplikacji: agent CLI pisze kod aplikacji
użytkownika w `data/projects/<id>`, a Claudable (Next.js 15, App Router)
orkiestruje — trzyma projekty w SQLite, streamuje przebieg pracy agenta do UI,
odpala preview dev-server i wypycha wynik do GitHuba.

Zlecenie obejmuje siedem niezależnych wątków: usunięcie martwej warstwy
WebSocket, redukcję do jednego agenta (Claude Code), usunięcie integracji Vercel
i Supabase, naprawę flickerowania czatu, poprawki z audytu, konteneryzację z
mapowanym katalogiem projektów oraz obsługę wielu template'ów (Next.js + Astro).

Projekt **nie ma living speca** (`spec.md`) — zgodnie z regułą 6 CLAUDE.md nie
powstaje on jako produkt uboczny tej zmiany; to osobna robota (`writing-specs`).
Ten dokument jest jedynym artefaktem bramki designu.

## 2. Decyzje

| # | Decyzja | Wybór | Dlaczego |
|---|---------|-------|----------|
| 1 | Warstwa WebSocket | **Usunąć w całości**, SSE zostaje jedynym transportem | Uzasadnienie **zmienione po pomiarze** (znalezisko C): nie „martwy kod", a transport, który nie utrzymuje połączenia dłużej niż kilka sekund i którego trzepanie napędza flicker oraz zagłodza własny fallback. Naprawa oznaczałaby debugowanie zszycia `noServer` z serwerem deweloperskim Nexta i podwójną weryfikację pod `next start` oraz w kontenerze — po to, żeby mieć drugi kanał do jednokierunkowego strumienia, który SSE już obsługuje. Decyzja użytkownika po przedstawieniu pomiaru. |
| 2 | Agenci inni niż Claude Code | **Usunąć** (codex, cursor, qwen, glm) | Decyzja użytkownika. ~3100 linii w czterech adapterach robiących ten sam przepływ. |
| 3 | Vercel i Supabase | **Usunąć** | Decyzja użytkownika. |
| 4 | GitHub | **Zostaje** | Decyzja użytkownika: jedyna droga wyjścia kodu poza zmapowany wolumen. |
| 5 | Porty preview w Dockerze | **Publikowany węższy zakres 3100–3131** (32 slotów) | Decyzja użytkownika. Zero zmian w logice preview, HMR Next/Astro działa bez proxy. Reverse proxy pod `/preview/<id>/` odrzucone: wymaga przepuszczenia HMR-owego WebSocketa i wymuszania `basePath`/`assetPrefix` w aplikacji użytkownika, co psułoby apki generowane przez agenta. |
| 6 | Auth agenta w kontenerze | **Wyłącznie mount `~/.claude`** | Decyzja użytkownika — login z subskrypcji, zero kluczy w plikach. |
| 7 | Persystencja w Dockerze | **Jeden mount `/data`** (projekty + `cc.db` + `global-settings.json`), `PROJECTS_DIR=/data/projects` | Sam mount katalogu projektów dawałby kontener, który po restarcie ma pliki na dysku, ale pustą listę projektów — czyli widoczną awarię. Mapowalna ścieżka do projektów pozostaje spełniona: to podkatalog mountu. |
| 8 | Zestaw template'ów | **Next.js + Astro**, rejestr rozszerzalny o jeden plik | Decyzja użytkownika. |
| 9 | Kształt template'ów | **Rejestr w TS** (`lib/templates/`), nie katalogi plików ani `create-*-app` | Sekcja 3. |
| 10 | Migracja bazy | **Wyczyścić schemat**: usunąć `preferredCli`, `activeCursorSessionId`, `fallbackEnabled`; usunąć wiersze `ProjectServiceConnection` dla `vercel`/`supabase`. Backup `data/cc.db` przed migracją. | Decyzja użytkownika. Kolumna, której nikt nie czyta, kłamie o tym, co aplikacja umie. |
| 11 | Selektor modelu | **Zostaje**, znika selektor CLI | Claude ma wiele modeli — to wybór, który dalej ma sens. Znika `lib/constants/{codex,cursor,qwen,glm}Models.ts` i warstwa `cliModels` sprowadza się do modeli Claude. Lista modeli — decyzja 17. |
| 12 | `/api/settings/cli-status` | **Przerobić na sprawdzenie poświadczeń**, nie binarki | `@anthropic-ai/claude-agent-sdk` ma własny bundlowany `cli.js` i nie potrzebuje globalnego `claude` na PATH. Obecny `claude --version` sprawdza rzecz nieistotną: może zawieść przy działającym SDK i odwrotnie. Nowy check pyta o obecność `$CLAUDE_CONFIG_DIR/.credentials.json` (domyślnie `~/.claude`). |
| 13 | Zakres naprawy flickera | **Chirurgicznie**, bez dekompozycji `ChatLog.tsx`/`page.tsx` | Przyczyna jest punktowa (sekcja 5, znalezisko B). Rozbijanie 3200-linijkowych plików to osobna robota i nie jest tym, o co proszono. |
| 14 | Testy | **Vitest + testy logiki czystej**, którą ta zmiana i tak rusza | Repo nie ma ani jednego testu ani runnera, a workflow wymaga dowodu. Pokrycie: rejestr template'ów, scaffold, alokacja portów preview, normalizacja modeli, rekoncyliacja osieroconych `UserRequest`. Flicker i Docker weryfikowane odpaleniem. |
| 15 | Kształt dostawy | **Jedna gałąź, plan w fazach**: usunięcia → flicker i bugi → template'y i Docker | Decyzja użytkownika. Usunięcia idą pierwsze, bo kurczą powierzchnię, którą reszta dotyka — zwłaszcza `ChatLog.tsx`, gdzie spotykają się WS i flicker. |
| 16 | ~~Izolacja agenta od ustawień hosta~~ | **Wyparte decyzją 24.** Zapisane, gdy wymaganiem był domyślny prompt; wymóg zmienił się na parytet z terminalem, więc `settingSources` zostaje włączone, a katalog `.claude` wnosi ustawienia, skille, hooki i MCP. | — |
| 17 | Lista modeli Claude | **Opus 5 (`claude-opus-5`), Sonnet 5 (`claude-sonnet-5`), Haiku 4.5 (`claude-haiku-4-5`)**, domyślny **Sonnet 5**. Generacja 4.6 schodzi do `aliases`. | Polecenie użytkownika. Zejście 4.6 do aliasów, a nie do kosza, to własna konwencja tego pliku — tak już leżą `claude-opus-4-5`, `claude-sonnet-4-5` i trzy generacje wcześniej. Dzięki temu wiersze w bazie trzymające `claude-sonnet-4-6` dalej się rozwiązują, tylko na nowszy model. |
| 18 | Kanoniczne ID Haiku | **`claude-haiku-4-5`** bez sufiksu daty; `claude-haiku-4-5-20251001` zostaje aliasem | Commit `2634077` („use correct Claude API model IDs (without date suffix)") ściął sufiksy, ale Haiku został z datą — plik jest niespójny sam ze sobą. ID modeli są kompletne w formie bez daty i sufiksów się do nich nie dokleja. Stara forma jako alias, więc istniejące wiersze w bazie nadal się rozwiązują. |
| 19 | ~~`maxOutputTokens` 32000~~ | **Zastąpione decyzją 25** | — |
| 20 | Regresja `cwd` | **Cofnąć `workingDirectory` na `cwd`** | Znalezisko N. Blokuje wszystko inne — dopóki agent pracuje w repo Claudable, żadna inna zmiana nie ma sensu. |
| 21 | `bypassPermissions` | **Dodać `allowDangerouslySkipPermissions: true`** | Znalezisko O. SDK wymaga tej flagi, żeby tryb w ogóle zadziałał. |
| 22 | Rzutowanie `as any` na opcjach `query()` | **Usunąć** | Znalezisko Q. To ono ukryło N i O. Bez niego kompilator znalazłby oba w sekundę, a każdy przyszły breaking change SDK zgłosi się sam. |
| 23 | System prompt agenta | **`systemPrompt: { type: 'preset', preset: 'claude_code' }`** — bez `append`, bez nadpisania. Instrukcje platformy znikają całkowicie. | Polecenie użytkownika: domyślny prompt, nic nie dopisujemy. Pominięcie opcji dałoby pusty prompt (`sdk.mjs`: `if (Y === void 0) G = ""`), więc preset trzeba podać jawnie. Konsekwencje zdjęcia zakazów — ryzyko 6. |
| 24 | Ustawienia, skille, MCP, CLAUDE.md | **`settingSources: ['user','project','local']`** + katalog `.claude` bindowany przez `CLAUDABLE_CLAUDE_DIR` (domyślnie `~/.claude`) | Wymóg: agent ma zachowywać się jak `claude` w terminalu i brać wszystko z bindowanego katalogu. Co dokładnie z tego wchodzi — zmierzone, sekcja 4.8. |
| 25 | `maxOutputTokens` | **Nie przekazywać wcale** | Polecenie użytkownika (zdjąć limit). Zastępuje decyzję 19. Uwaga: to usunięcie **martwego kodu**, nie zdjęcie działającego limitu — patrz sprostowanie w znalezisku L. |
| 26 | Guard `PROJECTS_DIR` w `executeClaude` | **Usunąć** | Polecenie użytkownika. Znosi to granicę zapisu poza katalogiem projektu — akceptowalne dopiero dlatego, że całość idzie do kontenera, w którym zamontowane są wyłącznie `/data` i katalog `.claude`. Konsolidacja resolvera ścieżek (znalezisko F) zostaje, bo dotyczy poprawnych ścieżek, nie ograniczeń. |
| 27 | Payload `system`/`init` z SDK | **Logować i publikować** (`cwd`, `tools`, `skills`, `agents`, `mcp_servers`, `plugins`, `permissionMode`, `model`) | Znalezisko R. To jedyny sposób udowodnienia decyzji 20-24 empirycznie, a nie z typów: SDK sam raportuje, w jakim katalogu siedzi i co widzi. Dowód dla reguły „nic nie jest zrobione bez uruchomienia". |
| 28 | Subagenci z plików | **Claudable sam czyta `agents/*.md`** (scope user i project), parsuje frontmatter i podaje przez opcję `agents` | `settingSources` ich **nie** ładuje — zmierzone: 5 definicji w `~/.claude/agents/` plus jedna podłożona w katalogu projektu, a payload `init` dalej raportuje wyłącznie cztery wbudowane. Bez tego parytet z terminalem jest niepełny dokładnie w tym jednym miejscu. |
| 29 | Zawartość obrazu Dockera | **`python3` i `bash`** obok `git` i Node | Hooki z bindowanego katalogu wykonują się jako procesy — bez interpretera po prostu nie ruszą. Niezależne od tego, czyj katalog zostanie zamontowany: hooki użytkowników to zwykle shell albo Python. |

## 3. Rozważane podejścia — kształt template'ów

Jedyny punkt, w którym istniał realny wybór architektoniczny.

**A. Rejestr w TypeScripcie (wybrane).** `lib/templates/index.ts` eksportuje mapę
`id → { label, scaffold(projectPath, projectId), devCommand, systemPrompt }`,
implementacja per template w `lib/templates/nextjs.ts` i `lib/templates/astro.ts`.
Dodanie trzeciego to jeden plik i jeden wpis.
*Za:* najmniejsza zmiana względem tego, co jest — `lib/utils/scaffold.ts` już jest
funkcją TS zapisującą pliki; szablony są malutkie (`package.json`, config, jedna
strona), bo resztę dopisuje agent; nic nie trzeba dowozić w obrazie ani w
`electron-builder.files`.
*Przeciw:* zawartość szablonu żyje w stringach TS, więc edycja szablonu to edycja
kodu.

**B. Katalogi plików kopiowane rekurencyjnie** (`templates/astro/**`).
*Za:* szablon jako dane, edytowalny bez dotykania kodu.
*Przeciw:* trzeba go wozić w obrazie Dockera i w `build.files` electron-buildera,
a podmiana nazwy projektu wymaga własnego mini-silnika placeholderów. Więcej
ruchomych części niż zysku przy szablonie na cztery pliki.

**C. Odpalanie `create-next-app` / `create astro` w kontenerze.**
*Za:* zero utrzymania, szablon zawsze aktualny.
*Przeciw:* kilkadziesiąt sekund na projekt, wymaga sieci, generatory są
interaktywne, a system prompt agenta i tak zabrania mu scaffoldować frameworki
(`lib/services/cli/claude.ts:~730`) — oddawanie tego zewnętrznemu narzędziu
odbiera kontrolę nad tym, co powstaje.

## 4. Projekt docelowy

### 4.1 Usunięcie WebSocketów
Kasowane: `lib/server/websocket-manager.ts`, `hooks/useWebSocket.ts`, zależność
`ws` i `@types/ws`, wywołanie `websocketManager.broadcast()` w
`lib/services/stream.ts:59`, `WEBSOCKET_CONFIG` w `lib/config/constants.ts`.
W `ChatLog.tsx` znika `isConnected` i cała logika „poll tylko gdy oba transporty
padły" — zostaje SSE plus jeden fallback pollingu, gdy SSE jest rozłączone.
`RealtimeEvent.data.transport` przestaje przyjmować `'websocket'`.

### 4.2 Redukcja do Claude Code
Kasowane: `lib/services/cli/{codex,cursor,qwen,glm}.ts`,
`lib/constants/{codexModels,cursorModels,qwenModels,glmModels}.ts`,
`claude_code_zai_env.sh`, gałęzie wyboru executora w
`app/api/chat/[project_id]/act/route.ts:~430`, selektor CLI w UI i w
`components/settings/AIAssistantSettings.tsx`, `hooks/useCLI.ts` w części
dotyczącej innych agentów. `lib/constants/cliModels.ts` zwija się do modeli
Claude. `Project.preferredCli`, `activeCursorSessionId`, `fallbackEnabled`
wypadają ze schematu; `activeClaudeSessionId` zostaje.
`lib/constants/claudeModels.ts` dostaje aktualną listę: `claude-opus-5`,
`claude-sonnet-5`, `claude-haiku-4-5`, `CLAUDE_DEFAULT_MODEL` na Sonnet 5,
generacja 4.6 przeniesiona do `aliases` (decyzje 17-18).

### 4.3 Usunięcie Vercel i Supabase
Kasowane: `lib/services/{vercel,supabase}.ts`, `app/api/vercel/**`,
`app/api/supabase/**`, `app/api/projects/[project_id]/{vercel,supabase}/**`,
`components/modals/{VercelProjectModal,SupabaseModal}.tsx`, sekcje deployu w
`app/[project_id]/chat/page.tsx` (w tym `startDeploymentPolling`,
`loadDeployStatus`, `checkCurrentDeployment` — jeden z pollerów napędzających
re-render rodzica). `ServiceToken` i `ProjectServiceConnection` zostają, ale
tylko dla providera `github`; wiersze innych providerów usuwa migracja.

### 4.4 Naprawa flickera
Trzy punktowe zmiany, wszystkie w `components/chat/ChatLog.tsx` i
`app/[project_id]/chat/page.tsx`:
1. **Rozerwać kaskadę tożsamości.** Rodzic przekazuje `onSessionStatusChange` i
   `onAddUserMessage` jako inline arrow (`page.tsx:2284`), więc `checkActiveSession`
   dostaje nową tożsamość przy każdym renderze rodzica, a efekt montujący
   (`ChatLog.tsx:2134`, deps `[projectId, checkActiveSession, loadChatHistory]`)
   re-runuje się i woła `loadChatHistory({ showLoading: true })` — pełny refetch
   200 wiadomości plus `setIsLoading(true)`. Handlery idą do `useRef` (wzorzec już
   obecny w usuwanym `useWebSocket.ts`), a efekt montujący dostaje deps
   `[projectId]`.
2. **Rozdzielić `pollIntervalRef`.** Jeden ref obsługuje dwóch niezależnych
   konsumentów — polling statusu sesji (`ChatLog.tsx:1993`) i polling historii
   (`ChatLog.tsx:2107`) — które kasują sobie interwały wzajemnie. Dwa osobne refy.
3. **Wyjąć `messages` z deps efektu pollingu** (`ChatLog.tsx:2060`, przez
   `messages.some(...)`) — dziś każda przychodząca wiadomość niszczy i odtwarza
   interwał. Warunek „czy coś się streamuje" czytany z refu.
Dodatkowo: `useUserRequests` pollinguje `/requests/active` co 500 ms w trakcie
runu; po naprawie #4.5 (znalezisko D) zniknie przypadek, w którym pollinguje tak
bez końca po restarcie serwera.

### 4.5 Poprawki z audytu
Sekcja 5 — pozycje A, D, E, F, G, H, I, J.

### 4.6 Docker
`Dockerfile` (node:22-slim + `git`, bo `lib/services/git.ts` woła binarkę),
`.dockerignore`, `docker-compose.yml`:
- `volumes: ["${CLAUDABLE_PROJECTS:-./data}:/data", "${HOME}/.claude:/root/.claude"]`
- `environment: PROJECTS_DIR=/data/projects`, `DATABASE_URL=file:/data/cc.db`,
  `PREVIEW_PORT_START=3100`, `PREVIEW_PORT_END=3131`, `CLAUDE_CONFIG_DIR=/root/.claude`
- `ports: ["3000:3000", "3100-3131:3100-3131"]`
- `init: true` — kontener dostaje reaper PID 1, bo w środku żyją dev-servery
  projektów użytkownika.
`DATABASE_URL` przestaje być ścieżką relatywną (`file:../data/cc.db`, liczoną
względem katalogu `prisma/`) — w kontenerze jest absolutne.
Preview musi bindować `0.0.0.0`, inaczej publikowany port nie dosięgnie procesu
(znalezisko K); flaga wchodzi do `devCommand` template'u.

### 4.7 Template'y
`lib/templates/index.ts` + `nextjs.ts` + `astro.ts`. `Project.templateType`
zaczyna być zapisywany z wyboru użytkownika i **czytany** w trzech miejscach:
`createProject` (który scaffold), `previewManager` (jaka komenda dev),
`executeClaude` (jaki system prompt — dziś zaszyty na sztywno tekst o Next.js).
Wybór template'u wchodzi do `components/modals/CreateProjectModal.tsx`.
Projekty bez `templateType` (istniejące wiersze) czytają się jako `nextjs`.
`TemplateType` przestaje być zdublowany między `types/backend/project.ts` i
`types/shared/project.ts` — zostaje jedna definicja, zawężona do `'nextjs' | 'astro'`.

### 4.8 Parytet z terminalem — zmierzony, nie założony

Sprawdzone probe'em na zainstalowanym SDK 0.2.68: przerwanie strumienia na
wiadomości `system`/`init`, która raportuje faktyczną konfigurację sesji.
Kolumna „dziś" to obecna konfiguracja Claudable (`settingSources` pominięte,
`systemPrompt` jako string), kolumna „po zmianie" to preset + `settingSources`.

| Element | Terminal | Dziś | Po zmianie |
|---|---|---|---|
| System prompt Claude Code | pełny | **nadpisany** stringiem | pełny (preset) |
| Skille wbudowane w CLI | 5 | 5 | 5 |
| Skille z `<dir>/skills` | tak | **nie** | **tak** (5 → 24) |
| `CLAUDE.md` | tak | **nie** | **tak** — potwierdzone odpowiedzią agenta na instrukcję z pliku |
| MCP z konfiguracji w `<dir>` | tak | **nie** | **tak** (doszedł `codebase-memory-mcp`) |
| MCP z konta claude.ai | tak | **tak, już dziś** | tak |
| Hooki z `settings.json` | tak | nie | **tak** — potwierdzone: hook `PreToolUse` zablokował `Write`, plik nie powstał |
| Slash commands | tak | 15 | 36 |
| Subagenci wbudowani | 4 | 4 | 4 |
| Subagenci z `<dir>/agents/*.md` | tak | nie | **nie** → decyzja 28 |
| Narzędzia wbudowane | wszystkie | wszystkie | wszystkie |

Dwie rzeczy, które ten pomiar przewrócił względem wcześniejszego odczytu z typów:
skille i subagenci **nie** były wcześniej „zerem" — pięć skilli wbudowanych w CLI
i czterech wbudowanych subagentów jest obecnych nawet w trybie izolacji, a serwery
MCP z konta claude.ai ładują się niezależnie od ustawień (znalezisko S). Brakowało
wyłącznie tego, co pochodzi z plików w katalogu `.claude`.

## 5. Audyt — znaleziska

| # | Waga | Znalezisko | Miejsce |
|---|------|-----------|---------|
| A | Wysoka | Preview `spawn` bez `detached`, a `stop()` robi `kill('SIGTERM')` na `npm` — wnuk `next dev` przeżywa i trzyma port. Do tego nie ma **żadnego** handlera `SIGINT`/`SIGTERM`, więc ubicie Claudable osierocia wszystkie dev-servery. W kontenerze to znaczy porty zajęte do restartu obrazu. | `lib/services/preview.ts:854`, `:938` |
| B | Wysoka | Kaskada re-fetchowania czatu — pełny opis w 4.4 | `ChatLog.tsx:2134`, `page.tsx:2284`, `ChatLog.tsx:1993/2060/2107` |
| C | **Wysoka — opis sprostowany** | Pierwotnie zapisane jako „martwa warstwa WS: serwer nie ma handlera upgrade'u". **Sprostowanie:** handler istnieje w `pages/api/ws/[projectId].ts` (Pages Router), tworzy `WebSocketServer({ noServer: true })` i woła `addConnection()`; klient celuje w tę trasę. Pierwotny grep objął `app components lib hooks types` i pominął `pages/`. Warstwa nie jest martwa, jest **zepsuta**: zmierzone na uruchomionej aplikacji trzy cykle connect/disconnect w 7 sekund, licznik reconnectu resetowany przy każdym `onopen`, każdy cykl wołający `recoverMissingMessages()` i otwierający nowy `EventSource` — 15+ pobrań listy wiadomości na jedno wejście i siedem odpowiedzi 503 z `/stream`. To **drugi silnik flickera**. | `pages/api/ws/[projectId].ts`, `hooks/useWebSocket.ts:99` |
| D | Średnia | `UserRequest` zostaje w `processing` na zawsze, jeśli serwer padnie w trakcie runu — jedynym pisarzem statusu jest ten sam proces i nic nie rekoncyliuje przy starcie. `/requests/active` liczy to jako aktywne, więc UI pollinguje co 500 ms bez końca i pokazuje run, którego nie ma. | `lib/services/user-requests.ts:14`, `hooks/useUserRequests.ts` |
| E | Średnia | Brak guardu path-traversal przy serwowaniu assetów: `path.join(PROJECTS_DIR, project_id, 'assets', filename)` z surowym `filename` z URL-a. `file-browser.ts:43` ma na to `resolveSafePath` — tu nie jest użyty. | `app/api/assets/[project_id]/[filename]/route.ts:~52` |
| F | Średnia | Niespójny fallback ścieżki projektu: `act/route.ts` i `preview.ts` liczą `cwd/projects/<id>`, a walidacja w adapterze wymaga `PROJECTS_DIR` (`./data/projects`) — dla wiersza bez `repoPath` użytkownik dostaje „Security violation" zamiast sensownego błędu. Jeden resolver zamiast trzech kopii. | `act/route.ts:~62`, `preview.ts:~620`, `claude.ts:~690` |
| G | Niska | `cli-status` sprawdza `claude --version`, choć SDK ma własny `cli.js` i binarki nie potrzebuje | `app/api/settings/cli-status/route.ts:~26` |
| H | Niska | `templateType` zapisywany na sztywno `'nextjs'` i nigdy nie czytany; `TemplateType` zdublowany w dwóch plikach typów | `lib/services/project.ts:64` |
| I | Niska | README obiecuje `npm run db:backup`, `db:reset`, `clean` — takich skryptów nie ma w `package.json` | `README.md` |
| J | Niska | Debug `console.log` w gorących ścieżkach (`📸` przy każdej wiadomości, `[ChatLog]` przy każdym loadzie historii) | `act/route.ts:~300`, `ChatLog.tsx:~1895` |
| K | Niska | Preview binduje domyślny interfejs — przy publikowanych portach Dockera trzeba `-H 0.0.0.0` (Next) / `--host` (Astro) | wchodzi do `devCommand` template'u |
| L | ~~Średnia~~ **Nieprawidłowe** | Pierwotnie zapisane jako „`maxOutputTokens` twardo 4000 urywa odpowiedzi". **Sprostowanie:** właściwości `maxOutputTokens` **nie ma** w typie `Options` SDK 0.2.68 (linia 604 `sdk.d.ts` należy do `ModelUsage`, nie do `Options`). Opcja była więc ignorowana dokładnie tak samo jak `workingDirectory` — żadnego limitu nie było, a `as any` ukryło i to. Decyzja 25 nie zmienia zachowania, tylko usuwa martwy kod. | `lib/services/cli/claude.ts:585` |
| M | Niska | Komentarz przy `selectedModel` w schemacie wymienia nieistniejące już ID modeli; README podaje „Context: Native 200k tokens" dla Claude Code, choć Opus 5 i Sonnet 5 mają 1M | `prisma/schema.prisma:40`, `README.md` |
| N | **Krytyczna** | `workingDirectory` nie istnieje w SDK 0.2.68 — zero wystąpień w `sdk.d.ts`, `sdk.mjs` i `cli.js`; opcja nazywa się `cwd` i domyślnie przyjmuje `process.cwd()`. Commit `3c00d5b` zamienił działającą opcję na nieistniejącą w obu adapterach, powołując się na breaking change, którego nie ma. Nieznany klucz jest ignorowany, więc **agent pracuje w katalogu serwera Claudable, nie w katalogu projektu** — dokładnie wbrew komentarzowi w tej samej linii. Walidacja ścieżki kilkadziesiąt linii wyżej liczy poprawną ścieżkę i nigdy jej nie używa. | `lib/services/cli/claude.ts:721`, `lib/services/cli/glm.ts` |
| O | Wysoka | `permissionMode: 'bypassPermissions'` bez wymaganego `allowDangerouslySkipPermissions: true` — SDK dokumentuje tę flagę jako obowiązkową dla tego trybu | `lib/services/cli/claude.ts:725` |
| P | Wysoka | `systemPrompt` podany jako surowy string **zastępuje** prompt presetu Claude Code, a nie rozszerza go. Agent traci cały harness i zostaje z jedenastoma linijkami o Next.js. | `lib/services/cli/claude.ts:727` |
| Q | **Wysoka** | Cały obiekt opcji `query()` rzutowany `as any` — najważniejsze wywołanie w aplikacji nie ma kontroli typów. Przepuściło N, O **oraz** martwe `maxOutputTokens` (znalezisko L). Trzy błędy z jednego rzutowania. | `lib/services/cli/claude.ts:766` |
| R | Niska | Wiadomość `system`/`init` z SDK niesie `cwd`, `tools`, `skills`, `agents`, `mcp_servers`, `plugins`, `permissionMode`; handler bierze z niej tylko `session_id` i wyrzuca resztę. Gdyby to było logowane, znalezisko N byłoby widoczne od pierwszego uruchomienia. | `lib/services/cli/claude.ts:953` |
| S | Informacyjne | Serwery MCP podłączone do konta claude.ai (u testowanego konta: ClickUp, Canva, Microsoft 365) ładują się **niezależnie od `settingSources`** — czyli agent budujący aplikacje ma je w zasięgu już dzisiaj, przed jakąkolwiek zmianą z tego runu. Nie wynikają z plików w `.claude`, więc `settingSources` ich nie kontroluje; gdyby kiedyś przeszkadzały, jedynym hamulcem jest `disallowedTools`. | zmierzone, sekcja 4.8 |

**Świadomie zostawione poza zakresem** (zgłoszone, nie ruszane):
- `ServiceToken.token` trzymany plain-text — świadomy trade-off „narzędzie
  lokalne"; po konteneryzacji warto wrócić, bo obraz da się wystawić.
- Wykonanie agenta jako `promise.catch(console.error)` bez trwałej kolejki.
  Rekoncyliacja przy starcie (D) łata najgorszy objaw; prawdziwa kolejka to
  osobna decyzja.
- `page.tsx` (3260 linii) i `ChatLog.tsx` (~2800) — dekompozycja to osobna robota.

## 6. Testy i dowód

Vitest, `npm test`. Pokrycie jednostkami: rejestr template'ów (każdy template
scaffolduje kompletny, uruchamialny zestaw plików), resolver ścieżki projektu
(F), guard traversal (E), alokacja portu z zakresu, normalizacja id modeli,
rekoncyliacja osieroconych `UserRequest` (D).

Bez pokrycia jednostkowego, weryfikowane odpaleniem: brak flickera podczas
aktywnego runu (obserwacja + brak powtarzających się `GET /messages` w
network), poprawne zamknięcie dev-serverów po `SIGTERM` (brak procesów-sierot),
`docker compose up` → utworzenie projektu z każdego template'u → preview
dostępne z hosta → restart kontenera → projekty na miejscu.

## 7. Ryzyka

1. **Mount `~/.claude` a symlinki.** W tym systemie `~/.claude/settings.json` i
   `.mcp.json` są symlinkami do `/home/m/dotfiles/`, więc w kontenerze będą
   wisiały. Nieszkodliwe, bo SDK w trybie izolacji ustawień z dysku nie czyta
   (decyzja 16), ale trzeba to sprawdzić empirycznie, a nie założyć.
2. **Odświeżanie tokenu OAuth** zapisuje do `.credentials.json`, więc mount musi
   być zapisywalny; przy `:ro` agent padnie po wygaśnięciu tokenu.
3. **32 sloty portów** to sztywny limit równoległych preview. Przy przekroczeniu
   `findAvailablePort` musi zwrócić czytelny błąd, nie wybuchnąć.
4. **Migracja schematu na SQLite** przebudowuje tabele. Backup przed `db push`
   jest częścią zadania, nie sugestią.
5. **Usuwanie deployu z `page.tsx`** dotyka pliku, w którym równolegle naprawiamy
6. **Zdjęcie zakazów z promptu a PreviewManager (decyzja 23).** Agent bez
   instrukcji „nie odpalaj dev-servera" może wystartować własny `next dev` na
   porcie spoza puli 3100-3131 — w kontenerze taki port nie jest publikowany,
   więc iframe nie pokaże nic, a proces zostanie po sesji. Świadoma konsekwencja
   polecenia użytkownika; jeśli wyjdzie w praktyce, najtańsza korekta to
   `disallowedTools` na `Bash` dla komend dev-servera, nie powrót zakazów do promptu.
7. **Bindowany katalog wnosi do agenta cały harness swojego właściciela** —
   `CLAUDE.md`, skille, hooki, MCP. Zmierzone i potwierdzone (sekcja 4.8), w tym
   hook blokujący `Write`. Użytkownik przyjmuje to świadomie: docelowo instancja
   stoi na innej maszynie z katalogiem dostosowanym pod jej użytkownika. Ścieżka
   bindu zostaje zmienną `CLAUDABLE_CLAUDE_DIR` właśnie po to, żeby ten katalog
   dał się podmienić bez zmian w kodzie.
8. **Symlinki w bindowanym katalogu.** W testowanym `~/.claude` `CLAUDE.md`,
   `agents`, `settings.json`, `.mcp.json` i wszystkie `hooks/*` są symlinkami do
   `/home/m/dotfiles/.claude/`. W kontenerze muszą się rozwiązać, inaczej nie wejdą
   — a przy `settingSources` włączonym to już nie jest nieszkodliwe. Docelowa
   maszyna będzie miała realne pliki, ale mechanizm mountu i tak musi to znosić:
   compose montuje katalog docelowy pod tą samą ścieżką absolutną (zmienna,
   domyślnie pusta). Weryfikacja przez payload z decyzji 27 — puste `skills`
   i `mcp_servers` znaczą wiszące symlinki.
