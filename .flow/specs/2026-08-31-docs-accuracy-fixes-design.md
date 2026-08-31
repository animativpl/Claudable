# Claudable — poprawki dokumentacji i README

Data: 2026-08-31
Run: `docs-accuracy-fixes`
Status: zapis deliberacji (dokument datowany, nie aktualizowany później)

## Kontekst

Zlecenie: „popraw teraz docsy, readme i dodaj spec.md". `spec.md` to osobny
byt (skill `writing-specs`, commitowany osobno per instrukcja tego skilla —
akt dokumentacyjny, recenzowalny sam). Ten dokument dotyczy tylko drugiej
części: audytu i poprawek README.md/package.json/.env.docker.example.

Audyt (fork, read-only) potwierdził wszystko już naprawione w poprzednich
gałęziach tej sesji nie wraca — nowe, realne znaleziska:

1. **9 wystąpień** `github.com/opactorai/Claudable` w README (badge'e
   gwiazdek/forków/licencji, `git clone`, star-history chart) — nieaktualne;
   po tej sesji repo ma dwa remote'y (`origin` = `anymorph-ai`, bez dostępu
   do push; `animativpl` = gdzie faktycznie wylądowała praca na życzenie
   użytkownika). Zapytany wprost — wybrał `animativpl`.
2. **`npm run prisma:reset` prawdopodobnie nie robi tego, co README
   twierdzi** — realny bug, zweryfikowany przez context7 (dokumentacja
   Prisma) i bezpośrednio (`prisma migrate status` na kopii bazy zwraca „not
   managed by Prisma Migrate", zero migracji do odtworzenia). Skrypt to
   `prisma migrate reset`, ale ten projekt jest `db push`-only od runu
   `claudable-cleanup-audit` (Task 9 świadomie usunął
   `prisma/migrations/` — commit `c3e64f6`). `migrate reset` z zerem migracji
   do replay nie odtworzy schematu tak, jak README obiecuje. Poprawny
   zamiennik, potwierdzony w docs Prisma: `prisma db push --force-reset`
   ("Drops and recreates the database before applying the schema changes.") —
   dokładnie to, co README już opisuje ("The command drops and recreates the
   local database").
3. **README's „Setup" nadinterpretuje `npm install`** — sekcja otwiera
   zdaniem "The npm install command automatically handles the complete
   setup", pod nim punkt 3 "Database Setup: SQLite database auto-creates at
   `data/cc.db` on first run" — prawdziwe, ale to nie `npm install` to robi
   (tylko `postinstall`→`ensure:env`, samo `.env`/porty), tylko pierwsze
   `npm run dev` (`scripts/run-web.js` woła tam `prisma db push`).
4. **`.env.docker.example`'s komentarz przy `ENCRYPTION_KEY` opisuje starą,
   już nieistniejącą logikę** — "wygenerowałby losowy klucz w pamięci, inny
   przy każdym starcie" — to zachowanie usunięte w `claudable-cleanup-audit`
   Task 8 (commit `2b6836c` i wcześniejsze w tym łańcuchu): dziś
   `lib/crypto.ts` rzuca błędem zamiast generować losowy klucz.

## Decyzje

| # | Decyzja | Wybór | Dlaczego |
|---|---------|-------|----------|
| 1 | Docelowy org dla publicznych linków README | **`animativpl`** | Decyzja użytkownika (zapytany wprost) — tam faktycznie wylądowała praca tej sesji. |
| 2 | `package.json`'s `repository.url` (dziś `anymorph-ai`, naprawione w poprzedniej gałęzi na podstawie ówczesnego `git remote -v`) | **Też `animativpl`**, dla spójności z decyzją 1 | Zostawienie `anymorph-ai` w `package.json` obok `animativpl` w README odtworzyłoby dokładnie ten sam typ rozjazdu, który ta sesja właśnie naprawiała wielokrotnie gdzie indziej. |
| 3 | `npm run prisma:reset` | Zmienić skrypt na `prisma db push --force-reset` | Zweryfikowane przez context7 (dokumentacja Prisma) i bezpośrednio (`prisma migrate status` na kopii bazy) — obecny skrypt (`prisma migrate reset`) nie ma czego odtworzyć (zero migracji), więc realnie nie robi tego, co README obiecuje. Nowy skrypt robi dokładnie to, README nie wymaga zmiany treści. |
| 4 | Zakres | Tylko te 4 znaleziska + spójność `repository.url` (decyzja 2) — audyt nie znalazł nic więcej | Fork-audyt (read-only) przeszedł całe README zdanie po zdaniu przeciw realnemu kodowi/configowi; reszta zweryfikowana jako zgodna z rzeczywistością. |
