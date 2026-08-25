#!/usr/bin/env node
/**
 * Jednorazowe czyszczenie po usunięciu Vercela, Supabase i agentów innych
 * niż Claude. Robi kopię bazy przed czymkolwiek, bo `prisma db push` na
 * SQLite przebudowuje tabele.
 */
const fs = require('fs');
const path = require('path');

// Zgodne z scripts/run-web.js:18-19 — Prisma i run-web.js czytają
// DATABASE_URL z .env/.env.local, nie z powłoki. Bez tego resolveDbPath()
// widziałby inną wartość niż faktyczny runtime Prismy.
// `override: true` na drugim wywołaniu jest konieczne: dotenv domyślnie NIE
// nadpisuje klucza już ustawionego przez poprzednie `.config()` w tym samym
// procesie (`node_modules/dotenv/lib/main.js` — `populate`), więc bez tej
// flagi .env.local nigdy by nie wygrał z .env dla tego samego klucza —
// sprzecznie z zamierzonym „drugi nadpisuje pierwszy".
//
// Sam `dotenv` jest opcjonalny: w obrazie runtime `node_modules` pochodzi
// z tracingu `next build --standalone`, a ten nie widzi `scripts/`, więc
// modułu tam nie ma i `npm run db:backup` padał na `Cannot find module`.
// W kontenerze `DATABASE_URL` przychodzi już ze środowiska (`env_file:`
// w docker-compose.yml), więc nie ma czego wczytywać z plików.
function loadEnvFiles() {
  let dotenv;
  try {
    dotenv = require('dotenv');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return;
  }
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
}

loadEnvFiles();

const LEGACY_PROVIDERS = ['vercel', 'supabase'];

// Zgodne z .env: Prisma dla SQLite rozwiązuje ścieżki relatywne w `file:`
// względem katalogu prisma/, nie względem cwd ani __dirname skryptu.
const PRISMA_DIR = path.join(__dirname, '..', 'prisma');
const DEFAULT_DATABASE_URL = 'file:../data/cc.db';

/**
 * Wydzielone, żeby `db:backup` i migracja liczyły ścieżkę bazy w jednym
 * miejscu. `DATABASE_URL` w kontenerze bywa absolutne (`file:/data/cc.db`),
 * a lokalnie relatywne (`file:../data/cc.db`) — Prisma dla SQLite rozwiązuje
 * to drugie względem `prisma/`, więc robimy to samo.
 */
function resolveDbPath(databaseUrl) {
  const url = databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const filePath = url.replace(/^file:/, '');
  return path.isAbsolute(filePath) ? filePath : path.resolve(PRISMA_DIR, filePath);
}

/** Kopiuje bazę do `<katalog bazy>/backups/cc_backup_<znacznik czasu>.db`. */
function backupDatabase(dbPath) {
  const backupDir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `cc_backup_${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

/** Logika `npm run db:backup` — brak bazy to błąd, nie cichy sukces. */
function runBackupCli() {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(
      `❌ No database found at ${dbPath} — nothing to back up. If this is a fresh install, ` +
        `that's expected: the database is created on first \`npm run dev\` (or \`npm run setup\`), ` +
        `and a fresh install has nothing to migrate yet.`
    );
    process.exit(1);
    return;
  }
  const backupPath = backupDatabase(dbPath);
  console.log(`backup: ${backupPath}`);
}

/**
 * Wydzielone, żeby dało się przetestować bez prawdziwej bazy.
 * Czyści OBIE tabele niosące providera. Po zawężeniu `isProvider` w Task 4
 * nie istnieje już trasa, którą użytkownik mógłby usunąć stary token —
 * `DELETE /api/tokens/vercel` zwraca 400 „Invalid provider" — więc wiersz
 * pominięty tutaj zostaje w bazie na zawsze i nieusuwalny.
 */
async function purgeLegacyProviders(client) {
  const connections = await client.projectServiceConnection.deleteMany({
    where: { provider: { in: LEGACY_PROVIDERS } },
  });
  const tokens = await client.serviceToken.deleteMany({
    where: { provider: { in: LEGACY_PROVIDERS } },
  });
  return { connections: connections.count, tokens: tokens.count };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(
      `❌ No database found at ${dbPath} — refusing to purge legacy rows without a backup.`
    );
    process.exit(1);
    return;
  }
  const backupPath = backupDatabase(dbPath);
  console.log(`🗃️  Backup: ${backupPath}`);

  const prisma = new PrismaClient();
  try {
    const removed = await purgeLegacyProviders(prisma);
    console.log(
      `🧹 Removed ${removed.connections} legacy service connection(s) and ${removed.tokens} legacy token(s)`
    );
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

module.exports = {
  LEGACY_PROVIDERS,
  purgeLegacyProviders,
  main,
  resolveDbPath,
  runBackupCli,
};
