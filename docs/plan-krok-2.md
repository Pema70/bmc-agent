# Plan kroku 2: projekty, role i edytor BMC bez AI

Krok 2 z `docs/spec.md` §14. Plan zaakceptowany 2026-11-09.

## Kontekst

Krok 1 jest zamknięty (PR #1–#3):
- szkielet Next.js;
- Postgres w Dockerze na `127.0.0.1:5433`;
- Prisma 7.10.1 z modelem `User`;
- next-auth v4 z `getSession()` / `requireSession()` w `src/lib/auth/session.ts`.

`/projekty` to na razie placeholder.

Krok 2 daje zalogowanemu użytkownikowi projekty z rolami i ręczny edytor dziewięciu bloków BMC. Edytor chroni przed nadpisaniem przez pole `version` (optymistyczne blokowanie).

Poza zakresem kroku 2: AI i zapraszanie innych użytkowników (krok 8). Role istnieją w modelu i w sprawdzaniu uprawnień, ale na razie przydzielamy tylko OWNER.

Krok dzieli się na **3 PR-y**. Każdy zaczyna się po zmergowaniu poprzedniego. **Bez nowych zależności**: Prisma, Zod i Tailwind już są.

---

## PR 2a: `feat/projekty`: projekty i role

**Commit 1 (`docs:`):**
- `CLAUDE.md`, „Konwencje kodu”: reguła o braku middleware i obowiązku wywołania `getSession()` / `requireSession()` oraz sprawdzenia uprawnień do projektu.
- `docs/zadania.md`: lista rzeczy na później.
- Ten plik.

**Schemat Prisma:**
```prisma
enum Role { OWNER EDITOR VIEWER }

model Project {
  id          String          @id @default(cuid())
  name        String
  description String
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  members     ProjectMember[]
}

model ProjectMember {
  projectId String
  userId    String
  role      Role
  createdAt DateTime @default(now())
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([projectId, userId])
  @@index([userId])
}
// User: + members ProjectMember[]
```
Do tego migracja `projects`.

**Kod:**
- `src/lib/schemas/project.ts`: `ProjectInput` (nazwa 1–100 znaków, opis 0–2000, przycinanie spacji).
- `src/lib/auth/permissions.ts`:
  - `requireProjectRole(projectId, minRole)`: najpierw `requireSession()`, potem członkostwo. Hierarchia ról to OWNER > EDITOR > VIEWER.
  - Dla osoby spoza projektu `notFound()` (D1).
  - Ta sama funkcja posłuży Server Actions i stronom.
- `src/lib/db/projects.ts`:
  - `listProjectsForUser(userId)`;
  - `createProject(userId, input)`, który w jednej transakcji tworzy `Project` i `ProjectMember(OWNER)`;
  - edycja nazwy i opisu, tylko OWNER (D6).
- `/projekty`: lista projektów użytkownika z rolą i formularz „Nowy projekt” (Server Action: sesja, potem Zod, potem zapis).
- `/projekty/[id]`: nagłówek projektu (nazwa, opis, rola) i edycja nazwy i opisu dla OWNER. Płótno dochodzi w PR 2b.

**Testy (mocki, bez bazy):**
- `ProjectInput`;
- hierarchia ról i `requireProjectRole`: brak sesji, brak członkostwa, za niska rola, OK;
- `createProject`: tworzy właściciela;
- edycja projektu: tylko OWNER;
- Server Actions: sprawdzają sesję przed walidacją.

## PR 2b: `feat/bmc-wariant`: schemat BMC i wariant główny

**Schemat Prisma:**
```prisma
model BmcVariant {
  id        String   @id @default(cuid())
  projectId String
  name      String
  isMain    Boolean  @default(false)
  state     Json     // BmcState, walidowany Zod przy zapisie i odczycie
  version   Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId])
}
// Project: + variants BmcVariant[]
```
- Najwyżej jeden wariant główny na projekt: częściowy indeks unikalny `ON "BmcVariant"("projectId") WHERE "isMain"` (D2).
- Najpierw sprawdzam w dokumentacji, czy Prisma 7.10 obsługuje taki indeks natywnie. Jeśli nie, dopisuję go ręcznie do SQL migracji (`migrate dev --create-only`) przed jej zastosowaniem i przed merge na `main`.
- Po dopisaniu sprawdzam, czy kolejne `migrate dev` nie próbuje usunąć indeksu i nie zgłasza rozjazdu schematu. Jeśli zgłasza, przerywam i informuję użytkownika przed dalszą pracą.

**Kod:**
- `src/lib/schemas/bmc.ts`:
  - `BlockKey` (9 kluczy ze spec §4);
  - `BmcEntry` (1–500 znaków, przycinanie);
  - `BmcState = z.record(BlockKey, z.array(BmcEntry).max(30))` z limitem łącznym 150 wpisów (D5). Do sprawdzenia, czy w Zod 4 rekord wymaga wszystkich 9 kluczy;
  - `emptyBmcState()`;
  - polskie nazwy i krótkie opisy bloków do UI.
- `src/lib/db/variants.ts`:
  - `getMainVariant(projectId)`: parsuje `state` Zodem, a niepoprawny stan daje jawny błąd;
  - `saveVariantState(variantId, expectedVersion, state)`: `updateMany where {id, version}` i `version + 1`. `count === 0` zwraca `{ ok: false, error: "VERSION_CONFLICT" }`.
- `createProject` z PR 2a tworzy w tej samej transakcji pusty wariant główny „Wariant główny”.
- `/projekty/[id]`: płótno **tylko do odczytu** w klasycznym układzie 9 bloków (siatka Tailwind).

**Testy:**
- `BmcState`: brak klucza, nadmiarowy klucz, pusty wpis, za długi wpis, limit na blok i limit łączny;
- `emptyBmcState`;
- `saveVariantState`: sukces, konflikt wersji, niepoprawny stan nie trafia do bazy;
- `getMainVariant` z uszkodzonym JSON-em.

## PR 2c: `feat/edytor-bmc`: edycja płótna

- Komponent kliencki `src/components/bmc/canvas-editor.tsx`: w każdym bloku dodawanie, edycja i usuwanie wpisów (lokalny stan).
- Jawny przycisk „Zapisz” z licznikiem niezapisanych zmian (D3).
- Server Action `saveCanvasAction(projectId, variantId, version, state)`, w kolejności:
  1. `requireProjectRole(projectId, "EDITOR")`;
  2. sprawdzenie, czy wariant należy do projektu;
  3. walidacja Zod;
  4. `saveVariantState`.
- Konflikt wersji: komunikat „Ktoś w międzyczasie zmienił ten model. Odśwież stronę, aby zobaczyć aktualną wersję.” Lokalne zmiany zostają na ekranie, nic nie jest nadpisywane.
- VIEWER widzi płótno bez kontrolek edycji, a akcja i tak odrzuca jego zapis po stronie serwera.
- Ostrzeżenie przy opuszczaniu strony z niezapisanymi zmianami (`beforeunload`).
- Testy: akcja (kolejność sprawdzeń, rola VIEWER odrzucona, wariant z innego projektu odrzucony, konflikt) i czyste funkcje edycji stanu (`addEntry` / `updateEntry` / `removeEntry` w `src/lib/bmc/state.ts`).
- Polling stanu (spec §8) zostaje na krok 8 (współdzielenie). Bez innych edytorów konflikt powstaje tylko przy dwóch kartach i obsługuje go `version`.

---

## Decyzje

| | Pytanie | Decyzja |
|---|---|---|
| D1 | Dostęp osoby spoza projektu do `/projekty/[id]` | **404**: nie zdradza, że projekt istnieje. |
| D2 | Jeden wariant główny na projekt | **Częściowy indeks unikalny** w bazie (dopisany do SQL migracji, jeśli Prisma nie obsługuje go natywnie). Po dopisaniu sprawdzić, czy kolejne `migrate dev` nie próbuje go usunąć i nie zgłasza rozjazdu schematu; jeśli tak, zgłosić użytkownikowi. |
| D3 | Zapis płótna | **Jawny przycisk „Zapisz”** całego stanu z `version`. |
| D4 | Wpisy w bloku | **Zwykłe stringi**, zgodnie ze spec §4. |
| D5 | Limity wpisów | **30 wpisów na blok** i **150 wpisów łącznie** w stanie. Przy 500 znakach na wpis to najwyżej ok. 75 tys. znaków, czyli rozsądny rozmiar kontekstu dla agenta w kroku 3. Bez limitu łącznego byłoby 9 × 30 = 270 wpisów. |
| D6 | Edycja i usuwanie projektu | **Edycja nazwy i opisu (OWNER) w PR 2a.** Usuwanie projektu w `docs/zadania.md`. |
| D7 | Testy komponentów React | **Bez testów komponentów i bez nowych zależności.** Testujemy logikę (schematy, uprawnienia, zapytania, akcje). |

## Weryfikacja (każdy PR)

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- `npx prisma migrate dev` na kontenerze `db`. Bez `migrate reset` bez zgody użytkownika (usuwa dane).
- Ręcznie przez `npm run start`:
  - **2a:** tworzenie projektu, lista, edycja nazwy i opisu; obcy projekt daje 404; bez sesji przekierowanie na `/logowanie`.
  - **2b:** nowy projekt ma pusty wariant główny, płótno jest widoczne.
  - **2c:** zapis, odświeżenie, wpisy zostają; przy dwóch kartach drugi zapis dostaje komunikat o konflikcie.
- Każdy PR zatrzymuje się po otwarciu i czeka na review. Niczego nie usuwamy (gałęzi, stashy, danych testowych, kontenerów) bez wyraźnej zgody użytkownika.
