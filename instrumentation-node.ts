/**
 * Uruchamiane raz na proces serwera Next.js (runtime nodejs). Dev-servery
 * projektów są dziećmi tego procesu — bez tego ubicie Claudable zostawia
 * je żywe, trzymające porty z puli preview.
 */
import { previewManager } from '@/lib/services/preview';

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Shutdown] ${signal} received — stopping preview servers...`);
  try {
    await previewManager.stopAll();
    console.log('[Shutdown] Preview servers stopped');
  } catch (error) {
    console.error('[Shutdown] Failed to stop preview servers cleanly:', error);
  }
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
