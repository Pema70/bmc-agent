# Plan zmian wyglądu aplikacji (przed krokiem 10)

> Sekcja „Zmiany po akceptacji” na końcu pliku ma pierwszeństwo przed treścią powyżej (puste do czasu akceptacji).

**Do akceptacji (2026-11-25).** Plik zostaje nieśledzony (bez commitu) do czasu Twojej akceptacji; pierwszy commit `docs:` z tym planem trafia do PR D1. Zasada jak w planach kroków 3 do 9: **żadnych zmian w kodzie, schemacie ani zależnościach przed akceptacją tego planu.**

## Kontekst i twarde ograniczenia

Cel: nowy wygląd aplikacji (kolory 60/30/10 na gradientach, płótno BMC na całą szerokość, czat poza płótnem, funkcje jako osobne przyciski z panelami). Reguły z `CLAUDE.md` i `docs/zadania.md` („Zmiany wyglądu aplikacji (przed krokiem 10)”) mają pierwszeństwo przed każdą radą skilla.

1. **Bez zmian w AI:** żadnych zmian w `src/lib/ai/` (prompty, opisy narzędzi, modele), w schematach Zod wyników AI (`src/lib/schemas/`, poza typami czysto interfejsowymi, których plan nie przewiduje) i w logice wywołań modelu (liczba, kolejność, dane wchodzące do promptów). Wersje promptów `chat-v6`, `evaluate-v1`, `questions-v1`, `refine-v1`, `impact-v1`, `compare-v1`, `strategies-v1` zostają. Zmiana wyglądu, która tego wymaga, jest osobnym PR-em z własnym pomiarem (nie w tym planie). Oznaczenia AI (`AiBadge`, `AiNotice`, etykiety „AI”) zostają z tym samym tekstem; zmienia się tylko ich kolor i kształt.
2. **Bez przemontowania:** przełączanie paneli, czatu i motywu nie może przemontować płótna ani czatu. `Workspace` zachowuje `key={variant.id}` (jak dziś, zależny wyłącznie od wariantu), żadnego `key` zależnego od panelu, listy ani adresu. Blokady przy niezapisanych zmianach (`DIRTY_MESSAGE`, `dirty`) działają jak dotąd.
3. **Bez nowych zależności** (najpierw sam Tailwind 4, który jest w projekcie). Nic nowego nie jest instalowane bez Twojej zgody i zwykłych reguł (wiek >14 dni, przypięcie, bez skryptów instalacyjnych). Plan nie przewiduje żadnej nowej zależności.
4. **Treści od modelu i od użytkownika wyłącznie jako zwykły tekst** (węzły tekstowe React, bez HTML i Markdown, bez `dangerouslySetInnerHTML`). Dotyczy też nowych plakietek, tooltipów i nagłówków paneli.
5. **Język i tryby:** interfejs po polsku; tryb ciemny i wąski ekran w każdym PR-ze. Tekst wpisów, czatu i tabel zawsze na **jednolitym tle** o kontraście co najmniej WCAG AA (4,5:1 dla zwykłego tekstu, 3:1 dla dużego i dla elementów interfejsu).
6. Każdy PR zatrzymuje się po otwarciu z listą rzeczy do sprawdzenia w przeglądarce. `npm run build`, `migrate`, `generate` i kroki w przeglądarce uruchamiasz Ty; ja `lint`, `typecheck`, `test`. Niczego nie usuwam bez Twojej zgody (stare klasy kolorów zamieniam w plikach, nie usuwam plików).

## Rola skilla `ui-ux-pro-max` (co sprawdziłem)

Przeczytałem `SKILL.md` głównego skilla (`ui-ux-pro-max`) i jego skrypty (`scripts/search.py`, `core.py`, `design_system.py`, `preview.py`), nie uruchamiając niczego poza dwoma zapytaniami wyszukiwania (odczyt lokalnych plików CSV, wynik tylko na ekran, nic nie zapisane):
- **Co robi:** wyszukuje w lokalnych bazach CSV (style, palety, zestawy czcionek, wytyczne UX, wykresy, stosy) i składa rekomendację systemu projektowego. Wynik to tekst do syntezy, nie zmiany w kodzie.
- **Jakie skrypty:** Python 3 bez zależności zewnętrznych (`search.py`). Brak połączeń sieciowych w tych skryptach i brak odczytu `.env` (sprawdzone przeszukaniem po `urllib`, `requests`, `socket`, `subprocess`, `API_KEY`). Wtyczka nie rejestruje hooków (`/reload-plugins`: 0 hooków).
- **Co zapisuje:** domyślnie nic. Zapis do katalogu projektu dzieje się tylko z flagami `--persist` (katalog `design-system/`) i `--preview` (plik `preview.html`); **nie będę ich używać** w repozytorium (w razie potrzeby tylko z `--output-dir` w katalogu tymczasowym sesji). Inne skille wtyczki (`design`, `brand`, `slides`, `banner-design`) mają skrypty generujące obrazy przez zewnętrzne API (Gemini i inne, klucze z zmiennych środowiskowych); **ich nie używam**. Reguły „Before Delivering App UI” skilla dotyczą aplikacji natywnych, więc nie wpływają na ten plan.
- **Co wzięłem ze skilla:** priorytety (dostępność, dotyk i interakcja, układ responsywny, typografia i kolor, nawigacja), wytyczne kontrastu i focusa, przykładowe palety dla „Analytics Dashboard” (granat i bursztyn) i „Productivity” (morski i pomarańcz). Konkretne wartości palet policzyłem sam i **zmierzyłem kontrasty skryptem** (tabele niżej), nie z opisu bazy.

## Stan obecny (sprawdzone w kodzie)

- Tailwind CSS 4 (`@import "tailwindcss"`, `@theme inline`), bez pliku konfiguracyjnego; `globals.css` ma tylko dwa tokeny (`--background`, `--foreground`) i tryb ciemny z `prefers-color-scheme`. Font: Geist i Geist Mono z `next/font/google` (Geist Mono nie jest nigdzie używany w klasach); `body` ma w CSS `Arial`, co nadpisuje Geista.
- Kolory są wpisane na stałe w klasach: ok. 37 plików `.tsx` z klasami, ok. 430 użyć `zinc-*`, 84 `red-*`, 51 `amber-*`, 16 `green-*`, po kilka `blue-*`, `indigo-*`, `sky-*`; 202 wystąpienia `dark:`.
- Strona projektu (`src/app/projekty/[id]/page.tsx`, 294 wiersze, komponent serwerowy) układa pionowo: nagłówek projektu, sekcję „Warianty i strategie” (przełącznik, akcje, wybór porównania, strategie), siatkę `płótno | czat 24 rem` (od `xl`), potem panele: Eksport, Ocena, Cykl poprawek (EDITOR), Analiza wpływu, a poza `Workspace` Załączniki i Edycja projektu. Kontener ma `max-w-[96rem]`.
- Płótno: `CANVAS_GRID` (siatka 10 × 3 od `lg`, jeden pod drugim poniżej), `BLOCK_PLACEMENT`, edytor (`canvas-editor.tsx`, 399 wierszy) i widok tylko do odczytu (`bmc-canvas.tsx`).
- `Workspace` (`VariantWorkspaceProvider`) jest `key={variant.id}`; `ImpactProvider` bez klucza zależnego od listy (świadomie: remount zgubiłby niezapisane zmiany i rozmowę). Panele oceny i strategii są kontrolowane propsami z serwera; `EvaluationPanel` ma `key` zależny od najnowszej oceny (remontuje się tylko ten panel, bez płótna i czatu).
- Brak biblioteki do testów komponentów (`jsdom`, `@testing-library`; środowisko Vitest to `node`). Testy komponentów to dziś `renderToStaticMarkup` i testy czystych funkcji.

## Kolory: 60/30/10 i gradienty

**Znaczenie proporcji:** 60% to kolor dominujący (tła strony i powierzchnie kontenerów), 30% to kolor drugorzędny (karty, panele, nagłówki bloków i paneli, pasek narzędzi), 10% to akcent (przyciski główne, aktywny przycisk paska, wyróżnienia, focus).

**Gradienty tylko tam, gdzie nie ma długiego tekstu:** tło strony (bardzo łagodny, dwa bliskie odcienie), nagłówki bloków płótna i paneli (tekst nagłówka biały lub ciemny, kontrast sprawdzony **na obu końcach** gradientu), przyciski główne (jak nagłówki). **Wpisy, wiadomości czatu, tabele, pola formularzy i uzasadnienia leżą zawsze na jednolitej powierzchni** (`--surface` lub `--tint`). Gradienty są statyczne (bez animacji), więc `prefers-reduced-motion` ich nie dotyczy; przejścia stanów (hover, panel) krótkie i wyłączane przy reduced motion.

**Tokeny semantyczne (w `globals.css`, `@theme inline`):** `--bg-from/to`, `--surface`, `--tint`, `--text`, `--muted`, `--border`, `--head-from/to`, `--on-head`, `--accent-from/to`, `--on-accent`, `--ring`, `--danger`, plus stany (niżej). Komponenty używają tylko tokenów (klasy `bg-surface`, `text-muted`…), więc **zamiana palety to zmiana jednego bloku zmiennych**, a nie przepisanie klas.

**Trzy palety** (wartości jasne; wszystkie pary tekstowe ≥ 4,5:1, zmierzone skryptem; w nawiasie najniższe wartości z pomiaru):

| | A. Błękit i bursztyn (rekomendacja) | B. Morski i koral | C. Indygo i limonka |
|---|---|---|---|
| 60% tło (gradient) | `#F3F6FC` → `#E6EDF9` | `#F1FAF8` → `#E1F3EF` | `#F6F5FF` → `#ECEAFE` |
| powierzchnia | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| 30% tint (karty, panele) | `#E8EEFA` | `#E3F3F0` | `#EEECFD` |
| nagłówki (gradient) | `#1E3A8A` → `#2B55C4` | `#0F5F5A` → `#0F766E` | `#3730A3` → `#4F46E5` |
| 10% akcent (gradient) | `#B45309` → `#92400E` | `#C2410C` → `#9A3412` | `#4D7C0F` → `#3F6212` |
| tekst / przytłumiony | `#0F1B3D` / `#4A5878` | `#0B2B2A` / `#42605E` | `#17143A` / `#524F7A` |
| obramowanie | `#C9D5EC` | `#BFDDD8` | `#D3D0F3` |
| kontrast tekst na powierzchni (min.) | 16,9 (przytłumiony 7,1) | 15,1 (6,8) | 17,5 (7,6) |
| kontrast tekst na tint (min.) | 14,5 (6,1) | 13,2 (6,0) | 15,1 (6,5) |
| biały na nagłówku (oba końce) | 10,4 / 6,6 | 7,5 / 5,5 | 9,9 / 6,3 |
| biały na akcencie (oba końce) | 5,0 / 7,1 | 5,2 / 7,3 | 5,0 / 7,1 |

**Wersje ciemne** (osobne wartości, nie odwrócenie): A: tło `#0B1226` → `#111B38`, powierzchnia `#16213F`, tint `#1C2A52`, tekst `#E8EDFA`, przytłumiony `#A7B3D1`, akcent `#FBBF24` → `#F59E0B` z ciemnym tekstem `#1A1203` (11,1 / 8,6); B: `#07191A` → `#0C2627`, powierzchnia `#10302F`, akcent `#FB923C` → `#F97316` z `#1C0A02`; C: `#0E0C24` → `#161336`, powierzchnia `#1B1842`, akcent `#A3E635` → `#84CC16` z `#0F1A02`. W ciemnym trybie nagłówki zostają gradientem granatowym, morskim i indygo z białym tekstem (6,6, 4,8 i 6,3 na jaśniejszym końcu). Kontrast tekstu na powierzchni i tint w ciemnych wersjach: 10,9 do 14,5 (przytłumiony ≥ 6,3).

**Uzasadnienie rekomendacji A:** profesjonalna, neutralna dla pracy dyplomowej (analiza biznesowa), najwyższe zapasy kontrastu, a bursztyn jako akcent jest wyraźnie odrębny od kolorów stanów po przeniesieniu oznaczenia AI na fiolet. B ma ciepły, mniej „bankowy” charakter, ale pomarańcz akcentu jest bliski czerwieni wpływu „wysoki”. C jest najbardziej wyrazista, ale limonka jako akcent koliduje z zielenią stanu „niski wpływ” i jest mniej typowa dla narzędzi analitycznych.

**Kolory stanów (zawsze z etykietą tekstową, nie tylko kolorem):** każdy stan to token trójki `bg / fg / border` (jasny i ciemny) o kontraście tekstu ≥ 4,5:1 na własnym tle, plus kształt (chip z ramką i, gdzie to ma sens, ikona SVG z `aria-hidden`):

| Stan | Etykieta (bez zmian) | Barwa proponowana |
|---|---|---|
| Propozycja AI, wynik AI | „AI” i dotychczasowe napisy (`AiBadge`, „Propozycja agenta”) | fiolet (przeniesienie z bursztynu, żeby akcent A nie mylił się z AI) |
| Wpływ niski / średni / wysoki | „Wpływ niski/średni/wysoki” | zieleń / bursztyn / czerwień |
| „Główny” | „Główny” | granat (barwa nagłówka palety) |
| „Strategia AI” | „Strategia AI” | fiolet jak AI |
| Błąd, ostrzeżenie, notatka | dotychczasowe teksty | czerwień / bursztyn / neutralny |

Wartości stanów ustalam w PR D1 i **sprawdza je test** (niżej), nie na oko.

## Typografia i rozmiary

- **Rekomendacja: Noto Sans** (ta sama rodzina co w PDF, dla spójności ekran i dokument, pełne pokrycie polskich liter). Opcje: (a) `next/font/google` `Noto_Sans` (zmienna, podzbiory `latin` i `latin-ext`, woff2, ten sam mechanizm co dziś Geist, bez nowej zależności; pobranie przy buildzie, jak teraz); (b) `next/font/local` z plików TTF z repozytorium (`src/lib/export/fonts/`, wersja 2.015 identyczna jak w PDF, bez sieci, ale tylko wagi 400 i 700 oraz cięższe pliki). **Rekomenduję (a)** dla wag 400/500/600/700 i rozmiaru; różnica względem PDF to ten sam krój, inna dystrybucja. `body` dostaje `font-family: var(--font-sans)` (dziś nadpisuje je `Arial`). Geist Mono nie jest używany: usuwam jego import z `layout.tsx` (usunięcie importu, nie plików), o ile w PR D1 `grep` potwierdzi brak użyć.
- **Skala:** treść 16 px (`text-base`) w panelach i czacie, **wpisy w blokach 15 px** (`text-[0.9375rem]`, interlinia 1,5), etykiety i metadane nie mniej niż 13 px (`text-[0.8125rem]`), nagłówki bloków 14 px pogrubione, nagłówki paneli 18 do 20 px. Minimum czytelności: nic z treścią poniżej 13 px; zmniejszanie tekstu **nie jest** sposobem na zmieszczenie wpisów.

## Płótno BMC na całą szerokość

- Kontener strony bez `max-w-[96rem]` dla płótna (pełna szerokość z marginesem `px-4` do `lg:px-6`); teksty panelu mogą mieć ograniczoną szerokość czytania wewnątrz paneli. Klasyczny układ dziewięciu bloków zostaje (`BLOCK_PLACEMENT`, siatka 10 × 3).
- **Zapytania o kontener zamiast o okno:** siatka klasyczna włącza się od szerokości **samego płótna** (`@container` i `@5xl:` w Tailwind 4, bez dodatkowych pakietów), nie od okna. Dzięki temu przy otwartym czacie (płótno węższe) układ nie ściska kolumn do nieczytelności: poniżej progu bloki układają się jeden pod drugim lub w dwóch kolumnach. Na wąskim ekranie zawsze jeden pod drugim.
- **Wiele wpisów w bloku: przewijanie wewnątrz bloku** (`max-h` ok. 18 rem na szerokim układzie, `overflow-y-auto`, widoczny pasek, tekst „Przewiń: jeszcze N wpisów” dla czytników i dla oka, `tabindex="0"` na obszarze przewijania z `aria-label`), bez zmniejszania czcionki. Na wąskim ekranie bez `max-h` (blok rośnie). Alternatywa „zwijanie z »pokaż więcej«” jest opisana w D8; rekomenduję przewijanie, bo w edytorze (pola do edycji) zwijanie ukrywałoby pola i propozycje.
- Edytor (`canvas-editor.tsx`) i widok do odczytu (`bmc-canvas.tsx`) zmieniają tylko klasy i strukturę opakowania; logika zapisu, wersji, `dirty`, propozycji i analizy wpływu bez zmian. Wyróżnienia propozycji AI i wpływu w blokach zostają jako etykieta tekstowa plus kolor stanu.

## Czat poza płótnem

| | **(a) Wysuwany panel z boku (rekomendacja)** | (b) Sekcja nad lub pod płótnem |
|---|---|---|
| Widoczność zmian | czat i płótno widać razem: propozycje i zaakceptowane zmiany są na płótnie w trakcie rozmowy | płótno i czat konkurują o pionowe miejsce; użytkownik przewija między nimi |
| Szerokość płótna | zamknięty: pełna szerokość; otwarty: płótno dostaje prawy margines o szerokości panelu (nie jest zasłaniane) na szerokich ekranach | zawsze pełna szerokość |
| Wąski ekran | panel jako nakładka (arkusz) z przyciskiem zamknięcia i Esc | czat pod płótnem, bardzo długa strona |
| Koszt | średni (kontener `aside`, stan otwarcia, przyciski, focus) | niski |
| Ryzyko | ukrycie czatu musi go nie odmontować (czat zawsze zamontowany, ukrywany stylem i `inert`) | brak |

**Rekomendacja: (a) jako panel „zadokowany”:** przycisk „Czat z agentem” w pasku narzędzi i pływający przycisk na wąskim ekranie; od szerokości `xl` panel ma 24 do 26 rem i **odsuwa** płótno (padding kontenera), więc nic nie jest zasłonięte; poniżej `xl` jest nakładką (nie modalną, bez pułapki fokusu, z Esc i przyciskiem „Zamknij”). Domyślnie: otwarty na `xl` i szerzej, zamknięty poniżej (D6). Plakietka na przycisku: liczba oczekujących propozycji (z `useVariantWorkspace`, już istnieje) i „agent pisze…” nie jest wymagane. **Czat zawsze zamontowany** (nie `{open && <AgentChat/>}`), `key={variant.id}` jak dotąd; zamknięty panel ma `hidden`/`inert`, więc strumień odpowiedzi i rozmowa przeżywają zamknięcie i otwarcie. Czat dalej tylko na wariancie głównym (komunikat dla innych wariantów zostaje w tym samym miejscu). Karty czatu (propozycja, ocena, wpływ) dostają nowe tokeny, bez zmiany treści i zachowania.

## Pasek narzędzi i panele

**Przyciski (pasek nad płótnem, jedna linia, zawijana na wąskim ekranie; poziomy scroll nie jest używany):** Czat · Ocena · Wpływ · Warianty i strategie · Porównanie · Cykl poprawek (tylko EDITOR+) · Załączniki · Eksport i raport. Obok paska zawsze widoczny **wybór wariantu** (nazwa bieżącego wariantu, znaczniki „Główny” / „Strategia AI”), bo to kontekst całej strony (D5).

- **Miejsce paneli:** jeden otwarty panel **pod płótnem**, na pełną szerokość, z nagłówkiem (gradient), przyciskiem „Zamknij” i `scrollIntoView({block:"nearest"})` po otwarciu z paska (nie po wczytaniu z adresu). Wysuwany panel zostaje zarezerwowany dla czatu (dwa panele z boku by się gryzły). Alternatywa „panele wysuwane z boku” opisana w D4.
- **Wszystkie panele zamontowane, nieaktywne ukryte** (`hidden`), nie odmontowywane: trwa trwająca akcja (np. generowanie strategii, ocena), przeżywają szkice odpowiedzi w cyklu poprawek, formularze i wyniki. Nieaktywne panele nie są dostępne dla czytników (`hidden`). Koszt: większy DOM; panele i tak są dziś wszystkie na stronie, więc różnicy w danych nie ma.
- **Adres:** `?panel=ocena|wplyw|warianty|porownanie|poprawki|zalaczniki|eksport` oraz `?czat=0|1` (D6). Odczyt po stronie serwera z `searchParams` (allowlista, Zod `enum`; nieznana lub niedozwolona dla roli wartość jest ignorowana, bez błędu) daje poprawny pierwszy render i przeżywa odświeżenie. Zmiana panelu to `window.history.replaceState` (Next 16 synchronizuje ją z `useSearchParams`), czyli **bez żądania do serwera, bez `router.push` i bez remountu**; `replaceState` zamiast `pushState`, żeby przycisk „wstecz” nie przechodził po każdym panelu (D3).
- **Plakietki na przyciskach (tekst, nie tylko kolor; `aria-label` z pełnym opisem):**

| Przycisk | Plakietka | Źródło danych |
|---|---|---|
| Czat | liczba oczekujących propozycji | `proposals` z `useVariantWorkspace` |
| Ocena | „nieaktualna” (gdy najnowsza ocena dotyczy starszej wersji niż bieżąca), „brak oceny” | najnowsza ocena z propsów i `version` z kontekstu (aktualizuje się po zapisie bez odświeżenia) |
| Wpływ | „aktywna analiza” (gdy wyróżnienie w płótnie jest włączone) | `ImpactProvider` |
| Warianty i strategie | liczba wariantów | `variantSummaries` |
| Cykl poprawek | „runda N z 3”, „czeka na odpowiedzi” | `refinementRounds` |
| Załączniki | liczba z limitem (np. „3/10”) | `attachments` |
| Eksport i raport | „niezapisane zmiany” (eksport dotyczy zapisanego stanu) | `dirty` z kontekstu |

- **Klawiatura i dostępność:** pasek ma `role="toolbar"` z `aria-label`, **roving tabindex** (strzałki w lewo i w prawo, Home, End; Tab opuszcza pasek), każdy przycisk to `<button>` z `aria-expanded` i `aria-controls` panelu, Enter i Spacja przełączają; Esc w otwartym panelu zamyka go i oddaje fokus przyciskowi; po otwarciu z paska fokus trafia na nagłówek panelu (`tabindex="-1"`). Widoczny pierścień focusa (token `--ring`, kontrast ≥ 3:1), cele dotykowe ≥ 44 px wysokości na wąskim ekranie, `cursor-pointer`, stan `disabled` z powodem tekstowym (np. „Najpierw zapisz albo cofnij swoje zmiany” zostaje tam, gdzie jest dziś).
- **Mapowanie na istniejące komponenty (logika bez zmian):** Ocena = `EvaluationPanel`; Wpływ = `ImpactPanel`; Warianty i strategie = `VariantSwitcher`, `VariantActions`, `StrategiesPanel`; Porównanie = `ComparePicker` (dalej prowadzi na stronę porównania); Cykl poprawek = `RefinementPanel`; Załączniki = `AttachmentsPanel` (przeniesiony w drzewie do hosta paneli; nie zależy od `Workspace`); Eksport i raport = `ExportPanel`. Panele serwerowe są przekazywane jako gotowe elementy do klienckiego hosta paneli (`children`/propsy typu `ReactNode`), więc ich pobieranie danych w `page.tsx` się nie zmienia.

## Pozostałe strony

Lista projektów, logowanie, rejestracja, nagłówek serwisu, strona porównania (`porownanie`), formularze (`project-form`, `form-field`, logowanie i rejestracja), strona startowa i komunikaty błędów dostają tokeny, typografię i komponenty z PR D1 (PR D4). Bez zmian w akcjach i walidacji.

## Podział na PR-y

Każdy PR zatrzymuje się po otwarciu z listą do sprawdzenia w przeglądarce (jasny i ciemny tryb, wąski i szeroki ekran, klawiatura). Każdy PR w opisie ma sekcję **„Co nie zmienia się”** z wynikiem `git diff --stat main -- src/lib/ai src/lib/schemas src/app/api/chat` (oczekiwane: puste) i zdaniem, że wersje promptów są bez zmian.

1. **D1: kolory, typografia, komponenty bazowe + statyczny podgląd palet.** `globals.css` (tokeny jasne i ciemne dla **rekomendowanej** palety, gradienty, focus), `layout.tsx` (Noto Sans, `body` używa `--font-sans`), komponenty bazowe w `src/components/ui/` (przycisk główny i drugorzędny, karta, nagłówek panelu z gradientem, chip stanu z etykietą, plakietka, pierścień focusa) wyłącznie na tokenach; test kontrastu tokenów; **statyczny podgląd** `docs/design-preview/{a,b,c}.html` (samowystarczalne pliki HTML z wbudowanym CSS, bez zewnętrznych zasobów i skryptów poza przełącznikiem jasny/ciemny): strona projektu z danymi przykładowymi (płótno 9 bloków z kilkoma wpisami, pasek przycisków z plakietkami, panel oceny, czat, przykładowe chipy stanów) w trzech paletach, każda w jasnym i ciemnym trybie. Strony aplikacji w D1 zmieniają wygląd tylko tyle, ile wynika z nowych tokenów globalnych (tło, font, kolor tekstu); migracja klas kolorów komponentów następuje w D2 do D4. **Stop: wybierasz paletę przed D2** (zamiana palety w aplikacji to jeden blok zmiennych).
2. **D2: układ strony projektu.** Płótno na całą szerokość (`@container`, przewijanie w blokach, 15 px), pasek narzędzi z plakietkami, host paneli (wszystkie zamontowane, `hidden`), `?panel=` (odczyt serwerowy, zapis `replaceState`), klawiatura, wybór wariantu przy pasku; migracja klas kolorów komponentów płótna, paneli, wariantów, strategii, oceny, wpływu, poprawek, załączników i eksportu. Czat w D2 jest tymczasowo sekcją pod płótnem (opcja b), bez zmian wewnątrz `AgentChat`. Testy: czyste funkcje (parsowanie `panel`, plakietki, nawigacja strzałkami), test statyczny, że `Workspace` ma `key` zależny tylko od wariantu (jak niżej), render plakietek.
3. **D3: czat.** Panel boczny (zadokowany od `xl`, nakładka poniżej), przycisk w pasku, `?czat=`, plakietka propozycji, Esc i zamknięcie, czat zawsze zamontowany; nowy wygląd wiadomości i kart (propozycja, ocena, wpływ). Zero zmian w `agent-chat.tsx` poza klasami i opakowaniem (logika `useChat`, wysyłanie, strumień, `DIRTY_MESSAGE`).
4. **D4: pozostałe strony.** Lista projektów, logowanie, rejestracja, strona startowa, nagłówek serwisu, strona porównania, formularze; przegląd końcowy dostępności (kontrast, focus, kolejność Tab, etykiety) i **kontrola braku surowych klas kolorów** (`grep` po `zinc-|red-|amber-|green-|blue-|sky-|indigo-` w `src/components` i `src/app`, wyjątki wymienione i uzasadnione). Opcjonalnie przełącznik jasny/ciemny (D7).
5. **D5 (docs, opcjonalnie): „Stan po zmianach wyglądu”** w tym pliku: PR-y, liczba testów, wyniki kroków w przeglądarce, odstępstwa, otwarte pozycje; status wpisu „Zmiany wyglądu aplikacji” w `docs/zadania.md`.

## Decyzje do podjęcia

| | Pytanie | Rekomendacja (alternatywy) |
|---|---|---|
| D1 | Paleta | **A (błękit i bursztyn).** (B morski i koral; C indygo i limonka; wybór po podglądzie z D1.) |
| D2 | Czcionka | **Noto Sans przez `next/font/google` (zmienna, `latin` + `latin-ext`).** (Pliki TTF z repozytorium przez `next/font/local`: bez sieci, ale tylko wagi 400 i 700; Geist bez zmian.) |
| D3 | Zapis panelu w adresie | **`replaceState`, `?panel=`.** (`pushState`: „wstecz” przechodzi po panelach; `router.replace`: żądanie do serwera przy każdym kliknięciu, odradzam.) |
| D4 | Miejsce paneli | **Jeden otwarty panel pod płótnem, pozostałe zamontowane i ukryte.** (Panele wysuwane z boku, gdy czat też jest z boku: dwa panele konkurują; odmontowywanie nieaktywnych: gubi trwające akcje i szkice.) |
| D5 | Wybór wariantu | **Zawsze widoczny przy pasku narzędzi** (nazwa, „Główny”/„Strategia AI”), a akcje i strategie w panelu „Warianty i strategie”. (Wszystko w panelu: wybór wariantu schowany za kliknięciem.) |
| D6 | Czat | **Zadokowany panel boczny od `xl`, nakładka poniżej; domyślnie otwarty od `xl`, zamknięty niżej; `?czat=0|1`.** (Sekcja nad lub pod płótnem; domyślnie zawsze zamknięty.) |
| D7 | Przełącznik jasny/ciemny | **Tylko ustawienie systemowe (jak dziś), bez przełącznika.** (Przełącznik z `localStorage` w `try/catch` i skryptem przeciw migotaniu: dodatkowy kod i zapis po stronie przeglądarki; do D4, jeśli chcesz.) |
| D8 | Wiele wpisów w bloku | **Przewijanie wewnątrz bloku z informacją „jeszcze N wpisów”.** (Zwijanie z „Pokaż więcej”; oba razem.) |
| D9 | Siatka płótna | **`@container` (próg od szerokości płótna).** (Dotychczasowe progi okna `lg:`: przy otwartym czacie ściska kolumny.) |
| D10 | Kontrola braku zmian w AI | **Sekcja „Co nie zmienia się” z `git diff --stat` w każdym PR-ze.** (Dodatkowo test przypinający sumy SHA-256 plików promptów: pewniejszy, ale blokuje też zamierzone zmiany promptów w kroku 10; odradzam.) |
| D11 | Podgląd palet | **Statyczne pliki HTML w `docs/design-preview/`** (3 palety × jasny i ciemny, dane przykładowe). (Strona w aplikacji pod ukrytym adresem: kod w repozytorium bez potrzeby.) |
| D12 | Ikony | **Własne SVG inline (kilka prostych, `aria-hidden`), bez biblioteki ikon.** (Biblioteka ikon: nowa zależność, wymaga Twojej zgody.) |

## Testy i weryfikacja

- `npm run lint`, `npm run typecheck`, `npm test` (ja); `npm run build` i oglądanie w przeglądarce (Ty).
- **Nowe testy bez nowych bibliotek (środowisko `node`):** (1) **kontrast tokenów:** test czyta `globals.css`, wyciąga wartości jasne i ciemne i sprawdza pary (tekst na powierzchni i tint, przytłumiony, biały na obu końcach gradientów nagłówka i akcentu, każdy stan `fg` na `bg`) ≥ 4,5:1; (2) czyste funkcje: `parsePanelParam` (allowlista, rola, wartości obce), `panelBadges`, nawigacja strzałkami paska; (3) render (`renderToStaticMarkup`): przyciski paska mają `aria-expanded`, `aria-controls`, tekst plakietki i `aria-label`, panel nieaktywny ma `hidden`; chipy stanów mają etykietę tekstową; (4) **test statyczny niezmienności montowania:** `page.tsx` ma `Workspace` z `key` zależnym wyłącznie od `variant?.id` i `AgentChat` z `key={variant.id}`, a pliki paska i hosta nie importują `useRouter` (brak `router.push/replace` przy przełączaniu); (5) istniejące testy (ocena, eksport, proposal-card itd.) przechodzą bez zmiany oczekiwań tekstów. Brak testów montowania komponentów w przeglądarce (brak `jsdom`): zachowanie „bez remountu” sprawdza **lista ręczna** w D2 i D3 (wpisz niezapisaną zmianę i wiadomość w czacie, przełącz panele i czat, odśwież adres z `?panel=`; nic nie znika).
- **Ręcznie po każdym PR:** jasny i ciemny tryb, szerokość 375, 768, 1280 i 1920 px, nawigacja samą klawiaturą (Tab, strzałki, Enter, Esc), powiększenie tekstu do 200%, polskie litery i długie wpisy (długi ciąg bez spacji w bloku), kontrast stanów (chip z etykietą w obu trybach).

## Ryzyka i rzeczy niepotwierdzone

- **Next 16 i `replaceState`:** dokumentacja Next opisuje integrację `window.history.replaceState` z `useSearchParams`; **zachowanie przy `router.refresh()` i przy nawigacji wstecz nie jest jeszcze sprawdzone w tym projekcie**; weryfikuje je D2 (jeśli się nie sprawdzi, plan awaryjny: stan panelu w kliencie i `router.replace` tylko przy zamknięciu karty, po Twojej zgodzie).
- **`@container` i klasy `@5xl:`:** wsparcie w Tailwind 4 z rdzenia (bez wtyczki); do potwierdzenia w buildzie D2.
- **Noto Sans z Google Fonts:** wymaga sieci przy buildzie, tak jak dziś Geist; niczego nie dodaję do zależności.
- **Rozmiar DOM po zamontowaniu wszystkich paneli:** panele są dziś wszystkie na stronie, więc zmiana jest neutralna; do oceny w przeglądarce.
- **Plakietka „nieaktualna” przy ocenie** opiera się na wersji z kontekstu, a najnowsza ocena pochodzi z propsów serwera: po zapisie plakietka pojawi się od razu, a po nowej ocenie zniknie po `router.refresh()` (dotychczasowy mechanizm).
- **Kolizje barw akcentu i stanów** (tabela wyżej): mitygacja to etykiety tekstowe, różne kształty (akcent tylko na pełnych przyciskach i aktywnej zakładce, stany jako chipy z ramką) oraz test kontrastu; wizualną czytelność oceniasz w podglądzie.

## Zmiany po akceptacji

Plan zaakceptowany 2026-11-25: **D1 do D12 zgodnie z rekomendacjami, z jedną zmianą (punkt 1)**. Paletę (D1) wybiera właściciel po obejrzeniu podglądów z PR D1; **D2 nie zaczyna się przed tym wyborem**. Punkty poniżej mają pierwszeństwo przed treścią powyżej. Kolejne rozbieżności i decyzje z implementacji dopisuję tu, numerowane jak w planach kroków 7 i 9.

1. **Czcionka (D2): `next/font/local` z plikami Noto Sans z repozytorium, a nie `next/font/google`.** Powody (właściciel): brak pobierania z sieci przy buildzie (połączenia z zewnętrznymi serwerami mają problemy z certyfikatami), ta sama czcionka w aplikacji i w PDF, brak nowej zależności. Pliki: `src/lib/export/fonts/NotoSans-Regular.ttf` i `NotoSans-Bold.ttf` (Noto Sans 2.015, SIL OFL 1.1, już w repozytorium od 9b). **Ograniczenie: dostępne są tylko wagi 400 i 700** (nie ma kroju półgrubego ani zmiennego). Konsekwencja: klasy `font-medium` (500) renderują się jako Regular, a `font-semibold` (600) jako Bold (przeglądarka wybiera najbliższy dostępny krój, bez sztucznego pogrubiania, bo deklarujemy tylko 400 i 700); kontrast hierarchii typograficznej budują rozmiar, kolor i Bold. Zamiast wag 500 i 600 w nowych komponentach używam 400 i 700. Ścieżki do plików w `layout.tsx` są względne wobec pliku (`../lib/export/fonts/...`); pliki źródłowe w repozytorium nie są zmieniane (build Next kopiuje je do `.next/static/media`). Pliki TTF (niepodzbiorowane, to wymagałoby narzędzia spoza projektu) są ładowane z `display: swap`. Zmiana wpływa też na tekst w D1: Geist (oba kroje) znika z `layout.tsx`, a `body` używa `--font-sans`.

2. **PR D1 (2026-11-25): doprecyzowania po implementacji.**
   - **Tokeny** w `src/app/globals.css` dla **palety A** (jasny i ciemny tryb z `prefers-color-scheme`, bez przełącznika: D7): `--bg-from/to`, `--surface`, `--tint`, `--text`, `--muted`, `--border`, `--head-from/to`, `--on-head`, `--accent-from/to`, `--on-accent`, `--ring`, `--danger`, trzy stany na ton (`ai`, `low`, `medium`, `high`, `main`: tło, tekst, ramka) i gradienty `--grad-bg`, `--grad-head`, `--grad-accent`. W Tailwindzie jako kolory (`bg-surface`, `text-muted`, `border-border`, `bg-ai-bg`…) oraz narzędzia `bg-app`, `bg-head`, `bg-cta`. Wartości stanów to moja propozycja: fiolet dla AI (przeniesiony z bursztynu), zieleń, bursztyn i czerwień dla wpływu, granat dla „Główny”; „Strategia AI” używa tonu `ai`.
   - **Kontrast sprawdza test** `src/app/design-tokens.test.ts` na prawdziwym pliku CSS (oba tryby, oba końce gradientów, stany, `danger`, `ring`): wszystkie pary tekstowe ≥ 4,5:1 (najniższa wartość w jasnym A: 5,0:1, w ciemnym A: 6,6:1). Te same pary dla palet B i C policzyłem osobno (tylko podglądy): najniższe wartości 5,2 i 4,8 (B jasna i ciemna), 5,0 i 6,3 (C), czyli wszystkie spełniają AA; test w repozytorium dotyczy palety, która jest w `globals.css`.
   - **Czcionka:** `layout.tsx` używa `next/font/local` (Regular 400 i Bold 700, zmienna `--font-noto-sans`), Geist i Geist Mono usunięte z importów (Geist Mono nigdzie nie był używany; pliki czcionek Geista nie istnieją w repozytorium, to były pobrania z sieci). `body` używa `--font-sans` (dotąd nadpisywał go `Arial`). **Brakuje kroju półgrubego:** `font-medium` (500) wyświetla się jako Regular, a `font-semibold` (600) jako Bold; istniejące komponenty zmienią więc wygląd nagłówków `font-semibold` (będą Bold) i `font-medium` (Regular), co mieści się w tym, co zmienia się w D2 do D4.
   - **Komponenty bazowe** w `src/components/ui/`: `Button` i `buttonClass` (główny: gradient akcentu; drugorzędny: powierzchnia z ramką), `Card`, `PanelHeader` (gradient, `h2` z identyfikatorem), `StateChip` (zawsze etykieta tekstowa), `Badge` (plakietka z ukrytym wizualnie opisem dla czytników). Używają wyłącznie tokenów; w D1 nie są jeszcze podpięte do stron (podpięcie w D2 do D4). Brak ikon i brak nowych zależności.
   - **Statyczny podgląd** `docs/design-preview/{a,b,c}.html`: samowystarczalne pliki (CSS w pliku, jedyny skrypt to przycisk „Przełącz jasny / ciemny”), strona projektu z danymi przykładowymi (pasek narzędzi z plakietkami, płótno dziewięciu bloków z blokiem przewijanym i długim ciągiem znaków, propozycja AI, wpływ, panel oceny, czat z boku, chipy stanów, próbki barw). Czcionka w podglądach: Noto Sans z systemu lub z plików repozytorium (względna ścieżka `../../src/lib/export/fonts/`), a gdy przeglądarka jej nie wczyta z `file://`, zapasowo Segoe UI; to nie wpływa na kolory.
   - **Nie zmienia się:** `src/lib/ai/`, `src/lib/schemas/`, `src/app/api/chat/` (puste `git diff --stat`), wersje promptów, komponenty stron (poza tym, co zmienia globalny font i tło `body`).

3. **Paleta D (2026-11-25, po obejrzeniu podglądów A do C): ciemny, nowoczesny styl; podgląd `docs/design-preview/d.html`.** Właściciel odrzucił A, B i C i wskazał zrzut ekranu `C:\Users\thepr\Pictures\styl.png` (strona skilla UI UX Pro Max). **Nie mogłem otworzyć tego pliku** (katalog `Pictures` nie istnieje pod tą ścieżką; obrazy użytkownika są w `C:\Users\thepr\OneDrive\Obrazy`, a pliku o nazwie `styl*` tam nie znalazłem), więc paletę D zbudowałem **wyłącznie z opisu** (czarne tło z rozmytą poświatą granatową i koralową, ciemny granat, szklane karty z cienką jasną ramką, jaśniejszy niebieski, koral). Podobieństwo do zrzutu trzeba ocenić po obejrzeniu podglądu.
   - **Proporcje:** 60% prawie czarne tło strony (`#04060C` → `#090E1D`) z dwiema rozmytymi poświatami (granat po lewej i na dole, koral po prawej u góry; gradienty radialne, bez filtrów); 30% ciemny granat (powierzchnia `#101A36`, tint `#17234A`) dla bloków płótna, paneli, czatu, tabel, pól i przycisków drugorzędnych, **pełne, nieprzezroczyste tło**; półprzezroczyste szklane powierzchnie (`rgba` białego 6% z cienką jasną ramką i rozmyciem tła) **tylko** na pasku przycisków, pasku górnym, nagłówkach bloków i paneli oraz małych kartach (w nagłówkach jako zapisany z góry kolor zastępczy, bo leżą na nieprzezroczystym bloku); przyciski główne w jaśniejszym niebieskim (`#7DB2FF` → `#5B9BFF`, tekst `#06112B`); 10% koral (`#FF9068` → `#FF7345`, tekst `#1A0A06`) na aktywnym przycisku paska, plakietkach, gradiencie tytułu (niebieski `#8DBBFF` → koral) i wyróżnieniach.
   - **Zmiana schematu tokenów względem A (jeśli wybrana D):** przycisk główny i akcent są osobnymi tokenami (`--primary-from/to`, `--on-primary` oraz `--accent-*` dla korala; w A oba były akcentem), dochodzą `--glow-navy`, `--glow-coral` (rgba) i ich szczyty `--glow-*-peak` (kolor zastępczy do testu kontrastu), `--glass`, `--glass-border`, `--title-from/to`. Narzędzie `bg-cta` w D oznacza przycisk niebieski (`primary`), a koralowy gradient dostaje osobne narzędzie. Podgląd i test używają tych samych nazw.
   - **Kontrasty (zmierzone testem na prawdziwym pliku, WCAG AA):** w ciemnym D najniższa wartość to 5,0:1, w jasnym D 4,7:1 (tekst, tekst przytłumiony, tekst na przyciskach, tytuł, stany, także na szczytach poświat). Test `design-tokens.test.ts` obejmuje teraz obie palety (A z `globals.css`, D z `d.html` w obu trybach), w tym szczyty poświat i gradient tytułu.
   - **Odróżnialność (test):** koral akcentu a czerwień „Wpływ wysoki”: odległość barwy 30 do 31° w ciemnym i 36 do 39° w jasnym trybie (koral 14 do 16°, czerwień stanu różowo-karmazynowa 345° w ciemnym i 336° w jasnym; dodatkowo stan ma ramkę i etykietę, a koral występuje tylko jako pełne wypełnienie); fiolet AI (273 do 275°) a niebieski przycisków i „Główny” (216 do 223°): 50 do 59°. Stany zachowują etykiety tekstowe.
   - **Tryb jasny jako uproszczona wersja na tych samych tokenach:** w podglądzie jest ten sam zestaw nazw (jasne tła, biała powierzchnia, ciemny tekst, niebieski i koral w ciemniejszych odcieniach, szklane powierzchnie jako półprzezroczysta biel, poświata jako blady pastel). Ciemny jest domyślny i główny: podgląd i blok `:root` nie zależą od `prefers-color-scheme`; jasny włącza się tylko atrybutem `data-theme="light"` (przycisk w podglądzie). **Dodatkowa praca, gdy D zostanie wybrana (szacunek, niezmierzony):** tokeny jasne są już policzone i objęte testem; nie dochodzi kod komponentów (używają tokenów). Dochodzą: (1) decyzja i kod, jak użytkownik włącza jasny tryb (D7 zmienia się z „tylko ustawienie systemu” na przełącznik z `localStorage` w `try/catch` i skryptem przeciw migotaniu albo na mapowanie `prefers-color-scheme: light`; to jedna mała zmiana w `layout.tsx` i jeden komponent), (2) oglądanie każdego PR (D2 do D4) w dwóch trybach zamiast jednego, czyli rząd +20 do 30% czasu przeglądu w przeglądarce, (3) poprawki wizualne jasnego trybu po pierwszym obejrzeniu (poświata i szkło w jasnym są najtrudniejsze do dobrania). Cały jasny tryb to rząd jednego dodatkowego małego PR-a w D4, a nie przepisywanie komponentów.
   - **Poprawka podglądów A do C:** w pierwszej wersji tekst we wszystkich podglądach mógł wyświetlać się kursywą (reguła `@font-face` z `local("Noto Sans")` wybierała systemowy krój pochyły). Poprawione we wszystkich czterech plikach (`font-style: normal`, czcionka tylko z plików repozytorium, zapasowo Segoe UI) i dodane zawijanie plakietek na wąskim ekranie. Zmieniły się tylko pliki podglądu, nie tokeny A.
