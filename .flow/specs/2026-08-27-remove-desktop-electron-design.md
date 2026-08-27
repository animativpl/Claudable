# Claudable — usunięcie budowania desktopowego (Electron)

Data: 2026-08-27
Run: `remove-desktop-electron`
Status: zapis deliberacji (dokument datowany, nie aktualizowany później)

## Kontekst

Zlecenie użytkownika: „wywal całkowicie buildowanie desktopa z electronem,
projekt ma być tylko webowy" — pojedyncza, jednoznaczna decyzja, bez
niejasności do rozstrzygnięcia. Skala pipeline'u zejściowa: jedna decyzja,
brak realnego designu do przemyślenia, red-team pominięty (czyste usunięcie,
bez wrażliwości bezpieczeństwa/danych, dobrze zweryfikowany zakres).

Zakres zweryfikowany przed pisaniem planu (grep, nie zgadywanie):
- Zero kodu aplikacyjnego (`app/`, `lib/services/`, API routes) rozgałęzia
  się na desktop-vs-web — grep pod `electron|isPackaged|app\.getPath|
  ELECTRON_RUN_AS_NODE` poza katalogiem `electron/` trafia wyłącznie w
  `index.js` (Electron entry point) i `scripts/run-desktop.js`.
- Elektron jest jedynym powodem `engines.node: ">=22.12.0"` w tym projekcie:
  `node_modules/next/package.json` wymaga `>=20.9.0`, `prisma` `>=18.18`,
  `react` praktycznie nic. Obraz Dockera wymaga Node 22 z innego, osobnego
  powodu (astro@7 w generowanych projektach) — to zostaje bez zmian.
- `Dockerfile`, `eslint.config.mjs`, `tsconfig.json` nie referencują
  `electron` wcale — build/lint/typecheck nie wymaga żadnej specjalnej
  obsługi po usunięciu.

## Decyzja

| # | Decyzja | Wybór | Dlaczego |
|---|---------|-------|----------|
| 1 | Zakres usunięcia | Usunąć cały katalog `electron/`, `index.js`, `scripts/run-desktop.js`, wszystkie skrypty/zależności/config `electron-builder` z `package.json`, sekcje README | Bezpośrednie polecenie użytkownika — projekt ma być tylko webowy. |
| 2 | `engines.node` (`>=22.12.0`) | **Zostaje bez zmian** (liczba), poprawia się tylko uzasadnienie w README (Electron już go nie wymusza, ale nic nie każe go obniżać) | Obniżenie minimalnej wersji Node to osobna decyzja o wsparciu platform, nie wynika z prośby „usuń Electron" — chirurgiczna zmiana dotyka tylko tego, co zlecenie wymaga. Zostawienie liczby bez zmian jest bezpieczne (nic tego nie wymaga niżej) i spójne z wymogiem obrazu Dockera (Node 22, inny powód). |
| 3 | `.gitignore`'owe `dist/`/`release/` | Usunąć (były wyjściem `electron-builder`, teraz martwe) | Ten sam wzorzec co reszta tegorocznego cleanupu — nieużywane wpisy configu się usuwa, nie zostawia. |

## Poza zakresem

- Zmiana minimalnej wersji Node w `engines.node` (decyzja 2) — tylko
  uzasadnienie w dokumentacji się poprawia.
- Wymagania Node dla obrazu Dockera (astro@7) — niezwiązane z tą zmianą.
