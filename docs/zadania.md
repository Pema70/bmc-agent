# Zadania na później

Rzeczy świadomie odłożone. Każda pozycja to osobny, mały PR po uzgodnieniu planu.

## Bezpieczeństwo i konta

- **Limit prób logowania.** Ograniczenie liczby nieudanych logowań (na e-mail i na adres IP), ochrona przed zgadywaniem haseł.
- **Reset hasła i weryfikacja e-maila.** Wymagają wysyłki wiadomości e-mail (dostawca do wyboru, nowa zależność do akceptacji).
- **Projekt bez właściciela po usunięciu konta.** `ProjectMember.user` ma `onDelete: Cascade`: usunięcie użytkownika usuwa jego członkostwa, w tym rolę OWNER, a projekt zostaje bez właściciela. Do rozwiązania przed dodaniem funkcji usuwania konta (np. blokada usunięcia konta, które jest jedynym właścicielem projektu, albo przekazanie własności).
- **Ochrona przed prompt injection z załączników.** Treść załączników wstawiana do promptu tylko w oznaczonych blokach danych, prompt systemowy mówi wprost, że to dane, nie polecenia (spec §7). Do tego testy na przykładowych złośliwych treściach.

## Projekty

- **Usuwanie projektu (OWNER).** Kaskadowo usuwa członkostwa, warianty i dalsze dane projektu, więc wymaga potwierdzenia w interfejsie (np. wpisanie nazwy projektu).

## Dokumentacja i narzędzia

- **Aktualizacja sekcji „Komendy” w `CLAUDE.md`** do faktycznych skryptów z `package.json` (np. `typecheck` to `next typegen && tsc --noEmit`, `test:watch`, `postinstall: prisma generate`, port bazy 5433).
