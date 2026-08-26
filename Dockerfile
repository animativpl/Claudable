# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# openssl także tutaj: bez niego `prisma generate` nie wykrywa wersji libssl
# i dokłada silnik dla "openssl-1.1.x", którego żaden z celów obrazu nie
# używa — 19 MB balastu i dokładnie ta niejednoznaczność, z której wziął się
# błąd "could not locate the Query Engine".
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# CLI Prismy dla `db push` przy starcie, w osobnym drzewie. Wyjście standalone
# zawiera wyłącznie klienta, który importuje kod aplikacji — CLI trzeba dołożyć.
# Instalacja zamiast ręcznego wybierania katalogów z `deps`: `prisma` ciągnie
# `@prisma/config` → `effect`, więc lista skopiowana z pamięci wywala start na
# "Cannot find module 'effect'". Wersja pochodzi z lockfile'a projektu, żeby
# CLI nie mogło rozjechać się z wygenerowanym klientem.
FROM node:22-slim AS prisma-cli
WORKDIR /cli
# openssl tak samo jak w etapie build: instalacja `prisma` pobiera silniki dla
# wykrytej wersji libssl, a bez tego pakietu wykrywanie spada do
# "openssl-1.1.x". Runtime ma OpenSSL 3.0, więc CLI uznaje zabrane silniki za
# nieswoje i dociąga brakujący z binaries.prisma.sh przy starcie KAŻDEGO
# świeżego kontenera. Bez dostępu do sieci `db push` pada, a `&&` w CMD
# zatrzymuje wtedy cały start serwera — kod wyjścia 1, aplikacja nie rusza.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY package-lock.json /tmp/app-lock.json
RUN PRISMA_VERSION="$(node -p "require('/tmp/app-lock.json').packages['node_modules/prisma'].version")" \
 && npm init -y > /dev/null \
 && npm install --omit=dev "prisma@${PRISMA_VERSION}"

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.js z wyjścia standalone czyta PORT i HOSTNAME. `.dockerignore`
# wycina `.env`, więc jedynym źródłem tych wartości jest środowisko obrazu.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# git: wołany przez lib/services/git.ts przy integracji z GitHubem.
# python3 i bash: hooki z zamontowanego katalogu .claude wykonują się jako
# procesy — bez interpretera nie uruchomią się i nikt tego nie zauważy.
# openssl: Prisma wykrywa wersję libssl, żeby wybrać silnik zapytań. Bez
# pakietu `openssl` wykrywanie cicho spada do "openssl-1.1.x" i klient szuka
# silnika, którego w obrazie nie ma. Dziś wchodzi tranzytywnie przez
# ca-certificates; jest wymieniony wprost, bo jest wymagany, a nie przypadkowy.
#
# Playwright (system deps dla Chromium): same binaria przeglądarki NIE są tu
# instalowane — agent robi `npx playwright install chromium` w projekcie i
# trafiają one do PLAYWRIGHT_BROWSERS_PATH=/data/home/.cache/ms-playwright,
# czyli do bind-mounted /data, gdzie przeżywają restart kontenera. Bez tych
# lib Chromium pada na "error while loading shared libraries" i żaden projekt
# nie uruchomi testów E2E ani scrapeingu. Lista pochodzi z Playwright dla
# Debian Bookworm (node:22-slim). xdg-utils: skrypt startowy chromium go
# sprawdza. fonts-liberation: bez fontu Chromium renderuje puste glify.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    git python3 bash openssl ca-certificates \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 \
    libdrm2 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
    libxkbcommon0 libxrandr2 libxshmfence1 fonts-liberation xdg-utils \
 && rm -rf /var/lib/apt/lists/*

# Wyjście standalone zamiast pełnego `node_modules` + `next start`.
# Dwa powody, oba zmierzone:
#  1. `next start` uruchamiany przez npx forkuje powłokę, więc SIGTERM od
#     `docker stop` trafia w npm, nie w proces Node. Handler zamykający
#     dev-servery preview (instrumentation-node.ts) nigdy się nie wykonywał,
#     a kontener wychodził z kodem 1. `server.js` to zwykły skrypt node —
#     `exec node server.js` czyni go PID 1 i sygnał dochodzi bezpośrednio.
#  2. Pełne `node_modules` dawało obraz 2.96 GB, w którym nieużywane
#     `.next/standalone` leżało dodatkowo jako balast.
# `.next/static` i `public` NIE są częścią wyjścia standalone i muszą być
# skopiowane osobno.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma ./prisma

# SDK agenta trace standalone bundluje do JavaScriptu, więc samego pakietu nie
# kopiuje — a zbundlowany kod spawnuje `cli.js` po ścieżce zamrożonej w
# buildzie: /app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js. Bez tego
# katalogu pierwsza instrukcja wysłana do agenta pada na "Cannot find module",
# czyli cała funkcja produktu, i to dopiero przy pierwszym użyciu — start
# kontenera wygląda zdrowo.
COPY --from=build --chown=node:node /app/node_modules/@anthropic-ai ./node_modules/@anthropic-ai

# Poza /app, żeby nie mieszać się z `node_modules` z trace'u standalone —
# COPY scala katalogi i nadpisałby wygenerowanego klienta pakietami CLI.
# --chown=node: gdyby CLI musiało dociągnąć silnik, sprawdza najpierw, czy może
# pisać do własnego katalogu silników. Przy poprawnie wykrytym openssl (etap
# `prisma-cli` wyżej) silnik już tam leży i ta ścieżka się nie odpala.
COPY --from=prisma-cli --chown=node:node /cli/node_modules /opt/prisma-cli/node_modules

# Użytkownik nierootowy: bez tego każdy plik, który kontener utworzy w
# zamontowanym katalogu, należy na dysku hosta do roota.
# To rozwiązuje jednak tylko połowę problemu. Bind-mount zachowuje właściciela
# katalogu z hosta, więc pliki dostają uid 1000 (`node`), a nie uid osoby
# uruchamiającej, jeśli ta ma inny. Pełne dopasowanie daje dopiero
# `user: "${UID}:${GID}"` w compose (Task 20).
# Reszta /app jest tylko czytana, więc dowolny uid wystarczy.
#
# HOME i cache npm muszą jednak być zapisywalne, a obcy uid nie ma wpisu w
# /etc/passwd: bez HOME dostaje `/`, więc `npm config get cache` daje `/.npm`
# i instalacja zależności projektu użytkownika pada na EACCES (mkdir /.npm).
# Oba idą pod /data, bo to jedyny katalog, którego właścicielem jest osoba
# uruchamiająca — montuje go compose.
# Uwaga dla Task 20: katalog konfiguracyjny agenta idzie za $HOME, czyli teraz
# /data/home/.claude (pierwszeństwo ma CLAUDE_CONFIG_DIR —
# lib/services/cli/claude-config-dir.ts). Tam montuje się .claude hosta.
# Właściciela /app nadają `COPY --chown` powyżej: rekurencyjny `chown -R /app`
# przepisuje każdy plik do nowej warstwy i kosztował 431 MB.
ENV HOME=/data/home
ENV npm_config_cache=/data/.npm
# Binaria Playwright lądują w /data (bind-mount) zamiast w /home lub /root,
# dzięki czemu przeżywają restart kontenera i nie trzeba ich pobierać ponownie.
ENV PLAYWRIGHT_BROWSERS_PATH=/data/home/.cache/ms-playwright
RUN mkdir -p /data/projects /data/home/.claude /data/.npm \
 && chown -R node:node /data
USER node

EXPOSE 3000
EXPOSE 3100-3131

# Brak `VOLUME ["/data"]` — świadomie. Przy bind-mouncie deklaracja nic nie
# wnosi, a przy uruchomieniu bez montowania tworzy anonimowy wolumen, który
# `docker rm` zostawia jako sierotę trzymającą bazę użytkownika poza jego
# zasięgiem. Mapowanie /data deklaruje compose (Task 20) i tam jest widoczne.

# Dev-servery projektów są procesami potomnymi tego kontenera, więc PID 1
# musi je zbierać. `init: true` w compose zapewnia reaper.
# --accept-data-loss: `db push` na SQLite przebudowuje tabele przy drifcie
# schematu i bez flagi czeka na interaktywne potwierdzenie, którego w
# kontenerze nikt nie udzieli.
# `exec node server.js`: bez `exec` SIGTERM trafiłby w powłokę zamiast w Node.
# `mkdir -p` na starcie: bind-mount zasłania katalogi utworzone w obrazie, a
# HOME i cache npm muszą istnieć, zanim ruszy pierwsza instalacja zależności.
CMD ["sh", "-c", "mkdir -p \"$HOME\" \"$npm_config_cache\" && node /opt/prisma-cli/node_modules/prisma/build/index.js db push --schema=/app/prisma/schema.prisma --skip-generate --accept-data-loss && exec node server.js"]
