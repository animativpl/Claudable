# Naprawa trzech defektów ujawnionych przy dostępie z sieci lokalnej

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development.

**Goal:** Czat i podgląd projektów działają, gdy aplikacja jest otwierana z adresu innego niż `localhost`, a dryf portu dev-servera przestaje być cichy.

**Architecture:** Trzy niezależne poprawki. Dwie po stronie klienta (bezpieczny kontekst, wyprowadzenie adresu podglądu z adresu, którym użytkownik wszedł), jedna w scaffoldzie Astro (twarde trzymanie przydzielonego portu).

**Tech Stack:** Next.js 15 App Router, TypeScript strict, vitest.

**Spec:** projekt nie ma żywego `spec.md`.

## Global Constraints

- TypeScript `strict: true`. Żadnego `as any` ani `@ts-ignore`.
- Zakres portów preview `3100`–`3131`, źródłem jest `lib/config/constants.ts`.
- Nie ruszać `Dockerfile` — obraz jest zweryfikowany uruchomieniem.
- Nie commitować `.env`, `.env.local`, `.env.docker`, `docker-compose.override.yml`.
- Wiadomości commitów po angielsku, tryb rozkazujący.
- Grepy weryfikacyjne wykluczają, nigdy nie wyliczają: `-I --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.flow --exclude=package-lock.json .`

---

### Task 1: Trzy defekty dostępu spoza localhost

**Files:**
- Create: `lib/utils/random-id.ts`
- Create: `tests/utils/random-id.test.ts`
- Create: `tests/utils/preview-url.test.ts`
- Modify: `app/[project_id]/chat/page.tsx`
- Modify: `app/page.tsx`
- Modify: `components/chat/ChatInput.tsx`
- Modify: `components/chat/ChatLog.tsx`
- Modify: `lib/serializers/client/chat.ts`
- Modify: `lib/utils/preview-url.ts` (nowy, jeśli nie istnieje) i konsumenci adresu podglądu
- Modify: `lib/templates/astro.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/utils/random-id.ts
  export function randomId(prefix?: string): string;
  // lib/utils/preview-url.ts
  export function toBrowsablePreviewUrl(storedUrl: string, currentHostname: string): string;
  ```

**Defekt A — `crypto.randomUUID` poza bezpiecznym kontekstem.**
`crypto.randomUUID` jest dostępne wyłącznie w secure context (HTTPS albo `localhost`). Pod `http://<ip-lan>` jest `undefined` i czat wywala się na `crypto.randomUUID is not a function`.
Niezabezpieczone wywołania: `app/[project_id]/chat/page.tsx:270,1318,1346`, `app/page.tsx:314`, `components/chat/ChatInput.tsx:185`.
Zabezpieczone już dziś (ten sam wzorzec, do zastąpienia wspólnym helperem): `components/chat/ChatLog.tsx:346-351`, `lib/serializers/client/chat.ts:62-66`.
Dodatkowo `app/[project_id]/chat/page.tsx:232` ma strażnika, ale spada na **pusty string** jako `conversationId` — to też naprawić, bo pusty identyfikator konwersacji jest gorszy niż wygenerowany fallbackiem.

**Defekt B — adres podglądu zaszyty na `localhost`.**
`lib/services/preview.ts:803` i `:913` budują `http://localhost:${port}`. Klient otwierający aplikację spoza tej maszyny dostaje adres wskazujący na własny komputer. Serwer nie wie, jakim adresem przyszedł użytkownik, więc **rozwiązanie jest po stronie klienta**: zachowaj zapisany adres jako źródło portu, a hosta podmień na `window.location.hostname` w momencie renderowania. Nie zmieniaj tego, co trafia do bazy — zmienna `NEXT_PUBLIC_APP_URL` przekazywana dev-serverowi ma zostać na `localhost`, bo tam jest ona poprawna (proces działa w kontenerze).

**Defekt C — Astro po cichu zmienia port.**
Astro przy zajętym porcie bierze następny wolny, w odróżnieniu od Next.js. Zmierzone: aplikacja przydzieliła 3100, dev-server nasłuchuje na 3101, baza i mapowanie portów mówią 3100, użytkownik dostaje pustkę bez błędu. W generowanym `astro.config.mjs` ustaw `server.strictPort: true`, żeby zajęty port kończył się błędem zamiast dryfem. Sprawdź w dokumentacji Astro przez context7, jak dokładnie nazywa się ta opcja w wersji 7 — nie zgaduj z pamięci.

- [ ] **Step 1: Testy dla `randomId` i `toBrowsablePreviewUrl` (RED)**
- [ ] **Step 2: Implementacja obu helperów (GREEN)**
- [ ] **Step 3: Podmiana pięciu niezabezpieczonych wywołań i dwóch istniejących strażników na wspólny helper**
- [ ] **Step 4: Wpięcie `toBrowsablePreviewUrl` we wszystkie miejsca renderujące adres podglądu**
- [ ] **Step 5: `strictPort` w scaffoldzie Astro plus test, że wygenerowany config go zawiera**
- [ ] **Step 6: Brama — `npm run type-check && npm test && npm run lint && npm run build`**
- [ ] **Step 7: Commit**
