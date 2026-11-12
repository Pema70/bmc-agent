# Zadania na później

Rzeczy świadomie odłożone. Każda pozycja to osobny, mały PR po uzgodnieniu planu.

## Bezpieczeństwo i konta

- **Limit prób logowania.** Ograniczenie liczby nieudanych logowań (na e-mail i na adres IP), ochrona przed zgadywaniem haseł.
- **Reset hasła i weryfikacja e-maila.** Wymagają wysyłki wiadomości e-mail (dostawca do wyboru, nowa zależność do akceptacji).
- **Projekt bez właściciela po usunięciu konta.** `ProjectMember.user` ma `onDelete: Cascade`: usunięcie użytkownika usuwa jego członkostwa, w tym rolę OWNER, a projekt zostaje bez właściciela. Do rozwiązania przed dodaniem funkcji usuwania konta (np. blokada usunięcia konta, które jest jedynym właścicielem projektu, albo przekazanie własności).
- **Ochrona przed prompt injection z załączników.** Treść załączników wstawiana do promptu tylko w oznaczonych blokach danych, prompt systemowy mówi wprost, że to dane, nie polecenia (spec §7). Do tego testy na przykładowych złośliwych treściach.

## Projekty

- **Usuwanie projektu (OWNER).** Kaskadowo usuwa członkostwa, warianty i dalsze dane projektu, więc wymaga potwierdzenia w interfejsie (np. wpisanie nazwy projektu).
- **Ręczny indeks częściowy `BmcVariant_projectId_main_key` (D2).** Dopisany ręcznie do SQL migracji `bmc_variant`, bo Prisma 7.10 obsługuje indeksy częściowe tylko w preview (`partialIndexes`). Gdy funkcja będzie stabilna, przenieść go do `schema.prisma` i sprawdzić, że `migrate diff` jest pusty.
- **Uzupełnienie wariantów głównych przy wdrożeniu produkcyjnym.** Projekty utworzone przed PR 2b nie mają wariantu głównego (na dev to tylko dane testowe). Przed pierwszym wdrożeniem produkcyjnym, jeśli takie projekty będą istnieć, dodać jednorazowe uzupełnienie pustego „Wariantu głównego”.

## Edytor BMC

- **Ostrzeżenie przy nawigacji wewnątrz aplikacji.** Znane ograniczenie z PR 2c: `beforeunload` łapie tylko zamknięcie karty, odświeżenie i wpisanie adresu. Nie łapie nawigacji wewnątrz aplikacji, więc kliknięcie np. „← Wszystkie projekty” przy niezapisanych zmianach gubi je bez ostrzeżenia. Ostrzeżenie dla linków wewnętrznych (przechwytywanie nawigacji App Routera) to osobna, większa zmiana.

- **Duplikaty wpisów w bloku a propozycje agenta.** Wpisy to zwykłe stringi (spec §4, D4), więc użytkownik może ręcznie wpisać dwa identyczne wpisy w jednym bloku. Propozycje EDIT i REMOVE (PR 3c) wskazują wpis tekstem `before`, więc dotyczą pierwszego pasującego i nie da się wskazać drugiego duplikatu. Propozycja ADD identycznego wpisu jest odrzucana (agent dostaje `ok: false` i może ją poprawić). Do rozważenia: unikalne id wpisów albo blokada duplikatów przy zapisie płótna.

- **Kosmetyka: przycisk „Analizuj wpływ”.** W wąskiej kolumnie karty propozycji przycisk zawija się do dwóch wierszy. Do poprawy układu przycisków na karcie (np. zawijanie rzędu przycisków lub krótsza etykieta).

## Dokumentacja i narzędzia

- **Ujednolicenie końców linii (`.gitattributes`).** Na Windows Git zamienia LF na CRLF, przez co np. `prisma/migrations/migration_lock.toml` pokazuje się jako zmieniony mimo pustego `git diff`. Dodać `.gitattributes` (np. `* text=auto eol=lf`) i sprawdzić, że nie zmienia sum kontrolnych zastosowanych migracji.

- **Brak Prettiera.** W projekcie nie ma Prettiera (ani w `package.json`, ani w `node_modules`), formatowanie pilnuje wyłącznie ESLint. Dodanie Prettiera to nowa zależność, więc wymaga zgody.

- **Aktualizacja sekcji „Komendy” w `CLAUDE.md`** do faktycznych skryptów z `package.json` (np. `typecheck` to `next typegen && tsc --noEmit`, `test:watch`, `postinstall: prisma generate`, port bazy 5433). Zrobione w PR `docs/porzadki-po-kroku-3`.

- **Wspólny helper przepływu LLM.** `runEvaluation`, `runImpactAnalysis` i (w kroku 6) kolejne funkcje powielają ten sam przepływ: odczyt wariantu, limity, kontrola minimalnej zawartości, model, `safeParse`, log, zapis, mapowanie błędów. Wydzielić wspólny helper na początku kroku 6 (D8 z `docs/plan-krok-5.md`), zanim powstaną trzecia i czwarta kopia.

## Dane testowe i środowisko dev

- **Dane testowe z kroku 4b w lokalnej bazie dev.** Konto `ocena-test@example.com` (hasło `!`, nie da się na nie zalogować), projekt „TEST ocena 4b (dane przykładowe)” z jedną oceną AI. Do usunięcia dopiero po zgodzie właściciela repozytorium (kasowanie kaskadowe: projekt, wariant, ocena, wiersze logów powiązane przez użytkownika).
- **Różnica modelu dev.** Plan kroku 3 zakładał `gemini-3.8-flash`, w praktyce lokalnie używany jest `gemini-3.5-flash-lite`. Ujednolicić (`LLM_MODEL`, sprawdzić nazwę w dokumentacji dostawcy) przed testami porównawczymi, żeby wyniki ocen i kosztów dało się porównywać.

## Agent AI

- **Agent dopytuje zbyt często i w kółko.** Zauważone po kroku 3 przy ręcznych próbach. Do poprawy w prompcie systemowym (`src/lib/ai/prompts`, podbić `PROMPT_VERSION`): najwyżej jedno lub dwa pytania naraz, bez powtarzania pytań, na które użytkownik już odpowiedział, a po dwóch turach pytań agent ma zaproponować wpisy z jawnie podanymi założeniami (`propose_block_change`) zamiast dopytywać dalej. Pomiar przed i po zmianie: liczba wywołań `ask_clarification` na rozmowę (oraz liczba tur pytań z rzędu) na stałym zestawie kilku scenariuszy rozmów, uruchamianym ręcznie tym samym modelem; wyniki zapisać do porównania w rozdziale testowym pracy. Testy automatyczne nadal tylko na mockach.

- **Narzędzie do odczytu zapisanej oceny.** Dziś `evaluate_bmc` zwraca modelowi tylko `{ ok, evaluationId }` (agent nie zna punktów), więc agent nie potrafi odpowiedzieć na pytanie „dlaczego innowacyjność dostała 5?”. Możliwe rozszerzenie: osobne narzędzie tylko do odczytu (np. `get_latest_evaluation`), bez argumentów od modelu, które czyta z bazy ostatnią zapisaną ocenę bieżącego wariantu (po `projectId` i `variantId` z serwera, uzasadnienia jako dane w oznaczonym bloku, nie jako polecenia) i zwraca ją agentowi. Do rozważenia razem z wpływem na koszty tokenów i ochroną przed prompt injection z uzasadnień.
- **Agent uruchomił ocenę od nowa na pytanie o wyjaśnienie oceny.** Zauważone przy ręcznych próbach po kroku 4d: na pytanie o uzasadnienie wyniku agent zawołał `evaluate_bmc` zamiast wyjaśnić istniejącą ocenę (niechciane zużycie limitu). Do poprawy: prompt (podbić `PROMPT_VERSION`; narzędzie tylko na prośbę o NOWĄ ocenę, nie o wyjaśnienie) oraz narzędzie tylko do odczytu zapisanej oceny (opis wyżej). Pomiar przed i po zmianie: liczba niechcianych ocen na rozmowę, na stałym zestawie scenariuszy uruchamianym ręcznie tym samym modelem; wyniki zapisać do rozdziału testowego.
- **Ograniczenia narzędzia `evaluate_bmc` (krok 4d).**
  - Ocena w ostatnim kroku tury (przy `MAX_STEPS=3` trzeci krok) nie zostawia miejsca na końcowe zdanie agenta. Karta wyniku i tak się pokazuje. Do rozważenia `prepareStep` wyłączające narzędzia w ostatnim kroku (zmienia zachowanie wszystkich narzędzi, więc osobny PR z testami).
  - Przekroczenie limitu zapytań o 1 wiersz: wiersz `chat` jest zapisywany na końcu tury, więc ocena w środku tury widzi licznik bez niego. To ta sama nieatomowość co w `checkUserLimits` (D6 z kroku 3).
  - Tura z oceną zużywa 2 wiersze `LlmCallLog` (`chat` i `evaluate_bmc`) i 3-4 wywołania modelu (przy `MAX_STEPS=3`), więc szybciej wyczerpuje `CHAT_MAX_REQUESTS_PER_HOUR` i limit tokenów.
- **`EVALUATION_MAX_OUTPUT_TOKENS`.** Ewentualna osobna zmienna z limitem tokenów wyjściowych dla oceny, gdyby pojawił się status `TRUNCATED` (dziś ocena zużywa ok. 400 z 2000 tokenów, więc niepotrzebna). Nie podnosić `LLM_MAX_OUTPUT_TOKENS` czatu.
- **Ręczna ocena referencyjna (krok 4e) odłożona.** Formularz oceny ręcznej (`source = MANUAL`, nakładka na radarze, różnice w punktach) zrobić w przygotowaniach do testów porównawczych, przed krokiem 10. Kolumna `source` jest już w schemacie.
- **Agent a wynik analizy i narzędzia.** Zauważone po PR 5d. Na prośbę „wyjaśnij mi ten wynik” agent nie ma wyniku analizy (narzędzie zwraca mu tylko `analysisId`, a analiza z panelu nie trafia do historii czatu), więc zaproponował nową zmianę zamiast powiedzieć, że szczegóły są na karcie. Wspomniał też nazwę `analyze_impact` i surowe id propozycji oraz kazał użytkownikowi „skorzystać z narzędzia”. Do poprawy w prompcie (podbić `PROMPT_VERSION`): przy pytaniu o wynik analizy lub oceny odsyłaj do karty i panelu, nie proponuj nowych zmian, nigdy nie podawaj nazw narzędzi ani identyfikatorów, opisując propozycję trzymaj się jej faktycznej treści. Scenariusze do pomiaru przed i po: „wyjaśnij wynik analizy”, „dodaj wpis” (bez analizy), „oceń model”. Do rozważenia osobno: narzędzie tylko do odczytu zapisanych wyników (tekst modelu wracałby do modelu jako dane, ryzyko prompt injection).
