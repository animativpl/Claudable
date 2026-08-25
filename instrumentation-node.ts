/**
 * Uruchamiane raz na proces serwera Next.js (runtime nodejs). Dev-servery
 * projektów są dziećmi tego procesu — bez tego ubicie Claudable zostawia
 * je żywe, trzymające porty z puli preview.
 *
 * Handler musi być WYŁĄCZNIE synchroniczny. Pod `next dev` Next ma własną
 * obsługę sygnałów, która kończy proces w tym samym ticku — asynchroniczny
 * ogon (np. zapis previewUrl/previewPort do bazy) nigdy nie dobiega.
 * Ubijanie drzew procesów jest synchroniczne, więc jest bezpieczne tutaj;
 * stan w bazie naprawia rekoncyliacja przy następnym starcie (Task 11).
 */
import { previewManager } from '@/lib/services/preview';

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  const killed = previewManager.killAllSync();
  console.log(`[Shutdown] ${signal}: killed ${killed} preview process tree(s)`);
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
