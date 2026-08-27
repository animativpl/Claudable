# Claudable — audyt cleanup/refactor

Data: 2026-08-27
Run: `claudable-cleanup-audit`
Status: zapis deliberacji (dokument datowany, nie aktualizowany później)

## 1. Kontekst

Zlecenie: „przejrzyj cały projekt i zaplanuj cleanup/refactor — obstawiam że
dużo rzeczy jest nieoptymalne/zbyt skomplikowane/niepotrzebne". Sześć
równoległych audytów pokryło cały projekt (backend/API, frontend, Docker/build,
testy/typy/Prisma, warstwa CLI/Agent SDK, config/dokumentacja root) —
42 zweryfikowane znaleziska, każde potwierdzone grepem, grafem kodu
(codebase-memory-mcp), historią gita albo izolowaną reprodukcją, nie
zgadywane. Pełny raport: Artifact opublikowany w tej sesji
(`claude.ai/code/artifact/2943a083-8692-4952-8089-115bc1c949bb`).

Projekt nie ma living speca — ten dokument jest jedynym artefaktem bramki
designu, zgodnie z regułą 6 CLAUDE.md.

**Odkrycie poboczne, potraktowane osobno od cleanup:** `docker-compose.yml`
działa dziś na `network_mode: host` (commit `89c16ed`, niezwiązany z tym
audytem), co po cichu zdjęło wiązanie portów wyłącznie na `127.0.0.1` — ten
sam commit usunął komentarz tłumaczący, że publikacja na wszystkich
interfejsach to zdalne wykonanie kodu dla każdego w tej samej sieci (aplikacja
nie ma uwierzytelnienia i daje agentowi Bash). `README.md:119-122` dalej
opisuje starą, bezpieczną konfigurację. To nie jest cleanup — to żywa
podatność z kłamiącą dokumentacją, i idzie jako Task 1, przed czymkolwiek
innym.

## 2. Decyzje

| # | Decyzja | Wybór | Dlaczego |
|---|---------|-------|----------|
| 1 | Zakres runu | **Wszystkie 42 znaleziska**, w fazach: bezpieczeństwo → dead code → duplikacja → legacy remnants → docs | Decyzja użytkownika. |
| 2 | `network_mode: host` | **Przywrócić wiązanie `127.0.0.1`-only** (`ports:` zamiast `network_mode: host`), zaktualizować README zgodnie ze stanem faktycznym | Regresja bezpieczeństwa z niezwiązanego commitu, nie decyzja architektoniczna do przemyślenia — cofnięcie do udokumentowanego, bezpiecznego stanu. Jeśli host networking było z jakiegoś powodu potrzebne, to osobna dyskusja z jawnym uzasadnieniem, nie coś do cichego zaakceptowania przy okazji cleanupu. |
| 3 | Model `Session` (Prisma) | **Usunąć** — model, dwie trasy API, martwy polling w `ChatLog.tsx` | Decyzja użytkownika po przedstawieniu dowodu: model nigdy nie jest zapisywany (zero `create`/`update`/`upsert`), obie trasy zawsze zwracają null/404. Realne śledzenie sesji już działa przez `Project.activeClaudeSessionId`. |
| 4 | Trasy `env` sync/upsert/conflicts | **Usunąć** (4 trasy + 2 funkcje serwisowe, ~300 linii) | Decyzja użytkownika po przedstawieniu dowodu: zero wywołań w aplikacji, dokumentacji ani skryptach tego repo. |
| 5 | `lib/crypto.ts` — fallback klucza szyfrowania | **Rzucić błędem zamiast cicho generować losowy klucz**, gdy `ENCRYPTION_KEY` nie jest ustawiony | Dzisiejszy fallback (`crypto.randomBytes(32)`) czyni istniejące sekrety nieodszyfrowywalnymi po restarcie bez żadnego ostrzeżenia. Ścieżka Dockera już wymusza `ENCRYPTION_KEY` przez `:?` w `docker-compose.yml`, a `scripts/setup-env.js` generuje go dla dev lokalnie — fallback w praktyce nigdy się nie odpala przy normalnym użyciu, więc zamiana na twardy błąd nie zmienia zachowania, tylko usuwa cichą pułapkę. Decyzja podjęta bezpośrednio (brak realnej alternatywy — cichy, rotujący klucz nie jest tym, czego ktokolwiek by chciał), analogicznie do `--webpack` w poprzednim runie. |
| 6 | `react-icons` (zależność produkcyjna) | **Usunąć z `package.json`**, zostawić `stubs/**` i alias `tsconfig.json` bez zmian | Zmierzone: build nigdy nie bundluje `node_modules/react-icons` (własny manifest trace'u Nexta wskazuje wyłącznie na stuby), a domniemany problem z typami, który stuby miały obchodzić, nie reprodukuje się dziś na realnym pakiecie. Usunięcie samej zależności to zero zmiany zachowania (nic jej i tak nie używa) — nie decyzja wizualna, bo UI dalej renderuje te same ikony Lucide co dziś. Odwrócenie aliasu z powrotem na prawdziwe react-icons byłoby zmianą wizualną i zostaje poza zakresem tego runu. |
| 7 | Martwe modele/kolumny Prisma (`Commit`, `ToolUsage`, osierocone kolumny `Message`/`ProjectServiceConnection`/`Project`) | **Usunąć przez migrację**, backup `data/cc.db` przed migracją | Ten sam wzorzec co poprzedni cleanup (`.flow/specs/2026-08-24-...-design.md`, decyzja 10: „Wyczyścić schemat... Backup przed migracją") — ustalony precedens w tym projekcie, nie nowa decyzja wymagająca ponownego pytania. |
| 8 | Znaleziska „needs verification by running it" (desktop packaging: `.next/standalone` bloat, `ELECTRON_RUN_AS_NODE`, duplikacja `extraResources`) | **Zweryfikować podczas implementacji taska, nie z góry** | Audyt sam oznaczył te jako niepewne bez realnego builda/pakowania — decyzja o naprawie zależy od tego, co pokaże weryfikacja, nie od założenia. Task w planie ma explicit krok weryfikacji przed jakąkolwiek zmianą. |
| 9 | Playwright system packages w Dockerfile (dodane w `89c16ed`, nieprzejrzane na własnych zasługach) | **Poza zakresem tego runu** — do osobnego przeglądu | Każda linia ma wiarygodny komentarz, zero konkretnego dowodu problemu; to przegląd Dockera, nie cleanup kodu, i zasługuje na tę samą wagę co reszta zmian Dockera w tym projekcie (patrz decyzja 2 powyżej — Docker dostaje wyższą poprzeczkę review). |
| 10 | `TOOL_NAME_ACTION_MAP`/`inferActionFromToolName` niewykorzystany eksport w `claude.ts` | **Rozwiązuje się samo** przy ekstrakcji `ChatLog.tsx` (decyzja o duplikacji, task w fazie 3) | Nie osobna decyzja — `ChatLog.tsx` zacznie importować z `claude.ts` zamiast trzymać własną kopię. |

## 2a. Rewizje po red-teamie planu

Plan przeszedł dwie tury red-teamu (adversarial pre-mortem, `plan-red-team`), każda zwracała realne, zweryfikowane niezależnie problemy — nie fałszywe alarmy. Poniższe pozycje **zmieniają lub doprecyzowują** decyzje powyżej; decyzje 1-10 zostają jako zapis pierwotnej deliberacji, to jest zapis tego, co się zmieniło i dlaczego.

| # | Rewizja | Co się zmieniło | Dlaczego |
|---|---------|------------------|----------|
| 11 | Decyzja 2 (`network_mode: host`) | **Task 1 wstrzymany** (⏸ PAUSED w planie), nie startuje bez potwierdzenia użytkownika | Red-team znalazł, że commit `89c16ed` opisuje przejście na host networking jako świadome (message commita), ten sam commit dodał mount `~/.figma-console-mcp` i ładowanie MCP — wiarygodny, legalny powód, nie musi być regresją. Użytkownik: „muszę najpierw sprawdzić" — Task 1 czeka na jego odpowiedź, reszta planu nie jest tym blokowana. |
| 12 | Decyzja 3 (model `Session`) | **Zawężone**: usuwane zostają dwie trasy API i martwy polling w `ChatLog.tsx` (bez zmian — potwierdzone martwe), ale **`model Session`, `Message.sessionId`, `Message.parentMessageId` NIE są usuwane** w tym runie | Red-team słusznie zauważył, że oryginalny grep (tylko `prisma.*` accessor calls) przegapił, że `Message.sessionId` ma realnego pisarza (`app/api/chat/[project_id]/messages/route.ts`) i realnych czytelników (`lib/services/message.ts`, `lib/serializers/chat.ts`, `ChatLog.tsx`'s `buildToolMessageKey`). Głębsza inwestygacja: kolumna jest technicznie żywa, ale realny przepływ produktowy (`lib/services/cli/claude.ts`) świadomie nigdy jej nie wypełnia (jawny komentarz w kodzie to potwierdza) — więc funkcja detekcji aktywnej sesji jest martwa (stąd trasy/polling nadal do usunięcia), ale usunięcie samej kolumny/modelu to osobna decyzja z realnym blast radius (4 pliki plumbing), nie bezpieczny dead-code drop do spakowania z resztą migracji. |
| 13 | Task 8 (`lib/crypto.ts`) | Rzucanie błędu przeniesione z module-scope (import-time) na leniwe rozwiązanie klucza wewnątrz `encrypt`/`decrypt` | Rzucanie przy imporcie zepsułoby `docker build` (etap builda nie ma `ENCRYPTION_KEY` — dostaje go dopiero kontener runtime przez `docker-compose.yml`). Decyzja 5 (rzucać zamiast cicho generować klucz) zostaje w mocy, zmienia się tylko *kiedy* to się sprawdza. |
| 14 | Task 12 (duplikacja `TOOL_NAME_ACTION_MAP` w `claude.ts`/`ChatLog.tsx`) | Zamiast `ChatLog.tsx` (`"use client"`) importującego z `claude.ts` (Agent SDK, `fs/promises`, Prisma), oba pliki importują z nowego, zero-importowego modułu `lib/tool-actions.ts` | Oryginalny plan złamałby granicę client/server w Next.js App Router — żaden komponent w tym repo nie importuje dziś z `lib/services`, a `claude.ts` ciągnie za sobą server-only zależności. Przy okazji: duplikacja była w czterech miejscach (mapa + 3 funkcje), nie tylko w jednej mapie jak pierwotnie śledzone — nowy moduł naprawia oba znane bugi (TodoWrite mislabeling, Task-tool `name` mylone ze ścieżką) raz, w jednym miejscu, na obu kopiach. |
| 15 | Task 19 (konsolidacja `sessionStorage` model-selection) | Zakres drastycznie zawężony: tylko `app/page.tsx` (realny czytelnik+pisarz) i `app/[project_id]/chat/page.tsx` (tylko pisarz) | Bezpośrednia weryfikacja wszystkich 4 pierwotnie wskazanych plików pokazała, że tylko te dwa w ogóle dotykają `sessionStorage`. `CreateProjectModal.tsx`'s stan modelu jest efemeryczny (prop, sesja jednego otwartego modala) i `ChatInput.tsx` nie ma żadnego stanu modelu — włączenie ich do wspólnego, trwałego store'a byłoby realną regresją zachowania (wybór modelu w modalu tworzenia projektu cicho nadpisywałby zapisany wybór na stronie głównej), nie dedupem. |

Dodatkowo (S3, S5 — poważne, nie blokujące): Task 18 (ekstrakcja z `chat/page.tsx`) miał błędny wzorzec grepa i złą lokalizację dla `getFileIcon` (zwraca JSX, więc nie może trafić do `lib/` — tam dziś zero plików `.tsx`) — poprawione na `components/chat/TreeView.tsx`, razem z typem `Entry`, który w oryginalnej wersji nie miał żadnego miejsca docelowego. Task 11 (path-traversal guard) miał test, który nie wymuszał realnego katalogu bazowego, więc mógł przejść z niewłaściwego powodu (gałąź "base missing" zamiast "traversal rejected") — poprawione na realny katalog tymczasowy; ta zmiana ujawniła też realną, mniejszą zmianę zachowania (404 zamiast 400 dla brakującego katalogu bazowego), udokumentowaną w planie zamiast cicho zaakceptowaną.

## 3. Poza zakresem

- Playwright system packages w Dockerfile (decyzja 9) — osobny przegląd.
- Realne demontaż/przywrócenie `react-icons` jako widocznej zmiany wizualnej (decyzja 6 zostawia dziś renderowane ikony bez zmian).
- Port-availability duplication (`scripts/setup-env.js` vs `electron/main.js`) — audyt ocenił jako niski priorytet, semantyka faktycznie różna, nie samo copy-paste.
- `UserRequest.cliPreference`/`Message.cliSource` zawsze `'claude'` — odnotowane jako vestigial, za mało warte osobnej decyzji migracyjnej w tym runie.
