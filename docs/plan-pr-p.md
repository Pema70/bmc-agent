# Plan PR „P”: poprawki promptu agenta (chat-v5) z pomiarem przed i po

**Zaakceptowany (2026-11-18), decyzje D1–D5 rozstrzygnięte przez właściciela repozytorium (sekcja „Decyzje”); poprawiony 2026-11-19 po próbnej rozmowie (sekcja „Stan wyjściowy i warunki wstępne”).** Ten plik to jedyna zmiana w pierwszym kroku (`docs/`). Kod i prompt (`chat-v4`) bez zmian, dopóki nie ma wyników „przed”. Wszystkie serie „przed” muszą być skończone przed zmianą promptu (mogą być rozłożone na kilka dni, jeśli dzienny limit Gemini okaże się niski).

Zakres wynika z `docs/plan-krok-6.md`, „Zmiany po akceptacji”, punkty 4 i 11 (PR „P”: scenariusze o dopytywaniu, niechcianej ocenie, wyniku analizy i nazwach narzędzi; prompt `chat-v5`, baseline na `chat-v4`) oraz z wpisów sekcji „Agent AI” w `docs/zadania.md`:

- „Agent dopytuje zbyt często i w kółko”,
- „Agent a wynik analizy i narzędzia”,
- „Agent uruchomił ocenę od nowa na pytanie o wyjaśnienie oceny”,
- „`prepareStep` w ostatnim kroku tury” oraz punkt o ocenie w ostatnim kroku w „Ograniczenia narzędzia `evaluate_bmc`”.

**Poza zakresem (zostają w `zadania.md`):** narzędzie do odczytu zapisanej oceny/analizy (`get_latest_evaluation`), narzędzia czatu `generate_strategies` i `compare_variants`, wątki czatu per wariant, limity atomowe. PR „P” zmienia wyłącznie treść promptu (`chat-v5`) i, jeśli pomiar to uzasadni, `prepareStep`.

## Podział na kroki

1. **Ten plan** (`docs/plan-pr-p.md`), PR `docs/plan-pr-p`. Po akceptacji i merge.
2. **Pomiar „przed”** na `chat-v4`, dopiero po warunkach wstępnych (sekcja „Stan wyjściowy i warunki wstępne”, w tym krok 0b): wykonuje właściciel repozytorium przez interfejs (sekcje „Instrukcja pomiaru” i „Metryki”). Wyniki wpisuje do tabel i przekazuje.
3. **PR `feat/prompt-chat-v5`**: dopiero po wynikach „przed”. Prompt `chat-v5`, ewentualnie `prepareStep`, testy na mockach. Zakres zmian prompu wynika z tabeli wyników „przed”, nie z domysłów (szkic hipotez niżej).
4. **Pomiar „po”**: ten sam model, te same scenariusze i wiadomości, ta sama liczba powtórzeń. Wyniki do tabel i do rozdziału testowego pracy.
5. **Domknięcie**: wyniki „przed” i „po” w tym pliku (osobny commit `docs:`), aktualizacja wpisów w `docs/zadania.md` (wpisy zamknięte, dopisek o ewentualnym narzędziu odczytu).

## Stan wyjściowy i warunki wstępne (po próbnej rozmowie 2026-11-19)

**Warunki wstępne pomiaru „przed”** (wszystkie spełnione, zanim ruszy pierwsza seria):

1. Zapis odpowiedzi asystenta działa (PR #34, zmergowany). Do tego czasu każda odpowiedź kończyła się `SAVE_FAILED` (82 z 90 wierszy `chat`, od 2026-11-10).
2. Argumenty `propose_block_change` mają wymagane `before` i `after` (PR #35, zmergowany).
3. Krok 0b (niżej) przeszedł bez uwag.
4. Prompt pozostaje `chat-v4`, `MAX_STEPS=3` bez zmian. Prompt zmienia dopiero PR „P”.

**Skutek błędu zapisu dla wcześniejszych obserwacji.** Przed #34 agent nie widział własnych wypowiedzi (historia dla modelu to były same wiadomości użytkownika), więc obserwacje z wpisów „Agent AI” w `docs/zadania.md` (dopytywanie w kółko, wyjaśnianie wyniku analizy, niechciane oceny) były zebrane na zepsutej aplikacji. Nie są punktem odniesienia: baseline to dopiero pomiar „przed” po naprawach.

**Obserwacje z próbnej rozmowy** (`gemini-3.1-flash-lite`, projekt niepomiarowy; służą jako przykłady do metryk i hipotez, nie jako wyniki):

- **Przykład do M4 (wyciek identyfikatora):** na „Oceń mój model” agent odpowiedział: „Ocena Twojego modelu jest już gotowa (identyfikator: `cmwn…`). Możesz ją zobaczyć na karcie powyżej.”. Prompt `chat-v4` zakazuje podawania punktów, ale mówi też „Wynik zawiera tylko identyfikator oceny”, co zachęca do jego powtórzenia. Hipoteza dla `chat-v5`: wprost zakazać podawania identyfikatora i nie wspominać o nim w opisie wyniku narzędzia.
- **Przykład do hipotez `chat-v5` („karta powyżej”):** agent napisał „na karcie powyżej”, a prompt mówi „na karcie pod Twoją odpowiedzią”. Agent miał rację: części wiadomości są renderowane w kolejności (`agent-chat.tsx`), więc karta narzędzia jest nad tekstem końcowym. To nieścisłość promptu, a nie błąd modelu. Hipoteza dla `chat-v5`: „na karcie w tej wiadomości”.
- **Błąd argumentów (naprawiony w #35, mierzony w M9):** `propose_block_change` z `operation: "add"` bez `before` i `after` dał `AI_InvalidToolInputError` (część `output-error`), po czym agent poprawił wywołanie w kolejnym kroku. W metryce M9 sprawdzamy, czy po #35 Gemini podaje `before: null`.
- **Osierocona wiadomość użytkownika zmienia zachowanie agenta.** Dwie tury zakończyły się `ABORTED` (po ok. 26–35 s), po czym w historii zostały wiadomości użytkownika bez odpowiedzi, a następna odpowiedź agenta dotyczyła wcześniejszej, nieobsłużonej prośby, a nie bieżącej wiadomości „Dziękuję”. Oznacza to, że niechciana propozycja na „Dziękuję” w tej próbie nie dowodzi nadgorliwości modelu (M10 trzeba czytać razem z Q1c: tura po turze bez `ABORTED`). Czasy `ABORTED` kończą się 2–3 s przed kolejną wiadomością, co wskazuje na kliknięcie „Zatrzymaj” (wniosek z czasów, nie z logów).
- **Interfejs czatu nie pozwala wysłać drugiej wiadomości w trakcie odpowiedzi** (`src/components/chat/agent-chat.tsx`): `send()` kończy się, gdy `busy`, a przycisk „Wyślij” jest wyłączony. Pole tekstowe pozostaje edytowalne, ale Enter w trakcie odpowiedzi nic nie wysyła. Przerwane tury biorą się więc z „Zatrzymaj”, zamknięcia lub odświeżenia strony, a nie z podwójnego wysyłania. Osierocenie wiadomości po przerwaniu to osobny wpis w `docs/zadania.md`; nie blokuje pomiaru, bo protokół (niżej) zabrania przerywania i unieważnia każdą turę bez statusu `OK`.
- **Czasy odpowiedzi są niestabilne**: od ok. 9 s do ponad 90 s dla jednokrokowej tury (ponowienia dostawcy wchodzą w `durationMs`). Czas nie jest metryką jakości; nie przerywaj odpowiedzi, czekaj na zakończenie.
- **Jedna tura bez wiersza w dzienniku** (wiadomość użytkownika bez odpowiedzi i bez wpisu w `LlmCallLog`): prawdopodobnie przerwane żądanie (restart serwera lub zamknięcie karty), nie wyjaśnione. Dlatego w trakcie serii nie restartujemy `npm run dev` i nie zamykamy ani nie odświeżamy karty z czatem.

## Warunki pomiaru (stałe dla „przed” i „po”)

- **Model stały: `gemini-3.5-flash-lite`** (`LLM_PROVIDER=google`). Właściciel ustawia go w `.env` przed pierwszą serią „przed” i nie zmienia do końca serii „po”. Poza pomiarami może używać `gemini-3.1-flash-lite`, ale tylko w projektach niepomiarowych (nazwy `P-przed-…` i `P-po-…` są zarezerwowane dla pomiarów). Używany model zapisuje kolumna `model` w `LlmCallLog`; zapytania Q1 filtrują po `model`, a kontrola Q1b sprawdza, że w projektach pomiarowych nie ma wierszy z innym modelem ani innym `promptVersion` (`chat-v4` w „przed”, `chat-v5` w „po”). Seria z choćby jednym obcym wierszem jest nieważna.
- **Plan Gemini (stały warunek): płatny.** Od 2026-11-20 klucz działa na płatnym planie Gemini API (przejście przed pierwszą ważną serią), więc „przed” i „po” idą na tym samym planie. Zmiana planu w trakcie pomiarów (np. powrót na darmowy) unieważnia porównanie, bo zmieniają się limity i zachowanie dostawcy (503, 429). Właściciel wpisuje datę przejścia i bieżące limity z AI Studio w tabeli w sekcji „Budżet”.
- Dane: wyłącznie przykładowe (niżej). Żadnych prawdziwych danych firmy ani osobowych, także na płatnym planie.
- Ustawienia `.env`: poza limitami z D3 bez zmian względem codziennej pracy. `MAX_STEPS=3`, `LLM_MAX_OUTPUT_TOKENS=2000` zostają. Limity z D3 (**te same wartości w seriach „przed” i „po”**): `CHAT_MAX_REQUESTS_PER_HOUR=60`, `CHAT_MAX_TOKENS_PER_DAY=600000`. **Po zakończeniu wszystkich pomiarów przywróć wartości domyślne** (`CHAT_MAX_REQUESTS_PER_HOUR=30`, `CHAT_MAX_TOKENS_PER_DAY=200000`, jak w `.env.example`).
- Nie czytam ani nie modyfikuję `.env` i nie ładuję go żadnym skryptem; zmiany w `.env` wykonuje właściciel.
- Tryb: `npm run dev` (do pomiaru wystarczy). Nie uruchamiam niczego, co ładuje `.env`; pomiar wykonujesz Ty w przeglądarce i w `psql`.
- Powtórzenia: **3 serie** (N=3) wszystkich scenariuszy (model jest niedeterministyczny; jedna seria nie odróżni poprawy od szumu). Wyniki raportuj osobno dla każdej serii, nie tylko średnią.
- Wiadomości wpisuj **dosłownie** jak niżej (kopiuj i wklej). Kolejność scenariuszy i serii taka sama w „przed” i w „po”.

### Nieważne próby serii „przed” (2026-11-20) i nowe konto pomiarowe

Pierwsze próby serii „przed” (na poprzednim koncie) zostały wykonane **przez pomyłkę na innym modelu niż `gemini-3.5-flash-lite`** i trafiły na błędy dostawcy **503**. Naruszają warunki pomiaru (model stały, status `OK`), więc są **nieważne i nie wchodzą do żadnej tabeli ani metryki**.

- Projekty nieważne: `P-przed-…` (faza `przed`, Q0 uruchomione na poprzednim koncie); część mogła zostać użyta, reszta zostaje nieużyta. Zostają w bazie (nic nie jest kasowane); są surowymi danymi.
- Przyczyna: zły model w `.env` (pomyłka właściciela) oraz 503 po stronie dostawcy; przejście na płatny plan Gemini (patrz „Warunki pomiaru”) ma ograniczyć 503 na ważnych seriach.
- Z dziennika (`LlmCallLog`, projekty `P-przed-%`): model **`gemini-3.1-flash-lite`** (zamiast `gemini-3.5-flash-lite`), 5 wierszy od 2026-11-20 15:35:06 do 15:41:17, w tym **3 ze statusem innym niż `OK`**. Model `gemini-3.1-flash-lite` jest dozwolony poza pomiarami, ale w projektach pomiarowych narusza warunek stałego modelu.
- **Nowe konto pomiarowe** (wszystkie ważne serie „przed” i „po” na tym jednym koncie; e-mail wpisujesz tylko w `psql`, nie w plikach). Limity aplikacji liczą się per użytkownik, więc oddzielne konto odcina też zużycie z prób.
- **Nowa seria „przed” zaczyna się od zera** w projektach `P-przed2-…` (Q0 z `\set faza 'przed2'`), na `gemini-3.5-flash-lite`, płatnym planie, `chat-v4`. Ważne serie „przed”: `P-przed2-*-seria1`, `-seria2`, `-seria3`.

**Rozdział nazw (ważne dla zapytań):** zapytania kontrolne wybierają projekty po prefiksie. Prefiks `P-przed2-` nie pokrywa się z `P-przed-` (wzorzec `P-przed-%` nie łapie nazw `P-przed2-…`, a `P-przed2-%` nie łapie prób nieważnych), więc kontrole Q1b i Q1c nie zmieszają projektów nieważnych z ważnymi. Zapytania mają zmienną `:'prefiks'`: w „przed” `P-przed2-`, w „po” `P-po-`. Zasada dla nowych faz: nazwa fazy nie może być prefiksem innej (stąd `przed2`, a nie `przed-powt1`).

**Uwagi z wykonania serii 1 (`P-przed2-*-seria1`):** w S1 agent złożył propozycję już w turze 2 (po wiadomościach 1 i 2 ze skryptu), więc scenariusz miał się tam skończyć. Właściciel po ok. 10 minutach przez pomyłkę wpisał jeszcze „Dodaj do kanałów: dostawa przez aplikację mobilną.” (wiadomość z S2). Ta wiadomość i odpowiedź na nią są **poza skryptem i nie wchodzą do metryk, wywołań ani tokenów**, a tury 1–2 pochodzą sprzed niej, więc **S1 seria 1 jest ważna** (korekta wcześniejszej oceny „nieważna”, która błędnie zakładała stałe 5 tur; reguła zakończenia w opisie S1 została doprecyzowana). S1, S2, S3S5 i S4 seria 1 są ważne (Q6: wszystkie wiersze `OK`, model `gemini-3.5-flash-lite`, prompty `chat-v4`/`evaluate-v1`/`impact-v1`; Q5: brak wiadomości osieroconych). Powtórki scenariuszy (faza `przed2-r1`) nie są potrzebne.

### Dane przykładowe: projekt „Kawiarnia Ziarno (dane przykładowe)”

Opis projektu: `Kawiarnia w centrum miasta (dane przykładowe).`

Wypełniony model (do scenariuszy S2–S5):

| Blok | Wpisy |
|---|---|
| Segmenty klientów | Studenci okolicznych uczelni; Pracownicy biurowi z centrum |
| Propozycja wartości | Świeżo palona kawa speciality w cenie sieciówki; Szybkie zamówienie z odbiorem na miejscu |
| Kanały | Lokal stacjonarny; Strona zamówień online |
| Relacje z klientami | Karta lojalnościowa; Profil w mediach społecznościowych |
| Strumienie przychodów | Sprzedaż napojów i wypieków; Sprzedaż kawy w ziarnach |
| Kluczowe zasoby | Ekspres ciśnieniowy i młynek; Wykwalifikowani bariści |
| Kluczowe działania | Przygotowanie kawy; Obsługa klientów w lokalu |
| Kluczowi partnerzy | Lokalna palarnia; Piekarnia dostarczająca wypieki |
| Struktura kosztów | Czynsz za lokal; Wynagrodzenia baristów; Zakup ziarna |

Scenariusz S1 używa projektu z tym samym opisem i **pustym** modelem.

### Izolacja serii (D2)

Historia czatu jest jedna na projekt, więc rozmowa z poprzedniej serii zmieniałaby zachowanie agenta. **Wariant A (D2): osobny projekt na każdą kombinację faza × scenariusz × seria, nic nie jest kasowane.** Rozmowy zostają jako surowe dane do pracy. Projektów jest 4 scenariusze × 3 serie = **12 na fazę** (S3 i S5 w jednym projekcie `S3S5`), nazwy w **ważnej** serii „przed”: `P-przed2-S1-seria1`, `P-przed2-S2-seria1`, `P-przed2-S3S5-seria1`, `P-przed2-S4-seria1`, … `P-przed2-S4-seria3`; w fazie „po” prefiks `P-po-` (`P-po-S1-seria1` itd.). Nazwy `P-przed-…` (bez `2`) to projekty nieważne (patrz wyżej). Projekty z prefiksem `P-` są zarezerwowane dla pomiarów (wyjątek: projekty próbne `P-proba-…` z kroku 0b, których Q1b i Q1c nie obejmują).

Projekty zakłada zapytanie Q0 (niżej), a nie ręczne wpisywanie.

#### Q0: założenie 12 projektów pomiarowych dla jednej fazy

Uruchamiane przez Ciebie w `psql` (`docker compose exec db psql -U bmc -d bmc_dev`, dane z `docker-compose.yml`). Bez skryptów Node, bez `.env`. Zapytanie tylko **dodaje** wiersze (`Project`, `ProjectMember` z rolą OWNER, `BmcVariant` z `isMain = true` i nazwą „Wariant główny”), niczego nie zmienia ani nie kasuje. Jedno polecenie `INSERT` to jedna transakcja, a klucze obce są sprawdzane na jego końcu. Wariant główny ma `version = 1`, `origin = MANUAL` (domyślne), więc częściowy indeks `BmcVariant_projectId_main_key` jest zachowany (jeden wariant główny na projekt). Identyfikatory generuje baza w formacie podobnym do cuid (`c` + 24 znaki), bo Prisma nadaje je po stronie klienta, a nie w bazie. S1 dostaje pusty model, pozostałe model „Kawiarni Ziarno”.

Zabezpieczenia: bez konta o podanym e-mailu nie powstanie nic (żadnych projektów bez właściciela); projekt o tej samej nazwie, w którym jesteś członkiem, nie zostanie założony drugi raz (można uruchomić ponownie bez duplikatów).

**Najpierw próba:** uruchom z `ROLLBACK` w ostatniej linii, sprawdź liczby, potem powtórz z `COMMIT`. Zapytania nie uruchamiałem (nie łączę się z bazą i nie ładuję `.env`), więc próba z `ROLLBACK` jest obowiązkowa. W `psql` ustaw wcześniej kodowanie (polskie znaki): `\encoding UTF8` (w terminalu Windows ewentualnie `chcp 65001`). Wstaw swój e-mail tylko w `psql`.

```sql
\set email 'TWÓJ_E-MAIL'
-- ważna seria „przed”: 'przed2'; seria „po”: 'po' (nie używaj 'przed': to faza prób nieważnych na poprzednim koncie)
\set faza 'przed2'

BEGIN;

WITH u AS (
  SELECT id FROM "User" WHERE email = :'email'
),
spec AS (
  SELECT s.kod, n.seria
  FROM (VALUES ('S1'), ('S2'), ('S3S5'), ('S4')) AS s(kod)
  CROSS JOIN generate_series(1, 3) AS n(seria)
),
nowe AS MATERIALIZED (
  SELECT
    'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) AS pid,
    'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) AS vid,
    'P-' || :'faza' || '-' || spec.kod || '-seria' || spec.seria AS nazwa,
    spec.kod,
    u.id AS uid
  FROM spec CROSS JOIN u
  WHERE NOT EXISTS (
    SELECT 1 FROM "Project" p JOIN "ProjectMember" m ON m."projectId" = p.id
    WHERE m."userId" = u.id
      AND p.name = 'P-' || :'faza' || '-' || spec.kod || '-seria' || spec.seria
  )
),
p AS (
  INSERT INTO "Project" (id, name, description, "updatedAt")
  SELECT pid, nazwa, 'Kawiarnia w centrum miasta (dane przykładowe).', now() FROM nowe
  RETURNING id
),
m AS (
  INSERT INTO "ProjectMember" ("projectId", "userId", role)
  SELECT pid, uid, 'OWNER' FROM nowe
  RETURNING "projectId"
)
INSERT INTO "BmcVariant" (id, "projectId", name, "isMain", state, "updatedAt")
SELECT vid, pid, 'Wariant główny', true,
  CASE WHEN kod = 'S1' THEN
    '{"customer_segments":[],"value_propositions":[],"channels":[],"customer_relationships":[],"revenue_streams":[],"key_resources":[],"key_activities":[],"key_partnerships":[],"cost_structure":[]}'::jsonb
  ELSE
    '{"customer_segments":["Studenci okolicznych uczelni","Pracownicy biurowi z centrum"],
      "value_propositions":["Świeżo palona kawa speciality w cenie sieciówki","Szybkie zamówienie z odbiorem na miejscu"],
      "channels":["Lokal stacjonarny","Strona zamówień online"],
      "customer_relationships":["Karta lojalnościowa","Profil w mediach społecznościowych"],
      "revenue_streams":["Sprzedaż napojów i wypieków","Sprzedaż kawy w ziarnach"],
      "key_resources":["Ekspres ciśnieniowy i młynek","Wykwalifikowani bariści"],
      "key_activities":["Przygotowanie kawy","Obsługa klientów w lokalu"],
      "key_partnerships":["Lokalna palarnia","Piekarnia dostarczająca wypieki"],
      "cost_structure":["Czynsz za lokal","Wynagrodzenia baristów","Zakup ziarna"]}'::jsonb
  END,
  now()
FROM nowe;

-- Kontrola: powinno być 12 wierszy dla fazy (przy pierwszym uruchomieniu), po jednym wariancie głównym.
SELECT p.name, p.id AS id_projektu, m.role AS rola,
       (SELECT count(*) FROM "BmcVariant" v WHERE v."projectId" = p.id AND v."isMain") AS warianty_glowne,
       (SELECT sum(jsonb_array_length(e.value))
          FROM "BmcVariant" v, jsonb_each(v.state) e
         WHERE v."projectId" = p.id AND v."isMain") AS wpisow_w_modelu
FROM "Project" p
JOIN "ProjectMember" m ON m."projectId" = p.id
WHERE m."userId" = (SELECT id FROM "User" WHERE email = :'email')
  AND p.name LIKE 'P-' || :'faza' || '-%'
ORDER BY p.name;

ROLLBACK;  -- po próbie zamień na COMMIT i uruchom całość ponownie
```

Oczekiwane w kontroli: 12 wierszy, `warianty_glowne = 1`, `rola = OWNER`, `wpisow_w_modelu` równe **0 dla S1 i 19 dla S2, S3S5 i S4** (osiem bloków po 2 wpisy i struktura kosztów z 3). Jeśli zapytanie zgłosi błąd kolumny (np. brak `origin` lub inna nazwa), nie poprawiaj ręcznie: wklej mi komunikat. Dla fazy „po” ustaw `\set faza 'po'` i powtórz (najlepiej tuż przed pomiarem „po”).

Sprawdź też, że w wynikach Q0 polskie znaki wyglądają poprawnie: `SELECT state->'customer_segments' FROM "BmcVariant" v JOIN "Project" p ON p.id = v."projectId" WHERE p.name = 'P-przed2-S2-seria1';` (po `COMMIT`).

## Scenariusze (stały zestaw)

Oznaczenia: `U:` wiadomość użytkownika (wpisz dosłownie), `UI:` akcja w interfejsie, `Oczekiwane` to zachowanie wzorcowe do oceny (nie wpływa na to, co wpisujesz). Po każdej turze poczekaj na koniec odpowiedzi i kartę wyniku (jeśli jest).

### S1. Dopytywanie (pusty model)

Skrypt odpowiedzi jest **stały i niezależny od pytań agenta** (żeby seria „przed” i „po” dostały to samo). Wpisuj kolejne wiadomości ze skryptu, aż agent złoży pierwszą propozycję (`propose_block_change`) albo skończą się wiadomości (maks. 5 tur użytkownika); po pierwszej propozycji scenariusz się kończy i nie wpisujesz niczego więcej. Odpowiedź tekstowa z pytaniem, ale bez narzędzia, nie kończy scenariusza (w `chat-v4` agent często pyta zwykłym tekstem zamiast przez `ask_clarification`).

1. `U: Chcę otworzyć kawiarnię. Pomóż mi zbudować model biznesowy.`
2. `U: Kawiarnia w centrum dużego miasta, kawa i proste śniadania.`
3. `U: Nie mam jeszcze więcej szczegółów.`
4. `U: To wszystko, co na razie wiem.`
5. `U: Zaproponuj wpisy na podstawie tego, co napisałem.`

Oczekiwane (`chat-v5`): najwyżej dwie tury pytań z rzędu, bez powtarzania pytań o to, co już padło, potem propozycje z jawnie nazwanymi założeniami. Wartości do zapisu: liczba `ask_clarification` na rozmowę, najdłuższa seria tur pytań z rzędu, czy i w której turze pojawiły się propozycje.

### S2. „Dodaj wpis” (model wypełniony)

1. `U: Dodaj do segmentów klientów: rodziny z dziećmi.`
2. `U: Dodaj do kanałów: dostawa przez aplikację mobilną.`
3. `U: Dziękuję.`

Oczekiwane: po jednej propozycji `propose_block_change` na turę, krótka odpowiedź bez ciężkich narzędzi; `evaluate_bmc` i `analyze_impact` nieużyte; w tekście brak nazw narzędzi i identyfikatorów. Tura 3 („Dziękuję.”): krótka odpowiedź tekstowa, **bez żadnych narzędzi** (M10). Propozycji nie trzeba odrzucać ani zatwierdzać (projekt jest jednorazowy); nie zatwierdzaj ich, żeby nie zmieniać stanu modelu.

### S3. „Oceń model” (model wypełniony)

1. `U: Oceń mój model.`

Oczekiwane: dokładnie jedno wywołanie `evaluate_bmc`, odpowiedź w 1–2 zdaniach bez punktów, bez nazw narzędzi i identyfikatorów. Zapisz też, czy po karcie oceny agent napisał zdanie końcowe (patrz M6).

### S4. „Wyjaśnij wynik analizy” (model wypełniony)

1. `U: Dodaj do strumieni przychodów: subskrypcja kawy miesięczna.`
2. `UI:` na karcie propozycji z tury 1 kliknij „Analizuj wpływ” i poczekaj na wynik (tę analizę widać na karcie, ale agent jej nie widzi).
3. `U: Wyjaśnij mi wynik tej analizy.`

Oczekiwane: agent odsyła do karty analizy lub mówi wprost, że jej nie widzi, nie proponuje nowych zmian, nie wywołuje `analyze_impact`, nie podaje nazw narzędzi ani identyfikatorów. Propozycji nie zatwierdzaj.

### S5. Pytanie o uzasadnienie istniejącej oceny (ten sam projekt co S3, bezpośrednio po S3)

1. (ocena z S3 jest już zapisana i widoczna na karcie)
2. `U: Dlaczego Innowacyjność dostała taką ocenę?`

Oczekiwane: agent nie woła `evaluate_bmc` (ocena już istnieje), odsyła do karty oceny albo uczciwie mówi, że nie widzi szczegółów, bez wymyślania uzasadnienia punktów. Wartość do zapisu: liczba niechcianych `evaluate_bmc` w tej turze.

S3 i S5 to jedna rozmowa w jednym projekcie (S3 tura 1, S5 tura 2), po której dochodzi tura 3: `U: Dziękuję.` (oczekiwane: krótka odpowiedź tekstowa bez żadnych narzędzi, M10). W tabelach S3 i S5 liczone osobno.

## Metryki

| # | Metryka | Definicja | Jak odczytać |
|---|---|---|---|
| M1 | Pytania agenta na rozmowę: narzędzie i tekst | **narzędzie:** liczba części `tool-ask_clarification` w wiadomościach asystenta; **tekst:** liczba wiadomości asystenta, w których tekst kończy się pytaniem (ostatni znak `?`, ewentualnie po zamykającym nawiasie lub cudzysłowie). Raportowane osobno („narzędzie / tekst”), do oceny łącznie (S1 najważniejszy; w S2–S5 oczekiwane 0 obu) | Q5 (kolumny `ask` i `pyt_tekst`) |
| M2 | Tury pytań z rzędu | najdłuższy ciąg kolejnych wiadomości asystenta, z których każda ma pytanie: `ask_clarification` albo tekst kończący się pytaniem (kolumna `pyt` w Q5) | Q5 (kolumna `pyt` w kolejnych wierszach) |
| M3 | Niechciane `evaluate_bmc` / `analyze_impact` | wywołanie w turze, w której wiadomość użytkownika nie prosiła o ocenę/analizę (S2, S4 tura 3, S5 tura 2; w S3 oczekiwane jest dokładnie jedno `evaluate_bmc`) | Q2 (kolumny `ocena`, `analiza`) i zużycie limitu: Q1, wiersze `evaluate_bmc`/`analyze_impact` |
| M4 | Wycieki nazw narzędzi i identyfikatorów | w tekście asystenta pojawia się nazwa narzędzia (`ask_clarification`, `propose_block_change`, `evaluate_bmc`, `analyze_impact`), słowa `proposalId`, `evaluationId`, `analysisId` albo identyfikator w formacie cuid (np. `cm…`, 25 znaków) | zapytanie Q3 (automatyczne) plus oglądowo: zwroty typu „skorzystaj z narzędzia”, „użyj narzędzia” |
| M5 | Nowe propozycje na prośbę o wyjaśnienie | liczba propozycji w odpowiedzi na wiadomość „Wyjaśnij…” / „Dlaczego…” (S4 tura 3, S5 tura 2; oczekiwane 0): `propozycje_ok` + `propozycje_odrzucone` | Q2 |
| M6 | Tura z oceną bez zdania końcowego | w S3 tura 1: wiadomość asystenta z `tool-evaluate_bmc` bez żadnego niepustego tekstu po wyniku (kandydat do `prepareStep`) | Q2 (kolumna `tekst` pusta) |
| M7 | Zużycie | wiersze `LlmCallLog`, wywołania modelu, tokeny, czas | zapytanie Q1 |
| M8 | Opinia w skali 0/1/2 (ręcznie, opcjonalnie) | czy odpowiedź jest sensowna po polsku i zgodna z scenariuszem (0 źle, 1 częściowo, 2 dobrze) | własna ocena po przeczytaniu |
| M9 | Błędne wywołania narzędzi | liczba części `tool-…` ze `state: output-error` (głównie `propose_block_change` z niepoprawnymi argumentami: `AI_InvalidToolInputError`); osobno: propozycje odrzucone przez serwer (`output.ok = false`). Wskazuje, czy po #35 model podaje `before: null` i `after` | Q2 (kolumny `bledy_narzedzi`, `propozycje_odrzucone`) i Q1 (`stepCount` = `MAX_STEPS` oznacza zużyty budżet kroków) |
| M10 | Niechciane narzędzia po „Dziękuję.” | liczba części `tool-…` w odpowiedzi na turę „Dziękuję.” (S2 tura 3, S3S5 tura 3; oczekiwane 0). Czytać wyłącznie dla scenariuszy ważnych (Q1c: 0 wierszy, brak osieroconych wiadomości) | Q2 (kolumna `narzedzia_razem`) |

Wycieki (M4) liczysz w tekście widocznym dla użytkownika, nie w polu argumentów narzędzi. **Zasada dla Q3:** zapytanie czyta wyłącznie części `type = 'text'`. Identyfikatory w wynikach narzędzi (`output`), `thoughtSignature` i inne metadane dostawcy (`providerMetadata`, `callProviderMetadata`, `resultProviderMetadata`) to dane techniczne, a nie tekst dla użytkownika, więc nie są wyciekiem i Q3 ich nie obejmuje. Przykład z próbnej rozmowy: „(identyfikator: `cmwn…`)” w tekście odpowiedzi to wyciek M4.

## Instrukcja pomiaru krok po kroku (wykonuje właściciel)

Wymaga: działającej bazy (`docker compose up -d db`), `npm run dev`, klucza Gemini w `.env` (tak jak na co dzień). Plik `.env` nie jest przeze mnie czytany.

### Przygotowanie (raz)

0. **Krok 0: kształt części wiadomości z narzędziem.** Założenie zapytań Q2 i Q3 to typy części `tool-<nazwa>` w `ChatMessage.parts`. Sprawdź je przed pierwszą serią, na dowolnej istniejącej rozmowie, w której agent użył narzędzia (stare projekty testowe). Jedno zapytanie pokazuje wszystkie typy części, jakie występują w bazie, a drugie jedną wiadomość asystenta z narzędziem w pełnym kształcie:

   ```sql
   SELECT p->>'type' AS typ_czesci, count(*) AS ile
   FROM "ChatMessage" m, jsonb_array_elements(m.parts) p
   GROUP BY 1 ORDER BY 2 DESC;

   SELECT m.id, m."createdAt", jsonb_pretty(m.parts) AS parts
   FROM "ChatMessage" m
   WHERE m.role = 'ASSISTANT'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.parts) p WHERE p->>'type' LIKE 'tool-%')
   ORDER BY m."createdAt" DESC
   LIMIT 1;
   ```

   Wklej mi wynik obu zapytań **przed pierwszą serią** (bez treści wiadomości z danymi prywatnymi; to dane przykładowe). Oczekuję w pierwszym typów `text`, `tool-ask_clarification`, `tool-propose_block_change`, `tool-evaluate_bmc`, `tool-analyze_impact` (oraz ewentualnie `step-start`). Jeśli nazwy są inne, poprawię Q2, Q3 i metryki, zanim zaczniesz.
0b. **Krok 0b: próba po naprawach (po merge #34 i #35).** Jedna próba na `gemini-3.5-flash-lite` (ustawiony w `.env`, `npm run dev` zrestartowany) w **pełnym projekcie niepomiarowym** (model z co najmniej 5 wpisami w co najmniej 3 blokach; np. jeden z projektów z Q0 uruchomionego z `\set faza 'proba'` albo projekt wpisany ręcznie; projektów `P-przed-…` do tego nie używaj). Wpisz dosłownie, po kolei, czekając na koniec odpowiedzi (bez „Zatrzymaj”, bez odświeżania strony):
   1. `Dodaj do kanałów: dostawa przez aplikację mobilną.`
   2. `Oceń mój model.`

   Potem uruchom Q4 (przegląd tur) i Q1 dla tego projektu. Warunki zaliczenia:
   - brak części ze `state: output-error` (czyli Gemini podaje `before: null` i `after`),
   - powstaje część `tool-evaluate_bmc:output-available`, a karta oceny jest widoczna,
   - wszystkie wiersze `chat` w dzienniku mają status `OK`,
   - na konsoli `npm run dev` nie ma linii `[chat] Błąd wywołania modelu`.

   Wklej mi wynik Q4 i Q1. Jeśli któryś warunek nie jest spełniony, nie zaczynaj serii „przed”: opiszemy przyczynę i ewentualną naprawę osobnym PR-em (nie zmieniamy schematów ani promptu w trakcie pomiaru). Wynik próby nie wchodzi do tabel.
1. Potwierdź wersję promptu: w repozytorium `PROMPT_VERSION = "chat-v4"` (`src/lib/ai/prompts/system.ts`); `git status` czysty poza plikami, które już miałeś. W swoim `.env` ustaw `LLM_MODEL=gemini-3.5-flash-lite` i nie zmieniaj go do końca serii „po”.
2. Ustaw w `.env` limity z D3: `CHAT_MAX_REQUESTS_PER_HOUR=60`, `CHAT_MAX_TOKENS_PER_DAY=600000`, zrestartuj `npm run dev`. **Po zakończeniu wszystkich pomiarów (po serii „po”) wróć do domyślnych: 30 i 200000.** Te same wartości muszą obowiązywać w „przed” i „po”.
3. Zaloguj się na to samo konto we wszystkich seriach (limity liczą się per użytkownik).
4. Otwórz konsolę bazy w osobnym oknie: `docker compose exec db psql -U bmc -d bmc_dev` (dane logowania z `docker-compose.yml`, nie z `.env`). W `psql`: `\pset pager off`, `\x off`, `\encoding UTF8`.
5. Załóż projekty pomiarowe zapytaniem Q0 (próba z `ROLLBACK`, potem z `COMMIT`), `\set faza 'przed2'`. Z adresu projektu (`/projekty/<id>`) albo z kolumny `id_projektu` w kontroli Q0 weź `<id>`; wstawiasz go w zapytaniach w miejsce `ID_PROJEKTU`. Zapisz moment startu serii (`SELECT now();`).

### Pojedyncza seria (powtórz 3 razy)

6. Dla każdego scenariusza w kolejności S1, S2, S3+S5, S4: wejdź w odpowiedni projekt, wpisuj wiadomości dosłownie jak w scenariuszu, po każdej czekaj na koniec odpowiedzi (czasy bywają od kilku do ponad 90 s). Nie poprawiaj agenta, nie dopowiadaj niczego poza skryptem. **Nie klikaj „Zatrzymaj”, nie odświeżaj ani nie zamykaj karty z czatem, nie restartuj `npm run dev` w trakcie serii.**
7. Po zakończeniu scenariusza uruchom Q4 (czy nie ma niespodzianek), Q2 (lista tur) i Q3 (wycieki) dla jego projektu; zapisz wyniki w tabeli.
8. Po serii uruchom Q1 (zużycie) dla wszystkich projektów serii albo dla konta w oknie czasu serii oraz Q1c (**musi dać 0 wierszy**) i Q1b (**0 wierszy**).
9. **Unieważnianie scenariusza.** Scenariusz (projekt) jest nieważny, gdy w jego dzienniku jest wiersz o statusie innym niż `OK` (Q1c): `ABORTED`, `PROVIDER_RATE_LIMIT`/429, 503, `SAVE_FAILED`, `SCHEMA_ERROR` i każdy inny, albo gdy któraś wiadomość użytkownika została bez odpowiedzi asystenta. Nie liczysz go do metryk i nie powtarzasz tury w tym samym projekcie (osierocona wiadomość zostałaby w historii i zmieniła zachowanie agenta). Zapisz zdarzenie w kolumnie „Uwagi”, poczekaj na reset limitu, jeśli to był limit, i **powtórz cały scenariusz w świeżym projekcie**: Q0 z `\set faza 'przed2-r1'` (potem `przed2-r2` itd.) zakłada projekty `P-przed2-r1-S2-seria1` itd. (użyj potrzebnego, resztę zostaw nieużytą); prefiks `P-przed2-` obejmują Q1b i Q1c (zmienna `:'prefiks'`), więc obejmują też powtórzenia, a nie obejmują prób nieważnych. W tabelach wpisz, który projekt jest ważnym wynikiem danej serii.

### Zapytania (SQL)

Q1: zużycie (czat i narzędzia) dla projektu, tylko wiersze modelu pomiarowego:

```sql
SELECT "createdAt", operation, "promptVersion", model, status,
       "stepCount", "inputTokens", "outputTokens", "durationMs", "costUsd"
FROM "LlmCallLog"
WHERE "projectId" = 'ID_PROJEKTU'
  AND model = 'gemini-3.5-flash-lite'
ORDER BY "createdAt";
```

Q1b: kontrola ważności serii (wiersze z innym modelem lub promptem w projektach pomiarowych; **oczekiwany wynik: 0 wierszy**). Ustaw wcześniej `\set prefiks 'P-przed2-'` (w pomiarze „po”: `'P-po-'`) i zmień `chat-v4` na `chat-v5` w pomiarze „po”. Q2 i Q3 czytają `ChatMessage`, które nie ma kolumny `model`, więc ich poprawność wynika z izolacji projektów (wariant A) potwierdzonej przez Q1b:

```sql
SELECT p.name, l.operation, l.model, l."promptVersion", l.status, l."createdAt"
FROM "LlmCallLog" l
JOIN "Project" p ON p.id = l."projectId"
WHERE p.name LIKE :'prefiks' || '%'
  AND (l.model <> 'gemini-3.5-flash-lite' OR l."promptVersion" NOT IN ('chat-v4', 'evaluate-v1', 'impact-v1'))
ORDER BY l."createdAt";
```

Q1c: kontrola ważności scenariuszy (każdy wiersz `LlmCallLog` w projektach pomiarowych ze statusem innym niż `OK`; **oczekiwany wynik: 0 wierszy**). Niepusty wynik unieważnia scenariusz danego projektu (krok 9). Używa tej samej zmiennej `:'prefiks'` co Q1b (w pomiarze „po” `P-po-`):

```sql
SELECT p.name, l.operation, l.status, l."errorCode", l."durationMs", l."createdAt"
FROM "LlmCallLog" l
JOIN "Project" p ON p.id = l."projectId"
WHERE p.name LIKE :'prefiks' || '%' AND l.status <> 'OK'
ORDER BY l."createdAt";
```

Dodatkowo scenariusz jest nieważny, jeśli któraś wiadomość `USER` nie ma następującej po niej wiadomości `ASSISTANT` (Q4: wiersz `USER` bez wiersza `ASSISTANT` bezpośrednio po nim).

Liczba wywołań modelu w scenariuszu = suma `stepCount` z wierszy `chat` + liczba wierszy `evaluate_bmc` i `analyze_impact` (każdy z nich to jedno wywołanie modelu, nie liczę ewentualnych ponowień w SDK po błędach sieci/429). Zużycie limitów konta (łącznie; aplikacja liczy wszystkie wiersze użytkownika, niezależnie od modelu, więc tu bez filtra po `model`): 

```sql
SELECT count(*) AS wiersze_ostatnia_godzina
FROM "LlmCallLog" WHERE "userId" = (SELECT id FROM "User" WHERE email = 'TWÓJ_E-MAIL') AND "createdAt" > now() - interval '1 hour';

SELECT sum(coalesce("inputTokens",0) + coalesce("outputTokens",0)) AS tokeny_doba
FROM "LlmCallLog" WHERE "userId" = (SELECT id FROM "User" WHERE email = 'TWÓJ_E-MAIL') AND "createdAt" > now() - interval '1 day';
```

(Wpisz swój e-mail tylko w `psql`; nie wkleja go do pliku ani do wyników w repozytorium.)

Q2: lista tur z licznikami narzędzi i tekstem (propozycje rozbite na przyjęte i odrzucone przez serwer, błędy narzędzi osobno):

```sql
SELECT m."createdAt", m.role,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'tool-ask_clarification') AS ask,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p
    WHERE p->>'type' = 'tool-propose_block_change' AND p->>'state' = 'output-available'
      AND p->'output'->>'ok' = 'true') AS propozycje_ok,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p
    WHERE p->>'type' = 'tool-propose_block_change' AND p->>'state' = 'output-available'
      AND p->'output'->>'ok' = 'false') AS propozycje_odrzucone,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p
    WHERE p->>'type' LIKE 'tool-%' AND p->>'state' = 'output-error') AS bledy_narzedzi,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'tool-evaluate_bmc') AS ocena,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'tool-analyze_impact') AS analiza,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p WHERE p->>'type' LIKE 'tool-%') AS narzedzia_razem,
  (SELECT string_agg(p->>'text', ' ') FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'text') AS tekst
FROM "ChatMessage" m
WHERE m."projectId" = 'ID_PROJEKTU'
ORDER BY m."createdAt";
```

Q4: przegląd tur: części w kolejności ze stanem i tekst (typy części potwierdzone w kroku 0: `text`, `step-start`, `tool-…`; stany: `output-available`, `output-error`):

```sql
SELECT m."createdAt", m.role,
  (SELECT string_agg(t.p->>'type' || coalesce(':' || (t.p->>'state'), ''), ' > ' ORDER BY t.ord)
     FROM jsonb_array_elements(m.parts) WITH ORDINALITY AS t(p, ord)) AS czesci,
  (SELECT string_agg(t.p->>'text', ' ' ORDER BY t.ord)
     FROM jsonb_array_elements(m.parts) WITH ORDINALITY AS t(p, ord)
    WHERE t.p->>'type' = 'text') AS tekst
FROM "ChatMessage" m
WHERE m."projectId" = 'ID_PROJEKTU'
ORDER BY m."createdAt";
```

Kształt części został potwierdzony w kroku 0 po #34 (`tool-<nazwa>`, `step-start`, `text`). Gdyby kolumny z licznikami mimo to wszędzie dawały 0, a w czacie widać karty, sprawdź kształt części: `SELECT jsonb_pretty(parts) FROM "ChatMessage" WHERE "projectId" = 'ID_PROJEKTU' AND role = 'ASSISTANT' ORDER BY "createdAt" DESC LIMIT 1;` i daj mi znać (poprawię nazwy typów w zapytaniu i w planie).

Q3: wycieki w tekście asystenta:

```sql
SELECT t."createdAt", t.tekst FROM (
  SELECT m."createdAt", m.role,
    (SELECT string_agg(p->>'text', ' ') FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'text') AS tekst
  FROM "ChatMessage" m WHERE m."projectId" = 'ID_PROJEKTU'
) t
WHERE t.role = 'ASSISTANT'
  AND (t.tekst ~* '(ask_clarification|propose_block_change|evaluate_bmc|analyze_impact|proposalId|evaluationId|analysisId)'
       OR t.tekst ~ 'c[a-z0-9]{24}');
```

Wynik pusty = brak wycieków (poza zwrotami typu „skorzystaj z narzędzia”, które oceniasz oczami; wpisz je w kolumnie „Uwagi”). Q3 celowo czyta tylko części `text` (patrz zasada pod metrykami).

Zdanie końcowe po ocenie (M6) czytasz z kolumny `tekst` w Q2 dla wiersza z `ocena = 1`.

### Q5 i Q6: przegląd całej serii naraz (tylko odczyt)

Zamiast Q2, Q3 i Q4 osobno dla każdego projektu: Q5 i Q6 obejmują cztery projekty jednej serii naraz (kolejność S1, S2, S3S5, S4). Przed nimi w `psql`:

```
\encoding UTF8
\pset pager off
\x off
\pset format wrapped
\set prefiks 'P-przed2-'
\set seria 'seria1'
```

Dla kolejnych serii zmień tylko `\set seria 'seria2'`, potem `'seria3'`. W pomiarze „po” ustaw `\set prefiks 'P-po-'`. Wzorzec `prefiks || '%-' || seria` obejmuje też powtórki scenariuszy (`P-przed2-r1-…`), a nie obejmuje prób nieważnych `P-przed-…`.

Q5: tury z licznikami narzędzi (`ask`, `prop_ok`, `prop_odrz`, `bledy`, `ocena`, `analiza`, `narzedzia`), częściami w kolejności ze stanem, tekstem, flagą wycieku (M4), pytaniem w tekście (`pyt_tekst` i `pyt`: M1 i M2) i flagą `osierocona` (wiadomość `USER` bez odpowiedzi `ASSISTANT` zaraz po niej):

```sql
SELECT p.name AS projekt,
  row_number() OVER w AS nr,
  to_char(m."createdAt", 'HH24:MI:SS') AS godz,
  m.role,
  CASE WHEN m.role = 'USER' AND coalesce(lead(m.role::text) OVER w, '') <> 'ASSISTANT'
       THEN 'TAK' END AS osierocona,
  x.ask,
  CASE WHEN m.role = 'ASSISTANT' AND x.tekst ~ '\?[[:space:])"”»]*$' THEN 1 ELSE 0 END AS pyt_tekst,
  CASE WHEN m.role = 'ASSISTANT' AND (x.ask > 0 OR x.tekst ~ '\?[[:space:])"”»]*$') THEN 'PYT' END AS pyt,
  x.prop_ok, x.prop_odrz, x.bledy, x.ocena, x.analiza, x.narzedzia,
  CASE WHEN m.role = 'ASSISTANT'
        AND (x.tekst ~* '(ask_clarification|propose_block_change|evaluate_bmc|analyze_impact|proposalId|evaluationId|analysisId)'
             OR x.tekst ~ 'c[a-z0-9]{24}') THEN 'WYCIEK' END AS wyciek,
  x.czesci,
  x.tekst
FROM "ChatMessage" m
JOIN "Project" p ON p.id = m."projectId"
CROSS JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE a.p->>'type' = 'tool-ask_clarification') AS ask,
    count(*) FILTER (WHERE a.p->>'type' = 'tool-propose_block_change'
                       AND a.p->>'state' = 'output-available' AND a.p->'output'->>'ok' = 'true') AS prop_ok,
    count(*) FILTER (WHERE a.p->>'type' = 'tool-propose_block_change'
                       AND a.p->>'state' = 'output-available' AND a.p->'output'->>'ok' = 'false') AS prop_odrz,
    count(*) FILTER (WHERE a.p->>'type' LIKE 'tool-%' AND a.p->>'state' = 'output-error') AS bledy,
    count(*) FILTER (WHERE a.p->>'type' = 'tool-evaluate_bmc') AS ocena,
    count(*) FILTER (WHERE a.p->>'type' = 'tool-analyze_impact') AS analiza,
    count(*) FILTER (WHERE a.p->>'type' LIKE 'tool-%') AS narzedzia,
    string_agg(a.p->>'type' || coalesce(':' || (a.p->>'state'), ''), ' > ' ORDER BY a.ord)
      FILTER (WHERE a.p->>'type' <> 'step-start') AS czesci,
    string_agg(a.p->>'text', ' ' ORDER BY a.ord) FILTER (WHERE a.p->>'type' = 'text') AS tekst
  FROM jsonb_array_elements(m.parts) WITH ORDINALITY AS a(p, ord)
) x
WHERE p.name LIKE :'prefiks' || '%-' || :'seria'
WINDOW w AS (PARTITION BY p.id ORDER BY m."createdAt", m.id)
ORDER BY p.name, nr;
```

Q6: `LlmCallLog` serii. Pierwszy wynik to wszystkie wiersze razem z modelem (obcy model jest widoczny), drugi to podsumowanie na projekt (`wywolania_modelu` = suma `stepCount` z wierszy `chat` plus liczba wierszy `evaluate_bmc` i `analyze_impact`):

```sql
SELECT p.name AS projekt, to_char(l."createdAt", 'HH24:MI:SS') AS godz, l.operation,
       l."promptVersion" AS prompt, l.model, l.status, l."errorCode",
       l."stepCount" AS kroki, l."inputTokens" AS tok_we, l."outputTokens" AS tok_wy,
       l."durationMs" AS ms, l."costUsd"
FROM "LlmCallLog" l
JOIN "Project" p ON p.id = l."projectId"
WHERE p.name LIKE :'prefiks' || '%-' || :'seria'
ORDER BY p.name, l."createdAt";

SELECT p.name AS projekt,
  count(*) AS wiersze,
  count(*) FILTER (WHERE l.status <> 'OK') AS nie_ok,
  coalesce(sum(l."stepCount") FILTER (WHERE l.operation::text = 'chat'), 0)
    + count(*) FILTER (WHERE l.operation::text IN ('evaluate_bmc', 'analyze_impact')) AS wywolania_modelu,
  sum(coalesce(l."inputTokens", 0) + coalesce(l."outputTokens", 0)) AS tokeny,
  sum(l."durationMs") AS ms
FROM "LlmCallLog" l
JOIN "Project" p ON p.id = l."projectId"
WHERE p.name LIKE :'prefiks' || '%-' || :'seria'
GROUP BY p.name
ORDER BY p.name;
```

Q1b i Q1c (wyżej) używają tej samej zmiennej `:'prefiks'`, więc po `\set prefiks` działają dla wszystkich serii naraz. Q5 i Q6 nie były jeszcze uruchamiane; pierwsze użycie (seria 1 w `P-przed2-…`) jest ich próbą, a błąd składni lub nazwy operacji zgłoś bez ręcznych poprawek.

## Budżet wywołań modelu (szacunek względem limitów)

To szacunki do zweryfikowania na pierwszej serii (wartości tokenów dla `gemini-3.5-flash-lite` odczytasz z Q1). Liczba wywołań modelu na turę (przy `MAX_STEPS=3`, `ask_clarification` kończy turę):

| Tura | Wywołania modelu | Wiersze `LlmCallLog` |
|---|---|---|
| z pytaniem (`ask_clarification`) | 1 | 1 |
| z propozycją (narzędzie + tekst końcowy) | 2 (do 3–4 przy kilku propozycjach w kolejnych krokach) | 1 |
| z oceną (`evaluate_bmc`) | 3 (krok z narzędziem, ocena, tekst) | 2 |
| z odpowiedzią bez narzędzi | 1 | 1 |
| „Analizuj wpływ” z karty (UI) | 1 | 1 (`analyze_impact`) |

| Scenariusz | Tury / akcje | Wywołania modelu (typowo; zakres) | Wiersze logu |
|---|---|---|---|
| S1 | do 5 tur | 7 (5–12) | 5 |
| S2 | 3 tury (z „Dziękuję.”) | 5 (5–7) | 3 |
| S3 + S5 | 3 tury (z „Dziękuję.”) | 5 (5–7) | 4 (5, jeśli S5 niechcianie woła ocenę) |
| S4 | 2 tury + analiza z UI | 4 (4–6) | 3 |
| **Razem na serię** | | **ok. 21 (19–32)** | **ok. 15 (do 16)** |
| **3 serie na jeden pomiar** | | **ok. 63 (57–96)** | **ok. 45 (do 48)** |
| **„przed” + „po”** | | **ok. 126 (114–192)** | **ok. 90** |

Względem limitów:

- **Limity aplikacji** (`checkUserLimits`, per użytkownik): domyślnie 30 wierszy `LlmCallLog` na godzinę i 200 000 tokenów na dobę. Seria to ok. 15 wierszy, więc 3 serie w ciągu godziny przekraczają 30 (limit jest sprawdzany przed wywołaniem, więc tura przerwana komunikatem o limicie psuje pomiar). Tokeny: w próbnej rozmowie wiersz `chat` miał ok. 3,5 tys. tokenów wejścia przy jednym kroku, ok. 8,5 tys. przy dwóch i ok. 11,9 tys. przy trzech (historia wchodzi do każdego kroku), `evaluate_bmc` ok. 2,2 tys. wejścia i ok. 0,4 tys. wyjścia. Szacunek: seria ok. 21 wywołań × ok. 4 000 ≈ 84 000 tokenów wejścia plus wyjście, a 3 serie ok. 250 000+: powyżej domyślnych 200 000 na dobę. Dlatego D3 (rozstrzygnięte): limity w `.env` na czas pomiarów to `CHAT_MAX_REQUESTS_PER_HOUR=60` (3 serie to ok. 45 wierszy w godzinie) i `CHAT_MAX_TOKENS_PER_DAY=600000` (pomiar to ok. 250 000+ tokenów), te same w „przed” i „po”. Limity Gemini (płatny plan) mogą mimo to wymusić rozłożenie serii na kilka dni (D1): wtedy kończysz serie „przed” w całości przed zmianą promptu.
- **Limity planu Gemini** (płatny plan od 2026-11-20; RPM, RPD, TPM dla `gemini-3.5-flash-lite`): nie przytaczam z pamięci, bo bywają zmieniane. Przed pomiarem odczytaj bieżące wartości z konsoli Google AI Studio (zakładka limitów) i wpisz je poniżej. Ryzyko leży głównie w RPD (ok. 63 wywołania na pomiar, ok. 126 łącznie) oraz w krótkim szczycie przy turze z oceną (3 wywołania w kilka sekund). Przy ręcznym wpisywaniu wiadomości typowo mniej niż 10 wywołań na minutę.

| Limit płatnego planu Gemini (stan z dnia pomiaru) | Wartość z AI Studio | Zużycie w pomiarze (szacunek) | Zapas |
|---|---|---|---|
| zapytania na minutę (RPM) | | do 3 w szczycie (tura z oceną) | |
| zapytania na dobę (RPD) | | ok. 63 na pomiar | |
| tokeny na minutę (TPM) | | ok. 10 000 w szczycie | |

Jeśli RPD nie wystarcza na 3 serie jednego dnia, rozłóż pomiar „przed” na dwa dni (serie kompletne, nie scenariusze) i zapisz datę każdej serii.

## Tabele wyników

Uzupełnia właściciel. Wpisuj liczby z zapytań; „Uwagi” na błędy, limity, nietypowe odpowiedzi.

### Wyniki „przed” (`chat-v4`, model: gemini-3.5-flash-lite, płatny plan Gemini, konto pomiarowe, prefiks `P-przed2-`, daty serii: seria 1: 2026-11-21, 13:52–14:15 (data z `ImpactAnalysis`); seria 2: 2026-11-21, 15:23–15:25; seria 3: 2026-11-21, 15:48–15:52)

| Scenariusz | Seria | M1 narzędzie / tekst | M2 serie pytań | M3 niechciane ocena/analiza | M4 wycieki | M5 propozycje przy „wyjaśnij” | M6 brak zdania po ocenie | M8 (0–2) | M9 błędy narzędzi | M10 narzędzia po „Dziękuję.” | Wywołania modelu | Tokeny (we/wy) | Uwagi |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | 0 / 2 | 2 | 0 | 0 | — | — | 1 | 0 | — | 3 | 9 007 / 288 | Ważna (tury 1–2; dodatkowa wiadomość po propozycji wyłączona z liczenia: 2 wywołania, 6 813 / 141 tokenów). Tura 1: agent zapytał **tekstem, bez `ask_clarification`**; tura 2: od razu `propose_block_change` (segment klientów z założeniem) i pytanie w tekście. Pierwsza propozycja w turze 2. |
| S1 | 2 | 0 / 2 | 2 | 0 | 0 | — | — | 1 | 0 | — | 3 | 9 001 / 287 | Ważna (tury 1–2; wiadomość poza skryptem po propozycji, ponownie przez pomyłkę, wyłączona z liczenia: 2 wywołania, 6 800 / 153 tokenów). Tura 1: pytanie tekstem, bez `ask_clarification`; tura 2: `propose_block_change` (segment klientów) i pytanie w tekście. Pierwsza propozycja w turze 2. |
| S1 | 3 | 0 / 2 | 2 | 0 | 0 | — | — | 1 | 0 | — | 3 | 9 025 / 297 | Ważna, nic nie wysłano po propozycji. Pierwsza propozycja po drugiej wiadomości użytkownika (tura 2; wiersz 4 w Q5). Tura 1: pytanie tekstem bez `ask_clarification`; tura 2: `propose_block_change` i pytanie w tekście. |
| S2 | 1 | 0 / 1 | 1 | 0 | 0 | — | — | 2 | 0 | 0 | 5 | 17 079 / 342 | Ważna. 2 propozycje (po jednej na turę, `output-available`), „Dziękuję.” bez narzędzi. Każda odpowiedź kończy się pytaniem do użytkownika w tekście; Markdown (`**`) w tekście. |
| S2 | 2 | 0 / 1 | 1 | 0 | 0 | — | — | 2 | 0 | 0 | 5 | 17 058 / 335 | Ważna. 2 propozycje (po jednej na turę), odpowiedzi z propozycją kończą się zdaniem „Zaakceptuj lub odrzuć tę propozycję.” (bez pytania). Pytanie w tekście padło dopiero po „Dziękuję.” („Czy chciałbyś dopracować jeszcze jakieś elementy…”): bez narzędzi (M10 = 0), ale z niepotrzebnym pytaniem; przykład do hipotezy 7. |
| S2 | 3 | 0 / 1 | 1 | 0 | 0 | — | — | 2 | 0 | 0 | 5 | 16 897 / 304 | Ważna. 2 propozycje, odpowiedzi z propozycją kończą się „Sprawdź i zaakceptuj lub odrzuć tę propozycję.” (bez pytania). Po „Dziękuję.” bez narzędzi, ale z pytaniem w tekście (jak w serii 2). |
| S3 | 1 | 0 / 0 | 0 | 0 (jedno oczekiwane `evaluate_bmc`) | 0 | — | 0 | 1 | 0 | — | 3 | 7 998 / 396 | Ważna. Jedno `evaluate_bmc`, po karcie zdanie końcowe (M6 = 0). Tekst mówi „na karcie **poniżej**”, a karta jest **nad** tekstem (części renderowane po kolei): błąd położenia, przykład do hipotezy 6. |
| S3 | 2 | 0 / 1 | 1 | 0 (jedno oczekiwane `evaluate_bmc`) | 0 | — | 0 | 1 | 0 | — | 3 | 8 001 / 428 | Ważna. Jedno `evaluate_bmc`, po karcie zdanie końcowe (M6 = 0). Znowu „na karcie **poniżej**”, a karta jest nad tekstem (hipoteza 6), i pytanie o konkretny obszar na końcu. |
| S3 | 3 | 0 / 0 | 0 | 0 (jedno oczekiwane `evaluate_bmc`) | 0 | — | 0 | 1 | 0 | — | 3 | 8 002 / 440 | Ważna. Jedno `evaluate_bmc`, po karcie zdanie końcowe (M6 = 0), bez pytania. Trzeci raz „na karcie **poniżej**” przy karcie nad tekstem (hipoteza 6). |
| S4 | 1 | 1 / 1 | 2 | 0 (`analyze_impact` z UI, nie od agenta) | 0 | 0 | — | 0 | 0 | — | 4 | 11 271 / 690 | Ważna. Analiza wpływu powstała po kliknięciu (wiersz `analyze_impact` `OK`), a agent w turze 3 zadał `ask_clarification` z twierdzeniem, że „nie uruchamialiśmy jeszcze żadnej oceny ani analizy”: **nieprawda**, oczekiwane „nie widzę wyniku, jest na karcie”. Przykład do hipotezy 2 (wyjaśnienia bez narzędzi). Zapis analizy potwierdzony: jeden wiersz `ImpactAnalysis` (`PROPOSAL`, trigger `UI`, `impact-v1`, 14:14:34). |
| S4 | 2 | 1 / 0 | 1 | 0 (`analyze_impact` z UI) | 0 | 0 | — | 1 | 0 | — | 4 | 11 297 / 555 | Ważna. Analiza z UI (wiersz `analyze_impact` `OK` 15:25:18). Tura 1: propozycja kończy się odesłaniem do karty („na karcie powyżej”), bez pytania. Tura 3: `ask_clarification`; Pytanie: „O jaką analizę pytasz? Czy masz na myśli ocenę całego modelu, czy analizę wpływu zmiany?” (sugestie: „Ocena całego modelu BMC”, „Analiza wpływu zmiany subskrypcji”). Agent nie twierdzi, że analizy nie było (inaczej niż w serii 1), ale nie odsyła do karty i dopytuje o oczywistą rzecz: M8 = 1 (ustalone z treści pytania). |
| S4 | 3 | 1 / 1 | 2 | 0 (`analyze_impact` z UI) | 0 | 0 | — | 1 (ustalone z treści pytania) | 0 | — | 4 | 11 258 / 571 | Ważna. Analiza z UI (wiersz `analyze_impact` `OK` 15:52:14). Tura 1: propozycja z pytaniem w tekście („Czy chcesz zatwierdzić tę zmianę…?”); tura 3: `ask_clarification`: „O jaką analizę pytasz? Czy chodzi o ocenę całego modelu BMC, czy o analizę wpływu zmiany (np. subskrypcji) na inne bloki?” (sugestie: „Ocena całego modelu”, „Wpływ subskrypcji na inne bloki”). Jak w serii 2: agent nie twierdzi, że analizy nie było, ale nie odsyła do karty i dopytuje o oczywistą rzecz (M8 = 1). |
| S5 | 1 | 1 / 0 | 1 | 0 | 0 | 0 | — | 1 | 0 | 0 | 2 | 6 646 / 159 | Ważna. Na „Dlaczego Innowacyjność…” agent zadał `ask_clarification` (pytanie, czy chodzi o konkretne elementy), zamiast odesłać do karty; bez tekstu w tej wiadomości. W wierszu także tura 3 („Dziękuję.”: tekst bez narzędzi, M10 = 0, 1 wywołanie). |
| S5 | 2 | 1 / 0 | 1 | 0 | 0 | 0 | — | 1 | 0 | 0 | 2 | 6 592 / 114 | Ważna. `ask_clarification` zamiast odesłania do karty (jak w serii 1); pytanie: „Czy masz na myśli jakąś konkretną propozycję wartości w swoim modelu, którą uważasz za najbardziej innowacyjną?” z sugerowanymi odpowiedziami podpowiadającymi treść (np. „cena kawy speciality na poziomie sieciówki”). Cała rozmowa S3S5: pytania w turach 2 i 4 z rzędu (M2 rozmowy = 2). W wierszu także tura 3 („Dziękuję.”: bez narzędzi i bez pytania, M10 = 0, 1 wywołanie). |
| S5 | 3 | 1 / 0 | 1 | 0 | 0 | 0 | — | 1 | 0 | 0 | 2 | 6 638 / 150 | Ważna. `ask_clarification` zamiast odesłania do karty (trzeci raz). Tura 3 („Dziękuję.”): bez narzędzi i bez pytania, M10 = 0. |

Uwagi do odczytu: M8 w serii 1 zaakceptowane przez właściciela; w serii 2 zaakceptowane (S4 = 1 ustalone z treści pytania); w serii 3 zaakceptowane przez właściciela (S4 = 1 ustalone z treści pytania). W wyklejonych wynikach Q5 pojawiały się fragmenty `--More--` i urwane słowa (np. „cz--Moy może”): to artefakt pagera `psql` przy wklejaniu, nie treść z bazy (ustaw `\pset pager off`). Zapisane w bazie teksty nie mają tych wstawek. Wywołania modelu = suma `stepCount` z wierszy `chat` plus wiersze `evaluate_bmc` i `analyze_impact` (Q6). Q1b i Q1c dla `P-przed2-` po serii 1, 2 i 3: 0 wierszy (potwierdzone przez właściciela). M1 „tekst” i M2 w serii 1 pochodzą z nowego Q5 (kolumny `pyt_tekst` i `pyt`) i zgadzają się z wcześniejszym liczeniem ręcznym. W S1 liczone są tylko tury 1–2 (wiersze 2 i 4 w Q5); wiersze 5–6 (wiadomość poza skryptem) są pominięte.

### Wyniki „po” (`chat-v5`, ten sam model, te same scenariusze)

Ta sama tabela, osobna kopia po pomiarze „po”.

| Scenariusz | Seria | M1 narzędzie / tekst | M2 serie pytań | M3 niechciane ocena/analiza | M4 wycieki | M5 propozycje przy „wyjaśnij” | M6 brak zdania po ocenie | M8 (0–2) | M9 błędy narzędzi | M10 narzędzia po „Dziękuję.” | Wywołania modelu | Tokeny (we/wy) | Uwagi |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | | | | | | | | | | | | |
| S1 | 2 | | | | | | | | | | | | |
| S1 | 3 | | | | | | | | | | | | |
| S2 | 1 | | | | | | | | | | | | |
| S2 | 2 | | | | | | | | | | | | |
| S2 | 3 | | | | | | | | | | | | |
| S3 | 1 | | | | | | | | | | | | |
| S3 | 2 | | | | | | | | | | | | |
| S3 | 3 | | | | | | | | | | | | |
| S4 | 1 | | | | | | | | | | | | |
| S4 | 2 | | | | | | | | | | | | |
| S4 | 3 | | | | | | | | | | | | |
| S5 | 1 | | | | | | | | | | | | |
| S5 | 2 | | | | | | | | | | | | |
| S5 | 3 | | | | | | | | | | | | |

### Podsumowanie przed / po (sumy z trzech serii)

| Metryka | Przed | Po | Kryterium sukcesu |
|---|---|---|---|
| M1 w S1 (suma z 3 serii: narzędzie + tekst) | narzędzie 0, tekst 6 (po 2 w każdej serii) | | bez pogorszenia (kontrolna; `chat-v5` tego nie zmienia) |
| M2 najdłuższa seria pytań w S1 | 2 w każdej serii (próg już spełniony) | | nie więcej niż 2 (kontrolna) |
| M3 niechciane `evaluate_bmc`/`analyze_impact` (S2, S4, S5) | 0 (S4: `analyze_impact` tylko z UI) | | 0 |
| M4 wycieki nazw i identyfikatorów | 0 (Q5, wszystkie serie). Osobno: błędne „na karcie poniżej” w S3 w 3 z 3 serii | | 0; „poniżej”/„powyżej” w S3: 0 (cel `chat-v5`) |
| M5 nowe propozycje przy „wyjaśnij” (S4, S5) | 0 | | 0 |
| M6 tury z oceną bez zdania końcowego (S3) | 0 (`prepareStep` niepotrzebny) | | 0 albo `prepareStep` (decyzja po „przed”) |
| M9 Błędne wywołania narzędzi (`output-error`) | 0 (też `propozycje_odrzucone` = 0) | | 0 |
| M10 Narzędzia po „Dziękuję.” (S2, S3S5) | 0 narzędzi; pytanie w tekście po „Dziękuję.” w S2 w 2 z 3 serii | | 0 narzędzi i 0 pytań po „Dziękuję.” (cel `chat-v5`) |
| M1 poza S1 (S2–S5, oczekiwane 0) | narzędzie 6 (S4: 3, S5: 3), tekst 6 (S2: 3, S3: 1, S4: 2) | | narzędzie 0 w S4 i S5; tekst mniej niż „przed” (cel `chat-v5`) |
| M7 zużycie na serię (S1–S5) | 17 wywołań modelu, 53 876 / 53 668 / 53 582 tokenów (we+wy) w seriach 1–3, 0 wierszy poza `OK` | | porównanie informacyjne |

Kryteria są progami roboczymi: przy 3 seriach i modelu niedeterministycznym oceniamy kierunek zmiany i każdy przypadek z osobna, a nie istotność statystyczną. Wynik opisujemy uczciwie, także gdy „po” nie jest lepsze.

**Wnioski z „przed” (3 serie, wszystkie ważne, model `gemini-3.5-flash-lite`, `chat-v4`):**

- **Zachowanie jest bardzo powtarzalne.** Odpowiedzi w seriach są niemal identyczne (obserwacja właściciela; Q5 pokazuje te same ścieżki narzędzi w tych samych scenariuszach). Trzy serie mierzą więc stały wzorzec dla tych konkretnych wiadomości, a nie rozrzut; wynik „po” porównujemy ścieżka po ścieżce i nie wnioskujemy o istotności statystycznej ani o zachowaniu na innych wiadomościach.
- **Bez problemu do poprawienia w „przed”:** M3, M4 (identyfikatory i nazwy narzędzi), M5, M6, M9 = 0. Dla nich „po” może tylko pokazać regresję; `prepareStep` nie jest potrzebny (M6 = 0), a poprawka `propose_block_change` (#35, #37) działa (0 błędów narzędzi w 15 scenariuszach).
- **Zmierzone problemy:** (a) pytania poza S1 (M1): 6 `ask_clarification` (S4 i S5, 6 z 6) i 6 pytań w tekście, w S4 i S5 zamiast odesłania do karty; (b) błędne „na karcie poniżej” w S3 (3 z 3), zgodne z promptem, który mówi „pod Twoją odpowiedzią”; (c) pytanie po „Dziękuję.” w S2 (2 z 3); (d) w S4 serii 1 fałszywe twierdzenie, że analizy nie było.
- **S1 nie sprawdza limitu tur pytań.** Agent nie użył `ask_clarification` ani razu, pyta zwykłym tekstem i składa pierwszą propozycję już w turze 2 (M2 = 2 w każdej serii, próg „najwyżej 2” spełniony). Skrypt S1 z konkretną drugą wiadomością nie wymusza dłuższego dopytywania. **Decyzja właściciela:** dodatkowego scenariusza (S1b) nie robimy. Problem „agent dopytuje w kółko” nie wystąpił w żadnej z 3 serii (po naprawie zapisu #34 agent proponuje wpisy w turze 2); wpis w `docs/zadania.md` ma status „niepotwierdzony po #34” (prawdopodobnie skutek błędu zapisu: bez zapisanych odpowiedzi agent nie widział w historii własnych pytań i pytał ponownie). Dane: `P-przed2-S1-seria1…3`, M1 narzędzie = 0, M2 = 2, pierwsza propozycja w turze 2 we wszystkich seriach.

## Hipotezy zmian w prompcie `chat-v5` (do potwierdzenia wynikami „przed”)

Nie zmieniam promptu przed wynikami. Poniżej tylko to, co wynika z wpisów w `zadania.md`, żeby dało się ocenić, które metryki mają sens:

1. **Dopytywanie:** w `chat-v4` reguła mówi „zadaj jedno konkretne pytanie” i „dopytuj zamiast zgadywać”, bez limitu tur. Hipoteza: dodać limit (po dwóch turach pytań agent proponuje wpisy), zakaz powtarzania pytań o to, co użytkownik już podał, i nazywanie założeń w uzasadnieniu propozycji.
2. **Wyjaśnienia:** przy pytaniu o wynik oceny lub analizy odsyłaj do karty/panelu, nie proponuj nowych zmian i nie wołaj `evaluate_bmc`/`analyze_impact`.
3. **Nazwy techniczne:** zakaz podawania nazw narzędzi i identyfikatorów w odpowiedziach; propozycję opisuj jej faktyczną treścią.
4. **Spójność reguł (D5, rozstrzygnięte):** `chat-v4` mówi „Proponuj tylko to, co wynika z rozmowy”, a wpis o dopytywaniu chce propozycji „z jawnie podanymi założeniami”. W `chat-v5` propozycja może zawierać założenie, pod warunkiem że uzasadnienie (`rationale`) ma prefiks „Założenie:”, nie zawiera liczb, a w tekście czatu agent wprost mówi, że to założenie do sprawdzenia. Wyjątek od „tylko to, co wynika z rozmowy” musi być w prompcie sformułowany tak, żeby nie otwierał drogi do wymyślania faktów ani danych liczbowych.
5. **Identyfikator wyniku (przykład z próbnej rozmowy):** opis narzędzia i prompt `chat-v4` mówią „Wynik zawiera tylko identyfikator oceny”, a agent powtórzył identyfikator w odpowiedzi. Hipoteza: usunąć wzmiankę o identyfikatorze z instrukcji dla modelu i zakazać go wprost.
6. **Położenie karty (przykład z próbnej rozmowy):** prompt mówi „na karcie pod Twoją odpowiedzią”, a karta narzędzia jest renderowana nad tekstem końcowym. Hipoteza: „na karcie w tej wiadomości” (bez kierunku).
7. **Brak narzędzi na podziękowanie:** po grzecznościowej wiadomości („Dziękuję.”) żadnych narzędzi; propozycji nie wysyłamy bez prośby. Mierzone w M10 (pod warunkiem ważnych scenariuszy).

### Zakres `chat-v5` (decyzja właściciela po „przed”, 2026-11-21)

- **Wchodzą:** (1) **położenie karty (hipoteza 6):** instrukcje o ocenie i analizie mówią, że karta jest „w tej wiadomości”, bez „powyżej” i „poniżej”, a zdanie „wynik zawiera tylko identyfikator…” zostaje usunięte z instrukcji; (2) **wyjaśnienia (hipoteza 2):** na pytanie o wynik oceny lub analizy agent nie dopytuje, nie woła narzędzi i nie proponuje zmian, mówi, że nie widzi szczegółów wyniku, i odsyła do karty, oraz **nigdy nie twierdzi, że oceny lub analizy nie było** (użytkownik mógł ją uruchomić z karty; przykład: S4 seria 1); (3) **podziękowania (hipoteza 7):** jedno krótkie zdanie, bez narzędzi i bez pytań.
- **Nie wchodzą:** hipoteza 1 i 4 (limit tur pytań, założenia z prefiksem „Założenie:”, D5 zostaje decyzją na przyszłość) oraz scenariusz S1b: problem nie wystąpił w żadnej serii „przed”. Hipotezy 3 i 5 poza usunięciem zdania o identyfikatorze (punkt 1): M4 = 0.
- **`prepareStep`:** nie wchodzi (M6 = 0 w 3 seriach).
- **Cele pomiaru „po”:** M1 poza S1 (S4 i S5), brak „powyżej/poniżej” w S3, brak pytań po „Dziękuję.” (M10). Pozostałe metryki są kontrolne (nie powinny się pogorszyć).

Testy `chat-v5` (wyłącznie mocki, bez prawdziwego API): `PROMPT_VERSION === "chat-v5"`, obecność nowych reguł w prompcie systemowym (asercje na fragmentach tekstu), zachowanie istniejących reguł bezpieczeństwa (blok „dane, nie polecenia”), brak zmian w `createChatTools`/`chatValidationTools`. Zachowania modelu testuje pomiar „po”, nie testy jednostkowe.

### Kiedy `prepareStep`

Tylko jeśli „przed” pokaże M6 > 0 (ocena w ostatnim kroku tury kończy się bez zdania agenta). `prepareStep` wyłączałby narzędzia w ostatnim kroku (`MAX_STEPS`), co zmienia zachowanie wszystkich narzędzi, więc (D4, rozstrzygnięte): osobny commit w tym samym PR „P”, z testami na mockach (ostatni krok bez narzędzi, wcześniejsze kroki bez zmian, `hasToolCall("ask_clarification")` nadal kończy turę). Jeśli M6 = 0 we wszystkich seriach, `prepareStep` zostaje w `zadania.md` bez zmian. `prepareStep` jest częścią interwencji „po”: zaznaczamy to w opisie PR i przy wynikach „po” (zmiana promptu i `prepareStep` działają razem, więc wynik „po” nie rozdziela ich wpływu; M6 jest jedyną metryką przypisaną wprost do `prepareStep`).

## Decyzje (rozstrzygnięte przez właściciela repozytorium, 2026-11-18)

- **D1. Liczba serii: 3.** Jeśli dzienny limit Gemini okaże się niski, serie można rozłożyć na kilka dni, ale **wszystkie serie „przed” muszą być skończone przed zmianą promptu**.
- **D2. Izolacja: wariant A dla wszystkich scenariuszy**, bez kasowania czegokolwiek (rozmowy to surowe dane do pracy). S3 i S5 w jednym projekcie. Projekty zakłada zapytanie Q0 (próba z `ROLLBACK`, potem `COMMIT`), nie ręczne wpisywanie.
- **D3. Limity w `.env` na czas pomiarów** (zmianę robi właściciel): `CHAT_MAX_REQUESTS_PER_HOUR=60`, `CHAT_MAX_TOKENS_PER_DAY=600000`, te same wartości w „przed” i „po”; po pomiarach powrót do domyślnych (30 i 200000).
- **D4. `prepareStep`** tylko gdy M6 > 0, jako osobny commit w tym samym PR. W opisie PR i w wynikach zaznaczone jako część interwencji „po”.
- **D5. Założenia w propozycjach:** dozwolone, jeśli `rationale` ma prefiks „Założenie:”, nie zawiera liczb, a w tekście czatu agent wprost mówi, że to założenie do sprawdzenia.
- **Model pomiarowy (stały warunek):** `gemini-3.5-flash-lite` od pierwszej serii „przed” do końca serii „po”; poza pomiarami dozwolony `gemini-3.1-flash-lite` (tylko w projektach niepomiarowych).

## Ryzyka

- Niedeterminizm modelu i niska liczba serii: wnioski kierunkowe, nie statystyczne; dlatego raportujemy każdą serię.
- Limity darmowego planu Gemini i limity aplikacji mogą przerwać serię (procedura w kroku 9).
- Zmiana modelu lub nazwy modelu między „przed” a „po” unieważnia porównanie (nie zmieniać `LLM_MODEL`).
- Zapytania Q2/Q3 zakładają, że części narzędzi w `ChatMessage.parts` mają typ `tool-<nazwa>`; jeśli nie (patrz uwaga pod Q2), poprawiam zapytania przed pomiarem.
- Wyjaśnianie ocen bez odczytu zapisanej oceny pozostaje ograniczone (agent jej nie widzi); `chat-v5` może tylko kazać odsyłać do karty. Narzędzie odczytu (`zadania.md`) to osobna decyzja po PR „P”.
- Przerwane tury (`ABORTED`, w tym „Zatrzymaj”) zostawiają w historii wiadomość użytkownika bez odpowiedzi i zmieniają zachowanie agenta w kolejnych turach. Dlatego scenariusz z jakimkolwiek wierszem innym niż `OK` jest nieważny i powtarzany w świeżym projekcie (krok 9).
- Czasy odpowiedzi są niestabilne (od ok. 9 do ponad 90 s), więc pomiar zależy od cierpliwości; nie przerywamy odpowiedzi, a czas nie jest metryką jakości.
- #35 nie gwarantuje, że Gemini zawsze poda `before: null`; skuteczność pokaże M9. Jeśli M9 wskaże nowy rodzaj błędów (np. brak `before` przy `add`), rozważamy wymaganie tylko `after`, ale poza trwającym pomiarem.
