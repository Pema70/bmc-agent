# Czcionka nagłówków (Space Grotesk)

Używana wyłącznie do nagłówków `h1` do `h3` i tytułu projektu (zmienna `--font-display`, `src/app/layout.tsx`). Wpisy, czat, tabele i formularze zostają w Noto Sans (`src/lib/export/fonts/`, ta sama czcionka co w PDF).

## Pliki

| Plik | Rozmiar (B) | SHA-256 |
|---|---|---|
| `SpaceGrotesk-Variable.ttf` | 136 676 | `acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72` |
| `OFL.txt` | 4 495 | `564ce565c371c5e5bbf286006565a7c9aa55a9f56e7ca58d56e05d649dd61a72` (suma oryginalnego pliku; **oryginał ma końce linii CRLF**) |

Sumy kontroluje test `src/app/fonts.test.ts`. Licencja jest porównywana po normalizacji końców linii do LF (suma `c6dec685825f73b18c20926fddc65e8315642e12986f15db0699170940a09efc`), bo Git zamienia końce linii zależnie od systemu; suma oryginału z CRLF (tabela wyżej) została sprawdzona przed dodaniem pliku.

## Źródło

- Repozytorium `google/fonts`, katalog `ofl/spacegrotesk`, plik `SpaceGrotesk[wght].ttf` (pierwotny projekt: <https://github.com/floriankarsten/space-grotesk>, autor Florian Karsten).
- Pobrano 2026-11-24 z `https://github.com/google/fonts/raw/main/ofl/spacegrotesk/`.
- **Plik jest niezmodyfikowany (bajt w bajt)**; zmieniona została tylko jego nazwa: `SpaceGrotesk[wght].ttf` → `SpaceGrotesk-Variable.ttf` (nawiasy kwadratowe w nazwie sprawiają kłopot narzędziom i globom na Windowsie). Numeru wersji pliku nie odczytywano.
- Krój zmienny, oś `wght` 300 do 700 (wartość domyślna 300), 136 676 bajtów (133,5 KiB).

## Licencja

SIL Open Font License, Version 1.1; Copyright 2020 The Space Grotesk Project Authors (<https://github.com/floriankarsten/space-grotesk>). Pełny tekst w `OFL.txt` (musi pozostać w tym katalogu razem z plikiem czcionki). Licencja pozwala dołączać czcionkę do projektu i osadzać ją w stronach; zabrania sprzedaży samej czcionki.

## Pokrycie znaków

Sprawdzone w tablicy `cmap` pliku (własny odczyt tablicy, bez dodatkowych narzędzi): obecne wszystkie polskie litery małe i duże (`ąćęłńóśźż`, `ĄĆĘŁŃÓŚŹŻ`) oraz cudzysłowy „ ” i półpauza.
