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
# `exec` przed `next start`: bez niego SIGTERM wysłany do PID 1 trafia w
# powłokę, nie w proces Next.js, który rejestruje handler zamykający
# dev-servery preview (instrumentation-node.ts, Task 9) — cichy wyciek
# procesów potomnych po `docker stop`.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && exec npx next start --port 3000 --hostname 0.0.0.0"]
