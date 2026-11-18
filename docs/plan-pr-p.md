# Plan PR „P”: poprawki promptu agenta (chat-v5) z pomiarem przed i po

**Do akceptacji (2026-11-18), decyzje D1–D5 rozstrzygnięte przez właściciela repozytorium (sekcja „Decyzje”).** Ten plik to jedyna zmiana w pierwszym kroku (`docs/`). Kod i prompt (`chat-v4`) bez zmian, dopóki nie ma wyników „przed”. Wszystkie serie „przed” muszą być skończone przed zmianą promptu (mogą być rozłożone na kilka dni, jeśli dzienny limit Gemini okaże się niski).

Zakres wynika z `docs/plan-krok-6.md`, „Zmiany po akceptacji”, punkty 4 i 11 (PR „P”: scenariusze o dopytywaniu, niechcianej ocenie, wyniku analizy i nazwach narzędzi; prompt `chat-v5`, baseline na `chat-v4`) oraz z wpisów sekcji „Agent AI” w `docs/zadania.md`:

- „Agent dopytuje zbyt często i w kółko”,
- „Agent a wynik analizy i narzędzia”,
- „Agent uruchomił ocenę od nowa na pytanie o wyjaśnienie oceny”,
- „`prepareStep` w ostatnim kroku tury” oraz punkt o ocenie w ostatnim kroku w „Ograniczenia narzędzia `evaluate_bmc`”.

**Poza zakresem (zostają w `zadania.md`):** narzędzie do odczytu zapisanej oceny/analizy (`get_latest_evaluation`), narzędzia czatu `generate_strategies` i `compare_variants`, wątki czatu per wariant, limity atomowe. PR „P” zmienia wyłącznie treść promptu (`chat-v5`) i, jeśli pomiar to uzasadni, `prepareStep`.

## Podział na kroki

1. **Ten plan** (`docs/plan-pr-p.md`), PR `docs/plan-pr-p`. Po akceptacji i merge.
2. **Pomiar „przed”** na `chat-v4`: wykonuje właściciel repozytorium przez interfejs (sekcje „Instrukcja pomiaru” i „Metryki”). Wyniki wpisuje do tabel i przekazuje.
3. **PR `feat/prompt-chat-v5`**: dopiero po wynikach „przed”. Prompt `chat-v5`, ewentualnie `prepareStep`, testy na mockach. Zakres zmian prompu wynika z tabeli wyników „przed”, nie z domysłów (szkic hipotez niżej).
4. **Pomiar „po”**: ten sam model, te same scenariusze i wiadomości, ta sama liczba powtórzeń. Wyniki do tabel i do rozdziału testowego pracy.
5. **Domknięcie**: wyniki „przed” i „po” w tym pliku (osobny commit `docs:`), aktualizacja wpisów w `docs/zadania.md` (wpisy zamknięte, dopisek o ewentualnym narzędziu odczytu).

## Warunki pomiaru (stałe dla „przed” i „po”)

- **Model stały: `gemini-3.5-flash-lite`** (`LLM_PROVIDER=google`). Właściciel ustawia go w `.env` przed pierwszą serią „przed” i nie zmienia do końca serii „po”. Poza pomiarami może używać `gemini-3.1-flash-lite`, ale tylko w projektach niepomiarowych (nazwy `P-…` są zarezerwowane dla pomiarów). Używany model zapisuje kolumna `model` w `LlmCallLog`; zapytania Q1 filtrują po `model`, a kontrola Q1b sprawdza, że w projektach pomiarowych nie ma wierszy z innym modelem ani innym `promptVersion` (`chat-v4` w „przed”, `chat-v5` w „po”). Seria z choćby jednym obcym wierszem jest nieważna.
- Dane: wyłącznie przykładowe (niżej). Żadnych prawdziwych danych firmy ani osobowych (darmowy plan Gemini).
- Ustawienia `.env`: poza limitami z D3 bez zmian względem codziennej pracy. `MAX_STEPS=3`, `LLM_MAX_OUTPUT_TOKENS=2000` zostają. Limity z D3 (**te same wartości w seriach „przed” i „po”**): `CHAT_MAX_REQUESTS_PER_HOUR=60`, `CHAT_MAX_TOKENS_PER_DAY=600000`. **Po zakończeniu wszystkich pomiarów przywróć wartości domyślne** (`CHAT_MAX_REQUESTS_PER_HOUR=30`, `CHAT_MAX_TOKENS_PER_DAY=200000`, jak w `.env.example`).
- Nie czytam ani nie modyfikuję `.env` i nie ładuję go żadnym skryptem; zmiany w `.env` wykonuje właściciel.
- Tryb: `npm run dev` (do pomiaru wystarczy). Nie uruchamiam niczego, co ładuje `.env`; pomiar wykonujesz Ty w przeglądarce i w `psql`.
- Powtórzenia: **3 serie** (N=3) wszystkich scenariuszy (model jest niedeterministyczny; jedna seria nie odróżni poprawy od szumu). Wyniki raportuj osobno dla każdej serii, nie tylko średnią.
- Wiadomości wpisuj **dosłownie** jak niżej (kopiuj i wklej). Kolejność scenariuszy i serii taka sama w „przed” i w „po”.

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

Historia czatu jest jedna na projekt, więc rozmowa z poprzedniej serii zmieniałaby zachowanie agenta. **Wariant A (D2): osobny projekt na każdą kombinację faza × scenariusz × seria, nic nie jest kasowane.** Rozmowy zostają jako surowe dane do pracy. Projektów jest 4 scenariusze × 3 serie = **12 na fazę** (S3 i S5 w jednym projekcie `S3S5`), nazwy: `P-przed-S1-seria1`, `P-przed-S2-seria1`, `P-przed-S3S5-seria1`, `P-przed-S4-seria1`, … `P-przed-S4-seria3`; w fazie „po” prefiks `P-po-`. Projekty z prefiksem `P-` są zarezerwowane dla pomiarów.

Projekty zakłada zapytanie Q0 (niżej), a nie ręczne wpisywanie.

#### Q0: założenie 12 projektów pomiarowych dla jednej fazy

Uruchamiane przez Ciebie w `psql` (`docker compose exec db psql -U bmc -d bmc_dev`, dane z `docker-compose.yml`). Bez skryptów Node, bez `.env`. Zapytanie tylko **dodaje** wiersze (`Project`, `ProjectMember` z rolą OWNER, `BmcVariant` z `isMain = true` i nazwą „Wariant główny”), niczego nie zmienia ani nie kasuje. Jedno polecenie `INSERT` to jedna transakcja, a klucze obce są sprawdzane na jego końcu. Wariant główny ma `version = 1`, `origin = MANUAL` (domyślne), więc częściowy indeks `BmcVariant_projectId_main_key` jest zachowany (jeden wariant główny na projekt). Identyfikatory generuje baza w formacie podobnym do cuid (`c` + 24 znaki), bo Prisma nadaje je po stronie klienta, a nie w bazie. S1 dostaje pusty model, pozostałe model „Kawiarni Ziarno”.

Zabezpieczenia: bez konta o podanym e-mailu nie powstanie nic (żadnych projektów bez właściciela); projekt o tej samej nazwie, w którym jesteś członkiem, nie zostanie założony drugi raz (można uruchomić ponownie bez duplikatów).

**Najpierw próba:** uruchom z `ROLLBACK` w ostatniej linii, sprawdź liczby, potem powtórz z `COMMIT`. Zapytania nie uruchamiałem (nie łączę się z bazą i nie ładuję `.env`), więc próba z `ROLLBACK` jest obowiązkowa. W `psql` ustaw wcześniej kodowanie (polskie znaki): `\encoding UTF8` (w terminalu Windows ewentualnie `chcp 65001`). Wstaw swój e-mail tylko w `psql`.

```sql
\set email 'TWÓJ_E-MAIL'
\set faza 'przed'

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

Sprawdź też, że w wynikach Q0 polskie znaki wyglądają poprawnie: `SELECT state->'customer_segments' FROM "BmcVariant" v JOIN "Project" p ON p.id = v."projectId" WHERE p.name = 'P-przed-S2-seria1';` (po `COMMIT`).

## Scenariusze (stały zestaw)

Oznaczenia: `U:` wiadomość użytkownika (wpisz dosłownie), `UI:` akcja w interfejsie, `Oczekiwane` to zachowanie wzorcowe do oceny (nie wpływa na to, co wpisujesz). Po każdej turze poczekaj na koniec odpowiedzi i kartę wyniku (jeśli jest).

### S1. Dopytywanie (pusty model)

Skrypt odpowiedzi jest **stały i niezależny od pytań agenta** (żeby seria „przed” i „po” dostały to samo). Wpisuj kolejne wiadomości, aż agent odpowie bez `ask_clarification` albo skończą się wiadomości (maks. 5 tur użytkownika).

1. `U: Chcę otworzyć kawiarnię. Pomóż mi zbudować model biznesowy.`
2. `U: Kawiarnia w centrum dużego miasta, kawa i proste śniadania.`
3. `U: Nie mam jeszcze więcej szczegółów.`
4. `U: To wszystko, co na razie wiem.`
5. `U: Zaproponuj wpisy na podstawie tego, co napisałem.`

Oczekiwane (`chat-v5`): najwyżej dwie tury pytań z rzędu, bez powtarzania pytań o to, co już padło, potem propozycje z jawnie nazwanymi założeniami. Wartości do zapisu: liczba `ask_clarification` na rozmowę, najdłuższa seria tur pytań z rzędu, czy i w której turze pojawiły się propozycje.

### S2. „Dodaj wpis” (model wypełniony)

1. `U: Dodaj do segmentów klientów: rodziny z dziećmi.`
2. `U: Dodaj do kanałów: dostawa przez aplikację mobilną.`

Oczekiwane: po jednej propozycji `propose_block_change` na turę, krótka odpowiedź bez ciężkich narzędzi; `evaluate_bmc` i `analyze_impact` nieużyte; w tekście brak nazw narzędzi i identyfikatorów. Propozycji nie trzeba odrzucać ani zatwierdzać (projekt jest jednorazowy); nie zatwierdzaj ich, żeby nie zmieniać stanu modelu.

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

S3 i S5 to jedna rozmowa w jednym projekcie (S3 tura 1, S5 tura 2). W tabelach liczone osobno.

## Metryki

| # | Metryka | Definicja | Jak odczytać |
|---|---|---|---|
| M1 | Liczba `ask_clarification` na rozmowę | liczba części `tool-ask_clarification` w wiadomościach asystenta w projekcie scenariusza (S1 najważniejszy; w S2–S5 oczekiwane 0) | zapytanie Q2 |
| M2 | Tury pytań z rzędu | najdłuższy ciąg kolejnych wiadomości asystenta z co najmniej jednym `ask_clarification` | Q2 (kolumna `ask` w kolejnych wierszach) |
| M3 | Niechciane `evaluate_bmc` / `analyze_impact` | wywołanie w turze, w której wiadomość użytkownika nie prosiła o ocenę/analizę (S2, S4 tura 3, S5 tura 2; w S3 oczekiwane jest dokładnie jedno `evaluate_bmc`) | Q2 (kolumny `ocena`, `analiza`) i zużycie limitu: Q1, wiersze `evaluate_bmc`/`analyze_impact` |
| M4 | Wycieki nazw narzędzi i identyfikatorów | w tekście asystenta pojawia się nazwa narzędzia (`ask_clarification`, `propose_block_change`, `evaluate_bmc`, `analyze_impact`), słowa `proposalId`, `evaluationId`, `analysisId` albo identyfikator w formacie cuid (np. `cm…`, 25 znaków) | zapytanie Q3 (automatyczne) plus oglądowo: zwroty typu „skorzystaj z narzędzia”, „użyj narzędzia” |
| M5 | Nowe propozycje na prośbę o wyjaśnienie | liczba części `tool-propose_block_change` w odpowiedzi na wiadomość „Wyjaśnij…” / „Dlaczego…” (S4 tura 3, S5 tura 2; oczekiwane 0) | Q2 (kolumna `propozycje`) |
| M6 | Tura z oceną bez zdania końcowego | w S3 tura 1: wiadomość asystenta z `tool-evaluate_bmc` bez żadnego niepustego tekstu po wyniku (kandydat do `prepareStep`) | Q2 (kolumna `tekst` pusta) |
| M7 | Zużycie | wiersze `LlmCallLog`, wywołania modelu, tokeny, czas | zapytanie Q1 |
| M8 | Opinia w skali 0/1/2 (ręcznie, opcjonalnie) | czy odpowiedź jest sensowna po polsku i zgodna z scenariuszem (0 źle, 1 częściowo, 2 dobrze) | własna ocena po przeczytaniu |

Wycieki (M4) liczysz w tekście widocznym dla użytkownika, nie w polu argumentów narzędzi.

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
1. Potwierdź wersję promptu: w repozytorium `PROMPT_VERSION = "chat-v4"` (`src/lib/ai/prompts/system.ts`); `git status` czysty poza plikami, które już miałeś. W swoim `.env` ustaw `LLM_MODEL=gemini-3.5-flash-lite` i nie zmieniaj go do końca serii „po”.
2. Ustaw w `.env` limity z D3: `CHAT_MAX_REQUESTS_PER_HOUR=60`, `CHAT_MAX_TOKENS_PER_DAY=600000`, zrestartuj `npm run dev`. **Po zakończeniu wszystkich pomiarów (po serii „po”) wróć do domyślnych: 30 i 200000.** Te same wartości muszą obowiązywać w „przed” i „po”.
3. Zaloguj się na to samo konto we wszystkich seriach (limity liczą się per użytkownik).
4. Otwórz konsolę bazy w osobnym oknie: `docker compose exec db psql -U bmc -d bmc_dev` (dane logowania z `docker-compose.yml`, nie z `.env`). W `psql`: `\pset pager off`, `\x off`, `\encoding UTF8`.
5. Załóż projekty pomiarowe zapytaniem Q0 (próba z `ROLLBACK`, potem z `COMMIT`), `\set faza 'przed'`. Z adresu projektu (`/projekty/<id>`) albo z kolumny `id_projektu` w kontroli Q0 weź `<id>`; wstawiasz go w zapytaniach w miejsce `ID_PROJEKTU`. Zapisz moment startu serii (`SELECT now();`).

### Pojedyncza seria (powtórz 3 razy)

6. Dla każdego scenariusza w kolejności S1, S2, S3+S5, S4: wejdź w odpowiedni projekt, wpisuj wiadomości dosłownie jak w scenariuszu, po każdej czekaj na koniec odpowiedzi. Nie poprawiaj agenta, nie dopowiadaj niczego poza skryptem.
7. Po zakończeniu scenariusza uruchom Q2 (lista tur) i Q3 (wycieki) dla jego projektu; zapisz wyniki w tabeli.
8. Po serii uruchom Q1 (zużycie) dla wszystkich projektów serii albo dla konta w oknie czasu serii.
9. Jeśli pojawi się błąd 429 lub komunikat o limicie: zapisz to w tabeli (kolumna „Uwagi”), poczekaj na reset i powtórz **całą** turę (nie pojedyncze wywołanie). Nie licz przerwanej tury do metryk.

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

Q1b: kontrola ważności serii (wiersze z innym modelem lub promptem w projektach pomiarowych; **oczekiwany wynik: 0 wierszy**). Zmień `chat-v4` na `chat-v5` w pomiarze „po”. Q2 i Q3 czytają `ChatMessage`, które nie ma kolumny `model`, więc ich poprawność wynika z izolacji projektów (wariant A) potwierdzonej przez Q1b:

```sql
SELECT p.name, l.operation, l.model, l."promptVersion", l.status, l."createdAt"
FROM "LlmCallLog" l
JOIN "Project" p ON p.id = l."projectId"
WHERE p.name LIKE 'P-przed-%'
  AND (l.model <> 'gemini-3.5-flash-lite' OR l."promptVersion" NOT IN ('chat-v4', 'evaluate-v1', 'impact-v1'))
ORDER BY l."createdAt";
```

Liczba wywołań modelu w scenariuszu = suma `stepCount` z wierszy `chat` + liczba wierszy `evaluate_bmc` i `analyze_impact` (każdy z nich to jedno wywołanie modelu, nie liczę ewentualnych ponowień w SDK po błędach sieci/429). Zużycie limitów konta (łącznie; aplikacja liczy wszystkie wiersze użytkownika, niezależnie od modelu, więc tu bez filtra po `model`): 

```sql
SELECT count(*) AS wiersze_ostatnia_godzina
FROM "LlmCallLog" WHERE "userId" = (SELECT id FROM "User" WHERE email = 'TWÓJ_E-MAIL') AND "createdAt" > now() - interval '1 hour';

SELECT sum(coalesce("inputTokens",0) + coalesce("outputTokens",0)) AS tokeny_doba
FROM "LlmCallLog" WHERE "userId" = (SELECT id FROM "User" WHERE email = 'TWÓJ_E-MAIL') AND "createdAt" > now() - interval '1 day';
```

(Wpisz swój e-mail tylko w `psql`; nie wkleja go do pliku ani do wyników w repozytorium.)

Q2: lista tur z licznikami narzędzi i tekstem:

```sql
SELECT m."createdAt", m.role,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'tool-ask_clarification') AS ask,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'tool-propose_block_change') AS propozycje,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'tool-evaluate_bmc') AS ocena,
  (SELECT count(*) FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'tool-analyze_impact') AS analiza,
  (SELECT string_agg(p->>'text', ' ') FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'text') AS tekst
FROM "ChatMessage" m
WHERE m."projectId" = 'ID_PROJEKTU'
ORDER BY m."createdAt";
```

Jeśli kolumny z licznikami wszędzie dają 0, a w czacie widać karty, sprawdź kształt części: `SELECT jsonb_pretty(parts) FROM "ChatMessage" WHERE "projectId" = 'ID_PROJEKTU' AND role = 'ASSISTANT' ORDER BY "createdAt" DESC LIMIT 1;` i daj mi znać (poprawię nazwy typów w zapytaniu i w planie).

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

Wynik pusty = brak wycieków (poza zwrotami typu „skorzystaj z narzędzia”, które oceniasz oczami; wpisz je w kolumnie „Uwagi”).

Zdanie końcowe po ocenie (M6) czytasz z kolumny `tekst` w Q2 dla wiersza z `ocena = 1`.

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
| S2 | 2 tury | 4 (4–6) | 2 |
| S3 + S5 | 2 tury | 4 (4–6) | 3 (4, jeśli S5 niechcianie woła ocenę) |
| S4 | 2 tury + analiza z UI | 4 (4–6) | 3 |
| **Razem na serię** | | **ok. 19 (17–30)** | **ok. 13 (do 14)** |
| **3 serie na jeden pomiar** | | **ok. 57 (51–90)** | **ok. 39 (do 42)** |
| **„przed” + „po”** | | **ok. 114 (102–180)** | **ok. 78** |

Względem limitów:

- **Limity aplikacji** (`checkUserLimits`, per użytkownik): domyślnie 30 wierszy `LlmCallLog` na godzinę i 200 000 tokenów na dobę. Seria to ok. 13 wierszy, więc 3 serie w ciągu godziny przekraczają 30 (limit jest sprawdzany przed wywołaniem, więc tura przerwana komunikatem o limicie psuje pomiar). Tokeny: jeśli prompt systemowy z dziewięcioma blokami i stanem to ok. 3 000 tokenów wejścia na wywołanie, to seria to ok. 19 × 3 000 ≈ 60 000 tokenów (wejście) plus wyjście, a 3 serie ok. 180 000+: bliskie 200 000 na dobę. Dlatego D3 (rozstrzygnięte): limity w `.env` na czas pomiarów to `CHAT_MAX_REQUESTS_PER_HOUR=60` (3 serie to ok. 39 wierszy w godzinie) i `CHAT_MAX_TOKENS_PER_DAY=600000` (pomiar to ok. 180 000+ tokenów), te same w „przed” i „po”. Limit darmowego planu Gemini może wymusić rozłożenie serii na kilka dni (D1): wtedy kończysz serie „przed” w całości przed zmianą promptu.
- **Limity darmowego planu Gemini** (RPM, RPD, TPM dla `gemini-3.5-flash-lite`): nie przytaczam z pamięci, bo bywają zmieniane. Przed pomiarem odczytaj bieżące wartości z konsoli Google AI Studio (zakładka limitów) i wpisz je poniżej. Ryzyko leży głównie w RPD (ok. 57 wywołań na pomiar, ok. 114 łącznie) oraz w krótkim szczycie przy turze z oceną (3 wywołania w kilka sekund). Przy ręcznym wpisywaniu wiadomości typowo mniej niż 10 wywołań na minutę.

| Limit planu Gemini (stan z dnia pomiaru) | Wartość z AI Studio | Zużycie w pomiarze (szacunek) | Zapas |
|---|---|---|---|
| zapytania na minutę (RPM) | | do 3 w szczycie (tura z oceną) | |
| zapytania na dobę (RPD) | | ok. 57 na pomiar | |
| tokeny na minutę (TPM) | | ok. 10 000 w szczycie | |

Jeśli RPD nie wystarcza na 3 serie jednego dnia, rozłóż pomiar „przed” na dwa dni (serie kompletne, nie scenariusze) i zapisz datę każdej serii.

## Tabele wyników

Uzupełnia właściciel. Wpisuj liczby z zapytań; „Uwagi” na błędy, limity, nietypowe odpowiedzi.

### Wyniki „przed” (`chat-v4`, model: __________, daty serii: __________)

| Scenariusz | Seria | M1 `ask` | M2 serie pytań | M3 niechciane ocena/analiza | M4 wycieki | M5 propozycje przy „wyjaśnij” | M6 brak zdania po ocenie | M8 (0–2) | Wywołania modelu | Tokeny (we/wy) | Uwagi |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | | | | | | | | | | |
| S1 | 2 | | | | | | | | | | |
| S1 | 3 | | | | | | | | | | |
| S2 | 1 | | | | | | | | | | |
| S2 | 2 | | | | | | | | | | |
| S2 | 3 | | | | | | | | | | |
| S3 | 1 | | | | | | | | | | |
| S3 | 2 | | | | | | | | | | |
| S3 | 3 | | | | | | | | | | |
| S4 | 1 | | | | | | | | | | |
| S4 | 2 | | | | | | | | | | |
| S4 | 3 | | | | | | | | | | |
| S5 | 1 | | | | | | | | | | |
| S5 | 2 | | | | | | | | | | |
| S5 | 3 | | | | | | | | | | |

### Wyniki „po” (`chat-v5`, ten sam model, te same scenariusze)

Ta sama tabela, osobna kopia po pomiarze „po”.

| Scenariusz | Seria | M1 `ask` | M2 serie pytań | M3 niechciane ocena/analiza | M4 wycieki | M5 propozycje przy „wyjaśnij” | M6 brak zdania po ocenie | M8 (0–2) | Wywołania modelu | Tokeny (we/wy) | Uwagi |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | | | | | | | | | | |
| S1 | 2 | | | | | | | | | | |
| S1 | 3 | | | | | | | | | | |
| S2 | 1 | | | | | | | | | | |
| S2 | 2 | | | | | | | | | | |
| S2 | 3 | | | | | | | | | | |
| S3 | 1 | | | | | | | | | | |
| S3 | 2 | | | | | | | | | | |
| S3 | 3 | | | | | | | | | | |
| S4 | 1 | | | | | | | | | | |
| S4 | 2 | | | | | | | | | | |
| S4 | 3 | | | | | | | | | | |
| S5 | 1 | | | | | | | | | | |
| S5 | 2 | | | | | | | | | | |
| S5 | 3 | | | | | | | | | | |

### Podsumowanie przed / po (sumy z trzech serii)

| Metryka | Przed | Po | Kryterium sukcesu |
|---|---|---|---|
| M1 `ask` w S1 (suma z 3 serii) | | | wyraźnie mniej niż „przed” |
| M2 najdłuższa seria pytań w S1 | | | nie więcej niż 2 |
| M3 niechciane `evaluate_bmc`/`analyze_impact` (S2, S4, S5) | | | 0 |
| M4 wycieki nazw i identyfikatorów | | | 0 |
| M5 nowe propozycje przy „wyjaśnij” (S4, S5) | | | 0 |
| M6 tury z oceną bez zdania końcowego (S3) | | | 0 albo `prepareStep` (decyzja po „przed”) |

Kryteria są progami roboczymi: przy 3 seriach i modelu niedeterministycznym oceniamy kierunek zmiany i każdy przypadek z osobna, a nie istotność statystyczną. Wynik opisujemy uczciwie, także gdy „po” nie jest lepsze.

## Hipotezy zmian w prompcie `chat-v5` (do potwierdzenia wynikami „przed”)

Nie zmieniam promptu przed wynikami. Poniżej tylko to, co wynika z wpisów w `zadania.md`, żeby dało się ocenić, które metryki mają sens:

1. **Dopytywanie:** w `chat-v4` reguła mówi „zadaj jedno konkretne pytanie” i „dopytuj zamiast zgadywać”, bez limitu tur. Hipoteza: dodać limit (po dwóch turach pytań agent proponuje wpisy), zakaz powtarzania pytań o to, co użytkownik już podał, i nazywanie założeń w uzasadnieniu propozycji.
2. **Wyjaśnienia:** przy pytaniu o wynik oceny lub analizy odsyłaj do karty/panelu, nie proponuj nowych zmian i nie wołaj `evaluate_bmc`/`analyze_impact`.
3. **Nazwy techniczne:** zakaz podawania nazw narzędzi i identyfikatorów w odpowiedziach; propozycję opisuj jej faktyczną treścią.
4. **Spójność reguł (D5, rozstrzygnięte):** `chat-v4` mówi „Proponuj tylko to, co wynika z rozmowy”, a wpis o dopytywaniu chce propozycji „z jawnie podanymi założeniami”. W `chat-v5` propozycja może zawierać założenie, pod warunkiem że uzasadnienie (`rationale`) ma prefiks „Założenie:”, nie zawiera liczb, a w tekście czatu agent wprost mówi, że to założenie do sprawdzenia. Wyjątek od „tylko to, co wynika z rozmowy” musi być w prompcie sformułowany tak, żeby nie otwierał drogi do wymyślania faktów ani danych liczbowych.

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
