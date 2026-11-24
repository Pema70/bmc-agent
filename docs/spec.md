# Specyfikacja: BMC Agent

Plik trafia do `docs/spec.md`. Reguły pracy agenta w repozytorium są w `CLAUDE.md`.

> **Zmiana zakresu 2026-11-18:** usunięta praca zespołowa (dawny krok 8), dochodzą: cykl poprawek po ocenie (krok 7), rozszerzony raport (krok 9), niezależny agent oceniający (krok 10), README (zaraz po PR „P”) oraz wersja 2 systemu z dziewięcioma agentami (§16, po zamknięciu wersji 1). Zamknięte plany kroków (`docs/plan-krok-*.md`) zostają bez zmian jako zapis historii.

## 1. Cel i zakres

Aplikacja webowa z agentem AI wspierającym analizę, tworzenie i ocenę modeli biznesowych w oparciu o Business Model Canvas (BMC). Użytkownik buduje model krok po kroku w rozmowie z agentem (także na podstawie wgranych dokumentów), ocenia go, poprawia w krótkim cyklu pytań i odpowiedzi, sprawdza wpływ zmian, porównuje warianty strategii i pobiera wynik jako PDF i DOCX oraz jako rozszerzony raport.

Aplikacja jest **jednoosobowa**: projekt należy do jednego konta i nie jest udostępniany innym.

Element badawczy pracy (po zamknięciu wersji 1): porównanie architektury z jednym agentem (wersja 1) z architekturą dziewięciu agentów z orkiestracją (wersja 2, §16) na tym samym zestawie przypadków testowych, z oceną niezależnego agenta oceniającego (§6) i oceną ręczną.

**Poza zakresem (świadome uproszczenia):** praca zespołowa (współdzielenie projektów, zapraszanie innych kont, role dla innych użytkowników, polling stanu; usunięte 2026-11-18), współedycja w czasie rzeczywistym, RAG z bazą wektorową, inne frameworki biznesowe niż BMC, wyszukiwanie w internecie przez agenta (decyzja 2026-11-18: źródłami są załączniki, rozmowa i wiedza ogólna modelu).

## 2. Kluczowe decyzje projektowe

| Temat | Decyzja |
|---|---|
| Zmiany proponowane przez agenta | Agent **proponuje**, użytkownik **akceptuje lub odrzuca**. Stan BMC zmienia się dopiero po akceptacji (human-in-the-loop). Dotyczy także cyklu poprawek (§7): poprawki to paczka propozycji, którą użytkownik zatwierdza jednym kliknięciem albo pojedynczo. |
| Streaming czatu | Route handler `/api/chat` (Vercel AI SDK). Server Actions służą do zwykłych mutacji. |
| Analiza wpływu zmian | Jakościowa (opis tekstowy i lista dotkniętych bloków ze stopniem niski/średni/wysoki), **bez parametrów liczbowych** (decyzja kroku 5, `docs/plan-krok-5.md`). W interfejsie oznaczona jako „Analiza AI”, nie weryfikacja biznesowa. |
| Warianty strategii (krok 6) | Generowanie strategii zapisuje *kandydatów* (`StrategyGeneration`), wariant powstaje dopiero po akceptacji użytkownika, agent nie tworzy wariantów sam. Różnice we wpisach przy porównaniu wylicza aplikacja, a nie model. Szczegóły: `docs/plan-krok-6.md`. |
| Projekty jednoosobowe | Każdy projekt ma dokładnie jednego członka z rolą OWNER (twórcę). Brak udostępniania i zaproszeń. Enum `Role` (OWNER/EDITOR/VIEWER), `ProjectMember`, `requireProjectRole` i `getProjectAccess` **zostają w kodzie bez zmian** (sprawdzanie dostępu działa jak dotąd, a usuwanie ról byłoby refaktorem bez zysku dla użytkownika). Ochrona przed nadpisaniem przez pole `version` zostaje (dwie karty przeglądarki tego samego użytkownika). |
| Niezależna ocena (krok 10) | Osobny agent oceniający („sędzia”) na tanim modelu Claude, inny dostawca niż model generujący (Gemini). Widzi **wyłącznie** dziewięć bloków gotowego BMC, bez historii rozmowy, opisu projektu, wariantów i wcześniejszych ocen (ocena „w ciemno”). Szczegóły w §6. |
| Język | Interfejs i odpowiedzi agenta po polsku. |
| Uwierzytelnianie | `next-auth@4.24.15` (Auth.js v4), provider Credentials (e-mail i hasło), sesja JWT. **Uzasadnienie:** Auth.js v5 w chwili decyzji (2026-11) był wciąż w becie (`5.0.0-beta.32`), a projekt używa tylko stabilnych wersji; v4 oficjalnie wspiera Next 16. **Migracja na v5:** cały kod serwerowy czyta sesję wyłącznie przez `getSession()` / `requireSession()` w `src/lib/auth/session.ts`, a `next-auth` importują tylko `src/lib/auth/options.ts`, route handler `/api/auth/[...nextauth]` i komponenty formularzy (`signIn`/`signOut`). Sekret w zmiennej `AUTH_SECRET` (nazwa z v5, v4 też ją czyta). |

## 3. Przepływ użytkownika

1. **Inicjalizacja:** użytkownik podaje nazwę projektu i krótki opis, opcjonalnie wgrywa dokument (opis firmy, biznesplan, notatki). Agent generuje startowy zarys BMC jako propozycje albo rozpoczyna wywiad.
2. **Budowanie krok po kroku:** agent dopytuje o szczegóły (`ask_clarification`) zamiast zgadywać. Proponuje wpisy do bloków, a użytkownik je zatwierdza.
3. **Ewaluacja i modyfikacje:** użytkownik uruchamia ocenę modelu. Edytuje bloki i widzi analizę wpływu zmiany na pozostałe bloki.
4. **Warianty i strategie:** agent generuje 2 do 3 alternatywnych wariantów całego BMC. Warianty są zapisywane w bazie i porównywane. Agent (model) tylko generuje kandydatów, a wariantem staje się kandydat dopiero po zapisaniu przez użytkownika.
5. **Cykl poprawek (najwyżej 3 rundy na wariant):** po ocenie gotowego modelu aplikacja generuje kilka pytań do użytkownika, użytkownik odpowiada w formularzu, model od razu przygotowuje paczkę poprawek (propozycji), użytkownik je zatwierdza, a model jest oceniany ponownie. Szczegóły w §7.
6. **Eksport i raport:** gotowy model do PDF lub DOCX oraz rozszerzony raport do pobrania (§10).
7. **Niezależna ocena (krok 10, badawczo):** gotowy BMC ocenia osobny agent bez wiedzy o projekcie (§6).

## 4. Model BMC

Dziewięć bloków. Klucze (stałe, używane w kodzie, bazie i schematach):

`customer_segments`, `value_propositions`, `channels`, `customer_relationships`, `revenue_streams`, `key_resources`, `key_activities`, `key_partnerships`, `cost_structure`

Każdy blok to lista wpisów tekstowych (krótkie punkty). Przykładowy schemat Zod do zaimplementowania w `src/lib/schemas/bmc.ts`:

```ts
const BlockKey = z.enum([
  "customer_segments", "value_propositions", "channels",
  "customer_relationships", "revenue_streams", "key_resources",
  "key_activities", "key_partnerships", "cost_structure",
]);

const BmcState = z.record(BlockKey, z.array(z.string().min(1).max(500)));
```

## 5. Model danych (szkic Prisma)

Szkic do doprecyzowania podczas implementacji. Każda zmiana schematu wymaga zgody użytkownika.

Prisma ORM 7 łączy się z bazą wyłącznie przez driver adapter: używamy `@prisma/adapter-pg` (wersja przypięta identycznie jak `prisma` i `@prisma/client`).

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  passwordHash String   // hash bcrypt (bcryptjs), nigdy jawny tekst
  createdAt    DateTime @default(now())
  members      ProjectMember[]
}

model Project {
  id          String   @id @default(cuid())
  name        String
  description String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  members     ProjectMember[]
  variants    BmcVariant[]
  attachments Attachment[]
  messages    ChatMessage[]
}

model ProjectMember {      // w wersji jednoosobowej: zawsze jeden wiersz z rolą OWNER na projekt
  projectId String
  userId    String
  role      Role     // OWNER | EDITOR | VIEWER (EDITOR i VIEWER nieużywane od 2026-11-18)
  createdAt DateTime @default(now())
  @@id([projectId, userId])
  @@index([userId])
}

model BmcVariant {
  id        String   @id @default(cuid())
  projectId String
  name      String
  isMain    Boolean  @default(false)
  state     Json     // BmcState (walidowany Zod przy zapisie i odczycie)
  version   Int      @default(1) // optymistyczne blokowanie (wersja stanu, nie nazwy ani flagi głównego)
  description     String?        // założenie strategii (AI_STRATEGY) albo opis ręczny, do 400 znaków
  origin          VariantOrigin  @default(MANUAL) // MANUAL | AI_STRATEGY
  createdById     String?
  generationId    String?        // generacja, z której pochodzi wariant
  generationIndex Int?           // numer kandydata w generacji
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId])
  // + częściowy indeks unikalny ("projectId") WHERE "isMain", dopisany ręcznie do SQL migracji (D2)
  // + @@unique([generationId, generationIndex]): ta sama strategia nie zapisze się dwa razy
}

model Proposal {          // propozycje zmian od agenta
  id        String   @id @default(cuid())
  variantId String
  blockKey  String
  before    Json
  after     Json
  rationale String
  status    ProposalStatus // PENDING | ACCEPTED | REJECTED
  // krok 7 (do akceptacji): źródło propozycji, np. sourceKind (CONVERSATION | ATTACHMENT | REFINEMENT | MODEL_KNOWLEDGE),
  // sourceAttachmentId, refinementRoundId; potrzebne do sekcji „Źródła” w raporcie (§10)
}

model Attachment {
  id        String @id @default(cuid())
  projectId String
  fileName  String
  mimeType  String
  sizeBytes Int
  storageKey String
  extractedText String?
}

model ChatMessage {
  id        String   @id @default(cuid())
  projectId String
  role      String   // user | assistant | tool
  content   Json
  createdAt DateTime @default(now())
}

model LlmCallLog {
  id           String   @id @default(cuid())
  projectId    String?
  model        String
  durationMs   Int
  inputTokens  Int
  outputTokens Int
  costUsd      Decimal?
  createdAt    DateTime @default(now())
}
```

Wynik `analyze_impact` zapisuje model `ImpactAnalysis` (krok 5; szczegóły w `docs/plan-krok-5.md`): `projectId`, `variantId`, `variantVersion`, `stateSnapshot`, `changeKind` (`PROPOSAL` | `DESCRIPTION`), `proposalId`, `change` (migawka zmiany), `result` (Json, `ImpactOutput` walidowany Zod), `schemaVersion`, `trigger` (`UI` | `CHAT`), `provider`, `model`, `promptVersion`, `llmCallLogId`, `createdById`, `createdAt`. Analizy są dopisywane (bez nadpisywania); odpowiedź niezgodna ze schematem nie jest zapisywana (`LlmCallLog.status = SCHEMA_ERROR`).

Wynik `evaluate_bmc` zapisuje model `EvaluationResult` (krok 4; szczegóły w `docs/plan-krok-4.md`): `projectId`, `variantId`, `variantVersion`, `stateSnapshot` (oceniany stan), `result` (Json, `EvaluationOutput` walidowany Zod), `schemaVersion`, `source` (`AI` | `MANUAL`), `trigger` (`UI` | `CHAT`), `provider`, `model`, `promptVersion`, `llmCallLogId`, `createdById`, `createdAt`. Odpowiedź niezgodna ze schematem nie jest zapisywana (`LlmCallLog.status = SCHEMA_ERROR`).

Wynik `generate_strategies` zapisuje model `StrategyGeneration` (krok 6; szczegóły w `docs/plan-krok-6.md`): `projectId`, `variantId` (wariant bazowy), `variantVersion`, `stateSnapshot`, `guidelines` (wytyczne użytkownika, traktowane jako dane), `result` (Json, `StrategiesOutput` walidowany Zod: 2 do 3 kandydatów z nazwą, założeniem i pełnym `BmcState`), `schemaVersion`, `trigger` (`UI` | `CHAT`), `provider`, `model`, `promptVersion`, `llmCallLogId`, `createdById`, `createdAt`. To są **kandydaci, nie warianty**: wariant (`BmcVariant` z `origin = AI_STRATEGY`) powstaje dopiero po zapisaniu kandydata przez użytkownika. Wpisy są dopisywane (bez nadpisywania), odpowiedź niezgodna ze schematem nie jest zapisywana (`LlmCallLog.status = SCHEMA_ERROR`).

Wynik `compare_variants` zapisuje model `VariantComparison` (krok 6; szczegóły w `docs/plan-krok-6.md`): `projectId`, `inputs` (Json: migawka 2 do 3 porównywanych wariantów, dla każdego etykieta A/B/C, `variantId`, nazwa, `version` i `state`, walidowane Zod), `result` (Json, `CompareOutput` walidowany Zod: podsumowanie, uwagi do bloków, zalety i wady każdego wariantu, rekomendacja z etykietą albo bez jednoznacznego wskazania), `schemaVersion`, `trigger` (`UI` | `CHAT`), `provider`, `model`, `promptVersion`, `llmCallLogId`, `createdById`, `createdAt`. Model operuje wyłącznie na etykietach, a prawdziwe identyfikatory wariantów nadaje i mapuje serwer. Porównanie nie ma kluczy obcych do wariantów (ma przeżyć ich usunięcie), więc jest odczytywane po `projectId`; to jawny wyjątek od reguły „projectId i variantId”. Dokładne różnice wpisów (dodane, brakujące) wylicza aplikacja deterministycznie, a model dodaje jakościowe uwagi, zalety, wady i rekomendację. Wpisy są dopisywane (bez nadpisywania), odpowiedź niezgodna ze schematem nie jest zapisywana (`LlmCallLog.status = SCHEMA_ERROR`).

**Planowane (schematy do akceptacji w planach kroków 7 i 10):**

- **`RefinementRound`** (krok 7, cykl poprawek): `projectId`, `variantId`, `roundNumber` (1 do 3, unikalny w obrębie wariantu), `evaluationId` (ocena, od której zaczęła się runda), `variantVersion`, `stateSnapshot`, `questions` (Json, pytania z modelu, walidowane Zod), `answers` (Json, odpowiedzi użytkownika, traktowane jako dane), `result` (Json, paczka propozycji), status rundy, `provider`, `model`, `promptVersion`, `llmCallLogId`, `createdAt`. Propozycje z rundy to zwykłe rekordy `Proposal` z odnośnikiem do rundy.
- **Ocena niezależnego agenta** (krok 10): rekomendacja to ten sam `EvaluationResult` z nową wartością `source = JUDGE` (ten sam `EvaluationOutput`, więc oceny z czatu, ręczne i sędziego da się wprost porównać i nałożyć na radar), z własnym `provider`, `model` i `promptVersion`. Alternatywa: osobna tabela. Decyzja w planie kroku 10.
- **Raport** (krok 9): generowany na żądanie z danych w bazie, bez osobnej tabeli (do potwierdzenia w planie kroku 9).

## 6. Agent AI

### Kontekst

W każdym wywołaniu agent dostaje: prompt systemowy, aktualny stan wariantu BMC (JSON z dziewięcioma blokami), nazwę i opis projektu, skrót historii rozmowy oraz listę załączników (nazwy, bez treści; treść pobiera narzędziem `read_attachment`).

### Narzędzia

Wszystkie argumenty i wyniki są walidowane schematami Zod.

| Narzędzie | Rodzaj | Wejście | Wynik |
|---|---|---|---|
| `ask_clarification` | narzędzie czatu | `question`, opcjonalnie `suggestedAnswers[]` | pytanie wyświetlone użytkownikowi, agent czeka na odpowiedź |
| `propose_block_change` | narzędzie czatu | `blockKey`, `operation` (add / edit / remove), `before`, `after`, `rationale` (krok 7: opcjonalnie źródło, np. `attachmentId`) | rekord `Proposal` ze statusem PENDING. **Stan BMC się nie zmienia.** |
| `read_attachment` | narzędzie czatu (krok 7) | `attachmentId` (i opcjonalnie zakres) | wyekstrahowany tekst (z limitem długości) w oznaczonym bloku danych |
| `analyze_impact` | analiza | zmiana: `proposalId` oczekującej propozycji albo `blockKey` + `description` (stan czyta serwer) | `summary` i lista dotkniętych bloków (innych niż zmieniany) z opisem wpływu i stopniem (niski/średni/wysoki). Wynik zapisuje `ImpactAnalysis` |
| `evaluate_bmc` | analiza | stan BMC (w narzędziu czatu bez argumentów: stan czyta serwer) | obiekt z ocenami 1 do 10 dla kryteriów `coherence` (spójność), `risk_resilience` (ryzyko, **10 = niskie ryzyko**), `feasibility` (realność), `innovation` (innowacyjność) i krótkim uzasadnieniem do każdego. Wszystkie osie: więcej = lepiej. Etykieta PL ryzyka: „Ryzyko (10 = niskie)” |
| `generate_strategies` | analiza (na razie tylko z interfejsu) | stan BMC, opcjonalnie wytyczne użytkownika | 2 do 3 wariantów pełnego BMC (każdy zgodny z `BmcState`) z nazwą i założeniem strategii |
| `compare_variants` | analiza (na razie tylko z interfejsu) | lista `variantId` | różnice blok po bloku, zalety i wady każdego wariantu, rekomendacja |
| `generate_questions` | analiza (krok 7, tylko z interfejsu) | stan wariantu i ostatnia ocena (czyta serwer) | 3 do 5 pytań do użytkownika, każde przypisane do bloku i kryterium oceny, które ma poprawić |
| `refine_from_answers` | analiza (krok 7, tylko z interfejsu) | stan wariantu, pytania i odpowiedzi użytkownika z rundy (czyta serwer) | paczka propozycji (`Proposal`, PENDING) z uzasadnieniem odwołującym się do odpowiedzi |
| `judge_bmc` | osobny agent oceniający (krok 10, interfejs i skrypt ewaluacji) | **tylko** `BmcState` (bez nazwy, opisu, historii, wariantów, ocen) | `EvaluationOutput` (te same kryteria i skala co `evaluate_bmc`), zapis jako ocena sędziego |

**Uwaga implementacyjna:** narzędzia analityczne mogą być wywoływane zarówno przez agenta w rozmowie, jak i bezpośrednio z interfejsu (przyciski typu "Oceń model"). Wszystkie używają wspólnego przepływu `runObjectOperation` (`src/lib/ai/run-object-operation.ts`): `generateText` z `output: Output.object({ schema })` (AI SDK 7; `generateObject` jest tam oznaczony jako przestarzały).

**Stan po kroku 6:** `generate_strategies` i `compare_variants` są na razie dostępne **tylko z interfejsu** (Server Actions), nie jako narzędzia czatu. Wejście stanu: stan czyta serwer z zapisanego wariantu (jak w `evaluate_bmc`). `generate_strategies` zwraca kandydatów, a nie warianty. W `compare_variants` model dostaje etykiety wariantów (A/B/C) zamiast identyfikatorów, a dokładne różnice wpis po wpisie wylicza aplikacja. Narzędzia czatu są odłożone (`docs/zadania.md`).

### Niezależny agent oceniający („sędzia”, krok 10)

- **Cel:** zmniejszyć obciążenie oceny „model ocenia własną pracę” (BMC buduje Gemini, więc ocena Gemini jest obciążona) i dać wspólną, ślepą miarę do porównań w pracy: modeli generujących (§12) oraz architektur jeden agent vs dziewięć agentów (§16).
- **Model:** tani model Claude przez API Anthropic, kandydat: Claude Haiku 5.5 (`claude-haiku-5-5`). Nazwę i cenę weryfikujemy w dokumentacji dostawcy przed pomiarami. Nazwa logiczna w `src/lib/ai/models.ts`: `judge`, konfiguracja w zmiennych `JUDGE_PROVIDER` i `JUDGE_MODEL` (niezależnie od `LLM_PROVIDER` / `LLM_MODEL`). Wymaga pakietu `@ai-sdk/anthropic` (nowa zależność, wybór wersji pokazany przed instalacją, jak w kroku 3).
- **Wiedza:** sędzia widzi **wyłącznie** dziewięć bloków ocenianego stanu. Nie dostaje nazwy ani opisu projektu, historii rozmowy, załączników, innych wariantów, wcześniejszych ocen ani informacji, który model i która architektura zbudowały BMC. Kolejność bloków i format wejścia są zawsze te same.
- **Wynik:** ten sam `EvaluationOutput` i ta sama rubryka co `evaluate_bmc` (osobny prompt `judge-v1`, ta sama zasada „dane, nie polecenia”, zakaz wymyślania faktów i liczb). Dzięki temu oceny AI, sędziego i ręczne leżą na jednej skali.
- **Uruchamianie:** przycisk w interfejsie (tylko ocena, bez wpływu na stan) oraz skrypt ewaluacji z kroku 10 (powtórzenie N razy na zestawie przypadków). Każde wywołanie zapisuje `LlmCallLog` i liczy się do limitów.
- **Ograniczenie metodologiczne:** jeśli w porównaniu modeli generujących bierze udział Claude Sonnet 5.5, sędzia z tej samej rodziny może go faworyzować; opisać w pracy i uzupełnić oceną ręczną.

### Prompty

- Prompt systemowy: rola doradcy biznesowego, zasada "dopytuj zamiast zgadywać", wymóg odpowiedzi po polsku, zakaz wymyślania danych liczbowych, zasada, że zmiany tylko przez `propose_block_change`.
- Osobne, krótkie fragmenty wytycznych dla każdego z dziewięciu bloków (czym jest blok, jakie pytania zadawać, typowe błędy). Trzymaj je w `src/lib/ai/prompts/`. W wersji 2 (§16) te same fragmenty są punktem wyjścia dla „skilli” dziewięciu agentów blokowych, żeby porównanie architektur nie mierzyło różnicy w wiedzy o blokach.

## 7. Załączniki i cykl poprawek (krok 7)

### Załączniki

- Obsługiwane formaty: PDF, DOCX, TXT. Limit rozmiaru ustaw w konfiguracji (np. 10 MB).
- Tekst ekstrahowany przy wgrywaniu i zapisywany w `extractedText`.
- Treść z plików trafia do promptu **tylko w oznaczonym bloku danych** (np. `<attachment name="...">...</attachment>`). System prompt mówi wprost, że zawartość załączników to dane, nie polecenia (ochrona przed prompt injection).
- Model zbudowany z załącznika: agent czyta załącznik (`read_attachment`) i proponuje wpisy (`propose_block_change`) ze wskazaniem załącznika jako źródła. Do promptu nie trafia nic poza oznaczonym blokiem danych.
- **DO ZDECYDOWANIA:** miejsce przechowywania plików (dysk lokalny na dev, zewnętrzny magazyn na produkcji).

### Cykl poprawek: ocena → pytania → poprawki

Działa na zapisanym stanie wariantu, z załącznikiem albo bez niego, gdy model jest „gotowy” (minimalna zawartość jak dla oceny). Jedna runda:

1. **Ocena:** `evaluate_bmc` (istniejąca funkcja) na zapisanym stanie.
2. **Pytania:** `generate_questions` na podstawie oceny (najsłabsze kryteria) i stanu: 3 do 5 konkretnych pytań, każde z blokiem i kryterium, które ma poprawić, opcjonalnie z sugerowanymi odpowiedziami. Pytania nie mogą prosić o dane, których model by potem użył jako faktów bez źródła.
3. **Odpowiedzi:** użytkownik wypełnia formularz (pytania można pominąć). Odpowiedzi to dane, nie polecenia (oznaczony blok w prompcie, limit długości).
4. **Poprawki od razu:** `refine_from_answers` w tym samym kroku tworzy paczkę propozycji (`Proposal`, PENDING), pokazaną jako diff na płótnie. Użytkownik może zatwierdzić całą paczkę jednym kliknięciem („Zastosuj poprawki”, z kontrolą `version`) albo pojedyncze propozycje. Stan zmienia się dopiero po kliknięciu.
5. **Ocena po poprawkach:** automatyczna propozycja ponownej oceny po zastosowaniu paczki, żeby zapisać wynik „przed” i „po” (dane do rozdziału testowego).

- **Limit:** najwyżej **3 rundy na wariant** (licznik z bazy, `RefinementRound.roundNumber` 1 do 3, sprawdzany po stronie serwera w transakcji). Po trzeciej rundzie dalsze zmiany tylko ręcznie albo przez czat.
- Każda runda to 2 wywołania modelu (pytania i poprawki) plus oceny, wszystkie w `LlmCallLog` i w limitach użytkownika.
- Niezapisane zmiany płótna blokują rozpoczęcie rundy (komunikat „Najpierw zapisz albo cofnij swoje zmiany”).

## 8. Uprawnienia (projekty jednoosobowe)

- Projekt widzi i edytuje wyłącznie jego właściciel (OWNER). Osoba spoza projektu dostaje 404 (nie zdradzamy istnienia projektu).
- Każda akcja serwerowa najpierw sprawdza sesję i dostęp do projektu (`requireProjectRole` / `getProjectAccess`, jak dotąd). Wymagane w kodzie role EDITOR/VIEWER pozostają (OWNER je spełnia), bez zmian w logice.
- Zapis wariantu wymaga aktualnego `version`. Przy konflikcie (np. dwie karty) interfejs informuje użytkownika i prosi o odświeżenie.
- Stan pobierany przy wejściu na stronę i po akcjach (`router.refresh()`). **Bez pollingu** (był potrzebny tylko do współpracy).
- Usunięte z zakresu: zapraszanie kont, zmiana ról członków, podgląd dla VIEWER, wątki czatu per użytkownik.

## 9. Wizualizacja i interfejs

- Edytor BMC: siatka dziewięciu bloków w układzie klasycznego płótna.
- **Przejrzystość zmian AI:** propozycje agenta wyświetlane jako podświetlony diff w bloku (usunięte i dodane wpisy) z przyciskami "Zaakceptuj" i "Odrzuć"; paczka z cyklu poprawek ma dodatkowo przycisk „Zastosuj poprawki”.
- Wykres radarowy (SVG) z wynikami `evaluate_bmc` (oraz nakładka oceny sędziego i ręcznej, krok 10).
- Widok porównania wariantów obok siebie z podświetlonymi różnicami.
- Czat z agentem (streaming) obok płótna.
- Panel „Cykl poprawek” (krok 7): numer rundy (N z 3), pytania, formularz odpowiedzi, wynik.

## 10. Eksport i raport (krok 9)

- PDF: `@react-pdf/renderer`, szablon z układem płótna BMC (tytuł projektu, dziewięć bloków, opcjonalnie wynik oceny).
- DOCX: biblioteka `docx`, wersja tekstowa (nagłówki bloków i listy wpisów).
- Eksport dotyczy wybranego wariantu.
- **Rozszerzony raport** (PDF i DOCX, do pobrania w aplikacji), zawiera:
  - nazwę i opis projektu, nazwę wariantu, datę, model i wersje promptów użyte do wyników AI;
  - płótno BMC i dla każdego bloku krótki opis „co tu jest i dlaczego” (z uzasadnień zaakceptowanych propozycji, bez generowania nowych treści albo jednym dodatkowym wywołaniem modelu, do decyzji w planie kroku 9);
  - **źródła:** lista załączników, z których korzystał agent, i dla każdego wpisu pochodzenie: wpis ręczny, propozycja AI z rozmowy, propozycja AI na podstawie załącznika (nazwa pliku), poprawka z cyklu poprawek (runda i pytanie), wiedza ogólna modelu (oznaczona wprost jako niezweryfikowana);
  - ostatnią ocenę (tabela, radar), historię ocen przed i po cyklach poprawek, oceny sędziego (jeśli są);
  - zapisane analizy wpływu i porównania wariantów, jeśli istnieją;
  - stałe oznaczenie, że treści AI to opinia modelu, a nie weryfikacja biznesowa.
- Raport składa się z danych zapisanych w bazie; wszystkie treści jako zwykły tekst (bez HTML z modelu).

## 11. Bezpieczeństwo i koszty

- Hasła hashowane bcryptem (`bcryptjs`, koszt 12). Hasło: 8–72 znaki i najwyżej 72 bajty w UTF-8 (limit bcrypt). E-mail zapisywany i porównywany małymi literami. Sesje przez Auth.js (patrz „Uwierzytelnianie” w sekcji 2).
- Klucze API tylko po stronie serwera, w zmiennych środowiskowych.
- Limity: liczba zapytań do agenta na użytkownika na godzinę, maksymalna liczba tokenów na zapytanie.
- Walidacja Zod wszystkich wejść (formularze, argumenty narzędzi, odpowiedzi LLM, odpowiedzi użytkownika w cyklu poprawek). Odpowiedź LLM niezgodna ze schematem nie może trafić do bazy.
- Każde wywołanie LLM zapisywane w `LlmCallLog` (także sędziego i cyklu poprawek).

## 12. Modele LLM

### Etapy pracy z modelami

0. **Narzędzie deweloperskie:** Claude Code z subskrypcji Claude Pro, bez kredytów API. To nie jest model aplikacji, tylko narzędzie do pisania kodu.
1. **Rozwój mechaniki** (czat krok po kroku, narzędzia agenta, baza danych, interfejs): darmowy klucz Gemini (Google AI Studio) albo tani model OpenAI z małym doładowaniem (kandydat OpenAI: `gpt-6-luna`; model Gemini z rodziny Flash). Nazwy modeli i limity darmowego planu weryfikujemy w dokumentacji dostawców.
2. **Przykłady do testów i porównanie modeli:** Claude Sonnet 5.5 (`claude-sonnet-5-5`) przez API Anthropic (płatne kredyty, dopiero na końcu, kilka serii testów) oraz modele z etapu 1.
3. **Porównanie modeli** (rozdział testowy): te same przypadki testowe, te same prompty i te same schematy Zod dla wszystkich modeli.
4. **Niezależna ocena:** sędzia (tani model Claude, kandydat `claude-haiku-5-5`) ocenia wyniki wszystkich modeli i obu architektur tym samym promptem (§6).
5. **Porównanie architektur** (po wersji 2, §16): jeden agent vs dziewięć agentów, ten sam model generujący, te same przypadki, ten sam sędzia.

### Konfiguracja

- Jeden plik `src/lib/ai/models.ts` mapuje nazwę logiczną na dostawcę i identyfikator modelu. Reszta kodu używa tylko nazwy logicznej (np. `chat`, `judge`, `compare-a`).
- Zmienne środowiskowe: `LLM_PROVIDER` (`google` | `openai` | `anthropic`), `LLM_MODEL`, `JUDGE_PROVIDER`, `JUDGE_MODEL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
- Klucze trzymamy tylko w pliku `.env` projektu. `ANTHROPIC_API_KEY` nie może być zmienną systemową, bo Claude Code użyłby go zamiast subskrypcji (naliczyłby opłaty API).
- Wszystko przez Vercel AI SDK. Zakaz używania API specyficznych dla jednego dostawcy.
- Zmiana modelu nie wymaga zmian w kodzie aplikacji.

### Zasady

- Prompty i schematy Zod muszą działać na wszystkich modelach z konfiguracji. Odpowiedź niezgodna ze schematem jest odrzucana i traktowana jako błąd (liczony w statystykach porównania).
- Nie dostrajaj promptów pod jeden model. Przed rozdziałem testowym uruchom ten sam zestaw przypadków na wszystkich modelach i poprawiaj prompty na podstawie wyników wszystkich.
- Model deweloperski też wchodzi do porównania, żeby pokazać różnicę między tanim a mocnym modelem.
- W porównaniu bierze udział co najmniej trzy modele: Claude Sonnet 5.5 oraz co najmniej dwa modele z etapu 1 (np. Gemini i OpenAI).
- Model sędziego jest stały dla wszystkich serii pomiarów (nie zmieniamy go między seriami).
- Budżet: kredyty API Anthropic doładowujemy dopiero przed testami porównawczymi, w niewielkiej kwocie, z ustawionym limitem wydatków w konsoli. Liczba serii testów wynika z budżetu (zaplanuj przypadki i liczbę uruchomień z góry, łącznie z wywołaniami sędziego).
- Przy darmowych planach API (np. Gemini) obowiązują limity zapytań. Aplikacja ma obsługiwać błędy limitów (ponowienie z opóźnieniem, czytelny komunikat). Do darmowych planów wysyłamy tylko dane przykładowe, nie poufne. Warunki wykorzystania danych w darmowym planie sprawdzamy w dokumentacji dostawcy.
- Mierzone wielkości: jakość (rubryka ręczna zdefiniowana z góry i ocena sędziego), zgodność ze schematem Zod, czas odpowiedzi, koszt (z `LlmCallLog`), liczba wywołań modelu na zbudowany BMC.
- Przykłady wygenerowane mocniejszym modelem opisujemy w pracy jako wyniki konkretnego modelu, nie jako wynik działania aplikacji w ogóle.
- Nazwy modeli i ceny weryfikujemy w dokumentacji dostawców przed każdą serią testów, bo modele bywają wycofywane (np. modele z serii GPT-4o mają zostać usunięte z API OpenAI 14 stycznia 2027).
- Każdy zapis wyniku zawiera: nazwę modelu, datę, wersję promptu (a w wersji 2 także architekturę).

## 13. Dane testowe i weryfikacja

- Skrypt `prisma/seed.ts` ładujący gotowe przykładowe modele BMC prawdziwych firm: kilka, które odniosły sukces, i kilka, które upadły.
- **Stały zestaw przypadków testowych** (opis firmy, opcjonalnie załącznik, skrypt odpowiedzi użytkownika), wspólny dla porównania modeli i porównania architektur (wersja 1 vs wersja 2). Zestaw ustalamy przed pierwszą serią i nie zmieniamy między seriami.
- Testy jednostkowe: schematy Zod, handlery narzędzi, logika uprawnień, wersjonowanie.
- Ewaluacja jakości LLM (osobny skrypt, uruchamiany ręcznie): te same przypadki i prompty dla kilku modeli, zapis wyników i kosztów do porównania w pracy. Kryteria oceny zdefiniuj z góry (np. trafność, spójność, użyteczność). Ocenianie modelu przez inny model jest obciążone, więc: sędzia z innej rodziny niż model generujący (§6) oraz ocena ręczna (ręczna ocena referencyjna, `source = MANUAL`).

## 14. Kolejność prac

1. Szkielet projektu, Postgres w Dockerze, Prisma, Auth.js (rejestracja i logowanie). **Zrobione.**
2. Projekty, role, edytor BMC bez AI. **Zrobione.**
3. Czat z agentem: `ask_clarification` i `propose_block_change` z akceptacją zmian. **Zrobione.**
4. `evaluate_bmc` i wykres radarowy. **Zrobione.**
5. `analyze_impact`. **Zrobione.**
6. `generate_strategies`, `compare_variants`, zapis i widok wariantów. **Zrobione.**
   - PR „P”: poprawki promptu agenta z pomiarem przed i po (`docs/plan-krok-6.md`).
   - PR README: instrukcja uruchomienia krok po kroku (`README.md`).
7. Załączniki, `read_attachment` i cykl poprawek (ocena → pytania → poprawki, najwyżej 3 rundy na wariant, §7).
8. ~~Współdzielenie projektów~~ **Usunięte z zakresu 2026-11-18** (projekty jednoosobowe, §8). Numer zostaje, żeby odwołania „krok 9” i „krok 10” w dokumentach były aktualne.
9. Eksport PDF i DOCX oraz rozszerzony raport ze źródłami (§10). **Zrobione.**
10. Dane przykładowe, ręczna ocena referencyjna, niezależny agent oceniający (`judge_bmc`), skrypt ewaluacji, porównanie modeli.
11. Wersja 2: dziewięciu agentów z orkiestracją (§16) i porównanie architektur. Zaczyna się dopiero po zamknięciu kroków 1 do 10.

## 15. Otwarte kwestie

- ~~Czy analiza wpływu ma zawierać parametry liczbowe?~~ Rozstrzygnięte w kroku 5: nie.
- ~~Praca zespołowa?~~ Rozstrzygnięte 2026-11-18: usunięta.
- Gdzie przechowywać pliki załączników na produkcji?
- Gdzie hostować bazę Postgres na produkcji (i czy wdrożenie produkcyjne jest w ogóle potrzebne do pracy)?
- Dokładne nazwy i ceny modeli do porównania (w tym modelu sędziego) oraz aktualne limity darmowego planu Gemini API (weryfikacja w dokumentacji dostawców przed testami).
- Budżet na kredyty API Anthropic i liczba serii testów porównawczych (z wywołaniami sędziego).
- ~~Źródła w raporcie?~~ Rozstrzygnięte 2026-11-18: załączniki, rozmowa i wiedza ogólna modelu (oznaczona jako niezweryfikowana). Bez wyszukiwania w internecie.
- ~~Forma paczki poprawek?~~ Rozstrzygnięte 2026-11-18: propozycje (`Proposal`, PENDING) do zatwierdzenia przez użytkownika, nie nowy wariant.
- **Sędzia:** jakie kryteria (te same cztery co `evaluate_bmc`, rekomendacja, czy dodatkowe), czy sędzia widzi nazwę branży (dziś: nie), ile powtórzeń na przypadek.
- **CAGR (sugestia promotora):** gdzie ma się pojawić. Propozycje: (a) w pracy, we wstępie, jako uzasadnienie tematu (wzrost rynku narzędzi AI dla biznesu, liczba ze źródła literaturowego); (b) w aplikacji jako opcjonalne „Dane rynkowe”: użytkownik podaje wielkość rynku w dwóch latach i źródło, aplikacja liczy CAGR = (wartość końcowa / wartość początkowa)^(1 / liczba lat) − 1 deterministycznie, a model dostaje wynik jako oznaczone dane użytkownika (nigdy nie liczy ani nie wymyśla go sam), wynik trafia do raportu ze źródłem. Do ustalenia z promotorem.
- ~~Repozytorium wersji 2?~~ Rozstrzygnięte 2026-11-18: to samo repozytorium z przełącznikiem trybu (`AGENT_MODE=single|multi`), wspólna baza, sędzia i skrypt ewaluacji (§16).

## 16. Wersja 2: dziewięciu agentów z orkiestracją (po wersji 1)

Szkic do doprecyzowania w osobnym planie po zamknięciu kroku 10. **To samo repozytorium** (decyzja 2026-11-18): przełącznik `AGENT_MODE=single|multi` (zmienna środowiskowa, domyślnie `single`), wspólna baza, płótno, ocena, raport, sędzia i skrypt ewaluacji; tryb `multi` to osobny moduł orkiestracji, a tryb `single` działa bez zmian. Nie implementujemy niczego z tej sekcji w wersji 1, ale decyzje wersji 1 nie mogą jej blokować (wspólne schematy, logi, sędzia, zestaw przypadków).

- **Agenci blokowi:** dziewięciu niezależnych agentów, każdy odpowiada za jeden blok BMC i ma własny „skill” (instrukcje dla bloku: czym jest blok, jakie pytania zadawać, typowe błędy, kryteria dobrego wpisu). Punkt wyjścia: fragmenty z `src/lib/ai/prompts/` (§6), żeby różnica w wynikach wynikała z architektury, a nie z innej wiedzy o blokach.
- **Orkiestrator:** rozdziela zadanie (opis firmy, odpowiedzi, załączniki) na agentów, zbiera ich propozycje, wykrywa sprzeczności między blokami (np. kanały niepasujące do segmentów) i prosi właściwych agentów o korektę. Agenci działają niezależnie (każdy widzi swoje dane wejściowe i ewentualnie zatwierdzony stan pozostałych bloków, do decyzji).
- **Wynik:** ten sam `BmcState` i te same propozycje (`Proposal`) co w wersji 1, więc płótno, ocena, raport i sędzia działają bez zmian.
- **Pomiar (element badawczy):** te same przypadki testowe, ten sam model generujący, ten sam sędzia i ta sama rubryka ręczna. Mierzymy: ocenę sędziego i ręczną, spójność między blokami, zgodność ze schematem, liczbę wywołań modelu, tokeny, koszt i czas na jeden zbudowany BMC. Każdy zapis ma pole architektury (`single` / `multi`).
- **Ryzyka:** 9 do 10 razy więcej wywołań modelu na turę (limity darmowego planu Gemini, koszty), spójność między blokami, czas odpowiedzi.
