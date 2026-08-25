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
import { previewManager, reconcileStalePreviews } from '@/lib/services/preview';
import { reconcileProjectPaths } from '@/lib/services/project';
import { reconcileStaleRequests } from '@/lib/services/user-requests';

// Rekoncyliacja przy starcie: każdy UserRequest/preview niedomknięty w chwili
// startu jest z definicji martwy, bo nie ma go kto kontynuować (Task 11).
// Musi wykonać się PRZED rejestracją handlerów sygnałów poniżej — to
// asynchroniczna ścieżka, a handler sygnałów musi zostać wyłącznie
// synchroniczny (patrz komentarz przy `shutdown`).
//
// `reconcileProjectPaths` dołącza tu z tego samego powodu: `repoPath` to
// absolutna ścieżka hosta, a po zmianie montowania (kontener) wskazuje na
// katalog, którego nie ma. Weryfikacja przy starcie jest jedynym momentem,
// w którym da się to naprawić, zanim agent albo preview jej użyje.
void reconcileProjectPaths();
void reconcileStaleRequests();
void reconcileStalePreviews();

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  const { group, single } = previewManager.killAllSync();
  if (single > 0) {
    console.warn(
      `[Shutdown] ${signal}: killed ${group} preview process group(s); WARNING: ${single} preview(s) could only be signalled as a single process (not a process group) — descendants may still hold their port`
    );
  } else {
    console.log(`[Shutdown] ${signal}: killed ${group} preview process tree(s)`);
  }
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
