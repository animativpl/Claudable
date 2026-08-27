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

## 3. Poza zakresem

- Playwright system packages w Dockerfile (decyzja 9) — osobny przegląd.
- Realne demontaż/przywrócenie `react-icons` jako widocznej zmiany wizualnej (decyzja 6 zostawia dziś renderowane ikony bez zmian).
- Port-availability duplication (`scripts/setup-env.js` vs `electron/main.js`) — audyt ocenił jako niski priorytet, semantyka faktycznie różna, nie samo copy-paste.
- `UserRequest.cliPreference`/`Message.cliSource` zawsze `'claude'` — odnotowane jako vestigial, za mało warte osobnej decyzji migracyjnej w tym runie.
