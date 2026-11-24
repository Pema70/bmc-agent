import path from "node:path";
import { Font } from "@react-pdf/renderer";

/**
 * Czcionka dokumentów PDF: Noto Sans (SIL OFL 1.1) z repozytorium, bo domyślne czcionki react-pdf (WinAnsi) nie mają polskich
 * liter. Pliki, wersja, licencja i sumy: `src/lib/export/fonts/README.md`.
 * Ścieżka od `process.cwd()` działa przy `next dev` i `next start` uruchamianych z katalogu projektu. Przy wdrożeniu
 * bezserwerowym lub w trybie `standalone` pliki trzeba dołączyć do wyniku (`outputFileTracingIncludes`), patrz `docs/zadania.md`.
 */
export const EXPORT_FONT_FAMILY = "Noto Sans";

const FONT_DIRECTORY = ["src", "lib", "export", "fonts"] as const;

export function exportFontPaths(): { regular: string; bold: string } {
  const directory = path.join(process.cwd(), ...FONT_DIRECTORY);
  return { regular: path.join(directory, "NotoSans-Regular.ttf"), bold: path.join(directory, "NotoSans-Bold.ttf") };
}

/** Najdłuższy wyraz, który zostaje w całości; dłuższe ciągi bez spacji dzielimy co tyle znaków (z myślnikiem na końcu wiersza). */
export const MAX_UNBROKEN_WORD_CHARS = 24;

/**
 * Bez tej reguły ciąg bez spacji dłuższy niż szerokość strony nie jest zawijany i **ginie z dokumentu** (jest obcięty poza
 * stroną; zmierzone w kroku 9b: z 200 znaków widać było 53). Znak zerowej szerokości (U+200B) nie wystarcza.
 */
export function splitOverlongWord(word: string): string[] {
  const chars = Array.from(word);
  if (chars.length <= MAX_UNBROKEN_WORD_CHARS) {
    return [word];
  }
  const parts: string[] = [];
  for (let index = 0; index < chars.length; index += MAX_UNBROKEN_WORD_CHARS) {
    parts.push(chars.slice(index, index + MAX_UNBROKEN_WORD_CHARS).join(""));
  }
  return parts;
}

/**
 * Rejestruje czcionki na nowo przy każdym renderze i ustawia własną regułę dzielenia wyrazów (domyślne wzorce dzielą polskie
 * wyrazy w złych miejscach, więc zwykłe wyrazy zostają w całości).
 *
 * Rejestracja jest świeża, bo `Font.register` dopisuje źródła do rodziny, a stary obiekt czcionki (fontkit) trzyma stan
 * glifów współdzielony między dokumentami: po wyrenderowaniu jednego dokumentu litera „c” w kolejnym dostawała błędny
 * zapis do kopiowania i wyszukiwania (tekst na stronie wyglądał poprawnie, ale w PDF był nieodczytywalny jako „c”).
 * Zmierzone testem w `fonts.test.tsx` („kolejny dokument”). Koszt: dwa pliki po ok. 0,4 MB parsowane przy każdym eksporcie.
 */
export function registerExportFonts(): void {
  const { regular, bold } = exportFontPaths();
  delete Font.getRegisteredFonts()[EXPORT_FONT_FAMILY];
  Font.register({
    family: EXPORT_FONT_FAMILY,
    fonts: [
      { src: regular, fontWeight: 400 },
      { src: bold, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback(splitOverlongWord);
}
