#!/usr/bin/env node
/**
 * Jednorazowe czyszczenie po usunięciu Vercela, Supabase i agentów innych
 * niż Claude. Robi kopię bazy przed czymkolwiek, bo `prisma db push` na
 * SQLite przebudowuje tabele.
 */
const fs = require('fs');
const path = require('path');

const LEGACY_PROVIDERS = ['vercel', 'supabase'];

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

  const dbPath = path.join(__dirname, '..', 'data', 'cc.db');
  if (fs.existsSync(dbPath)) {
    const backupDir = path.join(__dirname, '..', 'data', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `cc_backup_${stamp}.db`);
    fs.copyFileSync(dbPath, backupPath);
    console.log(`🗃️  Backup: ${backupPath}`);
  }

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

module.exports = { LEGACY_PROVIDERS, purgeLegacyProviders, main };
