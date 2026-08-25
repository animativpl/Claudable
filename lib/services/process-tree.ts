/**
 * Dev-server projektu to `npm run dev`, który spawnuje własne dziecko.
 * Zabicie samego npm zostawia wnuka trzymającego port. Na platformach
 * nie-Windows procesy startują jako liderzy grupy (`detached: true`) i giną
 * całą grupą (`scope: 'group'`). Na Windows `detached` nie tworzy grupy
 * procesów w tym samym sensie — `-pid` jest niedostępne, więc ubijany jest
 * wyłącznie proces npm (`scope: 'single'`), a jego dziecko może przeżyć.
 * Wartość zwracana mówi wprost, która ścieżka zadziałała, żeby wołający nie
 * mylił "ubito lidera" z "ubito całą grupę".
 */
export function killProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals = 'SIGTERM'
): { signalled: boolean; scope: 'group' | 'single' } {
  if (!pid || pid <= 0) {
    return { signalled: false, scope: 'single' };
  }
  try {
    // Ujemny pid = cała grupa procesów, której liderem jest pid.
    process.kill(-pid, signal);
    return { signalled: true, scope: 'group' };
  } catch {
    try {
      process.kill(pid, signal);
      return { signalled: true, scope: 'single' };
    } catch {
      return { signalled: false, scope: 'single' };
    }
  }
}
