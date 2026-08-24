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
| 1 | Warstwa WebSocket | **Usunąć w całości** | `websocketManager.addConnection()` (`lib/server/websocket-manager.ts:18`) nie jest wołane z żadnego miejsca — nie ma handlera upgrade'u, więc serwerowy WS nigdy nie przyjął połączenia. Działa SSE i jest właściwym narzędziem do jednokierunkowego strumienia serwer→klient. Naprawa oznaczałaby dopisanie custom servera pod Next tylko po to, by zdublować transport, który już działa. |
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
| 16 | Izolacja agenta od globalnych ustawień hosta | **Zostaje domyślna izolacja SDK** | SDK bez `settingSources` nie ładuje ustawień z dysku ("SDK isolation mode", `sdk.d.ts:1006`). Mount `~/.claude` daje więc wyłącznie poświadczenia — globalny `CLAUDE.md` i hooki użytkownika nie wchodzą do kontekstu agenta budującego aplikację. Nie zmieniamy tego. |
| 17 | Lista modeli Claude | **Opus 5 (`claude-opus-5`), Sonnet 5 (`claude-sonnet-5`), Haiku 4.5 (`claude-haiku-4-5`)**, domyślny **Sonnet 5**. Generacja 4.6 schodzi do `aliases`. | Polecenie użytkownika. Zejście 4.6 do aliasów, a nie do kosza, to własna konwencja tego pliku — tak już leżą `claude-opus-4-5`, `claude-sonnet-4-5` i trzy generacje wcześniej. Dzięki temu wiersze w bazie trzymające `claude-sonnet-4-6` dalej się rozwiązują, tylko na nowszy model. |
| 18 | Kanoniczne ID Haiku | **`claude-haiku-4-5`** bez sufiksu daty; `claude-haiku-4-5-20251001` zostaje aliasem | Commit `2634077` („use correct Claude API model IDs (without date suffix)") ściął sufiksy, ale Haiku został z datą — plik jest niespójny sam ze sobą. ID modeli są kompletne w formie bez daty i sufiksów się do nich nie dokleja. Stara forma jako alias, więc istniejące wiersze w bazie nadal się rozwiązują. |
| 19 | `maxOutputTokens` agenta | **32000** zamiast 4000 (dalej nadpisywalne przez `CLAUDE_CODE_MAX_OUTPUT_TOKENS`) | Znalezisko L. |

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

## 5. Audyt — znaleziska

| # | Waga | Znalezisko | Miejsce |
|---|------|-----------|---------|
| A | Wysoka | Preview `spawn` bez `detached`, a `stop()` robi `kill('SIGTERM')` na `npm` — wnuk `next dev` przeżywa i trzyma port. Do tego nie ma **żadnego** handlera `SIGINT`/`SIGTERM`, więc ubicie Claudable osierocia wszystkie dev-servery. W kontenerze to znaczy porty zajęte do restartu obrazu. | `lib/services/preview.ts:854`, `:938` |
| B | Wysoka | Kaskada re-fetchowania czatu — pełny opis w 4.4 | `ChatLog.tsx:2134`, `page.tsx:2284`, `ChatLog.tsx:1993/2060/2107` |
| C | Wysoka | Martwa warstwa WS: klient próbuje się łączyć z backoffem (10 prób), serwer nie ma handlera upgrade'u | `websocket-manager.ts:18`, `stream.ts:59` |
| D | Średnia | `UserRequest` zostaje w `processing` na zawsze, jeśli serwer padnie w trakcie runu — jedynym pisarzem statusu jest ten sam proces i nic nie rekoncyliuje przy starcie. `/requests/active` liczy to jako aktywne, więc UI pollinguje co 500 ms bez końca i pokazuje run, którego nie ma. | `lib/services/user-requests.ts:14`, `hooks/useUserRequests.ts` |
| E | Średnia | Brak guardu path-traversal przy serwowaniu assetów: `path.join(PROJECTS_DIR, project_id, 'assets', filename)` z surowym `filename` z URL-a. `file-browser.ts:43` ma na to `resolveSafePath` — tu nie jest użyty. | `app/api/assets/[project_id]/[filename]/route.ts:~52` |
| F | Średnia | Niespójny fallback ścieżki projektu: `act/route.ts` i `preview.ts` liczą `cwd/projects/<id>`, a walidacja w adapterze wymaga `PROJECTS_DIR` (`./data/projects`) — dla wiersza bez `repoPath` użytkownik dostaje „Security violation" zamiast sensownego błędu. Jeden resolver zamiast trzech kopii. | `act/route.ts:~62`, `preview.ts:~620`, `claude.ts:~690` |
| G | Niska | `cli-status` sprawdza `claude --version`, choć SDK ma własny `cli.js` i binarki nie potrzebuje | `app/api/settings/cli-status/route.ts:~26` |
| H | Niska | `templateType` zapisywany na sztywno `'nextjs'` i nigdy nie czytany; `TemplateType` zdublowany w dwóch plikach typów | `lib/services/project.ts:64` |
| I | Niska | README obiecuje `npm run db:backup`, `db:reset`, `clean` — takich skryptów nie ma w `package.json` | `README.md` |
| J | Niska | Debug `console.log` w gorących ścieżkach (`📸` przy każdej wiadomości, `[ChatLog]` przy każdym loadzie historii) | `act/route.ts:~300`, `ChatLog.tsx:~1895` |
| K | Niska | Preview binduje domyślny interfejs — przy publikowanych portach Dockera trzeba `-H 0.0.0.0` (Next) / `--host` (Astro) | wchodzi do `devCommand` template'u |
| L | Średnia | `maxOutputTokens` twardo 4000, gdy nie ma zmiennej środowiskowej — dla agenta zapisującego całe pliki to ciasne: odpowiedź urywa się w środku zapisu. Modele z decyzji 17 unoszą 128K. | `lib/services/cli/claude.ts:585` |
| M | Niska | Komentarz przy `selectedModel` w schemacie wymienia nieistniejące już ID modeli; README podaje „Context: Native 200k tokens" dla Claude Code, choć Opus 5 i Sonnet 5 mają 1M | `prisma/schema.prisma:40`, `README.md` |

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
   flicker — dlatego usunięcia idą przed naprawą UI (decyzja 15), nie odwrotnie.
