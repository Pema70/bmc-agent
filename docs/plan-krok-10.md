# Plan kroku 10: dane przykładowe, ocena ręczna, niezależny sędzia i ewaluacja modeli

> Sekcja „Zmiany po akceptacji” na końcu pliku ma pierwszeństwo przed treścią powyżej (puste do czasu akceptacji).

Krok 10 z `docs/spec.md` §14 (szczegóły §6, §12, §13). **Zaakceptowany z poprawkami (2026-11-25).** Poprawki w „Zmianach po akceptacji” mają pierwszeństwo.

Ten plik trafia 1:1 do `docs/plan-krok-10.md` jako pierwszy commit `docs:` pierwszego PR-a (10a). Zasada z kroków 3 do 9: **żadnych zmian w kodzie, schemacie ani zależnościach przed akceptacją tego planu**; schemat (10d, 10f), nowe zależności (10c), modele i budżet wymagają osobnej akceptacji przed migracją/instalacją/pomiarem.

## Kontekst

Cel kroku: zebrać wiarygodny materiał do rozdziału testowego pracy: (1) dane przykładowe z prawdziwych firm (sukces i upadek), (2) ręczna ocena referencyjna (rubryka z góry), (3) niezależny „sędzia” z innej rodziny modeli niż generujący, oceniający wyłącznie dziewięć bloków, (4) stały zestaw przypadków i skrypt ewaluacji uruchamiany przez właściciela dla ≥3 modeli, (5) metryki z §12 (ocena sędziego, ręczna, zgodność ze schematem, czas, koszt, liczba wywołań) i pole architektury gotowe na krok 11.

Wnioski z poprzednich kroków, które plan uwzględnia:
1. Testy bez prawdziwego API; **pomiary z prawdziwym API tylko przez właściciela** (skrypt ładuje `.env`; ja nie czytam i nie ładuję `.env`).
2. Metodyka z PR „P”: warunki stałe, ważność serii/scenariusza, N powtórzeń, zastrzeżenia przy cytowaniu, uczciwy opis także wyników niekorzystnych, brak testów statystycznych przy małym N.
3. Treści modeli i użytkownika tylko jako zwykły tekst; dane i załączniki to dane, nie instrukcje; sędzia dostaje wyłącznie bloki.
4. Każda nowa ścieżka ma test z prawdziwymi funkcjami i zamockowanym tylko klientem Prisma.
5. **Bez zmian w `chat-v6`** w tym kroku, chyba że seria S1–S5 wykaże regresję (wtedy osobny PR `fix/prompt-chat-v7` z pomiarem przed i po).

Ograniczenia: projekty jednoosobowe; każdy PR zatrzymuje się po otwarciu; `build`, migracje, `generate`, `db seed` i skrypty z `.env` uruchamia właściciel; dane wyłącznie przykładowe i publicznie znane; CAGR i decyzja o pomiarze B **poza zakresem do rozmowy z promotorem** (patrz „Otwarte”); niczego nie usuwam.

## Co sprawdziłem (odczyt, dzień zapisu planu)

**Kod:**
- `src/lib/ai/models.ts`: jedna nazwa logiczna `chat`; `getChatModel(name)` **ignoruje `name`**; obsługiwany tylko dostawca `google` (`SUPPORTED_PROVIDERS = ["google"]`); brak `judge`, `JUDGE_*`, `@ai-sdk/anthropic` i `@ai-sdk/openai` w `package.json`; `MODEL_PRICING` (4 pozycje, `MODEL_PRICING_CHECKED_AT = "2026-11-10"`); koszt: `computeCostUsd` w `log.ts` (bez progów kontekstu i dat; `null`, gdy brak ceny).
- `src/lib/ai/run-object-operation.ts`: wspólny silnik operacji obiektowych (ocena, wpływ, strategie, porównanie, pytania, poprawki) z **zahardkodowanym `getChatModel("chat")`**; ocena: `evaluate.ts` (`evaluate_bmc`, `evaluate-v1`), prompt dostaje **nazwę i opis projektu** (`buildEvaluatePrompt(project, state)`), więc sędzia „w ciemno” wymaga osobnego wejścia.
- Schemat: `EvaluationSource { AI MANUAL }`, `EvaluationTrigger { UI CHAT }` (kolumna opcjonalna), `EvaluationResult` wymaga `projectId` i `variantId` (więc każda ocena, także sędziego i ręczna, dotyczy istniejącego wariantu); `llmCallLogId` opcjonalny; `createEvaluation` zapisuje `source: "AI"` na sztywno; `parseEvaluationRow` wymaga dostawcy, modelu i wersji promptu tylko dla `AI`. Wartości `MANUAL` są w enumie, w parserze i testach, ale **nie ma formularza ani akcji zapisującej `MANUAL`**.
- Radar: `RadarChart` rysuje **najwyżej 2 serie** (ciągła z kółkami, przerywana z rombami); `comparableEvaluations` nie filtruje po `source`; dodanie trzeciej serii wymaga trzeciego stylu i tokenu (≥ 3:1).
- **Brak** `prisma/seed.ts` (i wpisu seed w `prisma.config.ts`), katalogu `scripts/`, skryptów pomiarowych i runnera TS (`tsx` nie ma; Node `>=22`). `prisma.config.ts` ładuje `.env` przy każdej komendzie Prismy (uruchamia właściciel).
- Czat: logika w `src/app/api/chat/route.ts` (`streamText`, narzędzia, `stopWhen`, limity); **nie ma wywoływalnego rdzenia poza HTTP**, więc skrypt nie uruchomi agenta bez wydzielenia (decyzja D9).
- Limity: `checkUserLimits` liczy z `LlmCallLog` łącznie dla `userId` (30 żądań/h, 200 tys. tokenów/dobę); operacje z `userId = null` ich nie zużywają.

**Dokumentacja dostawców (strony oficjalne, odczytane w dniu zapisu; ceny USD za 1 mln tokenów):**

| Model (ID API) | Wejście | Wyjście | Uwagi (ze strony) |
|---|---|---|---|
| `claude-haiku-5-5` (kandydat na sędziego) | 0,10 | 0,50 | prompt ≤ 100 tys. tokenów; powyżej 0,50 / 2,50; wycofanie „nie wcześniej niż 7.10.2027”; batch 0,05 / 0,25 |
| `claude-sonnet-5-5` | 2 | 10 | wycofanie „nie wcześniej niż 28.09.2027”; batch 1 / 5; od Claude 4.7 nowy tokenizer daje ok. 30% więcej tokenów |
| `gemini-3.5-flash-lite` (model dev) | 0,30 | 2,50 | batch 0,15 / 1,25; płatny plan |
| `gemini-3.6-flash` | 0,75 | 3,75 | do 31.12.2026; od 1.01.2027 1,50 / 7,50 (**w `MODEL_PRICING` jest `gemini-3.8-flash` z tymi samymi liczbami; strona cen go nie zawiera, `zadania.md` notuje, że nie działał: do poprawy w 10c**) |
| `gpt-6-luna` | 0,10 | 0,50 | powyżej 272 tys. tokenów 0,20 / 0,75; kandydat ze spec §12 |
| `gpt-5-nano` | 0,05 | 0,40 | najtańszy; alternatywa |
| `gpt-5.6-luna` | 0,20 | 1,20 | alternatywa |

Niepotwierdzone (do sprawdzenia w 10c przed pomiarami): obsługa ustrukturyzowanego wyjścia (`Output.object`) przez `@ai-sdk/anthropic` dla `claude-haiku-5-5` i przez `@ai-sdk/openai` dla `gpt-6-luna` (strona cen OpenAI tego nie podaje); limity zapytań Gemini (strona cen ich nie zawiera); **sposób ustawienia limitu wydatków w konsoli Anthropic** (strony cen i modeli nie opisują, odsyłają do `platform.claude.com/usage/limits` i `settings/billing`): ustawia właściciel, potwierdzenie zrzutem/opisem przed pomiarami.

**Zależności (`npm view`, dzień zapisu; próg 14 dni = wersje opublikowane do 10.11.2026):** `@ai-sdk/anthropic` latest 4.0.108 (24.11, za świeża); najnowsza spełniająca próg **4.0.102** (10.11, 20:17 UTC). `@ai-sdk/openai` latest 4.0.123 (24.11, za świeża); najnowsza spełniająca próg **4.0.114** (10.11, 20:18 UTC). Obie z `peerDependencies: zod ^3.25.76 || ^4.1.8` i zależnościami `@ai-sdk/provider 4.0.39`, `@ai-sdk/provider-utils 5.0.83`. Zgodność z zainstalowanym `ai 7.0.154` i `@ai-sdk/google 4.0.106` oraz drzewo zależności, skrypty instalacyjne i `npm audit`: **sprawdzam dopiero w 10c, przed zgodą** (jak w kroku 9). Wersje potwierdzam w dniu instalacji (próg liczony od tego dnia).

## Rozbieżności i doprecyzowania względem spec (wygrywa spec)

1. **Rekomendacja ze spec §6 przyjęta:** sędzia to ten sam `EvaluationResult` z `source = JUDGE` (nie osobna tabela); wymaga wartości w enumie (migracja w 10d).
2. **Decyzja o `trigger` (wpis w `zadania.md`):** nowa wartość **`SCRIPT`** w `EvaluationTrigger` (dla sędziego uruchamianego skryptem); sędzia z przycisku w interfejsie ma `UI`. `null` zostaje zarezerwowane dla `MANUAL` (jak dziś). Alternatywa: `null` także dla skryptu (odrzucona: gubi odróżnienie ręcznej od skryptowej).
3. **Decyzja o przycisku w dev (wpis w `zadania.md`):** `CLAUDE.md` dopuszcza płatne API Anthropic na etapie testów porównawczych, a to jest ten etap; koszt jednego sądu jest znikomy (rzędu 0,001 USD). Rekomendacja: **główną drogą jest skrypt; przycisk w interfejsie istnieje, ale jest ukryty, dopóki nie ustawisz `JUDGE_UI_ENABLED=true` oraz `JUDGE_*` i klucza** (EDITOR+, liczy się do limitów użytkownika, zapis w `LlmCallLog`); domyślnie wyłączony w dev, więc nic nie wywoła Anthropica bez Twojej decyzji.
4. **Kryteria sędziego (spec §15):** te same cztery co `evaluate_bmc`, ta sama rubryka 1 do 10 (w tym „ryzyko: 10 = niskie”); bez dodatkowych kryteriów (porównywalność z ocenami AI i ręcznymi). Sędzia **nie widzi nazwy branży** (spec: dziś nie); liczba powtórzeń sędziego na jeden BMC: **3** (mediana z trzech jako wartość porównawcza, rozstęp jako miara jego niepewności).
5. **Wspólna rodzina:** Sonnet 5.5 (generujący) i Haiku 5.5 (sędzia) to ta sama rodzina Anthropic; spec każe to opisać i uzupełnić oceną ręczną. Plan: ocena ręczna **w ślepej próbie** (D7), a w pracy zastrzeżenie. Opcja dodatkowa (nie w wariancie minimalnym): drugi sędzia z innej rodziny (np. `gpt-6-luna`) do sprawdzenia faworyzowania, tylko jako kontrola na podzbiorze.
6. **Krok 7 i sędzia:** ponowna ocena migawek z rund poprawek przez sędziego (zapytanie z `plan-krok-7.md`) wymaga danych z pomiaru B, który jest otwarty; plan przygotowuje **funkcję i zapytanie**, a wykonanie zależy od decyzji o pomiarze B (patrz „Otwarte”).

## Podział na PR-y

Każdy zaczyna się po zmergowaniu poprzedniego. **Zależności tylko w 10c, migracje tylko w 10d i 10f, po Twojej zgodzie.** Migracje, `generate`, `db seed`, `build` i skrypty z `.env` uruchamiasz Ty.

### PR 10a: `feat/seed-przykladowe`: dane przykładowe z prawdziwych firm
Pierwszy commit `docs:` z tym planem.
- `prisma/seed.ts` + wpis `migrations.seed` w `prisma.config.ts` (zgoda przy PR; uruchomienie `npx --no-install prisma db seed` po Twojej stronie) + `src/lib/seed/companies.ts` (dane jako czysty moduł z `BmcState`, walidowany Zod): **konto seedowe** `seed@example.com` (hasło `!`, nie da się zalogować, jak konto testowe 4b), jeden projekt na firmę (nazwa z prefiksem `Seed: `), wariant główny z modelem, pole `entryOrigins` = `MANUAL` (pochodzenie „ręczny”: opis publicznych faktów). Seed jest **idempotentny** (upsert po nazwie, nic nie kasuje, nie nadpisuje zmienionych przez Ciebie projektów: jeśli projekt istnieje, pomija go z komunikatem).
- Propozycja firm (opis modelu z publicznie znanych faktów, **bez liczb, kwot, udziałów i dat poza rokiem założenia/upadku**; przy każdej firmie `Źródło: publicznie dostępne informacje` oraz moment, którego model dotyczy):
  - **Sukces:** Netflix (subskrypcja streamingu), Airbnb (platforma wymiany dwustronnej), Spotify (freemium z subskrypcją).
  - **Upadek lub zamknięcie:** Blockbuster (wypożyczalnie stacjonarne i opłaty za zwłokę, model sprzed streamingu), Quibi (krótkie wideo premium na telefony, zamknięte po kilku miesiącach), Juicero (urządzenie do soków i paczki, zamknięte w 2017).
  - Dlaczego te: szeroko opisane w publicznych źródłach, bez wątków prawnych i osób prywatnych (świadomie **bez** Theranos i WeWork: spory prawne i zarzuty wymagałyby szczególnej ostrożności w opisie). Alternatywy do wyboru: Kodak, Dropbox, Nokia. **Zastrzeżenie:** każdy wpis to uproszczony opis; Ty weryfikujesz przed użyciem w pracy; opis nie zawiera wymyślonych liczb.
  - Dodatkowo **„Kawiarnia Ziarno”** (model z PR „P”, 19 wpisów) jako przypadek bez wiedzy modelu o firmie (kontrola na wpływ pamięci modelu o znanych firmach).
- Testy: każdy model przechodzi `BmcState` (limity wpisów i długości), **test pilnujący, że wpisy nie zawierają liczb poza czterocyfrowym rokiem** (zabezpieczenie przed wymyślonymi danymi), idempotencja seeda (mock Prismy), brak `.env`/kluczy w module.

### PR 10b: `feat/ocena-reczna`: ręczna ocena referencyjna (4e) i trzecia seria radaru
- Server Action `createManualEvaluation(projectId, variantId, input)` (sesja → rola EDITOR+ → wariant po projekcie → Zod `EvaluationOutput`): zapis `source = MANUAL`, `trigger = null`, `provider/model/promptVersion = null`, `variantVersion` i `stateSnapshot` bieżącego zapisanego stanu, **bez wywołania modelu**, bez `LlmCallLog`. Nowa funkcja `createManualEvaluation` w `src/lib/db/evaluations.ts` (dziś zapis ma `source: "AI"` na sztywno).
- Formularz w panelu „Ocena” (EDITOR+): cztery kryteria (liczba 1 do 10 i uzasadnienie ≤ 600 znaków, zwykły tekst), opis rubryki wprost przy polach (te same definicje co prompt oceny, „ryzyko: 10 = niskie”), blokada przy niezapisanych zmianach (jak „Oceń model”); formularz **nie pokazuje wyników AI ani sędziego** przed zapisem (ślepa ocena, D7).
- Radar: trzecia seria (`SERIES_STYLE` + token koloru ≥ 3:1 na powierzchni i tincie, np. istniejący `low-fg` z linią kropkowaną i kwadratowym znacznikiem), wybór nakładek (do dwóch porównawczych), legenda tekstowa z etykietą źródła („AI”, „ręczna”, „sędzia”) i wersją wariantu; zamyka wpis „Nakładka radarowa w porównaniu wariantów” **tylko w części oceny jednego wariantu** (porównanie wariantów zostaje otwarte, osobny wpis).
- Raport/eksport: oceny `MANUAL` już mają miejsce w `loadReportData` (grupowanie po `source`); test, że nie są dopisywane jako „AI”.
- Testy: akcja (kolejność sesja, rola, wariant, Zod; VIEWER 403; obcy wariant 404; limity długości), zapis `MANUAL` bez `LlmCallLog`, `parseEvaluationRow` dla `MANUAL`, radar trzy serie (geometria bez zmian w `radar.ts`), kontrasty trzeciej serii w `design-tokens.test.ts`.

### PR 10c: `chore/dostawcy-modeli`: zależności i konfiguracja modeli
**Stop na początku:** ponownie sprawdzam wersje i drzewo (dzień instalacji), pokazuję wynik z `npm audit` w katalogu tymczasowym (`--package-lock-only --ignore-scripts`) i czekam na zgodę. Instalacja: `npm install --save-exact --ignore-scripts --before=<dzień instalacji minus 14 dni> @ai-sdk/anthropic@<wersja> @ai-sdk/openai@<wersja>`.
- `package.json` i lockfile; `dependencies.test.ts` (dokładne wersje, brak skryptów instalacyjnych).
- `src/lib/ai/models.ts`: obsługa dostawców `openai` i `anthropic`; **nazwy logiczne `chat` i `judge`**; `getChatModel(name)` przestaje ignorować `name`; `judge` czyta **`JUDGE_PROVIDER` i `JUDGE_MODEL`** (osobny zod, niezależnie od `LLM_*`); klucze jak dziś (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` tylko w `.env`); brak nazw modeli na stałe poza `MODEL_PRICING`. `MODEL_PRICING` i `MODEL_PRICING_CHECKED_AT` aktualizowane z tabeli powyżej (dodane: `anthropic/claude-haiku-5-5`, `anthropic/claude-sonnet-5-5` bez zmian, `google/gemini-3.6-flash` zamiast `gemini-3.8-flash` po potwierdzeniu, `openai/gpt-6-luna`); zastrzeżenia o progach kontekstu (`haiku` > 100 tys., `gpt-6-luna` > 272 tys.) i dacie 1.01.2027 w komentarzu, bo `computeCostUsd` ich nie zna (prompty sędziego i pomiarów mieszczą się poniżej progów; test pilnuje).
- `.env.example`: `JUDGE_PROVIDER`, `JUDGE_MODEL`, `JUDGE_UI_ENABLED` (puste).
- `run-object-operation.ts`: parametr nazwy modelu w specyfikacji operacji (domyślnie `chat`, więc istniejące operacje bez zmian zachowania; testy charakteryzujące `evaluate`/`impact` zostają zielone).
- **Sprawdzenie przed 10d (test z mockiem):** `Output.object` z modelem Anthropic i OpenAI przez zamockowany model SDK; ręczna próba właściciela w 10g na pilocie.
- Testy: konfiguracja każdego dostawcy (poprawna, brak klucza, zły dostawca), `judge` niezależny od `LLM_*`, ceny i koszt (w tym `null` dla nieznanego), brak `ANTHROPIC_API_KEY` w kodzie klienta.

### PR 10d: `feat/sedzia`: niezależny agent oceniający (`judge_bmc`)
**Stop na schemacie:** pokazuję diff i czekam na akceptację przed migracją. Migracja: `ALTER TYPE "EvaluationSource" ADD VALUE 'JUDGE'; ALTER TYPE "EvaluationTrigger" ADD VALUE 'SCRIPT';` (kontrola SQL: brak `DROP INDEX "BmcVariant_projectId_main_key"` i brak `DROP CONSTRAINT "RefinementRound_roundNumber_check"`; PostgreSQL wymaga, by nowych wartości enuma nie użyć w tej samej transakcji: sprawdzam przy `--create-only`).
- `src/lib/ai/prompts/judge.ts`: `JUDGE_PROMPT_VERSION = "judge-v1"`; **ta sama rubryka** co `evaluate-v1` (jedno źródło definicji kryteriów, wspólna stała, żeby sędzia i `evaluate_bmc` nie rozeszły się), bez nazwy, opisu, historii, załączników, wariantów i ocen; dane w blokach `<bmc_state>` jako dane, nie polecenia; zakaz wymyślania faktów i liczb; stała kolejność bloków i format; zwykły tekst.
- `src/lib/ai/judge.ts`: `runJudge(ctx)` na `runObjectOperation` z modelem `judge`; operacja `judge_bmc`; ten sam `EvaluationOutput`; `isSufficient` jak ocena (min. 5 wpisów w 3 blokach); `ctx.trigger: "UI" | "SCRIPT"`; limity użytkownika dla `UI` (jak ocena), dla `SCRIPT` `userId` konta pomiarowego (limity podnosisz na czas pomiaru jak w PR „P”).
- `src/lib/db/evaluations.ts`: `createEvaluation` przyjmuje `source: "AI" | "JUDGE"`; `parseEvaluationRow`: dostawca, model i wersja promptu wymagane dla `AI` i `JUDGE`; `EvaluationSource` i `EvaluationTrigger` w Zod rozszerzone.
- Interfejs: przycisk „Oceń sędzią (AI)” w panelu „Ocena”, **widoczny tylko przy `JUDGE_UI_ENABLED=true`** i skonfigurowanym `JUDGE_*`; wynik oznaczony „sędzia” i modelem; opisy w panelu i w raporcie (sekcja „Oceny sędziego”: raport grupuje po `source`, test dla `JUDGE`).
- Testy: schemat, parser wiersza (`JUDGE` poprawny, bez modelu odrzucony), **sędzia nie dostaje nazwy ani opisu projektu** (test na treść promptu z „złośliwą” nazwą i opisem), `runJudge` ze ścieżkami błędów (limit, za mało wpisów, `SCHEMA_ERROR`, brak konfiguracji `judge`), zapis `JUDGE` + `LlmCallLog`, przycisk ukryty bez flagi.

### PR 10e: `refactor/rdzen-agenta`: wywoływalny rdzeń tury czatu (do akceptacji D9)
Warunek wykonania ewaluacji budowania BMC przez agenta (skrypt nie może wołać `route.ts`). **Czysta refaktoryzacja bez zmiany zachowania i bez zmiany promptów/opisów narzędzi:** `src/lib/ai/chat-agent.ts` z funkcją `runChatTurn(ctx, messages)` (to samo `streamText`, narzędzia, `stopWhen`, limity) używaną przez `route.ts`; testy charakteryzujące trasy zostają bez zmian, `git diff` w `src/lib/ai/prompts` i opisach narzędzi pusty. To także podstawa kroku 11 (`AGENT_MODE`). Alternatywa (D9): skrypt ewaluacji tylko z operacjami obiektowymi (ocena, strategie) bez agenta czatu, wtedy 10e odpada, a serię S1–S5 robisz ręcznie jak w PR „P”.

### PR 10f: `feat/skrypt-ewaluacji`: zestaw przypadków i skrypt ewaluacji
**Stop na schemacie** (tabela `EvalRun`, sekcja niżej).
- `src/lib/eval/cases.ts` (Zod, **zamrożony przed pierwszą serią**, suma kontrolna w teście): 
  - **`BUILD-*` (7):** firma z seeda lub Kawiarnia Ziarno; wejście: krótki opis (tylko publiczne fakty) i **skrypt odpowiedzi użytkownika** (stałe wiadomości, jak S1 w PR „P”); agent buduje model przez propozycje; skrypt **akceptuje wszystkie propozycje** tą samą funkcją co interfejs (`acceptProposal`); wynik: stan wariantu po turach.
  - **`EVAL-*` (7):** `evaluate_bmc` (i sędzia) na gotowym modelu z seeda: mierzy różnice ocen między modelami przy **tym samym** wejściu (bez budowania).
  - **`CHAT-S1…S5`:** scenariusze z `plan-pr-p.md` dosłownie jako kontrola regresji `chat-v6` (jeśli D9 = rdzeń agenta: skryptowo na modelu dev; metryki M1 do M10 z PR „P”; S4 wymaga akcji „Analizuj wpływ”, w skrypcie wywołanie `runImpactAnalysis` wprost; M8 zostaje oceną ręczną).
  - Rubryka ręczna i definicje metryk w tym samym pliku (D7).
- `scripts/eval/` (TypeScript, runner: patrz D10), `scripts/eval/README.md`: parametry (`--serie`, `--przypadki`, `--modele`, `--powtorzenia`, `--sedzia`, `--tylko-sprawdz` = suchy przebieg bez wywołań, drukuje liczbę wywołań i szacowany koszt z `MODEL_PRICING`), **twardy limit liczby wywołań** (`--max-wywolan`, przerwanie po przekroczeniu), logowanie każdego wywołania w `LlmCallLog`, projekty pomiarowe osobne na przebieg (prefiks `EV-<seria>-…`, nic nie kasowane), wznawianie (pomija ukończone `EvalRun`).
- **Ładowanie `.env` tylko przez skrypt, uruchamiany przez Ciebie.** Skrypt nigdy nie drukuje kluczy; pierwsze wyjście to `--tylko-sprawdz`.
- `EvalRun` (nowa tabela, jedna migracja): `id`, `seriesId`, `caseId`, `kind` (`BUILD | EVAL | CHAT`), `repetition`, `architecture` (**enum `SINGLE | MULTI`**, domyślnie `SINGLE`; pole gotowe dla kroku 11), `provider`, `model`, `chatPromptVersion`, `projectId` (powiązanie z `LlmCallLog` i `EvaluationResult`), `status` (`OK | FAILED | INVALID`), `errorCode`, `startedAt`, `finishedAt`; indeks `[seriesId, caseId]`. **Tokeny, czas i koszt nie są kopiowane**: liczone z `LlmCallLog` po `projectId` (jedno źródło prawdy).
- Zapytania SQL do zestawień (w `scripts/eval/queries.sql` i w opisie PR): średnia i rozstęp oceny sędziego na (przypadek × model), zgodność ze schematem (`LlmCallLog.status` ≠ `OK` / liczba wywołań), czas i koszt na zbudowany BMC, wywołania na BMC, różnica sędzia vs ręczna, ważność serii (odpowiedniki Q1b i Q1c z PR „P”).
- **Eksport do pracy:** `scripts/eval/export.ts` → CSV w UTF-8 z BOM (do Excela) w katalogu poza repozytorium (lub `eval-wyniki/` w `.gitignore`), kolumny: seria, przypadek, model, powtórzenie, architektura, ocena sędziego (4 kryteria + suma), ocena ręczna (jeśli jest), schemat OK, wywołania, tokeny, czas, koszt, wersje promptów, data; **plik do oceny ręcznej z zanonimizowanymi identyfikatorami** (model ukryty, losowa kolejność), klucz w osobnym pliku.
- Testy: walidacja zestawu (Zod, sumy kontrolne, 7+7+5 przypadków), skrypt na zamockowanych modelach (kolejność, limit wywołań, wznawianie, `INVALID` przy błędzie schematu, anonimizacja eksportu, brak kluczy w wyjściu), generatory zapytań/CSV; **brak prawdziwego API w testach**.

### PR 10g: `docs/wyniki-ewaluacji`: pilot, seria i zamknięcie kroku
Tylko `docs/` (bez kodu): wynik pilota (kalibracja kosztu na prawdziwych danych), wyniki serii i oceny, zastrzeżenia, „Stan po kroku 10”, statusy w `zadania.md`. Pomiary wykonujesz Ty (sekcja „Pomiar”).

## Modele, budżet i limity

**Modele ewaluacji (min. 3, spec §12):** (1) `gemini-3.5-flash-lite` (dev, już mierzony), (2) `gpt-6-luna` (OpenAI, kandydat ze spec; **zamiennik `gpt-5-nano` jako tańsza opcja**), (3) `claude-sonnet-5-5`. **Sędzia:** `claude-haiku-5-5`. Wszystkie nazwy i ceny potwierdzone na stronach dostawców w dniu zapisu planu (tabela wyżej) i **do ponownego potwierdzenia w dniu każdej serii** (spec §12 pkt 305).

**Założenia kosztowe (szacunki, niezmierzone; pilot w 10g je koryguje):** jedna budowa BMC przez agenta ≈ 12 wywołań, ≈ 48 tys. tokenów wejścia i 6 tys. wyjścia (na podstawie ok. 57 tys. tokenów na 17 wywołań z PR „P” i dłuższych tur); Claude ma ok. 30% więcej tokenów (nowy tokenizer); `evaluate_bmc` ≈ 2,5 tys. wejścia i 0,7 tys. wyjścia; sąd ≈ 2 tys. wejścia i 0,8 tys. wyjścia.

| Wariant | Zakres | Wywołania | Koszt (USD) | W tym |
|---|---|---|---|---|
| **Pełny** | 7 przypadków `BUILD` × 3 modele × N = 3 (63 budowy) + 7 `EVAL` × 3 × 3 (63) + sędzia 3 × (63 + 7 seedów) + S1–S5 na dev (17) | ok. 800 do 900 | **ok. 5 do 6** | Sonnet 5.5 ≈ 4,3 (21 budów × ≈ 0,20), Gemini ≈ 0,6, OpenAI ≈ 0,2, sędzia Haiku ≈ 0,15 |
| **Minimalny (rekomendacja na start)** | 4 przypadki (Kawiarnia Ziarno, 1 sukces, 1 upadek, 1 dowolny) × 3 modele × N = 2 (24 budowy) + `EVAL` 4 × 3 × 2 + sędzia 3 × 28 + S1–S5 | ok. 380 | **ok. 2** | Sonnet 5.5 ≈ 1,6 (8 budów), reszta < 0,5 |

Rozrzut szacunków: ±50% (długość rozmów, `MAX_STEPS = 3`, ponowienia `maxRetries: 2` zwiększają liczbę wywołań). **Limity wydatków (konsole):** Anthropic: limit **10 USD** na czas pomiarów (sposób ustawienia i potwierdzenie przez Ciebie, patrz „Niepotwierdzone”); OpenAI: limit miesięczny w ustawieniach rozliczeń (np. 5 USD); Gemini: płatny plan z włączonym budżetem/alertem. Skrypt ma `--max-wywolan` i szacunek przed startem; **pilot (jedna budowa na model, 3 budowy) przed całą serią** ocenia rzeczywisty koszt i czas i wstrzymuje decyzję o wariancie. Dla Gemini i OpenAI limity zapytań są wąskim gardłem czasowym (nie kosztowym): skrypt wykonuje wywołania sekwencyjnie z przerwą konfigurowalną i obsługuje `429` ponowieniem z wykładniczym opóźnieniem (po 3 próbach przebieg `INVALID`).

## Metodyka pomiaru (jak w PR „P”)

- **Warunki stałe:** ten sam zestaw przypadków (zamrożony), te same prompty i schematy dla wszystkich modeli (`chat-v6`, `evaluate-v1`, `judge-v1` …), `MAX_STEPS = 3`, `LLM_MAX_OUTPUT_TOKENS = 2000` / `LLM_MAX_OUTPUT_TOKENS_LONG = 12000`, to samo konto pomiarowe, płatne plany, **model sędziego stały w całej serii**, wersje modeli i cen zapisane w opisie serii; podniesione limity użytkownika na czas pomiaru i przywrócone po (Ty).
- **Ważność:** przebieg jest `INVALID`, gdy w jego `LlmCallLog` jest status inny niż `OK` po wyczerpaniu ponowień, gdy model nie dokończył skryptu odpowiedzi, albo wiersz z innym modelem/promptem niż zadeklarowany. Nieważny przebieg powtarza się w świeżym projekcie (`-r1`, `-r2`), a w wynikach wpisuje, który jest ważny; **odpowiedź niezgodna ze schematem jest wynikiem** (liczona w zgodności ze schematem), nie błędem pomiaru.
- **Metryki (§12):** ocena sędziego (4 kryteria i suma, mediana z 3 sądów + rozstęp), ocena ręczna (rubryka z góry, ślepa próba), zgodność ze schematem (`SCHEMA_ERROR` / wywołania), czas (suma i mediana wywołania), koszt z `LlmCallLog.costUsd`, liczba wywołań na zbudowany BMC; dodatkowo zgodność sędzia–ręczna (średnia różnica bezwzględna na kryterium; korelacja rangowa na próbie) i stabilność sędziego (rozstęp w 3 sądach).
- **Zastrzeżenia (do pracy):** małe N bez testów statystycznych; modele znają znane firmy (przypadek Kawiarni Ziarno kontroluje wpływ pamięci modelu); sędzia z tej samej rodziny co Sonnet może go faworyzować; ocena modelu przez model jest obciążona (dlatego ręczna ocena referencyjna); skrypt akceptuje wszystkie propozycje (agent bez człowieka w pętli) i mierzy zdolność budowy, nie dialog z użytkownikiem; ceny według cenników płatnych (także przy darmowych planach), progi kontekstu pominięte w koszcie; nie dostrajamy promptów pod jeden model (spec §12).
- **Rubryka ręczna (zdefiniowana z góry, 0/1/2 na kryterium):** (a) kompletność: dziewięć bloków wypełnionych sensownie, (b) wierność opisowi: brak wymyślonych faktów i liczb, (c) spójność między blokami, (d) zwięzłość i czytelność wpisów. Oprócz tego ocena 4 × (1 do 10) z formularza 10b dla próbki (min. jedna budowa na komórkę przypadek × model: 21 ocen, ok. 1 godzina).

## Pomiar (kto, kiedy, co)

1. **Przed:** 10a do 10f zmergowane; Ty: migracje (`migrate dev`, `generate`), `db seed`, `build`, klucze w `.env` (nie czytam), limity wydatków, konto pomiarowe i podniesione limity.
2. **Pilot (10g):** `--tylko-sprawdz`, potem 3 budowy (po jednej na model) + sędzia: kontrola działania, kosztu i czasu, decyzja o wariancie pełnym/minimalnym.
3. **Seria:** skrypt z Twojej konsoli; ja po fakcie podaję zapytania, Ty wklejasz wyniki; ja tabele i opis (jak w 7g/9).
4. **Ocena ręczna:** plik anonimowy, formularz 10b, potem odsłonięcie klucza.
5. **S1–S5 na `chat-v6`:** zamknięcie wpisu z `zadania.md` (kryteria z PR „P”: M3, M4, M5, M6, M9, M10 = 0; w S4 i S5 brak `ask_clarification`; tokeny w granicy +10% względem 56,8 tys. na serię); regresja = osobny PR `fix/prompt-chat-v7` z pomiarem przed i po.
6. **D9 (narastanie tokenów po odczycie załącznika):** opcjonalnie +2 do 3 wywołań w jednym projekcie z załącznikiem (porównanie `inputTokens` dwóch tur); zamyka wpis albo uzasadnia skracanie wyników odczytu w historii.

## Wpisy z `docs/zadania.md`

| Wpis | Decyzja |
|---|---|
| Niezależny agent oceniający | Zamykany w 10d (decyzja o `trigger` = `SCRIPT`, przycisk za flagą `JUDGE_UI_ENABLED`). |
| Ręczna ocena referencyjna (4e) | Zamykany w 10b. |
| Nakładka radarowa w porównaniu wariantów | Część „ocena jednego wariantu” w 10b; porównanie wariantów zostaje otwarte. |
| Seria S1–S5 na `chat-v6` | Zamykany w 10g (kontrola regresji w zestawie przypadków). |
| Pomiar D9 | Opcjonalnie w 10g. |
| Pomiar B, ponowna ocena migawek sędzią | **Otwarte do decyzji po rozmowie z promotorem**; plan dostarcza funkcję `runJudge` i zapytanie o migawki (z `plan-krok-7.md`), wykonanie zależy od decyzji. |
| Różnica modelu dev | Zamykany w 10c/10g: ceny i nazwy potwierdzone, `MODEL_PRICING` poprawiony (`gemini-3.8-flash`), jeden model dev dla wszystkich serii. |
| Dane testowe (konto `ocena-test@example.com`) | **Zostaje** (usuwanie tylko po Twojej zgodzie); nowe dane seeda mają osobne konto `seed@example.com`. |
| CAGR | **Poza zakresem** (czeka na promotora, spec §15). |
| Zmiany wyglądu (D3, D4) | Bez zmian (odłożone); kroku 10 nie dotyczą promptów ani schematów. |
| Usuwanie projektu, duplikaty wpisów, historia porównań, ochrona czasu ekstrakcji, `SAVE_FAILED`, `MAX_STEPS`, `npm audit` | Poza zakresem; projekty pomiarowe (`EV-…`) i seed **nie są kasowane** (dopisek w „Stanie po kroku 10” do wpisu „Usuwanie projektu”). |

## Decyzje do podjęcia

| | Pytanie | Rekomendacja (alternatywy) |
|---|---|---|
| D1 | Firmy do seeda | **Netflix, Airbnb, Spotify (sukces); Blockbuster, Quibi, Juicero (upadek); plus Kawiarnia Ziarno.** (Kodak, Dropbox, Nokia; bez Theranos i WeWork z powodu sporów prawnych.) |
| D2 | Treść wpisów seeda | Tylko publicznie znane fakty, bez liczb poza rokiem, z zastrzeżeniem i Twoją weryfikacją; test blokuje liczby. |
| D3 | Model sędziego | **`claude-haiku-5-5`** (0,10 / 0,50 USD za mln tokenów, wycofanie nie wcześniej niż 7.10.2027); alternatywa: model z innej rodziny jako drugi sędzia na podzbiorze. |
| D4 | `trigger` dla sędziego | **Nowa wartość `SCRIPT`**; z interfejsu `UI`; `null` tylko `MANUAL`. |
| D5 | Sędzia w interfejsie | **Przycisk istnieje, ale ukryty bez `JUDGE_UI_ENABLED=true`**; główna droga to skrypt. (Tylko skrypt: bez przycisku; zawsze widoczny: ryzyko przypadkowego zużycia płatnego API.) |
| D6 | Zapis sądu | **`EvaluationResult.source = JUDGE`** (rekomendacja spec §6); osobna tabela odrzucona. |
| D7 | Ocena ręczna | **Ślepa próba** (anonimowy plik, formularz bez wyników AI); rubryka 0/1/2 w 4 wymiarach + 4 × (1 do 10); próbka min. 21 budów. |
| D8 | Modele ewaluacji | **Gemini `gemini-3.5-flash-lite`, OpenAI `gpt-6-luna`, Claude `claude-sonnet-5-5`** (zgodnie ze spec). (`gpt-5-nano`, `gemini-3.6-flash` jako dodatkowe.) |
| D9 | Czy skrypt uruchamia agenta czatu | **Tak: refaktoryzacja `runChatTurn` w 10e** (czysta, bez zmian promptów; podstawa kroku 11). (Bez: skrypt tylko z operacjami obiektowymi, S1–S5 ręcznie jak w PR „P”.) |
| D10 | Runner skryptu TypeScript | **Bez nowej zależności:** skrypt uruchamiany jako osobny „projekt” Vitesta (`vitest run --config vitest.eval.config.ts`), który rozwiązuje aliasy `@/` i TS; ładowanie `.env` jawnie w skrypcie. (`tsx` jako dev-zależność: wymaga zgody i sprawdzenia skryptów instalacyjnych `esbuild`; `node --experimental-strip-types` nie rozwiązuje aliasów `@/`.) **Niepotwierdzone**, sprawdza 10f. |
| D11 | Tabela wyników | **`EvalRun` z polem `architecture`**; metryki z `LlmCallLog` po `projectId`. (Pliki JSONL: bez zapytań SQL.) |
| D12 | Liczba powtórzeń | N = 3 (pełny), N = 2 (minimalny); sędzia 3 × na BMC. |
| D13 | Wariant budżetu | **Minimalny na start (≈ 2 USD), pełny po pilocie (≈ 5 do 6 USD).** |
| D14 | Zestaw przypadków | 7 `BUILD` + 7 `EVAL` + `CHAT-S1…S5`, zamrożony sumą kontrolną przed serią. |
| D15 | Akceptacja propozycji w skrypcie | Wszystkie propozycje akceptowane tą samą funkcją co interfejs; zastrzeżenie w pracy. |
| D16 | Konto pomiarowe | Dedykowane konto i projekty `EV-…`; nic nie jest kasowane; limity użytkownika podnoszone na czas pomiaru. |
| D17 | Eksport | CSV UTF-8 z BOM + anonimowy plik do oceny ręcznej; poza repozytorium albo w `.gitignore`. |
| D18 | Pomiar B i ponowna ocena migawek | **Poza zakresem do decyzji po rozmowie z promotorem;** funkcja gotowa. |
| D19 | CAGR | **Poza zakresem** do ustaleń z promotorem. |
| D20 | Kto uruchamia | **Ty:** `migrate dev`, `generate`, `db seed`, `build`, skrypty z `.env`, konsole dostawców; **ja:** `lint`, `typecheck`, `test`, przegląd SQL. |

## Testy (wyłącznie mocki, bez prawdziwego API)

Zasada: prawdziwe funkcje odczytu i zapisu, zamockowany tylko klient Prisma i modele SDK. Pokrycie w opisach PR powyżej. Dodatkowo: `use-server-exports.test.ts` dla nowych plików `"use server"`; test, że `src/lib/ai/prompts/chat*` i opisy narzędzi są **niezmienione** (suma lub `git diff` w opisie PR), bo krok 10 nie zmienia `chat-v6`.

## Weryfikacja (każdy PR)

`npm run lint`, `npm run typecheck`, `npm test` (ja), `npm run build` (Ty). Ręcznie (`npm run start`): 10a seed i podgląd projektów; 10b formularz oceny ręcznej i trzy serie na radarze; 10d przycisk sędziego tylko przy fladze, wynik oznaczony; 10e zachowanie czatu bez zmian (test trasy i próba ręczna); 10f `--tylko-sprawdz`; 10g pilot i seria.

## Kolejność startu PR 10a (po akceptacji planu)

1. `git status`, `git log -3`; `main` po PR docs; gałęzi nie usuwam.
2. `git switch -c feat/seed-przykladowe`.
3. Commit 1 (`docs:`): `docs/plan-krok-10.md` (1:1, z „Zmianami po akceptacji”) i aktualizacja `docs/zadania.md` (statusy z tabeli „Wpisy”).
4. `src/lib/seed/companies.ts` + test; `prisma/seed.ts` i wpis seed w `prisma.config.ts` (**stop: pokazuję diff konfiguracji, bo zmienia plik, który ładuje `.env`**).
5. `lint`, `typecheck`, `test`, `build` (Ty); opis PR do pliku i `gh pr create --body-file`; stop.

## Zmiany po akceptacji

Plan zaakceptowany 2026-11-25: **D1 do D20 zgodnie z rekomendacjami** (D13: wariant minimalny na start), z poprawkami poniżej, które mają pierwszeństwo przed treścią powyżej. Pomiar B (D18) i CAGR (D19) zostają **otwarte do rozmowy z promotorem**. Kolejne rozbieżności i decyzje z implementacji dopisuję jako numerowane punkty.

1. **Anonimizacja przypadków `BUILD`.** Opis wejściowy przypadku nie zawiera nazwy firmy ani nazw własnych, które ją zdradzają (produkty, założyciele, marki, charakterystyczne nazwy usług); przykład formy: „Firma A: serwis wideo na żądanie w abonamencie, treści własne i licencjonowane…”. **Prawdziwa nazwa jest tylko w kluczu wyników** (`cases.ts`: pole `trueName` i `aliases`, nieużywane w prompcie ani w skrypcie odpowiedzi użytkownika; eksport do oceny ręcznej też jej nie ujawnia). Przypadki `EVAL` i dane seeda **zostają z nazwami** (to ocena gotowego modelu, nie budowa z opisu). **Test w 10f:** opisy i skrypty odpowiedzi `BUILD` nie zawierają żadnej nazwy ani aliasu z listy zakazanych tokenów (porównanie bez rozróżniania wielkości liter i po normalizacji polskich znaków). Przypadek „Kawiarnia Ziarno” jest fikcyjny, więc anonimizacji nie potrzebuje.
   - **Dodatkowa metryka (obserwacja, nie kryterium zaliczenia):** „rozpoznanie firmy mimo anonimizacji” (O1): w tekstach odpowiedzi modelu w przebiegu (wiadomości asystenta, uzasadnienia propozycji) szukamy nazwy lub aliasu firmy (sprawdzenie automatyczne w skrypcie eksportu, wynik 0/1 na przebieg, plus ręczny przegląd trafień); raportujemy odsetek na model i na przypadek (sukces vs upadek). Zastrzeżenie: brak trafienia nie dowodzi, że model firmy nie rozpoznał (może jej nie nazwać); trafienie pokazuje wpływ wiedzy modelu na wynik i zostaje opisane w pracy.
2. **Seed na wskazanym koncie (zamiast konta bez możliwości logowania).** `prisma db seed` tworzy projekty **na istniejącym koncie podanym przy uruchomieniu**: zmienna **`SEED_USER_EMAIL`** (np. `SEED_USER_EMAIL=… npx --no-install prisma db seed`; argument po `--` jako alternatywa, `--email`). **Bez ustawionej zmiennej lub bez konta o tym e-mailu seed kończy się komunikatem po polsku i niczego nie tworzy** (kod wyjścia ≠ 0, brak zapisów). Seed **nie zakłada kont i nie ustawia haseł**. Seed jest idempotentny **per konto** (projekt o nazwie `Seed: <firma>` na tym koncie jest pomijany z komunikatem, bez nadpisywania). Wszędzie w planie, gdzie jest `seed@example.com`, obowiązuje to konto wskazane przez Ciebie; wiersz „Dane testowe” w tabeli „Wpisy z `docs/zadania.md`” bez zmian (konto `ocena-test@example.com` zostaje). Testy 10a: brak zmiennej → komunikat i zero zapisów; nieistniejące konto → komunikat i zero zapisów; poprawne konto → projekty i `entryOrigins`; powtórne uruchomienie → pominięcie; seed nigdy nie wywołuje tworzenia użytkownika ani haszowania hasła. Adres e-mail nie trafia do logów ani do opisów PR.
3. **Drugi sędzia z innej rodziny na podzbiorze (w wariancie minimalnym).** Oprócz sędziego głównego (`claude-haiku-5-5`) **sędzia kontrolny `gpt-6-luna`** ocenia podzbiór: **po jednej budowie na model i przypadek** (wariant minimalny: 4 przypadki × 3 modele = 12 budów), po 3 sądy na budowę (jak sędzia główny, 36 wywołań). Cel: sprawdzić, czy Haiku faworyzuje Sonneta (spec §6, ograniczenie); metryka: różnica średnich ocen Sonneta względem pozostałych modeli według sędziego głównego i kontrolnego oraz zgodność rang. **Zapis: ten sam `EvaluationResult.source = JUDGE`, a model rozróżnia kolumna `model`** (i `provider`); nie dodajemy nowej wartości enuma. Konfiguracja: osobna nazwa logiczna **`judge-control`** w `models.ts` (zmienne `JUDGE_CONTROL_PROVIDER` i `JUDGE_CONTROL_MODEL`, w `.env.example`; w 10c) i ta sama operacja `judge_bmc` z tym samym promptem `judge-v1` (sędzia kontrolny nie ma innego promptu). **Model sędziego głównego pozostaje stały dla całej serii**; sędzia kontrolny nie zastępuje go w żadnej tabeli głównej, tylko jest osobną kolumną porównawczą. Skrypt: `--sedzia-kontrolny` (domyślnie wyłączony, włączany dla podzbioru), eksport i zapytania SQL rozróżniają sędziów po `model`. Testy: zapis `JUDGE` z różnymi `model`, wybór podzbioru (po jednej budowie na model i przypadek), brak mieszania sędziów w zestawieniach, `judge-control` niezależny od `judge` i `chat`.
   - **Przeliczony budżet (wariant minimalny, szacunek):** sędzia kontrolny `gpt-6-luna` ≈ 2 tys. tokenów wejścia i 0,8 tys. wyjścia na sąd po 0,10 / 0,50 USD za mln tokenów ≈ 0,0006 USD; 36 sądów ≈ **0,02 USD**. Wywołania: ok. 380 + 36 = **ok. 416**. **Koszt łączny wariantu minimalnego: ok. 2 USD (bez zmiany rzędu wielkości: ok. 2,0 do 2,1 USD)**; w wariancie pełnym analogicznie po jednej budowie na model i przypadek (21 budów, 63 sądy, ≈ 0,04 USD): łącznie ok. 5 do 6 USD. Limit wydatków OpenAI w konsoli obejmuje też sędziego kontrolnego (zalecane 5 USD wystarcza z zapasem). Szacunek niezmierzony, pilot w 10g go koryguje.
4. **Opisy firm w seedzie przeglądasz Ty przed użyciem w pracy.** W opisie PR 10a podaję je w **czytelnej tabeli: firma, blok, wpisy** (jeden wiersz na blok, wpisy wypisane tekstem; sekcja „Do weryfikacji” z zastrzeżeniem, że to uproszczony opis publicznie znanych faktów bez liczb). Wpisy są **proponowane do Twojej korekty** przed merge'em 10a; nic z seeda nie jest używane w pomiarach, dopóki nie zaakceptujesz opisów (zatwierdzenie zapisuję w „Zmianach po akceptacji” po przeglądzie).
5. **Ograniczenie kolejności.** Po zmergowaniu PR docs „Stan po zmianach wyglądu” (#57) zaczynam 10a według „Kolejności startu”; commit 1 (`docs:`) zawiera ten plik w stanie z tymi poprawkami.
6. **Otwarte sprawy (odwołanie „patrz Otwarte” w sekcji „Kontekst” dotyczy tego punktu).** Poza zakresem kroku 10 do czasu rozmowy właściciela z promotorem:
   - **Pomiar B** (wpis w `docs/zadania.md`, status otwarte): czy wykonać pomiar rund poprawek z krokiem 7 (scenariusze B1 i B2 z `docs/plan-krok-7.md`, ok. 45 wywołań) i **ponowną ocenę migawek z rund przez sędziego** (zapytanie o migawki z `plan-krok-7.md`). Krok 10 dostarcza tylko `runJudge` i gotowość; **niczego z pomiaru B nie wykonujemy i nie zmieniamy statusu wpisu**, dopóki właściciel nie zdecyduje. Zastrzeżenie z kroku 7 zostaje: oceny „przed” i „po” w rundach robi ten sam model co poprawki, więc różnica może być zawyżona.
   - **CAGR** (spec §15, wpis w `zadania.md`, status otwarte): wstęp pracy (liczba z literatury) albo opcjonalne „Dane rynkowe” w aplikacji z deterministycznym CAGR z danych użytkownika. **Poza zakresem; nie planujemy ani nie implementujemy.**
   - Wciąż otwarte i **nietykane** w kroku 10: dopracowanie wyglądu D3/D4 (PR #57 zapisuje wpis), usuwanie projektu, duplikaty wpisów, historia porównań, ochrona czasu ekstrakcji i generowania dokumentów, `npm audit`.
7. **Stan wyjściowy do startu 10a (stan na 2026-11-25).** `main` zawiera #56 (wygląd D2) i wcześniejsze kroki do 9 włącznie (raport, eksport, pochodzenie wpisów). **PR #57** (`docs/stan-po-zmianach-wygladu`: wpis „Dopracowanie wyglądu (D3 czat, D4 pozostałe strony)” w `zadania.md` i „Stan po zmianach wyglądu” w `plan-design.md`) jest otwarty; **10a zaczynam dopiero po jego zmergowaniu** i po komendzie właściciela („PR #57 zmergowany. Zrób `git switch main` i `git -c http.sslBackend=schannel pull`, gałęzi nie usuwaj”). Ten plik jest **nieśledzony** (nie wchodzi do #57); trafia do repozytorium jako commit 1 w 10a. Wersje promptów obecnie: `chat-v6`, `evaluate-v1`, `questions-v1`, `refine-v1`, `impact-v1`, `compare-v1`, `strategies-v1`; krok 10 nie zmienia żadnej z nich (nowa: `judge-v1`). Model dev: `gemini-3.5-flash-lite`. Wersje pakietów AI: `ai` 7.0.154, `@ai-sdk/google` 4.0.106 (nowe: `@ai-sdk/anthropic`, `@ai-sdk/openai` dopiero w 10c po zgodzie).
8. **Doprecyzowanie „Kolejności startu PR 10a” (uwzględnia punkty 2 i 4).**
   1. Po zmergowaniu #57: `git switch main`, `git -c http.sslBackend=schannel pull`, `git status` (nietykany: `prisma/migrations/migration_lock.toml`, objaw końców linii; plik `docs/plan-krok-10.md` nieśledzony), gałęzi nie usuwam.
   2. `git switch -c feat/seed-przykladowe`.
   3. Commit 1 (`docs:`): `docs/plan-krok-10.md` (1:1, ze wszystkimi punktami tej sekcji) i `docs/zadania.md` (statusy z tabeli „Wpisy z `docs/zadania.md`”; pomiar B i CAGR bez zmian: otwarte). Edycje plików z CRLF skryptem Pythona z `newline=""`.
   4. `src/lib/seed/companies.ts` (dane: Netflix, Airbnb, Spotify, Blockbuster, Quibi, Juicero, Kawiarnia Ziarno; tylko publicznie znane fakty, **bez liczb poza rokiem**, test blokuje liczby) + testy; `prisma/seed.ts` czytający **`SEED_USER_EMAIL`** (punkt 2: bez zmiennej lub konta komunikat i zero zapisów; bez zakładania kont i haseł); wpis `migrations.seed` w `prisma.config.ts` (**stop i pokazanie diffu tej konfiguracji przed dalszą pracą**, bo ten plik ładuje `.env`; nie uruchamiam seeda ani żadnej komendy Prismy).
   5. `npm run lint`, `npm run typecheck`, `npm test` (ja); `npm run build` i `npx --no-install prisma db seed` z `SEED_USER_EMAIL` (Ty).
   6. Opis PR 10a w pliku (`gh pr create --body-file`; PowerShell 5.1 psuje `--body`): co zmieniono, **tabela „firma, blok, wpisy” do Twojej weryfikacji** (punkt 4), jak uruchomić seed (przykład z `SEED_USER_EMAIL`), czego jeszcze nie ma (10b do 10g); **stop po otwarciu**, bez 10b przed zmergowaniem 10a.
9. **Zasady pracy obowiązujące w całym kroku (z `CLAUDE.md` i poleceń właściciela, powtórzone, żeby plan był samowystarczalny).** Nie czytam, nie modyfikuję i nie ładuję `.env` żadnym skryptem (pomiary i `db seed` uruchamia właściciel). Niczego nie usuwam bez zgody (gałęzie, pliki, projekty, dane, kontenery). Nigdy nie pushuję na `main`; jeden PR to jeden mały krok; push i pull przez `git -c http.sslBackend=schannel`; po otwarciu PR stop i czekanie na review. Nowa zależność, zmiana schematu i zmiana konfiguracji ładującej `.env` tylko po osobnej zgodzie (10c: pakiety, 10d i 10f: migracje, 10a: `prisma.config.ts`). Komunikaty o commitach z dopiskiem `Co-Authored-By`, opisy PR kończone linią „Generated with Claude Code”. Skrypty z polskimi znakami jako pliki Pythona, nie heredoc. Testy bez prawdziwego API.

