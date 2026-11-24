/**
 * Zwykły tekst w dokumentach (krok 9). Wszystko, co pochodzi z bazy (nazwy, opisy, wpisy, uzasadnienia, odpowiedzi, nazwy
 * plików), przechodzi przez `exportText`, a potem trafia do dokumentu wyłącznie jako węzeł tekstowy (`<Text>` w PDF,
 * `TextRun` w DOCX). Bez HTML i Markdown. Usuwamy to, co psuje dokument albo wprowadza w błąd czytelnika:
 * - znaki sterujące (w DOCX nieprawidłowe w XML 1.0: Word zgłasza uszkodzony plik), poza tabulatorem i nowym wierszem;
 * - znaki zmiany kierunku tekstu (U+202A do U+202E, U+2066 do U+2069, U+200E, U+200F, U+061C), które pozwalają
 *   „odwrócić” fragment tekstu i ukryć jego prawdziwą treść;
 * - niesparowane surogaty i znaki niebędące znakami (U+FFFE, U+FFFF), bajt BOM (U+FEFF).
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const DIRECTION_CHARS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
const NON_CHARACTERS = /[\uFFFE\uFFFF\uFEFF]/g;

export function exportText(value: string | null | undefined, maxChars?: number): string {
  if (value === null || value === undefined) {
    return "";
  }
  const cleaned = value
    .toWellFormed()
    .replace(/\r\n?|\u2028|\u2029|\u0085/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(DIRECTION_CHARS, "")
    .replace(NON_CHARACTERS, "")
    .trim();
  if (maxChars === undefined) {
    return cleaned;
  }
  const chars = Array.from(cleaned);
  return chars.length <= maxChars ? cleaned : `${chars.slice(0, Math.max(0, maxChars - 1)).join("").trimEnd()}…`;
}

// --- nazwa pliku do pobrania -----------------------------------------------------------------------------------------------

const MAX_FILE_BASE_CHARS = 100;

const POLISH_TO_ASCII: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
  Ą: "A",
  Ć: "C",
  Ę: "E",
  Ł: "L",
  Ń: "N",
  Ó: "O",
  Ś: "S",
  Ź: "Z",
  Ż: "Z",
};

function toAscii(text: string): string {
  return text
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (letter) => POLISH_TO_ASCII[letter] ?? letter)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/** Data w strefie Europe/Warsaw jako RRRR-MM-DD (jak daty w interfejsie). */
export function exportDateStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts;
}

function unicodeBase(parts: readonly string[], date: Date): string {
  const joined = ["bmc", ...parts.map((part) => exportText(part)), exportDateStamp(date)]
    .join("-")
    // Bez separatorów ścieżek, cudzysłowów, znaków niedozwolonych w nazwach plików i znaków sterujących.
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    // Kilka myślników i kropek z rzędu (np. „..” po usunięciu separatorów ścieżek) zamieniamy na jeden myślnik.
    .replace(/[-.]{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return Array.from(joined).slice(0, MAX_FILE_BASE_CHARS).join("").replace(/[-.]+$/g, "");
}

/** Nagłówek `Content-Disposition` dla pobrania: `filename` ASCII (zgodność) i `filename*` UTF-8 z polskimi literami. */
export function exportContentDisposition(parts: readonly string[], date: Date, extension: "pdf" | "docx"): string {
  const unicode = unicodeBase(parts, date) || "bmc-eksport";
  const ascii = toAscii(unicode) || "bmc-eksport";
  const encoded = encodeURIComponent(`${unicode}.${extension}`).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}.${extension}"; filename*=UTF-8''${encoded}`;
}
