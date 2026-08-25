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
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 bash openssl ca-certificates \
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

# Poza /app, żeby nie mieszać się z `node_modules` z trace'u standalone —
# COPY scala katalogi i nadpisałby wygenerowanego klienta pakietami CLI.
# --chown=node: CLI sprawdza przy starcie, czy może pisać do własnego katalogu
# silników (dociąga je leniwie) i pod nierootowym użytkownikiem przerywa
# z "please make sure you install prisma with the right permissions".
COPY --from=prisma-cli --chown=node:node /cli/node_modules /opt/prisma-cli/node_modules

# Użytkownik nierootowy: bez tego każdy plik, który kontener utworzy w
# zamontowanym katalogu, należy na dysku hosta do roota.
# To rozwiązuje jednak tylko połowę problemu. Bind-mount zachowuje właściciela
# katalogu z hosta, więc pliki dostają uid 1000 (`node`), a nie uid osoby
# uruchamiającej, jeśli ta ma inny. Pełne dopasowanie daje dopiero
# `user: "${UID}:${GID}"` w compose (Task 20) — i dlatego `chmod a+w` na
# katalogu silników CLI Prismy: Prisma sprawdza przy starcie, czy może do
# niego pisać (dociąga silniki leniwie), i pod obcym uid inaczej przerywa.
# Reszta /app jest tylko czytana, więc dowolny uid wystarczy.
# Uwaga dla Task 20: katalog konfiguracyjny agenta idzie za $HOME, czyli
# /home/node/.claude, nie /root/.claude (pierwszeństwo ma CLAUDE_CONFIG_DIR —
# lib/services/cli/claude-config-dir.ts).
# Właściciela /app nadają `COPY --chown` powyżej: rekurencyjny `chown -R /app`
# przepisuje każdy plik do nowej warstwy i kosztował 431 MB.
RUN mkdir -p /data/projects /home/node/.claude \
 && chown -R node:node /data /home/node/.claude \
 && chmod a+w /opt/prisma-cli/node_modules/@prisma/engines
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
CMD ["sh", "-c", "node /opt/prisma-cli/node_modules/prisma/build/index.js db push --schema=/app/prisma/schema.prisma --skip-generate --accept-data-loss && exec node server.js"]
