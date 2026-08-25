/**
 * Dev-server projektu to `npm run dev`, który spawnuje własne dziecko.
 * Zabicie samego npm zostawia wnuka trzymającego port, dlatego procesy
 * startują jako liderzy grupy (`detached: true`) i giną całą grupą.
 */
export function killProcessTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    // Ujemny pid = cała grupa procesów, której liderem jest pid.
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
