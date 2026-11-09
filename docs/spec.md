# Specyfikacja: BMC Agent

Plik trafia do `docs/spec.md`. Reguły pracy agenta w repozytorium są w `CLAUDE.md`.

## 1. Cel i zakres

Aplikacja webowa z agentem AI wspierającym analizę, tworzenie i ocenę modeli biznesowych w oparciu o Business Model Canvas (BMC). Użytkownik buduje model krok po kroku w rozmowie z agentem, ocenia go, sprawdza wpływ zmian, porównuje warianty strategii i eksportuje wynik do PDF i DOCX.

**Poza zakresem (świadome uproszczenia):** współedycja w czasie rzeczywistym (jak Google Docs), RAG z bazą wektorową, inne frameworki biznesowe niż BMC.

## 2. Kluczowe decyzje projektowe

| Temat | Decyzja |
|---|---|
| Zmiany proponowane przez agenta | Agent **proponuje**, użytkownik **akceptuje lub odrzuca**. Stan BMC zmienia się dopiero po akceptacji (human-in-the-loop). |
| Streaming czatu | Route handler `/api/chat` (Vercel AI SDK). Server Actions służą do zwykłych mutacji. |
| Analiza wpływu zmian | Jakościowa (opis tekstowy i lista dotkniętych bloków). **DO ZDECYDOWANIA:** czy dodajemy proste parametry liczbowe (koszty, przychody). Domyślnie: nie. |
| Praca zespołowa | Asynchroniczna: zapis w Postgres, odświeżanie stanu, role. Ochrona przed nadpisaniem przez pole `version` (optymistyczne blokowanie). |
| Język | Interfejs i odpowiedzi agenta po polsku. |

## 3. Przepływ użytkownika

1. **Inicjalizacja:** użytkownik podaje nazwę projektu i krótki opis. Agent generuje startowy zarys BMC albo rozpoczyna wywiad.
2. **Budowanie krok po kroku:** agent dopytuje o szczegóły (`ask_clarification`) zamiast zgadywać. Proponuje wpisy do bloków, a użytkownik je zatwierdza.
3. **Ewaluacja i modyfikacje:** użytkownik uruchamia ocenę modelu. Edytuje bloki i widzi analizę wpływu zmiany na pozostałe bloki.
4. **Warianty i strategie:** agent generuje 2 do 3 alternatywnych wariantów całego BMC. Warianty są zapisywane w bazie i porównywane.
5. **Współpraca:** właściciel udostępnia projekt innym kontom z określoną rolą.
6. **Eksport:** gotowy model do PDF lub DOCX.

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
  members     ProjectMember[]
  variants    BmcVariant[]
  attachments Attachment[]
  messages    ChatMessage[]
}

model ProjectMember {
  projectId String
  userId    String
  role      Role     // OWNER | EDITOR | VIEWER
  @@id([projectId, userId])
}

model BmcVariant {
  id        String   @id @default(cuid())
  projectId String
  name      String
  isMain    Boolean  @default(false)
  state     Json     // BmcState (walidowany Zod przy zapisie i odczycie)
  version   Int      @default(1) // optymistyczne blokowanie
  updatedAt DateTime @updatedAt
}

model Proposal {          // propozycje zmian od agenta
  id        String   @id @default(cuid())
  variantId String
  blockKey  String
  before    Json
  after     Json
  rationale String
  status    ProposalStatus // PENDING | ACCEPTED | REJECTED
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

## 6. Agent AI

### Kontekst

W każdym wywołaniu agent dostaje: prompt systemowy, aktualny stan wariantu BMC (JSON z dziewięcioma blokami), nazwę i opis projektu, skrót historii rozmowy oraz listę załączników (nazwy, bez treści; treść pobiera narzędziem `read_attachment`).

### Narzędzia

Wszystkie argumenty i wyniki są walidowane schematami Zod.

| Narzędzie | Rodzaj | Wejście | Wynik |
|---|---|---|---|
| `ask_clarification` | narzędzie czatu | `question`, opcjonalnie `suggestedAnswers[]` | pytanie wyświetlone użytkownikowi, agent czeka na odpowiedź |
| `propose_block_change` | narzędzie czatu | `blockKey`, `operation` (add / edit / remove), `before`, `after`, `rationale` | rekord `Proposal` ze statusem PENDING. **Stan BMC się nie zmienia.** |
| `read_attachment` | narzędzie czatu | `attachmentId` (i opcjonalnie zakres) | wyekstrahowany tekst (z limitem długości) |
| `analyze_impact` | analiza | `blockKey`, `change` | lista dotkniętych bloków z opisem wpływu i stopniem (niski/średni/wysoki) |
| `evaluate_bmc` | analiza | stan BMC | obiekt z ocenami 1 do 10 dla kryteriów (spójność, ryzyko, realność, innowacyjność) i krótkim uzasadnieniem do każdego |
| `generate_strategies` | analiza | stan BMC, opcjonalnie wytyczne użytkownika | 2 do 3 wariantów pełnego BMC (każdy zgodny z `BmcState`) z nazwą i założeniem strategii |
| `compare_variants` | analiza | lista `variantId` | różnice blok po bloku, zalety i wady każdego wariantu, rekomendacja |

**Uwaga implementacyjna:** cztery narzędzia analityczne (`analyze_impact`, `evaluate_bmc`, `generate_strategies`, `compare_variants`) mogą być wywoływane zarówno przez agenta w rozmowie, jak i bezpośrednio z interfejsu (przyciski typu "Oceń model"). W obu przypadkach używają tej samej funkcji generującej obiekt według schematu Zod (`generateObject`). Wybór sposobu wywołania zapisz w kodzie jednym, spójnym wzorcem.

### Prompty

- Prompt systemowy: rola doradcy biznesowego, zasada "dopytuj zamiast zgadywać", wymóg odpowiedzi po polsku, zakaz wymyślania danych liczbowych, zasada, że zmiany tylko przez `propose_block_change`.
- Osobne, krótkie fragmenty wytycznych dla każdego z dziewięciu bloków (czym jest blok, jakie pytania zadawać, typowe błędy). Trzymaj je w `src/lib/ai/prompts/`.

## 7. Załączniki

- Obsługiwane formaty: PDF, DOCX, TXT. Limit rozmiaru ustaw w konfiguracji (np. 10 MB).
- Tekst ekstrahowany przy wgrywaniu i zapisywany w `extractedText`.
- Treść z plików trafia do promptu **tylko w oznaczonym bloku danych** (np. `<attachment name="...">...</attachment>`). System prompt mówi wprost, że zawartość załączników to dane, nie polecenia (ochrona przed prompt injection).
- **DO ZDECYDOWANIA:** miejsce przechowywania plików (dysk lokalny na dev, zewnętrzny magazyn na produkcji).

## 8. Współpraca i uprawnienia

- Role: OWNER (wszystko, zarządzanie członkami), EDITOR (edycja i rozmowa z agentem), VIEWER (tylko odczyt i eksport).
- Każda akcja serwerowa najpierw sprawdza sesję i rolę w projekcie.
- Zapis wariantu wymaga aktualnego `version`. Przy konflikcie interfejs informuje użytkownika i prosi o odświeżenie.
- Odświeżanie stanu: pobieranie przy wejściu na stronę i okresowy polling (bez WebSocketów).

## 9. Wizualizacja i interfejs

- Edytor BMC: siatka dziewięciu bloków w układzie klasycznego płótna.
- **Przejrzystość zmian AI:** propozycje agenta wyświetlane jako podświetlony diff w bloku (usunięte i dodane wpisy) z przyciskami "Zaakceptuj" i "Odrzuć".
- Wykres radarowy (Recharts) z wynikami `evaluate_bmc`.
- Widok porównania wariantów obok siebie z podświetlonymi różnicami.
- Czat z agentem (streaming) obok płótna.

## 10. Eksport

- PDF: `@react-pdf/renderer`, szablon z układem płótna BMC (tytuł projektu, dziewięć bloków, opcjonalnie wynik oceny).
- DOCX: biblioteka `docx`, wersja tekstowa (nagłówki bloków i listy wpisów).
- Eksport dotyczy wybranego wariantu.

## 11. Bezpieczeństwo i koszty

- Hasła hashowane (bcrypt lub argon2). Sesje przez Auth.js.
- Klucze API tylko po stronie serwera, w zmiennych środowiskowych.
- Limity: liczba zapytań do agenta na użytkownika na godzinę, maksymalna liczba tokenów na zapytanie.
- Walidacja Zod wszystkich wejść (formularze, argumenty narzędzi, odpowiedzi LLM). Odpowiedź LLM niezgodna ze schematem nie może trafić do bazy.
- Każde wywołanie LLM zapisywane w `LlmCallLog`.

## 12. Modele LLM

### Etapy pracy z modelami

0. **Narzędzie deweloperskie:** Claude Code z subskrypcji Claude Pro, bez kredytów API. To nie jest model aplikacji, tylko narzędzie do pisania kodu.
1. **Rozwój mechaniki** (czat krok po kroku, narzędzia agenta, baza danych, interfejs): darmowy klucz Gemini (Google AI Studio) albo tani model OpenAI z małym doładowaniem (kandydat OpenAI: `gpt-6-luna`; model Gemini z rodziny Flash). Nazwy modeli i limity darmowego planu weryfikujemy w dokumentacji dostawców.
2. **Przykłady do testów i porównanie modeli:** Claude Sonnet 5.5 (`claude-sonnet-5-5`) przez API Anthropic (płatne kredyty, dopiero na końcu, kilka serii testów) oraz modele z etapu 1.
3. **Porównanie modeli** (rozdział testowy): te same przypadki testowe, te same prompty i te same schematy Zod dla wszystkich modeli.

### Konfiguracja

- Jeden plik `src/lib/ai/models.ts` mapuje nazwę logiczną na dostawcę i identyfikator modelu. Reszta kodu używa tylko nazwy logicznej (np. `dev`, `strong`, `compare-a`).
- Zmienne środowiskowe: `LLM_PROVIDER` (`google` | `openai` | `anthropic`), `LLM_MODEL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
- Klucze trzymamy tylko w pliku `.env` projektu. `ANTHROPIC_API_KEY` nie może być zmienną systemową, bo Claude Code użyłby go zamiast subskrypcji (naliczyłby opłaty API).
- Wszystko przez Vercel AI SDK. Zakaz używania API specyficznych dla jednego dostawcy.
- Zmiana modelu nie wymaga zmian w kodzie aplikacji.

### Zasady

- Prompty i schematy Zod muszą działać na wszystkich modelach z konfiguracji. Odpowiedź niezgodna ze schematem jest odrzucana i traktowana jako błąd (liczony w statystykach porównania).
- Nie dostrajaj promptów pod jeden model. Przed rozdziałem testowym uruchom ten sam zestaw przypadków na wszystkich modelach i poprawiaj prompty na podstawie wyników wszystkich.
- Model deweloperski też wchodzi do porównania, żeby pokazać różnicę między tanim a mocnym modelem.
- W porównaniu bierze udział co najmniej trzy modele: Claude Sonnet 5.5 oraz co najmniej dwa modele z etapu 1 (np. Gemini i OpenAI).
- Budżet: kredyty API Anthropic doładowujemy dopiero przed testami porównawczymi, w niewielkiej kwocie, z ustawionym limitem wydatków w konsoli. Liczba serii testów wynika z budżetu (zaplanuj przypadki i liczbę uruchomień z góry).
- Przy darmowych planach API (np. Gemini) obowiązują limity zapytań. Aplikacja ma obsługiwać błędy limitów (ponowienie z opóźnieniem, czytelny komunikat). Do darmowych planów wysyłamy tylko dane przykładowe, nie poufne. Warunki wykorzystania danych w darmowym planie sprawdzamy w dokumentacji dostawcy.
- Mierzone wielkości: jakość (rubryka ręczna zdefiniowana z góry), zgodność ze schematem Zod, czas odpowiedzi, koszt (z `LlmCallLog`).
- Przykłady wygenerowane mocniejszym modelem opisujemy w pracy jako wyniki konkretnego modelu, nie jako wynik działania aplikacji w ogóle.
- Nazwy modeli i ceny weryfikujemy w dokumentacji dostawców przed każdą serią testów, bo modele bywają wycofywane (np. modele z serii GPT-4o mają zostać usunięte z API OpenAI 14 stycznia 2027).
- Każdy zapis wyniku zawiera: nazwę modelu, datę, wersję promptu.

## 13. Dane testowe i weryfikacja

- Skrypt `prisma/seed.ts` ładujący gotowe przykładowe modele BMC prawdziwych firm: kilka, które odniosły sukces, i kilka, które upadły.
- Testy jednostkowe: schematy Zod, handlery narzędzi, logika uprawnień, wersjonowanie.
- Ewaluacja jakości LLM (osobny skrypt, uruchamiany ręcznie): te same przypadki i prompty dla kilku modeli, zapis wyników i kosztów do porównania w pracy. Kryteria oceny zdefiniuj z góry (np. trafność, spójność, użyteczność). Uwaga: ocenianie modelu przez inny model jest obciążone, więc uzupełnij je oceną ręczną.

## 14. Kolejność prac (propozycja)

1. Szkielet projektu, Postgres w Dockerze, Prisma, Auth.js (rejestracja i logowanie)
2. Projekty, role, edytor BMC bez AI
3. Czat z agentem: `ask_clarification` i `propose_block_change` z akceptacją zmian
4. `evaluate_bmc` i wykres radarowy
5. `analyze_impact`
6. `generate_strategies`, `compare_variants`, zapis i widok wariantów
7. Załączniki i `read_attachment`
8. Współdzielenie projektów
9. Eksport PDF i DOCX
10. Dane przykładowe, testy, ewaluacja modeli

## 15. Otwarte kwestie

- Czy analiza wpływu ma zawierać parametry liczbowe?
- Gdzie przechowywać pliki załączników na produkcji?
- Gdzie hostować bazę Postgres na produkcji?
- Dokładne nazwy i ceny modeli do porównania oraz aktualne limity darmowego planu Gemini API (weryfikacja w dokumentacji dostawców przed testami).
- Budżet na kredyty API Anthropic i liczba serii testów porównawczych.
