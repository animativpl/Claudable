# Aktualizacja zależności — Next.js 16, Claude Agent SDK 0.3, TypeScript 7, Electron 44

Data: 2026-08-26
Run: `deps-upgrade-next16-agentsdk`
Status: zapis deliberacji (dokument datowany, nie aktualizowany później)

## 1. Kontekst

Zlecenie: „zaktualizuj projekt i jego dependency, w tym agent sdk i wersje
nexta". `npm view` na wszystkich pakietach z `package.json` pokazał pięć
bumpów majorowych: `next` 15.5.6→16.3.3, `@prisma/client`/`prisma` 6.1.0→7.x
(z pułapką: tag `latest` pakietu `prisma` to w praktyce `8.0.0-rc.11`, RC),
`typescript` 5.7.2→7.0.2 (nowy kompilator tsgo w Go), `electron` 39→44,
`@anthropic-ai/claude-agent-sdk` 0.2.68→0.3.246. Reszta (`react`, `zod`,
`vitest`, ...) to bumpy minor/patch bez realnego ryzyka.

Projekt nie ma living speca — ten dokument jest jedynym artefaktem bramki
designu, zgodnie z regułą 6 CLAUDE.md.

Przed tym runem w drzewie leżały niezwiązane, nieskomitowane zmiany (loader
MCP scope user, wydzielenie `CreateProjectModal`, Playwright w Dockerze,
`network_mode: host`) — na żądanie użytkownika skomitowane wprost jako
`89c16ed`, bez oceny merytorycznej (nie są częścią tego zlecenia).

## 2. Decyzje

| # | Decyzja | Wybór | Dlaczego |
|---|---------|-------|----------|
| 1 | Next.js | **Bump do 16.3.3**, kodemod `@next/codemod@canary upgrade latest`, ręczna weryfikacja `next.config` i pozostałości sync `params`/`cookies()`/`headers()` | Bezpieczny skok — Vercel dowozi oficjalny kodemod. Wymaga bumpa `eslint-config-next` do tej samej wersji (musi trzymać się majora Nexta). |
| 2 | Prisma | **Pominięte w tym przebiegu** — bump tylko w obrębie 6.x (najnowszy patch/minor) | Decyzja użytkownika po przedstawieniu ryzyka: 7.x to zmiana architektury (adaptery sterowników, koniec `datasource.url` w schema.prisma dla klienta, ESM-only), która nakłada się na dopiero co naprawiony problem binaryTargets/Docker/OpenSSL (commit `2e46a43`). Nie było wymienione z nazwy w zleceniu — tylko Next i Agent SDK były. Osobna migracja później. |
| 3 | TypeScript | **Bump do 7.0.2** mimo że `typescript-eslint` (zależność `eslint-config-next`) jeszcze go nie wspiera i lint prawdopodobnie się posypie | Decyzja użytkownika po przedstawieniu ryzyka — świadomie wybrane dosłowne „najnowsza wersja" zamiast bezpieczniejszego 5.9.3. Konsekwencja: krok weryfikacji lint może wymagać `eslint-config-next`/`typescript-eslint` na wersji edge/beta albo tymczasowego wyłączenia reguł, które nie działają — do rozstrzygnięcia w planie/implementacji, nie tutaj. |
| 4 | Electron | **Bump do 44.0.0** + `electron-builder` na wersję zgodną z Electron 44 (ustalić w trakcie planowania) | Prosty skok wg npm, ale trzeba zweryfikować: async clipboard API (v40), zmianę instalacji binarki (v42, wpływ na Docker/CI), nazewnictwo `display-capture` w `setPermissionRequestHandler` i obsługę fd w ASAR (v44). |
| 5 | Claude Agent SDK | **Bump do 0.3.246** | Wymienione z nazwy w zleceniu. Breaking changes trafiające wprost w kod integracyjny: `TodoWrite` usunięte (→ `TaskCreate`/`TaskUpdate`/...), `options.env` całkowicie zastępuje `process.env` zamiast mergować, MCP łączy się domyślnie asynchronicznie, `@anthropic-ai/sdk`/`@modelcontextprotocol/sdk` przeszły do `peerDependencies`. Dotyka świeżo skomitowanego `mcp-servers-loader.ts` i `claude-options.ts`/`claude.ts` — wymaga realnej weryfikacji, nie tylko bumpa numerka. |
| 6 | Reszta zależności (`react`, `react-dom`, `zod`, `@types/*`, `vitest`, ...) | **Bump do najnowszych minor/patch w obecnym majorze** | Niskie ryzyko, bez osobnej decyzji. |
| 7 | `engines.node` | **Podnieść floor do `>=20.9.0`** | Next 16 realnie wymaga tej wersji; obecny zapis `>=20.0.0` jest zbyt luźny. |

## 3. Poza zakresem

- Migracja Prisma 6→7 (decyzja 2) — osobny run, gdy będzie potrzebny.
- Ocena merytoryczna zmian skomitowanych jako `89c16ed` (MCP scope user,
  `network_mode: host`, Playwright w Dockerze) — nie są przedmiotem tego
  zlecenia.
