/**
 * Identyfikator generowany po stronie klienta.
 *
 * `crypto.randomUUID` istnieje wyłącznie w bezpiecznym kontekście — HTTPS albo
 * `localhost`. Pod `http://<ip-lan>` przeglądarka go nie udostępnia i samo
 * wywołanie wywraca czat na `crypto.randomUUID is not a function`. Każde
 * użycie w kodzie klienta idzie więc tędy, a nie prosto do `crypto`.
 */
export function randomId(prefix?: string): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 11)}`;

  return prefix ? `${prefix}_${raw}` : raw;
}
