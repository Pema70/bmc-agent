# BMC Agent

Aplikacja webowa z agentem AI do tworzenia, analizy i oceny modeli biznesowych (Business Model Canvas). Projekt w ramach pracy inżynierskiej.

- Specyfikacja: [`docs/spec.md`](docs/spec.md)
- Zasady pracy w repozytorium: [`CLAUDE.md`](CLAUDE.md)

## Stan projektu

Lista według [`docs/spec.md`](docs/spec.md) §14 (kolejność prac).

**Działa:**

- rejestracja i logowanie (Auth.js),
- projekty i edytor dziewięciu bloków BMC (bez AI),
- czat z agentem: agent dopytuje i **proponuje** zmiany wpisów, a użytkownik je akceptuje lub odrzuca (agent nie zmienia modelu sam),
- ocena modelu (spójność, ryzyko, realność, innowacyjność) z wykresem radarowym,
- analiza wpływu zmiany na pozostałe bloki,
- strategie (kandydaci na warianty), zapis wariantów i porównanie wariantów,
- poprawki promptu agenta z pomiarem przed i po (wyniki: [`docs/plan-pr-p.md`](docs/plan-pr-p.md)).

**Jeszcze nie ma:** załączników i cyklu poprawek (krok 7), eksportu PDF i DOCX oraz rozszerzonego raportu (krok 9), danych przykładowych w repozytorium i niezależnego agenta oceniającego (krok 10), wersji 2 z dziewięcioma agentami (krok 11). Skrypt `prisma/seed.ts` (dane przykładowe) jest tylko zapowiedziany w specyfikacji (§13) i **nie istnieje**.

Projekty są **jednoosobowe**: projekt należy do jednego konta i nie jest udostępniany innym (bez zaproszeń i współdzielenia, patrz [`docs/spec.md`](docs/spec.md) §8).

## Wymagania

- **Node.js 22 lub nowszy** (`engines` w `package.json`) i npm.
- **Docker** z poleceniem `docker compose` (lokalny PostgreSQL). Na Windows i macOS **Docker Desktop musi być uruchomiony przed** `docker compose`.
- **System:** projekt rozwijany na Windows 11. Na macOS i Linux nie był tu sprawdzany; komendy poniżej są zwykłymi komendami npm i Dockera.
- **Klucz API Google Gemini** (jedyny obsługiwany dostawca modelu, patrz niżej).

## Klonowanie repozytorium

```bash
git clone https://github.com/Pema70/bmc-agent.git
cd bmc-agent
```

Na Windows, gdy `git clone`, `pull` lub `push` kończy się błędem SSL, użyj `git -c http.sslBackend=schannel clone ...` (analogicznie `pull` i `push`).

## Konfiguracja `.env`

Plik `.env` nie trafia do repozytorium. Skopiuj wzór i uzupełnij:

```bash
cp .env.example .env
```

W PowerShellu: `Copy-Item .env.example .env`.

Klucz Gemini (`GOOGLE_GENERATIVE_AI_API_KEY`) utworzysz za darmo w [Google AI Studio](https://aistudio.google.com/apikey).

| Zmienna | Co robi | Wartość |
|---|---|---|
| `DATABASE_URL` | Połączenie z Postgresem z `docker-compose.yml` | z `.env.example` (`postgresql://bmc:bmc@localhost:5433/bmc_dev?schema=public`) |
| `AUTH_SECRET` | Sekret Auth.js (next-auth v4) | **wygeneruj sam:** `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `NEXTAUTH_URL` | Adres aplikacji | `http://localhost:3000` (lokalnie) |
| `LLM_PROVIDER` | Dostawca modelu | `google` (jedyny obsługiwany) |
| `LLM_MODEL` | Nazwa modelu | w `.env.example` `gemini-3.8-flash`; w pomiarach z PR „P” użyto `gemini-3.5-flash-lite`. Nazwy sprawdzaj w dokumentacji dostawcy (modele bywają wycofywane) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Klucz Gemini | **twój klucz** (nie wpisuj go do repozytorium) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Zarezerwowane na kolejne wersje | **dziś nieużywane**; zostaw puste |
| `MAX_STEPS` | Najwyżej tyle kroków (zapytań do API) w jednej turze czatu | `3` |
| `CHAT_MAX_REQUESTS_PER_HOUR` | Limit zapytań do agenta na użytkownika na godzinę | `30` |
| `CHAT_MAX_TOKENS_PER_DAY` | Limit tokenów na użytkownika na dobę | `200000` |
| `LLM_MAX_OUTPUT_TOKENS` | Limit tokenów odpowiedzi czatu | `2000` |
| `CHAT_MAX_MESSAGE_CHARS` | Najdłuższa wiadomość użytkownika (znaki) | `4000` |
| `CHAT_HISTORY_LIMIT` | Ile ostatnich wiadomości czatu wchodzi do rozmowy | `30` |
| `MAX_PENDING_PROPOSALS` | Ile propozycji agenta naraz może czekać na decyzję | `20` |
| `MAX_VARIANTS_PER_PROJECT` | Najwyżej tyle wariantów na projekt | `10` |
| `LLM_MAX_OUTPUT_TOKENS_LONG` | Limit tokenów dla operacji z dużym wynikiem (strategie, porównanie) | `12000` |
| `ATTACHMENT_MAX_BYTES` | Najwyższy rozmiar jednego załącznika (bajty) | `10485760` (10 MB) |
| `ATTACHMENT_MAX_PER_PROJECT` | Najwyżej tyle załączników na projekt | `10` |
| `ATTACHMENT_MAX_TEXT_CHARS` | Ile znaków wyekstrahowanego tekstu zapisujemy (dalej przycięcie) | `200000` |
| `READ_ATTACHMENT_MAX_CHARS` | Ile znaków tekstu zwraca jedno odczytanie załącznika przez agenta | `6000` |
| `ATTACHMENT_ZIP_MAX_UNCOMPRESSED_BYTES` | Łączny rozmiar plików w DOCX po rozpakowaniu (ochrona przed „bombą ZIP”) | `104857600` (100 MB) |
| `ATTACHMENT_ZIP_MAX_ENTRIES` | Najwyżej tyle plików w archiwum DOCX | `1000` |
| `ATTACHMENT_PDF_MAX_PAGES` | Ile stron PDF czytamy (dalej przycięcie) | `200` |
| `ATTACHMENT_EXTRACT_TIMEOUT_MS` | Limit czasu ekstrakcji tekstu (ms; ochrona częściowa) | `15000` |
| `ATTACHMENTS_DIR` | Katalog magazynu plików załączników (dev) | `.data/attachments` |

Pusta zmienna limitu (np. `MAX_STEPS=`) liczy się jak brak i działa wartość domyślna. Zakresy wartości: `src/lib/ai/config.ts`.

> **Ostrzeżenie: `ANTHROPIC_API_KEY` tylko w pliku `.env`, nigdy jako zmienna systemowa.** Zmienna systemowa mogłaby zostać użyta przez narzędzia deweloperskie zamiast subskrypcji i naliczyć opłaty za API (patrz `CLAUDE.md`). Klucze trzymaj wyłącznie w `.env`.

> **Dane przykładowe.** Na darmowym planie Google wykorzystuje treści do ulepszania produktów (komentarz w `.env.example`), więc wpisuj do aplikacji wyłącznie dane przykładowe, bez danych poufnych i osobowych.

## Baza danych w Dockerze

```bash
docker compose up -d db
```

Uruchamia Postgres 18 (`docker-compose.yml`, kontener `db`) na `127.0.0.1:5433` (port **5433**, żeby nie kolidować z lokalnym Postgresem na 5432; baza niedostępna z sieci lokalnej). Dane logowania dev: użytkownik `bmc`, hasło `bmc`, baza `bmc_dev`. Kontener ma healthcheck (`pg_isready`), więc przed następnym krokiem poczekaj, aż będzie „healthy”. Dane są w wolumenie `bmc_db_data`; usunięcie wolumenu kasuje bazę.

## Instalacja zależności

```bash
npm install
```

`npm install` uruchamia też `prisma generate` (skrypt `postinstall`); wygenerowany klient trafia do `src/generated/prisma` (katalog jest w `.gitignore`).

## Migracje

Na świeżej bazie zastosuj istniejące migracje z `prisma/migrations`:

```bash
npx --no-install prisma migrate deploy
```

Dlaczego `migrate deploy`, a nie `migrate dev`: `deploy` tylko wykonuje zapisane migracje (w tym ręcznie dopisany indeks częściowy `BmcVariant_projectId_main_key`), bez bazy cieniowej, bez porównywania schematu z bazą i bez pytań o reset ani tworzenia nowych migracji. `migrate dev` jest dla osoby, która **zmienia** `prisma/schema.prisma`: `npx --no-install prisma migrate dev`, a potem `npx --no-install prisma generate` (Prisma 7 nie generuje klienta po `migrate dev`).

`prisma.config.ts` czyta `DATABASE_URL` z pliku `.env`. Seeda nie ma (patrz „Stan projektu”).

## Uruchomienie

**Tryb deweloperski:**

```bash
npm run dev
```

Aplikacja: http://localhost:3000.

**Tryb produkcyjny (lokalnie):**

```bash
npm run build
npm run start
```

Wymaga tej samej bazy, zastosowanych migracji i uzupełnionego `.env` (przy innym adresie ustaw `NEXTAUTH_URL`). Konfiguracja hostingu (np. Dockerfile) nie jest częścią repozytorium.

## Testy i kontrola jakości

```bash
npm test             # testy jednostkowe (Vitest), jednorazowo
npm run test:watch   # testy w trybie obserwowania
npm run lint         # ESLint
npm run typecheck    # next typegen + tsc --noEmit
```

Testy nie wymagają bazy ani klucza API: działają na mockach i nie wywołują prawdziwego modelu (zasada z `CLAUDE.md`). Przed otwarciem PR muszą przechodzić `lint`, `typecheck`, `test` i `build`.

## Pierwsze kroki w aplikacji

1. Otwórz http://localhost:3000 i wybierz **„Załóż konto”** (`/rejestracja`): e-mail, hasło (8 do 72 bajtów; polskie litery liczą się podwójnie) i opcjonalnie imię. Po rejestracji aplikacja próbuje zalogować; gdy się nie uda, zaloguj się ręcznie (`/logowanie`).
2. Na liście projektów (`/projekty`) w sekcji **„Nowy projekt”** podaj nazwę i opis i kliknij **„Utwórz projekt”**. Projekt jest jednoosobowy: należy do Twojego konta, bez udostępniania.
3. Na stronie projektu wypełnij bloki BMC ręcznie albo rozmawiaj z agentem w czacie (**„Wyślij”**). Agent dopytuje i proponuje zmiany; na karcie propozycji wybierz **„Zaakceptuj”** lub **„Odrzuć”**. Model zmienia się dopiero po akceptacji.
4. **„Oceń model”** uruchamia ocenę z wykresem radarowym (wymaga co najmniej 5 wpisów w co najmniej 3 blokach). **„Analizuj wpływ”** (na karcie propozycji lub w panelu) ocenia wpływ zmiany na pozostałe bloki (co najmniej 3 wpisy w 2 blokach).
5. Panel **„Strategie”** generuje kandydatów na warianty; kandydata zapisujesz przyciskiem **„Zapisz jako wariant”**. Warianty możesz kopiować (**„Utwórz kopię”**) i porównywać (**„Porównaj”**, **„Porównaj z AI”**). Progi zawartości modelu: `src/lib/ai/config.ts`.

Odpowiedzi agenta i analizy to wsparcie generowane przez model, nie weryfikacja biznesowa.

## Typowe problemy

- **`docker compose` nie łączy się z Dockerem.** Uruchom Docker Desktop i spróbuj ponownie.
- **Port 5433 zajęty.** Zmień lewą stronę mapowania portu w `docker-compose.yml` (`"127.0.0.1:5433:5432"`) i ten sam port w `DATABASE_URL`. Port 5432 jest pominięty celowo (kolizja z lokalnym Postgresem).
- **`[env] Nie znaleziono pliku .env`.** Skopiuj `.env.example` do `.env` (polecenia wymagające bazy nie zadziałają bez `DATABASE_URL`).
- **`Brak klucza API: ustaw GOOGLE_GENERATIVE_AI_API_KEY w pliku .env`.** Uzupełnij klucz i zrestartuj `npm run dev`.
- **`Dostawca „openai”/„anthropic” nie jest jeszcze obsługiwany`.** Ustaw `LLM_PROVIDER="google"`; dziś działa tylko Gemini.
- **Końce linii na Windows.** Git zamienia LF na CRLF, więc np. `prisma/migrations/migration_lock.toml` pokazuje się jako zmieniony mimo pustego `git diff`. To znany objaw (plik `.gitattributes` jeszcze nie istnieje, patrz [`docs/zadania.md`](docs/zadania.md)); nie commituj tej zmiany. Nie edytuj też zastosowanych migracji.
- **`http.sslBackend=schannel` (Windows).** Domyślny backend SSL Gita może kończyć się błędem; używaj `git -c http.sslBackend=schannel pull` (i `push`).
- **Limity aplikacji.** Komunikaty „Osiągnięto limit … zapytań do agenta na godzinę” i „Wykorzystano dzienny limit tokenów agenta” oznaczają limity z `.env` (domyślnie 30 zapytań na godzinę i 200000 tokenów na dobę). Poczekaj albo zwiększ `CHAT_MAX_REQUESTS_PER_HOUR` i `CHAT_MAX_TOKENS_PER_DAY` i zrestartuj aplikację. Jedna tura czatu to do `MAX_STEPS` zapytań do API, a tura z oceną zużywa więcej niż zwykła.
- **Limity i błędy dostawcy (Gemini).** „Przekroczono limit zapytań modelu (darmowy plan)” to odpowiedź 429 dostawcy, a „Model jest chwilowo niedostępny (przeciążenie dostawcy)” to zwykle 503; w obu przypadkach spróbuj ponownie za chwilę. Darmowy plan ma niskie limity, a 503 zdarzały się w pomiarach także przy modelu `gemini-3.1-flash-lite`. Każde wywołanie modelu jest logowane w tabeli `LlmCallLog` (status, tokeny, czas, koszt).
- **Odpowiedź trwa długo.** Czasy odpowiedzi są niestabilne (w pomiarach od kilku do ponad 90 sekund); poczekaj na koniec odpowiedzi, a nie odświeżaj strony w trakcie.

## Struktura projektu

```
src/app/             # strony i route handlers (App Router): /rejestracja, /logowanie, /projekty
src/app/api/chat/    # streaming czatu z agentem
src/app/api/auth/    # Auth.js
src/components/      # komponenty React (auth, bmc, chat, evaluation, impact, strategies, comparison, variants)
src/lib/ai/          # konfiguracja modelu, limity, prompty, narzędzia agenta
src/lib/schemas/     # schematy Zod (źródło prawdy dla typów)
src/lib/auth/        # sesja, uprawnienia, rejestracja
src/lib/db/          # klient Prisma i zapytania
src/lib/             # także: bmc, evaluation, impact, strategies, comparison, variants, env
src/generated/       # wygenerowany klient Prisma (w .gitignore)
prisma/              # schema.prisma, migracje
docs/                # specyfikacja, plany kroków, zadania, pomiary
```

## Dokumentacja

- [`docs/spec.md`](docs/spec.md): specyfikacja (cel, decyzje projektowe, model danych, agent AI, kolejność prac, otwarte kwestie).
- [`docs/zadania.md`](docs/zadania.md): otwarte zadania i znane ograniczenia.
- [`docs/plan-krok-2.md`](docs/plan-krok-2.md) do [`docs/plan-krok-6.md`](docs/plan-krok-6.md): zamknięte plany kroków (zapis historii).
- [`docs/plan-pr-p.md`](docs/plan-pr-p.md): pomiar przed i po zmianie promptu agenta (wyniki, metryki, zastrzeżenia).
- [`CLAUDE.md`](CLAUDE.md): zasady pracy w repozytorium (workflow, konwencje, zasady dla części AI).
