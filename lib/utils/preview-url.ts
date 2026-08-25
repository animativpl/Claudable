/**
 * Hosty, które w zapisanym adresie podglądu są prawdziwe wyłącznie dla
 * maszyny, na której działa serwer. Przeglądarka na innym komputerze
 * rozwiązuje je na samą siebie.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/**
 * Adres podglądu w kształcie, pod którym otworzy go bieżąca przeglądarka.
 *
 * Serwer zapisuje `http://localhost:<port>`, bo dev-server startuje wewnątrz
 * kontenera i tam ten adres jest poprawny — trafia też do dev-servera jako
 * `NEXT_PUBLIC_APP_URL`. Serwer nie wie jednak, jakim adresem przyszedł
 * użytkownik, więc hosta podmienia dopiero klient: z zapisanego adresu bierze
 * port, hosta bierze z okna przeglądarki.
 *
 * Podmiana obejmuje tylko pętlę zwrotną. Host spoza niej trafia do bazy
 * wyłącznie z jawnego `overrides.url` projektu — nadpisanie go zepsułoby
 * świadomie skonfigurowany adres (tunel, proxy), a nie naprawiło defektu.
 */
export function toBrowsablePreviewUrl(storedUrl: string, currentHostname: string): string {
  if (!currentHostname) {
    return storedUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(storedUrl);
  } catch {
    // Adres nieparsowalny albo pusty zwracamy bez zmian: zadaniem tej funkcji
    // jest podmiana hosta, nie walidacja. Zjedzenie go dałoby „brak podglądu"
    // zamiast widocznego, diagnozowalnego błędu ładowania.
    return storedUrl;
  }

  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    return storedUrl;
  }

  parsed.hostname = currentHostname;

  // `URL#toString` dokłada „/" adresowi bez ścieżki, a konsumenci doklejają do
  // zwróconego adresu route — dev-server dostałby wtedy pusty segment „//".
  return storedUrl.endsWith('/') ? parsed.toString() : parsed.toString().replace(/\/$/, '');
}
