# Czcionki eksportu PDF

Czcionki dołączone do repozytorium, bo domyślne czcionki `@react-pdf/renderer` (Helvetica, Times, Courier; kodowanie WinAnsi) nie zawierają polskich liter `ą ć ę ł ń ś ź ż` i ich wielkich odpowiedników. Używa ich wyłącznie generowanie PDF (`src/lib/export/pdf/`).

## Pliki

| Plik | Rozmiar (B) | SHA-256 |
|---|---|---|
| `NotoSans-Regular.ttf` | 431 364 | `f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8` |
| `NotoSans-Bold.ttf` | 432 376 | `87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9` |
| `OFL.txt` | 4 396 | `cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a` (suma oryginalnego pliku z końcami linii LF) |

Sumy kontroluje test `src/lib/export/fonts.test.ts`: zmiana pliku czcionki wymaga świadomej zmiany sumy w teście i w tym pliku.

## Źródło i wersja

- **Noto Sans, wersja 2.015** (`Version 2.015` w tabeli `name` obu plików), wydanie `NotoSans-v2.015` z 2024-11-20 w repozytorium <https://github.com/notofonts/latin-greek-cyrillic> (plik `NotoSans-v2.015.zip`, ścieżka w archiwum: `NotoSans/unhinted/ttf/`; `OFL.txt` z katalogu głównego archiwum).
- Wybrano wariant **unhinted** (bez instrukcji hintingu, ok. 0,43 MB na plik), wystarczający do PDF. Pliki są **niezmodyfikowane** (bajt w bajt jak w wydaniu).
- Pobrano 2026-11-24 poleceniem `gh release download NotoSans-v2.015 -R notofonts/latin-greek-cyrillic`.

## Licencja

SIL Open Font License, Version 1.1; Copyright 2022 The Noto Project Authors (<https://github.com/notofonts/latin-greek-cyrillic>). Pełny tekst w `OFL.txt` (musi pozostać w tym katalogu razem z plikami czcionek). Plik czcionki nie wskazuje Reserved Font Name, a pole `fsType` jest równe 0 (osadzanie w dokumentach bez ograniczeń). Licencja pozwala dołączać czcionkę do projektu i osadzać ją w generowanych PDF; zabrania sprzedaży samej czcionki.

## Pokrycie znaków (sprawdzone narzędziem fontTools, 3884 glify)

- Obecne wszystkie 18 polskich liter (`ąćęłńóśźż` i `ĄĆĘŁŃÓŚŹŻ`) w obu plikach.
- Obecne m.in. `„ ” “ ’ – — … • · ° × € ©`.
- **Brak:** `≥ ≤ → ✓ ★`. W dokumentach nie używamy tych symboli (zamiast nich słowa). Znaki spoza łaciny, greki i cyrylicy (np. emoji, CJK) w treściach użytkownika mogą wyświetlić się jako puste kwadraty; zachowanie przy braku glifu sprawdza test eksportu.
