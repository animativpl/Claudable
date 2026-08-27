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
| 3 | TypeScript | ~~Bump do 7.0.2~~ **Wyparte decyzją 10.** | — |
| 4 | Electron | **Bump do 44.0.0** + `electron-builder` na wersję zgodną z Electron 44 (ustalić w trakcie planowania) | Prosty skok wg npm, ale trzeba zweryfikować: async clipboard API (v40), zmianę instalacji binarki (v42, wpływ na Docker/CI), nazewnictwo `display-capture` w `setPermissionRequestHandler` i obsługę fd w ASAR (v44). |
| 5 | Claude Agent SDK | **Bump do 0.3.246** | Wymienione z nazwy w zleceniu. Breaking changes trafiające wprost w kod integracyjny: `TodoWrite` usunięte (→ `TaskCreate`/`TaskUpdate`/...), `options.env` całkowicie zastępuje `process.env` zamiast mergować, MCP łączy się domyślnie asynchronicznie, `@anthropic-ai/sdk`/`@modelcontextprotocol/sdk` przeszły do `peerDependencies`. Dotyka świeżo skomitowanego `mcp-servers-loader.ts` i `claude-options.ts`/`claude.ts` — wymaga realnej weryfikacji, nie tylko bumpa numerka. |
| 6 | Reszta zależności (`react`, `react-dom`, `zod`, `@types/*`, `vitest`, ...) | **Bump do najnowszych minor/patch w obecnym majorze** | Niskie ryzyko, bez osobnej decyzji. |
| 7 | `engines.node` | **Podnieść floor do `>=20.9.0`** | Next 16 realnie wymaga tej wersji; obecny zapis `>=20.0.0` jest zbyt luźny. |
| 8 | Tailwind CSS | **Pominięte w tym przebiegu** — bump tylko w obrębie 3.x (3.4.17→3.4.19) | Ten sam wzorzec co decyzja 2: 4.x to zmiana architektury (plugin PostCSS `tailwindcss`→`@tailwindcss/postcss`, autoprefixer wchodzi domyślnie, konfiguracja CSS-first `@theme` zamiast `tailwind.config.ts`), nie była wymieniona z nazwy, wysoki blast radius (cały UI). Osobna migracja później. |
| 9 | ESLint, framer-motion, lucide-react, dotenv | **Bump do najnowszego majora** (eslint 9→10, framer-motion 11→13, lucide-react 0.x→1.x, dotenv 16→17) | Decyzja użytkownika po przedstawieniu ryzyka — w odróżnieniu od Prisma/Tailwind to zwykłe zależności aplikacji, nie architektura builda; niezgodności typów złapie `tsc --noEmit` w projekcie ze `strict: true`. |

| 10 | TypeScript (rewizja decyzji 3) | **5.9.3**, nie 7.0.2 | Znalezisko red-teamu planu, zweryfikowane wprost o rejestr npm: `typescript@7.0.2` eksportuje w `package.json` wyłącznie `./lib/version.cjs` na roocie (zero klasycznego API kompilatora, tylko `bin/tsc` i eksperymentalne `./unstable/*`), a `typescript-eslint` (twarda zależność `eslint-config-next@16.3.3`) deklaruje peer `typescript: ">=4.8.4 <6.1.0"`. To nie „lint może się wysypać" z decyzji 3 — `npm install` kończyłby się realnym ERESOLVE. Inny koszt niż ten, na który użytkownik się zgodził — przedstawione ponownie z dowodem, decyzja użytkownika: 5.9.3. |
| 11 | Next.js 16 — Turbopack domyślny | **`--webpack` we `build`/`dev`** (`package.json` i `scripts/run-web.js:146`), next.config.js bez zmian | Znalezisko red-teamu, zweryfikowane wprost w źródle Nexta (`turbopack-warning.ts`): build z configiem `webpack` i bez `turbopack` kończy się `process.exit(1)`. Ten projekt ma customowy `webpack:` (fallback fs/path/os) i żadnego `turbopack`. Migracja do Turbopacka zmieniłaby zachowanie, którego Docker (`output: 'standalone'`) dziś dowodzi działaniem — `--webpack` to udokumentowana ścieżka zachowania status quo, nie obejście. |
| 12 | Agent SDK — peer dependencies (rewizja po drugim red-teamie) | ~~Dodać jawnie do `dependencies`, rozszerzyć `Dockerfile:101`~~ **Wyparte decyzją 14.** | — |
| 13 | ESLint 10 — ostrzeżenia peer, nie błąd | **Zostaje przy 10.9.1** (decyzja 9 w mocy), akceptując `npm warn ERESOLVE overriding peer dependency` dla kilku pluginów `eslint-config-next` deklarujących peer wyłącznie do `^9` | Znalezisko drugiego red-teamu, zweryfikowane `npm install --dry-run`: to ostrzeżenia (npm nadpisuje niezgodność domyślnie), nie twardy błąd instalacji jak w przypadku TypeScript 7 (decyzja 10) — inna kategoria ryzyka, nie wymaga ponownego pytania użytkownika. |
| 14 | Agent SDK 0.3 — realny mechanizm runtime (rewizja decyzji 12) | **Nic do zmiany w `Dockerfile`.** `@anthropic-ai/sdk` i `@modelcontextprotocol/sdk` idą do `devDependencies` (typy, nie runtime). | Drugi red-team rozpakował bezpośrednio tarballe: `@anthropic-ai/claude-agent-sdk@0.3.246` **nie ma już `cli.js`** — `exports` to `.`, `./extract`, `./browser`, `./bridge`, `./sdk-tools(.js)`. Zamiast tego `optionalDependencies` na 8 pakietów platformowych (`@anthropic-ai/claude-agent-sdk-linux-x64` itd., ~236 MB rozpakowane), rozwiązywanych w runtime przez `createRequire(...).resolve(...)` — zmierzony w `sdk.mjs` dokładny komunikat błędu `Native CLI binary for ${platform}-${arch} not found`. Grep realnego kodu (`sdk.mjs`, `bridge.mjs`) na `@modelcontextprotocol/sdk` i `@anthropic-ai/sdk` daje **zero trafień** — oba występują wyłącznie w plikach `.d.ts` (typy, konsumowane przez `tsc`, nigdy przez `require`/`import` w runtime). Plan pierwszego red-teamu (decyzja 12) rozwiązywał więc problem, który nie istnieje, i pomijał ten, który istnieje: pakiet `@anthropic-ai/claude-agent-sdk-linux-x64` dzieli scope `@anthropic-ai` z głównym pakietem, więc **już dziś istniejący** `COPY .../node_modules/@anthropic-ai` w `Dockerfile:101` przenosi go do obrazu runtime — trzeba to jednak zweryfikować uruchomieniem (Task 5 Step 10), nie założyć, i świadomie przyjąć wzrost obrazu o ~236 MB rozpakowane, który ten sam Dockerfile w komentarzach przy `output: 'standalone'` dokumentuje jako coś, co było celowo zmniejszane. |
| 15 | ESLint config Next 16 — nowy ruleset `typescript-eslint` (rewizja: zobacz decyzję 16) | ~~Override `@typescript-eslint/no-explicit-any: 'warn'`~~ **Martwa konfiguracja — wyparte decyzją 16.** | — |
| 16 | ESLint 10 — realny mechanizm, znalezisko implementera Taska 2 (rewizja decyzji 13) | **Pin `eslint` na `^9.39.5`, nie 10.x.** `eslint.config.mjs` zostaje `core-web-vitals`-only (bez `eslint-config-next/typescript`), bez override'u `no-explicit-any` — jest martwy, bo `core-web-vitals.js` w ogóle nie referuje `typescript-eslint`. Nowe reguły `eslint-plugin-react-hooks@7` (`set-state-in-effect`, `refs`, `purity`, `preserve-manual-memoization`) w `eslint.config.mjs` schodzą do `'warn'`, tym samym mechanizmem co planowany (a martwy) override dla `no-explicit-any`. `tsconfig.json` (przepisany przez `next build`: `jsx: preserve`→`react-jsx`) wchodzi do zakresu Taska 2 jako zamierzona zmiana. | Decyzja 13 była błędna — zweryfikowana ponownie i obalona przez implementera, potwierdzona przeze mnie bezpośrednią reprodukcją: `ESLint 10.9.1` + `eslint-config-next@16.3.3` **twardo crashuje** (`contextOrFilename.getFilename is not a function`) na każdym pliku, nie „ostrzega". `eslint-plugin-react@7.37.5` to **najnowsza opublikowana wersja** (`npm view eslint-plugin-react versions` kończy się na 7.37.5) i jej `peerDependencies.eslint` to `"^3 \|\| … \|\| ^9.7"` — bez wsparcia dla majora 10 w ogóle, więc to nie jest kwestia czekania na nowszy patch. `eslint-config-next@16.3.3`'s własny `peerDependencies.eslint: ">=9.0.0"` (na którym oparta była decyzja 13) jest po prostu niezgodny z własnym drzewem zależności pakietu. Osobno: codemod (Task 2 Step 3) generuje `eslint.config.mjs` rozszerzający wyłącznie `eslint-config-next/core-web-vitals` (wierne odzwierciedlenie starego `.eslintrc.json`), nie `.../typescript` — ten drugi jest jedynym miejscem, gdzie `no-explicit-any` w ogóle się włącza (zweryfikowane grepem: `core-web-vitals.js` nie ma żadnej referencji do `typescript-eslint`), więc override z decyzji 15 nigdy nic by nie robił. Za to `core-web-vitals` **wciąga** `eslint-plugin-react-hooks@7`, którego nowe reguły "React Compiler" łapią 40 realnych wystąpień w `components/`, `app/`, `hooks/`, `contexts/` — nowy problem tej samej kategorii co planowany `no-explicit-any` (nowa wersja configu włącza regułę, której wcześniej nie było), tylko nieprzewidziany w designie. `warn` zachowuje dzisiejszy stan (te reguły nie istniały pod starym `next lint`), zamiast brać na siebie 40 potencjalnych napraw jako efekt uboczny bumpa zależności — te same zasady co decyzja 11/15, zastosowane do właściwego znaleziska. Osobno zaakceptowane: `eslint .` linituje szerzej niż `next lint` (cały monorepo, nie tylko `app/pages/components/lib`) — 2 błędy `react/display-name` w `stubs/react-icons-*.tsx` (wygenerowane shimy, nie kod aplikacji) idą do `ignores` w `eslint.config.mjs`. |

## 3. Poza zakresem

- Migracja Prisma 6→7 (decyzja 2) — osobny run, gdy będzie potrzebny.
- Migracja Tailwind CSS 3→4 (decyzja 8) — osobny run, gdy będzie potrzebny.
- Ocena merytoryczna zmian skomitowanych jako `89c16ed` (MCP scope user,
  `network_mode: host`, Playwright w Dockerze) — nie są przedmiotem tego
  zlecenia.
