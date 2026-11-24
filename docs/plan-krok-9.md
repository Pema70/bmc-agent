# Plan kroku 9: eksport PDF i DOCX oraz rozszerzony raport ze źródłami

> Sekcja „Zmiany po akceptacji” na końcu pliku ma pierwszeństwo przed treścią powyżej (puste do czasu akceptacji).

Krok 9 z `docs/spec.md` §14 (szczegóły w §10). **Do akceptacji (2026-11-24).**

Ten plik trafia 1:1 do `docs/plan-krok-9.md` jako pierwszy commit `docs:` pierwszego PR-a (9a). Zasada z kroków 3 do 7: **żadnych zmian w kodzie, schemacie ani zależnościach przed akceptacją tego planu**; schemat (9a), wybór bibliotek i czcionek (9b) wymagają osobnej akceptacji przed migracją i instalacją.

## Kontekst

Cel: użytkownik pobiera z aplikacji (1) **eksport wybranego wariantu**: PDF z układem płótna BMC i DOCX w wersji tekstowej oraz (2) **rozszerzony raport** (PDF i DOCX) z danymi projektu i wariantu, płótnem, opisem bloków, **pochodzeniem każdego wpisu**, ocenami (z historią przed i po rundach poprawek), analizami wpływu, porównaniami, listą załączników, modelami i wersjami promptów oraz stałym oznaczeniem, że treści AI to opinia modelu, a nie weryfikacja biznesowa. Raport składa się wyłącznie z danych zapisanych w bazie (spec §10): **ani eksport, ani raport nie wołają modelu** (0 wywołań, 0 wpisów w `LlmCallLog`).

Wnioski z kroków 7 i PR „P”, które plan uwzględnia:

1. **Każda nowa ścieżka danych ma test z prawdziwymi funkcjami odczytu i zapisu** i zamockowanym tylko klientem Prisma (nie mockujemy `loadReportData` ani `resolveEntryOrigins` w testach renderowania).
2. **Treści od modelu i od użytkownika (wpisy, uzasadnienia, odpowiedzi, nazwy plików, nazwy wariantów i projektów) w dokumentach wyłącznie jako zwykły tekst**: węzły `<Text>` w PDF i `TextRun` w DOCX, bez HTML i Markdown; znaki sterujące i znaki zmiany kierunku tekstu usuwane przed wstawieniem.
3. **Krok 0b po PR-ach z eksportem wykonuje właściciel** (otwiera pliki w Wordzie i przeglądarce PDF: polskie znaki, układ, źródła). Instrukcje z listą kroków i zapytaniami SQL podaję przy otwarciu PR-a (jak w 7g).
4. **Testy eksportu bez porównywania obrazów**, na strukturze dokumentu: PDF przez `unpdf` (już w projekcie), DOCX przez `mammoth` (już w projekcie).
5. Opisy w interfejsie i w dokumentach po polsku; dane przykładowe; nic poza `docs/` i testami nie dotyka `.env`.
6. **Seria kontrolna S1–S5 na `chat-v6`** (wpis w `zadania.md`, decyzja z 2026-11-23): planowana tu (PR 9f) z kosztem i zapytaniami jak w PR „P”.

Ograniczenia: CAGR poza zakresem (czeka na promotora, spec §15); projekty jednoosobowe (§8: role w kodzie zostają, brak udostępniania); każdy PR zatrzymuje się po otwarciu; `npm run build`, `migrate`, `generate` i kroki 0b uruchamia właściciel (`.env`); model dev `gemini-3.5-flash-lite`; dane przykładowe; niczego nie usuwam bez zgody.

## Co sprawdziłem (2026-11-24)

Wszystko tylko do odczytu.

**Stan kodu:**
- Nie ma `src/lib/export/`, nie ma `@react-pdf/renderer` ani `docx` w `package.json`; `public/` jest pusty. Stos z `CLAUDE.md` już zakłada obie biblioteki (zgoda na stos), ale instalacja wymaga osobnej zgody (9b). `react` 19.3.0, `next` 16.4.5, Node `>=22`. W projekcie są już `unpdf` i `mammoth` (użyjemy ich w testach struktury dokumentów).
- **Stan wariantu zmienia się w pięciu miejscach** (to one decydują o pochodzeniu wpisów): `saveVariantState` (zapis z edytora, cały stan od klienta, kontrola wersji), `acceptProposal` i `acceptRoundBatch` (stosują propozycje), `createVariant` (kopia wariantu: stan z bazy, **bez zapisu, z którego wariantu**), `saveStrategyAsVariant` (stan kandydata strategii; wariant ma `generationId` i `generationIndex`); do tego `createProject` (pusty stan). Stan przy aktualizacji zapisuje jedna funkcja `writeVariantStateIfVersion(client, variantId, expectedVersion, state)`.
- **Wpisy w blokach to zwykłe stringi bez identyfikatorów** (spec §4, wpis o duplikatach w `zadania.md`); duplikaty w bloku są możliwe; edycja wpisu to dla bazy nowy tekst.
- **Dane źródłowe raportu już istnieją:**
  - `Proposal`: `sourceKind` (`CONVERSATION`, `ATTACHMENT`, `REFINEMENT`, `MODEL_KNOWLEDGE`), `sourceAttachmentName` (migawka), `refinementRoundId`, `refinementQuestionIndex`, `rationale`, `before`, `after`, `status`, `resolvedAt`. Propozycje sprzed 7a mają domyślnie `CONVERSATION` (wszystkie powstały w rozmowie, więc to wiarygodne).
  - `RefinementRound`: `roundNumber`, `questions`, `answers`, `evaluationId` (ocena „przed”), `variantVersion`, `status`.
  - `EvaluationResult`, `ImpactAnalysis`, `StrategyGeneration`, `VariantComparison`: wynik, `provider`, `model`, `promptVersion`, `variantVersion`, migawki stanów (porównanie: `inputs` z migawkami, **bez kolumny z id wariantów**, filtr po wariancie dziś tylko w aplikacji, znany wpis w `zadania.md`).
  - `Attachment`: metadane (`fileName`, `kind`, `sizeBytes`, `textChars`, `truncated`, `createdAt`); `LlmCallLog`: `operation`, `provider`, `model`, `promptVersion`, `createdAt`.
  - **`Proposal` nie przechowuje modelu ani wersji promptu** (powstaje w turze czatu, a log czatu nie jest z nią powiązany), więc „model i wersje promptów” dla propozycji raport poda zbiorczo z `LlmCallLog` projektu (rozbieżność 2).
- `src/lib/evaluation/radar.ts` ma czyste funkcje geometrii wykresu (`radarAxes`, `radarPoints`, `radarRing`, `toPolygonPoints`, `splitLabel`): użyjemy ich do narysowania radaru w PDF przez `Svg` z `@react-pdf/renderer`, bez drugiej implementacji geometrii.
- Wzorce do reużycia: route handler z `getProjectAccess(projectId, rola)` (`src/app/api/projekty/[id]/zalaczniki/route.ts`), `getVariantForProject(projectId, variantId)`, listy `listEvaluationsForVariant`, `listImpactAnalysesForVariant`, `listAttachmentsForProject`, `listRoundsForVariant`, `listRoundProposalIds`, `formatVariantDate` (strefa `Europe/Warsaw`), `normalizeFileName`, testy z `vi.mock("@/lib/db/client")`.

**Zależności (`npm view` z 2026-11-24, próg 14 dni = wersje opublikowane do 2026-11-10):** szczegóły w sekcji „Zależności”.

## Rozbieżności względem spec (wygrywa spec, poniższe doprecyzowuje)

1. **„Dostępny dla każdego członka projektu”** (polecenie) = rola `VIEWER` i wyżej (spec §8 zostawia role w kodzie bez zmian). Eksport i raport nie wołają modelu, więc VIEWER nie zużywa limitów.
2. **„Model i wersje promptów użyte do wyników AI” (§10):** oceny, analizy, strategie i porównania mają `provider`/`model`/`promptVersion` przy wyniku; **propozycje nie** (patrz wyżej). Raport podaje: model i prompt przy każdym wyniku oraz **zbiorczą tabelę z `LlmCallLog` projektu** (operacja, model, wersja promptu, liczba wywołań, pierwsze i ostatnie użycie), z adnotacją, że propozycje z czatu nie mają zapisanej wersji promptu.
3. **„Oceny sędziego (jeśli są)”:** krok 10 jeszcze nie istnieje. Raport grupuje oceny wg `source` (`AI`, `MANUAL`) i nie wyświetla pustych sekcji; sędzia dojdzie w kroku 10 jako kolejne źródło.
4. **„Opcjonalnie wynik oceny” w PDF płótna:** eksport dołącza najnowszą ocenę, jeśli istnieje (oznaczoną „AI”, z wersją modelu i uwagą, gdy dotyczy innej wersji niż zapisana), bez przełącznika w interfejsie (D13).
5. **Pochodzenie wpisu ma więcej wartości niż pięć ze spec:** ręczny, rozmowa, załącznik (nazwa pliku), cykl poprawek (runda i pytanie), wiedza modelu (niezweryfikowana), **strategia AI** (wariant ze strategii) i **„źródło nieznane”** (patrz „Pochodzenie wpisów”).
6. **Raport dotyczy zapisanego stanu wariantu** (`BmcVariant.state` z bazy, wersja w nagłówku), nie niezapisanych zmian w edytorze; interfejs mówi to wprost przy przyciskach.
7. **Spec §10 „raport składa się z danych zapisanych w bazie”** przemawia za opisem bloków złożonym z zapisanych uzasadnień (D3), a nie dodatkowym wywołaniem modelu.

## Podział na PR-y

Każdy zaczyna się po zmergowaniu poprzedniego. **Nowe zależności tylko w 9b, po Twojej zgodzie. Migracja tylko w 9a.** Polecenia Prismy i build uruchamiasz Ty.

### PR 9a: `feat/pochodzenie-wpisow`: zapis pochodzenia wpisów

**Stop:** akceptacja schematu (jedna kolumna, sekcja „Schemat Prisma do akceptacji”) przed migracją; kontrola SQL pod kątem `DROP INDEX "BmcVariant_projectId_main_key"` i `DROP CONSTRAINT "RefinementRound_roundNumber_check"` (obie, zgodnie z wpisem w `zadania.md`). Pierwszy commit: `docs:` z tym planem.
- `prisma/schema.prisma` + migracja `pochodzenie_wpisow`: `BmcVariant.entryOrigins Json @default("[]")`.
- `src/lib/schemas/origin.ts` (Zod): `EntryOrigin` (`strictObject`: `blockKey`, `text`, `kind: MANUAL | PROPOSAL | STRATEGY`, `proposalId?`, `sourceKind?`, `attachmentName?`, `roundNumber?`, `questionIndex?`, `strategyName?`, `recordedVersion`), `EntryOrigins` (tablica, najwyżej 150).
- `src/lib/bmc/origins.ts` (czyste funkcje, bez bazy): `originsAfterManualSave(oldState, newState, oldOrigins)` (wpisy bez zmiany zachowują pochodzenie, nowe lub zmienione tekstem dostają `MANUAL`, usunięte znikają), `originsAfterProposal(origins, proposal)`, `originsForStrategy(state, strategy)`, `originsFromSource(origins)` (kopia). Klucz tożsamości wpisu: `(blockKey, tekst)`.
- Zmiana `writeVariantStateIfVersion` tak, żeby **wymagała** argumentu `origins` (kompilator wymusza, że żadna ścieżka zapisu stanu go nie pominie) oraz podpięcie pięciu ścieżek: `saveVariantState` (odczyt starego stanu i pochodzenia przed zapisem, zapis nadal chroniony wersją), `acceptProposal`, `acceptRoundBatch`, `createVariant` (kopiuje pochodzenie), `saveStrategyAsVariant`; `createProject` zapisuje `[]`.
- `src/lib/report/provenance.ts`: `resolveEntryOrigins(state, storedOrigins, fallback)`: dla każdego bieżącego wpisu zapisane pochodzenie, a gdy go brak, **dopasowanie wsteczne** (zaakceptowana propozycja tego wariantu z `after` równym tekstowi; wariant ze strategii: zgodność z kandydatem), inaczej „nieznane”. Zwraca też pewność: `ZAPISANE`, `USTALONE_PO_TEKSCIE`, `NIEZNANE`.
- Testy: patrz „Testy” (każda ścieżka zapisu z prawdziwą funkcją zapisu i zamockowanym klientem; w tym wyścig o wersję, kopia, strategia, wsteczne dopasowanie).

### PR 9b: `chore/eksport-zaleznosci`: zależności, czcionka, szkielet eksportu

**Stop na początku:** ponownie sprawdzam wersje i drzewo (dzień instalacji), pokazuję wynik wraz z `npm audit` dla nowych pakietów i czekam na zgodę. Instalacja: `npm install --save-exact --ignore-scripts --before=<dzień instalacji minus 14 dni> @react-pdf/renderer@<wersja> docx@<wersja>` (patrz „Zależności”). Wybór czcionki (D5) także wymaga zgody przed dodaniem plików.
- `package.json` i `package-lock.json`: dwa pakiety przypięte dokładnie; rozszerzony `dependencies.test.ts` (dokładne wersje, brak skryptów instalacyjnych w drzewie obu pakietów).
- Czcionka w repozytorium: `src/lib/export/fonts/` (Noto Sans Regular i Bold w TTF) + `OFL.txt` i krótka notatka o źródle w `src/lib/export/fonts/README.md`; **zgłaszam dodanie plików binarnych w opisie PR** (jak przy fixture’ach w 7b).
- `src/lib/export/sanitize.ts`: `exportText(value)` (usuwa znaki sterujące poza tabulatorem i nowym wierszem, znaki zmiany kierunku tekstu U+202A–202E i U+2066–2069, niesparowane surogaty; skraca ekstremalnie długie ciągi bez spacji do łamania) i `exportFileName(...)`.
- `src/lib/export/pdf/fonts.ts` (rejestracja czcionek z `process.cwd()`, wyłączone dzielenie wyrazów), minimalny dokument PDF (nazwa projektu i wszystkie polskie litery) i **minimalny route handler** `GET /api/projekty/[id]/eksport?wariant=…&format=pdf` (VIEWER+), żeby `npm run build` sprawdził zgodność z Next 16 i Turbopackiem **przed** zbudowaniem na tym całej reszty.
- Testy: obecność wszystkich 18 polskich liter z dużymi i małymi w wyjściowym PDF (`unpdf.extractText`), czcionka nie jest podmieniana na standardową, `exportText` na złośliwych tekstach.
- **Krok 0b-lite (właściciel):** pobrać próbny PDF i sprawdzić polskie litery w przeglądarce PDF i w Wordzie (kopiowanie tekstu).

### PR 9c: `feat/dane-raportu`: model danych raportu

- `src/lib/report/types.ts` (Zod): `ReportData` (projekt, wariant z wersją i datą, notka AI, wpisy z pochodzeniem i pewnością, opisy bloków, załączniki, oceny, rundy poprawek z parą „przed/po”, analizy, porównania, zbiorcza tabela modeli i promptów, statystyki „źródło nieznane”).
- `src/lib/report/load-report-data.ts`: `loadReportData(projectId, variantId, now)` składa dane **tylko** przez funkcje odczytu z filtrem po `projectId` i `variantId` (reużycie istniejących, plus nowe: `listProposalsForReport` z `resolvedAt` i uzasadnieniem, `listRoundsWithEvaluations`, `listLlmCallSummary(projectId)` agregat po `operation/provider/model/promptVersion`, `listVariantComparisonsForVariant` z filtrem po wariancie w SQL przez `jsonb_path_exists` i **bez migawek stanów**). Limity D8.
- `src/lib/report/describe-blocks.ts` (D3): czysta funkcja `describeBlock(entries, origins, proposals)`.
- `src/lib/report/round-evaluations.ts`: `pairRoundEvaluations(rounds, evaluations)`: ocena „przed” = `RefinementRound.evaluationId`, „po” = pierwsza ocena wariantu utworzona po ostatnim rozstrzygnięciu propozycji rundy (jak w punkcie 3 „Zmian po akceptacji” planu 7); brak oceny „po” to jawny stan „brak oceny po rundzie”.
- Testy z prawdziwymi `loadReportData` i funkcjami odczytu (mock klienta): filtry po projekcie i wariancie (obcy wariant → brak danych), limity i adnotacja „pokazano N z M”, uszkodzony rekord wyniku jako pozycja z błędem (nie wyjątek), pusty wariant, wariant bez oceny.

### PR 9d: `feat/eksport-wariantu`: PDF z płótnem i DOCX tekstowy

**Krok 0b po tym PR-ze (właściciel, pliki).**
- `src/lib/export/pdf/canvas-document.tsx`: PDF A4 poziomo, klasyczny układ płótna (Partnerzy | Działania nad Zasobami | Propozycje wartości | Relacje nad Kanałami | Segmenty; Struktura kosztów | Strumienie przychodów), tytuł projektu i wariantu, data, wersja stanu, najnowsza ocena (tabela i radar `Svg` z `radar.ts`) z oznaczeniem „AI”, stopka z notką i numeracją stron.
- `src/lib/export/docx/canvas-document.ts`: DOCX tekstowy: nagłówek 1 (projekt), nagłówek 2 (wariant), dla każdego bloku nagłówek 3 i lista wpisów, tabela ostatniej oceny; język dokumentu `pl-PL`, właściwości (tytuł, autor „BMC Agent”), stopka z notką.
- `GET /api/projekty/[id]/eksport?wariant=<id>&format=pdf|docx&rodzaj=plansza` (VIEWER+; wariant po `projectId`; odpowiedź `application/pdf` lub `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `Content-Disposition: attachment` z bezpieczną nazwą, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`).
- Interfejs: sekcja „Eksport” przy wybranym wariancie (przyciski „Pobierz PDF” i „Pobierz DOCX”, komunikat „Eksport dotyczy zapisanego stanu (wersja N); niezapisane zmiany nie są uwzględnione”, blokada przy `dirty` nie jest potrzebna: tylko informacja).
- Testy struktury (PDF przez `unpdf`, DOCX przez `mammoth`), złośliwe nazwy, pusty wariant, route handler (kolejność: sesja → rola → wariant → format → generowanie).

### PR 9e: `feat/raport-rozszerzony`: rozszerzony raport (PDF i DOCX)

**Krok 0b po tym PR-ze (właściciel, pliki).**
- Szablony `report-document.tsx` i `report-document.ts` na `ReportData` (kolejność sekcji w „Interfejsie”), kody źródeł w płótnie i tabela „Źródła wpisów”, tabela rund poprawek (pytanie, odpowiedź, propozycje i ich status, ocena przed i po), analizy wpływu i porównania (oznaczone „AI”), tabela modeli i promptów.
- `rodzaj=raport` w route handlerze, przyciski „Pobierz raport PDF” i „Pobierz raport DOCX”.
- Testy struktury obu formatów, w tym **każda kategoria źródła** (ręczny, rozmowa, załącznik, poprawki, wiedza modelu, strategia, nieznane) i stałe oznaczenie AI w nagłówku, stopce i przy każdej treści z modelu.
- Zamknięcie wpisu „Rozszerzony raport ze źródłami” w `docs/zadania.md`.

### PR 9f: `docs/seria-s1-s5-chat-v6`: seria kontrolna i zamknięcie kroku

Tylko `docs/` (bez kodu): wyniki serii S1–S5 na `chat-v6` (sekcja „Krok 0b i seria kontrolna”), opcjonalny pomiar D9, sekcja „Stan po kroku 9” w tym pliku i statusy w `docs/zadania.md`.

## Pochodzenie wpisów (decyzja główna: D1)

Problem: wpis to zwykły tekst bez identyfikatora; po akceptacji propozycji tekst może zostać zmieniony ręcznie, wariant może być kopią albo strategią, a wpisy z czasów przed 7a nie mają źródła. Trzy podejścia:

| | **A. Dopasowanie po tekście w chwili raportu** | **B. Zapis pochodzenia przy każdej zmianie stanu** | **C. B + wsteczne A jako zapas (rekomendacja)** |
|---|---|---|---|
| Idea | dla wpisu szukamy zaakceptowanej propozycji (`add`/`edit`) wariantu z `after` równym tekstowi | kolumna `BmcVariant.entryOrigins` aktualizowana w tej samej operacji, która zmienia stan (5 ścieżek) | jak B; dla wpisów bez zapisu raport próbuje A i **oznacza pewność** |
| Zmiana schematu | brak | **1 kolumna Json** (bez backfillu) | jak B |
| Zmiany w ścieżkach zapisu | brak | 5 ścieżek + `writeVariantStateIfVersion` wymusza argument | jak B |
| Wpis ręczny | **nierozróżnialny od nieznanego** („ręczny lub nieznany”) | `MANUAL` (pewne) od 9a | `MANUAL` (pewne) od 9a; wcześniejsze: nieznane |
| Wpis z propozycji, potem edytowany ręcznie | błędnie „nieznany” (tekst się nie zgadza) lub, gdy wrócił do tekstu propozycji, błędnie „z propozycji” | `MANUAL` (nowy tekst = nowy wpis) | jak B |
| Wpis ręczny o tekście identycznym z zaakceptowaną propozycją | **błędnie „z propozycji”** (fałszywa pewność) | `MANUAL` | `MANUAL` po 9a; przed 9a „ustalone po tekście” (zaznaczone jako prawdopodobne) |
| Kopia wariantu | brak powiązania z wariantem źródłowym (`createVariant` go nie zapisuje): propozycje kopii nie istnieją, więc wszystko „nieznane” | kopiuje pochodzenie źródła | jak B; kopie sprzed 9a: nieznane |
| Wariant ze strategii | dopasowanie do kandydata w `StrategyGeneration` (tekst) | `STRATEGY` z nazwą strategii | jak B; wcześniejsze: dopasowanie do kandydata |
| Duplikaty w bloku | jeden wspólny wynik | jeden wspólny klucz (to samo) | to samo |
| Koszt wdrożenia | mały (jedna funkcja raportu) | średni (migracja, 5 ścieżek, ~25 testów) | jak B + funkcja zapasowa |
| Dokładność dla danych istniejących dziś | ograniczona | **brak** (wszystko nieznane do czasu nowych zmian) | najlepsza dostępna (wsteczne A) |

**Rekomendacja: C.** Uzasadnienie: spec §10 wymaga „dla każdego wpisu pochodzenie”, a bez zapisu A daje fałszywą pewność w dwóch miejscach (ręczny wpis o tekście z propozycji, wpis wrócony do tekstu propozycji) i nie odróżnia „ręczny” od „nieznany”, co dla pracy dyplomowej jest najgorszym możliwym wynikiem (raport twierdziłby coś, czego nie wie). Kolumna Json zapisywana tym samym `UPDATE`, co stan, jest atomowa bez nowych transakcji, kopiuje się trywialnie i jest ograniczona (najwyżej 150 wpisów). Alternatywy: **A jako wariant minimalny**, jeśli nie chcesz migracji (wtedy raport ma tylko etykietę „ręczny lub nieznany” i nigdy „ręczny”); osobna tabela `EntryOrigin` (więcej zapytań, bez zysku, bo raport czyta pochodzenie wariantu w całości).

**Co raport pokaże jako „źródło nieznane” (uczciwie, także przy C):**
1. wszystkie wpisy ręczne wprowadzone przed 9a (nie da się ich odróżnić od innych wpisów bez zapisu);
2. wpisy w kopiach wariantów utworzonych przed 9a (brak powiązania kopii ze źródłem; nie szukamy w propozycjach innych wariantów, bo to grozi błędnym przypisaniem);
3. wpisy zmienione ręcznie po zaakceptowaniu propozycji przed 9a;
4. wpisy w wariantach ze strategii przed 9a, których tekst nie zgadza się z kandydatem (zmieniony po zapisie);
5. wpisy z nieczytelnym (uszkodzonym) zapisem `entryOrigins` (kolumna zostaje zignorowana i raport to zaznacza).
Wpisy z zapisem są oznaczone **„zapisane”**, ustalone wstecznie **„ustalone po tekście (prawdopodobne)”**, reszta **„nieznane”**; stopka sekcji „Źródła wpisów” podaje liczbę wpisów w każdej z tych trzech grup. Zastrzeżenia, które zostają: duplikaty w bloku dzielą jedno pochodzenie; „ręczny” oznacza „zapisany z edytora” (tekst mógł zostać wklejony); od 9a pochodzenie jest rejestrowane tylko dla zmian stanu przechodzących przez 5 ścieżek.

## Opis bloków „co tu jest i dlaczego” (D3)

| | **a. Złożenie z zapisanych uzasadnień (rekomendacja)** | **b. Jedno dodatkowe wywołanie modelu** |
|---|---|---|
| Koszt | 0 wywołań | 1 wywołanie na raport (ok. 2 tys. tokenów wejścia i 0,6 tys. wyjścia) i `LlmCallLog` |
| Wymyślanie faktów | brak: tylko wpisy i **cytaty** uzasadnień zaakceptowanych propozycji | ryzyko „wyjaśniania” powodów, których nikt nie podał; trzeba reguł w prompcie i testu na złośliwych wpisach |
| Zgodność ze schematem | niepotrzebna (tekst składany deterministycznie) | schemat Zod (9 opisów), `SCHEMA_ERROR`, nowy prompt (wersja) |
| Powtarzalność | ten sam raport dla tych samych danych | dwa eksporty mogą się różnić; trzeba zapisać wynik (nowa tabela) albo żyć z różnicami |
| Uprawnienia | VIEWER może pobrać | pobranie zużywałoby limity: wymagałoby EDITOR+ i osobnego przycisku |
| Oznaczenie AI | cytaty uzasadnień oznaczone „AI” | cały opis „AI” z modelem i promptem |
| Jakość tekstu | suchy, dla bloków ręcznych tylko lista wpisów | spójny, ale niezweryfikowany |

**Rekomendacja: a.** Spec §10 zamyka raport w „danych zapisanych w bazie” i dopuszcza dodatkowe wywołanie tylko jako alternatywę. Opis bloku składa się z: liczby wpisów, rozbicia na pochodzenie („3 z rozmowy, 1 z załącznika Opis.pdf, 2 ręczne”), cytatów uzasadnień zaakceptowanych propozycji (z oznaczeniem „uzasadnienie agenta”, rundą i pytaniem, gdy dotyczy) i zdania „Brak zapisanego uzasadnienia” dla wpisów bez propozycji. Wariant b zostaje jako opcjonalne rozszerzenie po kroku 9 (osobny wpis w `zadania.md`, jeśli zechcesz).

## Polskie znaki w PDF i czcionka (D5)

- **Domyślne czcionki `@react-pdf/renderer` (Helvetica, Times, Courier) to standardowe czcionki PDF w kodowaniu WinAnsi (Latin-1 z dodatkami): zawierają „ó”, ale nie zawierają „ą ć ę ł ń ś ź ż”** (i ich wielkich odpowiedników), więc polskie litery by się nie wyświetliły. To wiedza z dokumentacji i z zawartości kodowania, **nie zmierzona tu** (nie renderowałem PDF); sprawdza ją od razu test w 9b (`unpdf.extractText` po wygenerowaniu PDF ze wszystkimi polskimi literami) i krok 0b-lite.
- **Rozwiązanie: czcionka dołączona do repozytorium.** Rekomendacja: **Noto Sans** (licencja SIL Open Font License 1.1: wolno dołączać do projektu, osadzać w PDF i dystrybuować z plikiem licencji; sprzedaż samej czcionki zabroniona, nie dotyczy nas). Pliki `NotoSans-Regular.ttf` i `NotoSans-Bold.ttf` (ok. 0,5 MB każdy; rozmiary do potwierdzenia przy pobraniu) w `src/lib/export/fonts/` z `OFL.txt`. Pobranie z oficjalnego repozytorium Noto (notofonts) albo Google Fonts po Twojej zgodzie; sprawdzam licencję w pliku i **pokrycie glifów** (18 polskich liter, cudzysłowy „ ”, półpauza, symbole oceny).
- Alternatywy: **Roboto** (Apache-2.0), **DejaVu Sans** (licencja Bitstream Vera, szeroka ale cięższa i mniej ładna w druku), pakiet npm `@fontsource/noto-sans` (OFL; bez binariów w repozytorium, ale pliki są dzielone na podzbiory znaków i w formacie woff2/woff, więc polskie litery i podstawowa łacina są w osobnych plikach, czego `@react-pdf/renderer` nie łączy w jedną rodzinę; **odrzucone**). Podzbiór czcionki (np. `pyftsubset` do Latin i Latin Extended-A, ok. 0,1 MB) jest możliwy, ale wymaga narzędzia spoza projektu (zgoda jak dla zależności): zostawiam jako opcję, jeśli rozmiar repozytorium będzie przeszkadzał.
- Ścieżka do plików: `process.cwd()` + względna ścieżka (działa dla `next start`). **Uwaga na produkcję:** przy wdrożeniu bezserwerowym lub kontenerowym z trybem `standalone` pliki czcionek trzeba dołączyć do wyniku (`outputFileTracingIncludes`); spec §15 zostawia hosting otwarty, więc to tylko wpis w `zadania.md`.
- Znaki spoza łaciny, greki i cyrylicy (emoji, CJK) w nazwach lub wpisach mogą wyświetlić się jako puste kwadraty; **co robi `@react-pdf/renderer` przy braku glifu, sprawdza test w 9b** (nie może rzucać wyjątku); ograniczenie opisane w raporcie i w `zadania.md`. DOCX nie osadza czcionek (Word dobiera czcionkę systemową, język dokumentu `pl-PL`).

## Zależności (D6)

Dane z `npm view` z 2026-11-24 (próg: wersje opublikowane do 2026-11-10). **W planie nic nie zainstalowano.** Drzewo odczytane rekurencyjnie z rejestru (`npm view` dla każdego pakietu, zakresy rozwiązane do najnowszych wersji spełniających próg); w 9b powtarzam to i dodaję `npm audit` w katalogu tymczasowym (`--package-lock-only --ignore-scripts`, jak w 7b).

| Pakiet | Najnowsza | Najnowsza starsza niż 14 dni | Drzewo (z progiem) | Skrypty install | Licencje | Rozmiar rozpakowany drzewa | Zgodność |
|---|---|---|---|---|---|---|---|
| **`@react-pdf/renderer`** | 4.9.1 (**2026-11-24, dziś: za świeża**) | **4.9.0** (2026-08-27, 89 dni) | **60 pakietów** (youngest 2026-11-04, 20 dni), żaden deprecated | **brak w całym drzewie** | MIT 55, ISC 4, Apache-2.0 1 (`@swc/helpers`) | ok. 30 MB (`pdfkit` 10, `hyphen` 5,5, `fontkit` 5,5 MB) | peer `react` do 19 (projekt: 19.3.0); `next` 16.4.5: zob. niżej |
| **`docx`** | 9.16.0 (2026-11-19, 5 dni) i 9.15.4 (2026-11-14, 10 dni): za świeże | **9.15.3** (2026-11-06, 18 dni) | **5 pakietów** (`docx`, `@types/node`, `nanoid`, `undici-types`, `fflate`; youngest 2026-11-06) | **brak** | MIT 5 | ok. 24 MB (prawie w całości `@types/node` wciągnięte jako zależność) | Node `>=16` (projekt `>=22`) |

- **Pułapka świeżych wersji pośrednich:** bez progu `npm install` rozwiązałby podpakiety `@react-pdf/*` do wersji z **dziś** (0 dni), co łamie regułę 14 dni dla zależności przechodnich. Dlatego instalacja z flagą **`--before=<data>`** (rozwiązanie całego drzewa „na dzień”), a lockfile przypina wynik; `dependencies.test.ts` pilnuje dokładnych wersji i braku skryptów install. `--ignore-scripts` także dlatego, że root `postinstall` (`prisma generate`) ładuje `.env`.
- **Uwagi:** `docx` ma `@types/node` w `dependencies` (typy trafiają do produkcyjnego drzewa; projekt ma `@types/node ^22` w devDependencies: npm zagnieździ drugą kopię, `npm run typecheck` sprawdzam w 9b). `hyphen` (5,5 MB) to wzorce dzielenia wyrazów dla wielu języków, **nieużywane**, bo wyłączamy dzielenie (słabe dla polskiego).
- **Next 16.4.5 i Turbopack (niepotwierdzone, sprawdza 9b):** dokumentacja Next wymienia `@react-pdf/renderer` wśród pakietów domyślnie wyłączonych z bundlowania serwerowego, więc nie powinno być potrzeby `serverExternalPackages`; dokumentacja `react-pdf.org` opisuje zgodność z Next i mówi o błędach tylko w wersjach Next sprzed 14.1.1. Zgłaszany jest osobno błąd Turbopack z trybem `standalone` (pakiety z `serverExternalPackages` nie trafiają do `.next/standalone`); nie używamy `standalone` na dev. **Plan awaryjny:** dodać `serverExternalPackages: ["@react-pdf/renderer"]` w `next.config.ts` po błędzie w buildzie właściciela; zmiana konfiguracji Next to osobna zgoda.
- Źródła: [Next.js serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages), [react-pdf: zgodność](https://react-pdf.org/docs/v4/compatibility), [Next.js issue #88844 (standalone)](https://github.com/vercel/next.js/issues/88844).

## Uprawnienia i bezpieczeństwo

- Route handler: `getProjectAccess(projectId, "VIEWER")` przed jakimkolwiek odczytem (401, 403, 404 jak w `zalaczniki/route.ts`), następnie wariant po `getVariantForProject(projectId, variantId)` (obcy lub nieistniejący → 404 bez ujawniania), `format` i `rodzaj` z listy dozwolonych wartości (Zod), nic innego z zapytania nie trafia do dokumentu.
- Wszystkie odczyty raportu po `projectId` I `variantId` (porównania: po `projectId`, filtr po wariancie w SQL); żaden identyfikator z bazy (id wariantu, id propozycji, `storageKey`, ścieżki) nie trafia do dokumentu; w raporcie są numery rund i pytań, nazwy plików i kody źródeł.
- **Treść jako zwykły tekst:** `exportText` na każdym łańcuchu z bazy (nazwy, opisy, wpisy, uzasadnienia, odpowiedzi, nazwy plików); w DOCX także usuwanie znaków nieprawidłowych w XML 1.0 (inaczej Word zgłasza uszkodzony plik); w PDF zawijanie bardzo długich ciągów bez spacji (bez dzielenia wyrazów). Brak `dangerouslySetInnerHTML`, HTML, Markdown; testy na `</attachment><b>x</b>.pdf`, `<w:p>`, `‮`, NUL, bardzo długim wpisie.
- Nagłówki odpowiedzi: `Content-Disposition: attachment; filename="…"; filename*=UTF-8''…`, nazwa z `exportFileName` (ASCII bez polskich liter w `filename`, pełna nazwa w `filename*`, najwyżej 100 znaków, bez separatorów ścieżek), `Cache-Control: no-store` (dokument zawiera dane projektu), `X-Content-Type-Options: nosniff`.
- Zasoby: generowanie PDF i DOCX działa w głównym wątku procesu (jak ekstrakcja PDF w 7b: **ochrona czasu częściowa**, wpis w `zadania.md`); ograniczają je limity D8 (liczba pozycji i długość tekstów), a eksport jednego wariantu ma sensowny rozmiar (do 150 wpisów).
- Nic nie jest zapisywane na dysku ani w bazie (dokument generowany w locie i zwracany), więc nie ma nowych plików do sprzątania (nie dotyczy wpisu „Usuwanie projektu”).

## Interfejs

- Przy wybranym wariancie sekcja **„Eksport i raport”** (dla każdego członka, także VIEWER): cztery przyciski „Pobierz PDF (płótno)”, „Pobierz DOCX (tekst)”, „Pobierz raport PDF”, „Pobierz raport DOCX” (zwykłe linki do route handlera z `download`), opis „Eksport dotyczy zapisanego stanu wariantu (wersja N); niezapisane zmiany nie są uwzględnione” oraz zdanie, że treści AI w dokumencie są oznaczone i są opinią modelu.
- **Kolejność sekcji rozszerzonego raportu:** 1) strona tytułowa (projekt, opis, wariant, data i godzina `Europe/Warsaw`, wersja stanu, „BMC Agent”) i stałe oznaczenie AI; 2) płótno z kodami źródeł; 3) opis bloków; 4) źródła: załączniki (nazwa, typ, rozmiar, liczba znaków, data, „użyty jako źródło wpisu” / „wgrany, niewykorzystany”) i tabela „Źródła wpisów” z legendą kodów (R ręczny, Rz rozmowa, Z załącznik + nazwa, P runda N pytanie M, W wiedza modelu (niezweryfikowana), S strategia AI, ? nieznane) oraz podsumowaniem „zapisane / ustalone po tekście / nieznane”; 5) ocena najnowsza (tabela, radar w PDF) i historia ocen; 6) cykle poprawek (pytania, odpowiedzi, propozycje i ich status, ocena przed i po); 7) analizy wpływu; 8) porównania wariantów; 9) modele i wersje promptów (tabela zbiorcza); 10) uwagi o danych (stan zapisany, limity „pokazano N z M”, ograniczenia pochodzenia).
- **Stałe oznaczenie AI (D12):** tekst w nagłówku pierwszej strony i w stopce **każdej** strony: „Treści oznaczone „AI” to opinia modelu językowego (…), a nie weryfikacja biznesowa. Model nie sprawdza rynku ani danych liczbowych.”; przy każdej pozycji z modelu etykieta „AI” (tekstem, nie samym kolorem) z modelem i wersją promptu przy wynikach.
- Układ PDF płótna: A4 poziomo, jedna strona, gdy model mieści się (do ok. 60 wpisów i 12 w bloku); przy większym modelu ta sama siatka z zawijaniem na kolejne strony (sprawdza to krok 0b na wariancie z dużą liczbą wpisów). Druk czarno-biały (kody źródeł literowe, kolory pomocnicze).

## Liczba wywołań modelu i koszty

Eksport i raport: **0 wywołań modelu**, brak wpisów w `LlmCallLog`, brak zużycia limitów użytkownika (D3). Jedyny koszt to czas procesora serwera przy generowaniu dokumentu (PDF kilkaset ms do kilku sekund dla dokumentu kilkunastostronicowego: do zmierzenia w 0b, niezmierzone). Wyjątek: **seria kontrolna S1–S5 (9f): 17 wywołań, 12 wierszy `LlmCallLog`, ok. 57 tys. tokenów** (sekcja „Krok 0b i seria kontrolna”).

## Schemat Prisma do akceptacji (D1, PR 9a)

Jedna kolumna, bez nowej tabeli i bez backfillu (istniejące warianty dostają `[]`, a raport używa dopasowania wstecznego):

```prisma
model BmcVariant {
  // ... dotychczasowe pola bez zmian ...
  entryOrigins Json @default("[]") // pochodzenie wpisów (EntryOrigin[], Zod); klucz (blockKey, tekst); zapisywane tym samym UPDATE co stan
}
```

SQL migracji (do przeczytania przed zastosowaniem): `ALTER TABLE "BmcVariant" ADD COLUMN "entryOrigins" JSONB NOT NULL DEFAULT '[]';`. Kontrola: brak `DROP INDEX "BmcVariant_projectId_main_key"` i brak `DROP CONSTRAINT "RefinementRound_roundNumber_check"`. Rozmiar: najwyżej 150 wpisów po ok. 200 bajtów (kilkadziesiąt KB). `writeVariantStateIfVersion` przyjmuje `origins` i zapisuje je razem ze stanem w jednym `updateMany`.

## Decyzje do podjęcia

| | Pytanie | Rekomendacja (alternatywy) |
|---|---|---|
| D1 | Jak ustalać pochodzenie wpisów | **C: zapis w `BmcVariant.entryOrigins` + wsteczne dopasowanie z oznaczoną pewnością.** (A: bez migracji, ale „ręczny” nigdy nie jest znany i są fałszywe przypisania; B: bez wstecznego dopasowania, więc wszystko dotychczasowe „nieznane”.) |
| D2 | Tożsamość wpisu | `(blockKey, dokładny tekst)`; duplikaty w bloku dzielą pochodzenie (znane ograniczenie, wpis „Duplikaty wpisów” zostaje otwarty). Alternatywa: id wpisów w stanie (zmiana modelu BMC, duży zakres). |
| D3 | Opis bloków | **a: złożenie z zapisanych uzasadnień, 0 wywołań.** (b: jedno wywołanie modelu na raport; c: oba, z przyciskiem „Opis AI” dla EDITOR+, wynik w nowej tabeli: później.) |
| D4 | Układ PDF płótna | Klasyczny układ BMC, A4 poziomo, druk czarno-biały, kody źródeł literowe; zawijanie na kolejne strony przy dużym modelu. |
| D5 | Czcionka | **Noto Sans Regular i Bold (TTF, OFL 1.1) w `src/lib/export/fonts/` z `OFL.txt`**, zgłoszone jako pliki binarne. (Roboto, DejaVu Sans, podzbiór przez `pyftsubset`; `@fontsource/*` odrzucone.) |
| D6 | Biblioteki | **`@react-pdf/renderer` 4.9.0 i `docx` 9.15.3, przypięte dokładnie, instalacja z `--before`, `--ignore-scripts`**; wersje potwierdzane w dniu instalacji (próg 14 dni od dnia instalacji). |
| D7 | Adres i parametry | `GET /api/projekty/[id]/eksport?wariant=<id>&format=pdf\|docx&rodzaj=plansza\|raport`, rola VIEWER+, stan zapisany. (Server Action zwracająca plik: niewygodne dla pobierania.) |
| D8 | Limity raportu | Najwyżej 20 ocen, 20 analiz wpływu, 10 porównań (jak listy w interfejsie), wszystkie rundy poprawek (najwyżej 3), wszystkie załączniki (najwyżej 10), 150 wpisów; nadmiar obcięty z adnotacją „pokazano N z M”. |
| D9 | Treść w dokumentach | Wyłącznie zwykły tekst przez `exportText`; w DOCX bez znaków nieprawidłowych w XML 1.0; bez HTML i Markdown; długie ciągi zawijane. |
| D10 | Nazwa pliku | `bmc-<projekt>-<wariant>-<RRRR-MM-DD>.pdf/.docx` (ASCII w `filename`, pełna nazwa w `filename*`, najwyżej 100 znaków). |
| D11 | Daty | Strefa `Europe/Warsaw` jak `formatVariantDate`; w raporcie data generowania i wersja stanu. |
| D12 | Oznaczenie AI | Nagłówek pierwszej strony i stopka każdej strony (PDF i DOCX) + etykieta „AI” przy każdej pozycji z modelu, tekstem. |
| D13 | Ocena w eksporcie płótna | Najnowsza ocena dołączana, jeśli istnieje (oznaczona AI i wersją; uwaga, gdy dotyczy innej wersji); bez przełącznika. (Przełącznik „bez oceny”: dodatkowy UI.) |
| D14 | Testy eksportu | Struktura, nie obraz: PDF przez `unpdf.extractText` (tekst, polskie litery, oznaczenia AI, kody źródeł, liczba stron > 0), DOCX przez `mammoth` (tekst i HTML nagłówków i list tylko w teście). Bez snapshotów obrazów. |
| D15 | Seria kontrolna S1–S5 | **Jedna seria** (decyzja 2026-11-23), 17 wywołań, projekty `P-v6-…`; alternatywa: trzy serie dla porównywalności z tabelami PR „P” (51 wywołań, trzeba podnieść limity jak w D3 z PR „P”). |
| D16 | Kto uruchamia | **Ty:** `prisma migrate dev --create-only`/`migrate dev`/`generate`, `npm run build`, kroki 0b; **ja:** `lint`, `typecheck`, `test`, przegląd SQL. |
| D17 | Dokumenty zapisywane na serwerze? | Nie: generowane w locie, bez magazynu i bez nowej tabeli (brak plików do sprzątania). |
| D18 | CAGR | Poza zakresem (czeka na promotora, spec §15); jeśli dopiszesz, osobny PR po 9e (deterministyczny wynik jako dane użytkownika w raporcie). |

## Wpisy z `docs/zadania.md`

| Wpis | Decyzja |
|---|---|
| Rozszerzony raport ze źródłami (krok 9) | Zamykany w 9e; zapis pochodzenia od 9a; ograniczenia (nieznane) opisane w raporcie i w „Stanie po kroku 9”. |
| Seria kontrolna S1–S5 na `chat-v6` | Zamykany w 9f (wynik i status; ewentualne poprawki promptu w osobnym PR z pomiarem przed i po). |
| Usuwanie projektu (OWNER) | **Zostaje otwarty.** Krok 9 nie dodaje plików ani tabel do sprzątania (`entryOrigins` jest kolumną wariantu, kaskada ją usuwa); dopisek w „Stanie po kroku 9”. |
| Duplikaty wpisów w bloku | **Zostaje otwarty** (D2: wspólne pochodzenie duplikatów), dopisek. |
| Historia porównań wariantów | **Zostaje otwarty**; `listVariantComparisonsForVariant` (9c) rozwiązuje filtr po wariancie dla raportu i może posłużyć stronie porównania w osobnym PR. |
| Ekstrakcja tekstu: ochrona czasu częściowa | Zostaje otwarty; nowy wpis tej samej klasy dla generowania PDF/DOCX w głównym wątku (9e). |
| Ręczny indeks częściowy i `CHECK` | Każda migracja kroku 9 kontrolowana pod kątem obu `DROP` (9a). |
| Wspólny `onError`, osierocone wiadomości, `SAVE_FAILED`, `MAX_STEPS`, D9, `npm audit`, pomiar B | Poza zakresem kroku 9 (bez zmian), z wyjątkiem opcjonalnego pomiaru D9 w 9f. |
| Nakładka radarowa w porównaniu, kosmetyka, Prettier | Poza zakresem. |

## Testy (wyłącznie mocki, bez prawdziwego API)

Zasada z kroków 7 i PR „P”: **testy z prawdziwymi funkcjami odczytu i zapisu, zamockowany tylko klient Prisma**.

- **Pochodzenie (9a):** czyste funkcje (`originsAfterManualSave`: bez zmian, dodanie, edycja tekstu, usunięcie, duplikat, zmiana kolejności; `originsAfterProposal`: add, edit, remove; `originsForStrategy`; kopia); **każda z pięciu ścieżek zapisu** (prawdziwe `saveVariantState`, `acceptProposal`, `acceptRoundBatch`, `createVariant`, `saveStrategyAsVariant`) zapisuje poprawne `entryOrigins` w tym samym `updateMany`/`create`; wyścig o wersję nie zapisuje pochodzenia; uszkodzone `entryOrigins` w bazie nie wywraca zapisu; `resolveEntryOrigins` (zapisane, wsteczne po propozycji, wsteczne po kandydacie strategii, nieznane, duplikaty, uszkodzony zapis); schemat `EntryOrigin` (`strictObject`).
- **Dane raportu (9c):** `loadReportData` z prawdziwymi funkcjami odczytu: filtry po projekcie i wariancie, obcy wariant, limity z adnotacją, uszkodzony rekord, pusty wariant, wariant bez oceny, para „przed i po” (jest, brak, wiele ocen), porównania z filtrem po wariancie, `describeBlock` (wszystkie rodzaje źródeł, brak uzasadnienia).
- **Czcionki i tekst (9b):** polskie litery w PDF, brak podmiany czcionki, zachowanie przy brakujących glifach, `exportText` i `exportFileName` na złośliwych danych (`</attachment>`, NUL, `‮`, `../x`, bardzo długi ciąg, pusty).
- **Dokumenty (9d, 9e):** PDF (`unpdf`) i DOCX (`mammoth`): tytuły, nagłówki bloków, wpisy, kody źródeł i legenda, każdy rodzaj źródła i „nieznane”, oznaczenie AI (nagłówek, stopka, przy pozycji), tabela ocen i para „przed i po”, nazwy załączników jako tekst, wariant pusty, bardzo długi wpis; DOCX otwiera się jako ZIP z poprawnym `[Content_Types].xml` i `word/document.xml` (kontrola przez istniejący `inspectZip`).
- **Route handler (9b, 9d, 9e):** kolejność sesja → rola → wariant → Zod → generowanie, 401, 403 (zbyt niska rola nie istnieje dla VIEWER, test na obcym projekcie: 404), obcy wariant 404, zły `format` i `rodzaj` 400, nagłówki (`Content-Disposition`, `no-store`, `nosniff`), nazwa pliku.
- **`use-server-exports.test.ts`** pilnuje, że nowe pliki z `"use server"` (jeśli powstaną) eksportują tylko funkcje asynchroniczne.

## Krok 0b i seria kontrolna

### Krok 0b po 9b, 9d i 9e (właściciel; konkretne listy kroków i SQL podaję przy otwarciu każdego PR-a)

Dane: projekt „Kawiarnia Ziarno” z przykładowym modelem; do pełnego sprawdzenia źródeł potrzebny wariant, w którym są wpisy wszystkich rodzajów: ręczne (z edytora), z rozmowy (zaakceptowana propozycja), z załącznika, z cyklu poprawek (runda i pytanie), z wiedzy modelu, kopia wariantu i wariant ze strategii. Zapytanie Q0 (jeśli projekty mają powstać zapytaniem) i lista kliknięć w interfejsie w opisie PR 9d. Co sprawdzasz w plikach: **polskie litery** (ąćęłńóśźż i duże) w nazwach, wpisach i uzasadnieniach; układ dziewięciu bloków; stopka i nagłówek z oznaczeniem AI; legenda kodów źródeł i etykiety „zapisane / ustalone po tekście / nieznane” (na wariancie z danymi sprzed 9a); nazwa załącznika z `</attachment>` jako zwykły tekst; bardzo długi wpis; wariant pusty i wariant bez oceny; DOCX otwiera się w Wordzie **bez monitu o naprawę**, ma nawigację po nagłówkach i język polski; PDF ma zaznaczalny tekst i działa wyszukiwanie; nazwa pobranego pliku; czas generowania (odczucie, dla pracy zapisz sekundy).

Zapytania SQL tylko do odczytu (w opisie PR 9a i 9e): kontrola zapisu pochodzenia po każdej z pięciu ścieżek (`SELECT name, version, jsonb_array_length("entryOrigins"), jsonb_pretty("entryOrigins") FROM "BmcVariant" …`) i zestawienie liczby wpisów wg `kind` i `sourceKind`.

### Seria kontrolna S1–S5 na `chat-v6` (PR 9f)

**Cel:** sprawdzić brak regresji poprawek z PR „P” po zmianach promptu w 7d (`chat-v6`: załączniki, źródło propozycji, brak Markdown, zdanie o poleceniach w pliku). Zakres czatu w kroku 9 się nie zmienia (eksport nie dotyka promptów), więc `chat-v6` jest wersją ostateczną dla tej serii; jeśli przed 9f dojdzie PR zmieniający prompt czatu, seria jest odkładana do niego.

- **Koszt (jedna seria):** 17 wywołań modelu (S1: 3, S2: 5, S3 i S5: 5, S4: 4), **12 wierszy `LlmCallLog`** (mieści się w domyślnym limicie 30 na godzinę), ok. **57 tys. tokenów** we+wy (pomiar „po” w PR „P” dla `chat-v5`: 56 806 / 57 144 / 56 825 tokenów w trzech seriach). Czas właściciela ok. 25 do 30 minut. Wariant z trzema seriami: 51 wywołań, 36 wierszy, ok. 170 tys. tokenów (ponad limity godzinowe, więc w `.env` na czas pomiaru podnosisz limity jak w D3 z PR „P” i potem je przywracasz).
- **Warunki stałe jak w PR „P”:** to samo konto pomiarowe, płatny plan Gemini, `gemini-3.5-flash-lite`, wersje promptów `chat-v6`/`evaluate-v1`/`impact-v1`, scenariusze S1 do S5 z `docs/plan-pr-p.md` bez zmian, osobny projekt na scenariusz (nic nie jest kasowane), prefiks projektów **`P-v6-`** (rozłączny z `P-przed2-` i `P-po-`).
- **Projekty:** Q0 z `docs/plan-pr-p.md` z `\set faza 'v6'` i **jedną serią** (w zapytaniu `generate_series(1, 1)` zamiast `1, 3`): 4 projekty `P-v6-S1-seria1`, `P-v6-S2-seria1`, `P-v6-S3S5-seria1`, `P-v6-S4-seria1` (próba z `ROLLBACK`, potem `COMMIT`; oczekiwane: 4 wiersze, S1 z 0 wpisami, pozostałe po 19). Pełne zapytanie podaję w opisie PR 9f.
- **Zapytania (z `docs/plan-pr-p.md`, bez zmian, z `\set prefiks 'P-v6-'`):** Q1 (zużycie), **Q1b i Q1c (muszą dać 0 wierszy: status inny niż `OK` unieważnia scenariusz)**, Q2 (lista tur), Q3 (wycieki identyfikatorów i nazw narzędzi), Q4 (niespodzianki), Q5 i Q6 (przegląd całej serii), Q7 (pytanie w dowolnym miejscu tekstu, M1b). Procedura jak w „Pojedynczej serii” PR „P”: wiadomości dosłownie ze scenariusza, bez „Zatrzymaj”, bez odświeżania karty i restartu serwera w trakcie.
- **Kryteria zaliczenia (jak „po” w PR „P”):** M3, M4, M5, M6, M9, M10 = 0; w S4 i S5 `ask_clarification` = 0 i brak „poniżej” w tekście karty; po „Dziękuję.” brak narzędzi; 17 wywołań; tokeny w granicy +10% względem 56,8 tys. (powyżej +15% sprawdzamy przyczynę: dłuższy prompt `chat-v6` i pusta lista `<attachments>` w kontekście). Pojedyncza seria wychwyci tylko grubą regresję (zastrzeżenie w „Stanie po kroku 9”).
- **Regresja** = osobny PR `fix/prompt-chat-v7` z pomiarem przed i po (nie w 9f).
- **Opcjonalnie (D9 z kroku 7, +2 do 3 wywołań):** jeden projekt z załącznikiem, tura 1 „co jest w załączniku?” i tura 2 niezwiązane pytanie; porównanie `inputTokens` obu tur z `LlmCallLog` (czy wynik odczytu w historii zwiększa koszt). Zamyka wpis o D9 albo uzasadnia skracanie wyników odczytu w historii.

## Weryfikacja (każdy PR)

`npm run lint`, `npm run typecheck`, `npm test` (uruchamiam ja), `npm run build` (Ty). W 9a: Ty `npx --no-install prisma migrate dev --create-only --name pochodzenie_wpisow`, ja czytam SQL (kontrola obu `DROP`), Ty `migrate dev` i `generate`. W 9b: **build jest tu krytyczny** (pierwszy import `@react-pdf/renderer` w kodzie aplikacji). Ręcznie (`npm run start`):
- **9a:** brak zmian w interfejsie; po edycji wpisu w edytorze, akceptacji propozycji, kopii wariantu i zapisie strategii zapytanie o `entryOrigins` pokazuje właściwe `kind`.
- **9b:** pobranie próbnego PDF z polskimi literami (przeglądarka PDF i kopiowanie tekstu do Worda).
- **9d i 9e:** krok 0b z listą w opisie PR.
- **9f:** seria S1–S5.

Każdy PR zatrzymuje się po otwarciu i czeka na review (CLAUDE.md pkt 6). Niczego nie usuwam (gałęzie, stashe, pliki, dane); `prisma/migrations/migration_lock.toml` (objaw końców linii), `pr-5a-body.md` i `schema-diff.txt` zostają nietknięte.

## Kolejność startu PR 9a (po akceptacji planu)

1. `git status`, `git log -3`; `main` po #48 (już wykonane); gałęzi nie usuwam.
2. `git switch -c feat/pochodzenie-wpisow`.
3. Commit 1 (`docs:`): `docs/plan-krok-9.md` (1:1, z „Zmianami po akceptacji”), bez pushu do czasu akceptacji schematu.
4. Zmiana `prisma/schema.prisma` (jedna kolumna) **bez migracji**; stop: pokazuję diff i czekam na akceptację.
5. Po akceptacji: Ty `migrate dev --create-only --name pochodzenie_wpisow`; ja czytam SQL; Ty `migrate dev` i `generate`.
6. Commity: schemat Zod i czyste funkcje, zmiana `writeVariantStateIfVersion` i pięć ścieżek, `resolveEntryOrigins`, testy.
7. `lint`, `typecheck`, `test` (ja), `build` (Ty); opis PR do pliku i `gh pr create --body-file`; stop.

## Zmiany po akceptacji

Plan zaakceptowany 2026-11-24: **D1 do D18 zgodnie z rekomendacjami** (D1 = C, D3 = a, D5 = Noto Sans, D6 = `@react-pdf/renderer` 4.9.0 i `docx` 9.15.3 z `--before`, D15 = jedna seria). **Poprawki poniżej mają pierwszeństwo przed treścią powyżej.** Kolejne rozbieżności i decyzje z implementacji dopisuję tu (numerowane punkty jak w planie kroku 7).

1. **Etykiety źródeł mówią, kto jest autorem treści.** „Ręczny” jest **jedynym** rodzajem oznaczającym tekst użytkownika; pozostałe rodzaje opisujemy jako propozycje AI. Etykiety w raporcie (pełne teksty, kody literowe w płótnie zawsze z legendą pełnych etykiet):

   | Pochodzenie (zapis) | Etykieta w raporcie |
   |---|---|
   | `MANUAL` | „ręczny (tekst użytkownika)” |
   | `PROPOSAL` + `CONVERSATION` | „propozycja agenta w rozmowie (zaakceptowana)” |
   | `PROPOSAL` + `ATTACHMENT` | „propozycja agenta na podstawie załącznika <nazwa>” (nazwa jako zwykły tekst) |
   | `PROPOSAL` + `REFINEMENT` | „propozycja z cyklu poprawek, runda N, pytanie M (na podstawie odpowiedzi użytkownika)” |
   | `PROPOSAL` + `MODEL_KNOWLEDGE` | „wiedza modelu (deklaracja agenta, niezweryfikowana)” |
   | `STRATEGY` | „strategia AI <nazwa>” |
   | brak (pewność `NIEZNANE`) | „źródło nieznane” |

   Przy pewności `USTALONE_PO_TEKSCIE` etykieta dostaje dopisek „(ustalone po tekście, prawdopodobne)”. **W legendzie zapisujemy wprost:** „Wartość `CONVERSATION` (propozycja w rozmowie) nie oznacza, że treść podał użytkownik: agent nie zawsze deklaruje wiedzę własną (`MODEL_KNOWLEDGE`), więc część takich propozycji może opierać się na ogólnej wiedzy modelu.” **Test na etykiety:** czysta funkcja `sourceLabel(origin, certainty)` w `src/lib/report/labels.ts` (PR 9c) z testem każdej etykiety, testem, że **żadna etykieta propozycji AI nie nazywa treści „ręczną” ani „użytkownika” poza dopiskiem „(na podstawie odpowiedzi użytkownika)” przy cyklu poprawek**, testem legendy (zawiera zdanie o `CONVERSATION`) oraz asercjami na etykiety i legendę w wygenerowanych PDF i DOCX (9d, 9e).

2. **Ograniczenie: zaakceptowana propozycja poprawiona potem ręcznie dostaje pochodzenie „ręczny”,** mimo że jej treść pochodzi od AI (zapisujemy tylko, że **bieżący tekst wpisał użytkownik**; zmieniony tekst to nowy wpis w klucz `(blockKey, tekst)`). **Bez implementacji śledzenia edycji** (np. łańcucha „z propozycji, potem poprawione”). Zapisane w: tym planie, **uwagach raportu (sekcja 10 w kolejności sekcji):** „Wpis oznaczony „ręczny” może zawierać tekst zaproponowany wcześniej przez agenta i poprawiony ręcznie; raport nie śledzi edycji, zapisuje tylko, że bieżący tekst wpisał użytkownik.” (test w 9e na obecność tego zdania w PDF i DOCX), oraz **w `docs/zadania.md`** (nowy wpis „Pochodzenie wpisu po ręcznej edycji propozycji AI (krok 9)”, status otwarte, dodawany w PR 9a razem z planem).

3. **Krok 0b po 9d: w opisie PR 9d podaję gotowy scenariusz przygotowania wariantu ze wszystkimi rodzajami źródeł** (dokładne kliknięcia i wiadomości, liczba wywołań modelu), zbudowany na istniejących projektach, jeśli się da: `P-7g-proba1` (ma wykonaną rundę poprawek z jedną propozycją, ale **sprzed 9a, więc jej wpisy mają pochodzenie „ustalone po tekście”**, co służy do sprawdzenia etykiet wstecznych) oraz projekt testowy z załącznikami z kroku 0b po 7d (`kawiarnia.txt`, `zlosliwy.txt`; nazwę i id znajdziesz zapytaniem tylko do odczytu po `Attachment`, podam je w opisie PR). **Rodzaje „zapisane” (pewne) powstają tylko po wdrożeniu 9a**, więc scenariusz tworzy świeży wariant w projekcie z załącznikiem: wpis ręczny (edytor), propozycja z rozmowy, propozycja z załącznika (`read_attachment`), propozycja z wiedzy modelu (prosimy agenta wprost o sugestię z ogólnej wiedzy; jeśli model nie ustawi `model_knowledge`, zapisujemy to w wynikach jako niezweryfikowane na prawdziwym modelu, a rodzaj pokrywają testy), runda poprawek (ocena, pytania, odpowiedzi, „Zastosuj poprawki”), kopia wariantu i wariant ze strategii (zapis kandydata); liczba wywołań modelu policzona w opisie PR (rząd 15 do 20). Dokładna lista kroków powstaje przy otwarciu PR 9d.

4. **Start 9a według „Kolejności startu”:** `git switch -c feat/pochodzenie-wpisow` z `main` (po #48); commit 1 `docs:` z `docs/plan-krok-9.md` (z tymi poprawkami) i wpisem w `docs/zadania.md` z punktu 2; zmiana `prisma/schema.prisma` (jedna kolumna `entryOrigins`) **bez migracji, bez `generate`, bez pushu**; **stop: pokazuję diff schematu i czekam na akceptację przed migracją.**
