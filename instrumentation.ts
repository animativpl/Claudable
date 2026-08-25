/**
 * Uruchamiane raz na proces serwera Next.js dla każdego runtime'u
 * (nodejs i edge). `previewManager` zależy od `child_process`, którego
 * edge bundler nie potrafi rozwiązać — logika żyje więc w
 * `instrumentation-node.ts`, importowanym wyłącznie w runtime nodejs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
