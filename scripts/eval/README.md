# Skrypt ewaluacji agenta (krok 10, PR 10f)

Mierzy, jak modele Gemini budują i oceniają modele biznesowe (BMC), na zamrożonym zestawie przypadków. Wyniki zapisują się w bazie
(`EvalRun`, projekty pomiarowe `EV-…`, `LlmCallLog`, `EvaluationResult`). **Uruchamia go wyłącznie właściciel**: skrypt ładuje `.env`
(klucze API, baza) i woła prawdziwe API. Testy automatyczne działają tylko na mockach.

## Uruchamianie

```powershell
npm run eval -- --serie PILOT-1 --przypadki BUILD-01 --modele gemini-3.5-flash-lite
```

To **tryb na sucho** (domyślny): wypisuje listę przypadków, model, limity wyjścia, liczbę tur, szacowany koszt i które przebiegi
zostałyby pominięte lub powtórzone. Nie woła modelu i nie zapisuje do bazy (czyta tylko `EvalRun` i sprawdza konto).

Prawdziwy przebieg wymaga `--wykonaj` oraz jawnych bezpieczników (bez wartości domyślnych):

```powershell
npm run eval -- --serie PILOT-1 --przypadki BUILD-01 --modele gemini-3.5-flash-lite --wykonaj --max-koszt-usd 0.15 --max-tur 15
```

Przypadek `BUILD` trwa od 6 do 14 tur (6 stałych wiadomości i do 8 kontynuacji), więc `--max-tur` dla pojedynczego BUILD ustaw na co najmniej 15, a tryb na sucho ostrzeże, gdy limit jest za niski.

Zmienne środowiskowe trafiają do procesu przez `node --env-file=.env` w skrypcie `eval` z `package.json`; sam skrypt niczego nie czyta z
pliku. Bez `npm`: `node --env-file=.env scripts/eval/run.mjs <argumenty>`. Sprawdzenie, że importy działają poza Next.js (bez `.env`,
bez modelu i bazy): `npm run eval:importy`.

Wymagane w `.env`: `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `LLM_PROVIDER=google`, `LLM_MODEL`, **`EVAL_USER_EMAIL`** (konto
pomiarowe) oraz, z `--sedzia`, `JUDGE_PROVIDER`, `JUDGE_MODEL` i `ANTHROPIC_API_KEY`.

## Argumenty

| Argument | Znaczenie |
|---|---|
| `--serie ID` | identyfikator serii (litery, cyfry, myślniki; do 24 znaków); wchodzi do nazw projektów |
| `--przypadki` | lista (`BUILD-01,EVAL-02`), `minimalny` (BUILD 01–04, EVAL 01–04, CHAT-S1 do S5) albo `wszystkie` (19); `CHAT-S5` wymaga `CHAT-S3` |
| `--modele` | lista modeli generujących, **tylko z `ALLOWED_CHAT_MODELS`** (`models.ts`, modele z cennikiem); domyślnie `LLM_MODEL` |
| `--powtorzenia N` | liczba powtórzeń (1–10, domyślnie 1) |
| `--sedzia` | po zbudowaniu (BUILD) i dla EVAL: 3 sądy sędziego (`trigger = SCRIPT`); model sędziego z `JUDGE_*`, stały w serii |
| `--max-wyjscia N`, `--max-wyjscia-dlugie N` | limity tokenów wyjścia (czat; operacje długie), zapisywane w `EvalRun` |
| `--przerwa-ms N` | przerwa między przebiegami |
| `--powtorz-niewazne` | powtarza przebiegi `INVALID` jako kolejną próbę |
| `--wykonaj` | prawdziwy przebieg (wymaga `--max-koszt-usd` i `--max-tur`) |
| `--max-koszt-usd X`, `--max-tur N` | bezpieczniki bieżącego uruchomienia (kontynuacje BUILD liczą się do `--max-tur`) |

Nie ma `providerOptions` ani ustawień „thinking” (decyzja zapada w 10g).

## Kody wyjścia (PowerShell: `$LASTEXITCODE`)

`0` zakończono (także tryb na sucho) · `1` nieoczekiwany błąd · `2` odmowa startu · `3` przerwano bezpiecznikiem lub Ctrl+C ·
`4` błąd krytyczny w trakcie (konfiguracja, odrzucony klucz).

## Odmowy startu (kod 2, bez zapisów)

Błędne argumenty; `--wykonaj` bez `--max-koszt-usd` lub `--max-tur`; model spoza listy; **zestaw przypadków niezamrożony lub niezgodny z
`FROZEN_CASES_CHECKSUM`** (w trybie na sucho tylko ostrzeżenie); brak zmiennej `EVAL_USER_EMAIL` albo konta o tym adresie (adres nie
jest drukowany); błędna konfiguracja modelu (komunikat bez wartości kluczy).

## Bezpieczniki

- Dotyczą **bieżącego uruchomienia skryptu** (od jego startu), nie całej serii, więc wznowienie nie zatrzymuje się od razu.
- Sprawdzanie jest **po turze** (i po operacji AI), więc **jedna tura może przekroczyć limit** (do `MAX_STEPS` kroków modelu). Przerwanie
  następuje, gdy limit jest osiągnięty lub przekroczony.
- `COST_LIMIT`: suma `costUsd` z `LlmCallLog` dla projektów utworzonych w tym uruchomieniu. `TURN_LIMIT`: liczba tur czatu.
  `COST_UNKNOWN`: udane wywołanie bez kosztu (model bez ceny w `MODEL_PRICING`). `USER_ABORT`: Ctrl+C (drugie Ctrl+C wymusza wyjście).
- Przerwany przypadek dostaje `EvalRun.status = STOPPED` z tym kodem, komunikat po polsku, kod wyjścia 3.

## Limity użytkownika konta pomiarowego

Skrypt pomija limity użytkownika (żądania na godzinę i tokeny na dobę) tylko w **własnym procesie**: tura przez
`prepareChatTurnWithoutUserLimits`, a operacje wewnątrz tury i bezpośrednie wywołania przez podniesione zmienne w `process.env`
(`CHAT_MAX_REQUESTS_PER_HOUR`, `CHAT_MAX_TOKENS_PER_DAY`). Serwer aplikacji nie ma tego obejścia. **Zalecane osobne konto
pomiarowe (`EVAL_USER_EMAIL`)**: tury skryptu liczą się do dziennego limitu tego konta w aplikacji, więc na zwykłym koncie mogłyby go
wyczerpać.

## Wznawianie i statusy

`OK` i `FAILED` (wynik pomiaru, np. zbyt pusty model) oraz `INVALID` (awaria techniczna: wyjątek z tury, błąd dostawcy po
ponowieniach, `NO_END`) są pomijane przy ponownym uruchomieniu tej samej serii; `INVALID` powtarza się z `--powtorz-niewazne`.
`STOPPED` powtarza się jako **nowa próba** (`attempt + 1`) w nowym projekcie `EV-<seria>-<przypadek>-p<n>-a<k>`; stary wiersz i projekt
zostają jako historia. Wiersz `RUNNING` po awarii procesu jest przy starcie oznaczany jako `STOPPED / CRASHED`.

**Ważne:**

- **Przebiegi z innym `--max-wyjscia` lub `--max-wyjscia-dlugie` muszą mieć inne `--serie`.** Limity nie są w kluczu unikalności
  (`seriesId, caseId, model, repetition, architecture, attempt`), więc drugi przebieg w tej samej serii zostałby pominięty jako ukończony.
- **Nie uruchamiaj dwóch procesów na tej samej serii naraz**: wznowienie oznacza `RUNNING` jako `CRASHED`, więc drugi proces
  zepsułby wiersze pierwszego.

## Projekty pomiarowe i anonimizacja

Każdy przebieg tworzy projekt `EV-<seria>-<przypadek>-p<powtórzenie>[-a<próba>]` z opisem „Nowy model biznesowy.” (bez nazwy firmy,
modelu i informacji o teście). **Nazwa jest widoczna dla czatu i `evaluate-v1`** (jak w serii „P”), a dla sędziego nie (sędzia dostaje
tylko stan BMC). Opisy i wiadomości przypadków `BUILD` nie zawierają nazwy firmy ani aliasów (pilnuje tego test); prawdziwa nazwa jest
tylko w `src/lib/eval/cases.ts`. Przypadki `EVAL` zostają z nazwami (ocena gotowego modelu). Zestaw jest zamrożony sumą kontrolną
(`FROZEN_CASES_CHECKSUM`); każdy przebieg zapisuje ją w `EvalRun.casesChecksum`.

## Ograniczenia

- `BUILD` używa wprost terminów BMC i mierzy głównie przenoszenie informacji do bloków; wydobywanie ich z luźnej rozmowy pokrywają
  scenariusze `CHAT`.
- Skrypt **akceptuje wszystkie propozycje** agenta (BUILD), więc mierzy zdolność budowy, nie dialog z użytkownikiem.
- **Stała kontynuacja BUILD** (protokół kontynuacji, `BUILD_CONTINUATION_MESSAGE` w `cases.ts`): po 6 wiadomościach skrypt wysyła „Tak, zaproponuj kolejne wpisy na podstawie tego, co już napisałem.” (najwyżej 8 razy, do 14 tur) aż do wypełnienia 9 bloków (`ALL_BLOCKS`), dwóch kolejnych tur bez nowych propozycji (`NO_NEW_PROPOSALS`) albo limitu kontynuacji (`CONTINUATION_LIMIT`); `EvalRun.turnCount` i `EvalRun.endReason` zapisują liczbę tur i powód. Kontynuacja jest zawsze taka sama i **nie odpowiada na pytania agenta**, więc BUILD mierzy tempo zamiany opisu na wpisy, a nie prowadzenie dialogu. Kontynuacje liczą się do `--max-tur`. Powód protokołu: agent `chat-v6` prowadzi wywiad blok po bloku (`docs/plan-krok-10.md`, punkt 22).
- Analiza wpływu w `CHAT-S4` zapisuje trigger `UI` (enum `ImpactTrigger` nie ma `SCRIPT`); rozpoznanie po projekcie `EV-…` i `EvalRun`.
  Narzędzia czatu (`evaluate_bmc`) zapisują `trigger = CHAT`; ocena `EVAL` i sędzia ze skryptu: `SCRIPT`.
- Szacunek kosztu w trybie na sucho jest niezmierzony (rozrzut ±50%); ceny z `MODEL_PRICING` (stan z `MODEL_PRICING_CHECKED_AT`).

## Zapytania SQL

Propozycje niezaakceptowane przez skrypt (po przebiegu BUILD każda propozycja o statusie innym niż `ACCEPTED`), bez zmiany schematu:

```sql
\set prefix 'EV-PILOT-1-BUILD-%'
SELECT p.name AS projekt,
       count(*) FILTER (WHERE pr.status = 'ACCEPTED') AS zaakceptowane,
       count(*) FILTER (WHERE pr.status <> 'ACCEPTED') AS niezaakceptowane
FROM "Project" p
JOIN "BmcVariant" v ON v."projectId" = p.id
JOIN "Proposal" pr ON pr."variantId" = v.id
WHERE p.name LIKE :'prefix'
GROUP BY p.name
ORDER BY p.name;
```

Koszt i wywołania przebiegu liczysz z `LlmCallLog` po `projectId` (łącznik: `EvalRun.projectId`); tokeny, czas i koszt nie są kopiowane do `EvalRun`.

Wyniki zbiorcze i eksport CSV (`eval-wyniki/`, poza gitem) dochodzą w PR 10f-2.
