import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";
import { inspectZip, verifyZipInflation } from "@/lib/attachments/zip-inspect";
import { normalizeFileName, type AttachmentKind } from "@/lib/schemas/attachment";

/**
 * Wykrywanie typu pliku po zawartości i ekstrakcja tekstu (PDF: unpdf, DOCX: mammoth, TXT: UTF-8).
 * Treść i nazwa pliku to niezaufane dane: tutaj tylko wyciągamy tekst, a do promptu trafia on wyłącznie przez dataBlock.
 *
 * Znane ograniczenie ochrony czasu (zapisane w docs/zadania.md): ekstrakcja PDF działa w głównym wątku procesu
 * (pdf.js bez workera), a JavaScript jest jednowątkowy. Limit czasu sprawdzamy między stronami (przy czytaniu kolejnej
 * strony) i dodatkowo wyścigiem z timerem, który **nie jest w stanie przerwać** kodu blokującego wątek: pojedyncza
 * patologiczna strona może zająć procesor aż do końca jej przetwarzania. Pełna ochrona wymaga osobnego wątku
 * (worker_threads z terminate()) albo procesu potomnego.
 */

export type ExtractError =
  | "UNSUPPORTED"
  | "MISMATCH"
  | "CORRUPT"
  | "NO_TEXT"
  | "ARCHIVE_TOO_LARGE"
  | "TIMEOUT";

export type ExtractLimits = {
  maxTextChars: number;
  zipMaxUncompressedBytes: number;
  zipMaxEntries: number;
  pdfMaxPages: number;
  extractTimeoutMs: number;
};

export type ExtractResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; error: ExtractError; message: string };

export type DetectResult = { ok: true; kind: AttachmentKind } | { ok: false; error: "UNSUPPORTED" | "MISMATCH"; message: string };

const MESSAGES = {
  UNSUPPORTED: "Obsługiwane formaty plików to PDF, DOCX i TXT (UTF-8).",
  MISMATCH: "Zawartość pliku nie zgadza się z jego rozszerzeniem.",
  CORRUPT: "Nie udało się odczytać pliku: jest uszkodzony albo zabezpieczony hasłem.",
  NO_TEXT_PDF: "Ten PDF nie ma warstwy tekstowej (to prawdopodobnie skan); rozpoznawanie tekstu ze skanów nie jest obsługiwane.",
  NO_TEXT: "Plik nie zawiera tekstu.",
  NOT_DOCX: "Ten plik ZIP nie jest dokumentem DOCX.",
  ZIP_UNSUPPORTED: "Archiwum DOCX używa nieobsługiwanych funkcji (np. szyfrowania lub ZIP64).",
  ARCHIVE_TOO_LARGE: "Dokument DOCX jest zbyt duży po rozpakowaniu albo zawiera zbyt wiele plików.",
  TIMEOUT: "Przetwarzanie pliku trwało zbyt długo i zostało przerwane.",
} as const;

const MIN_TEXT_CHARS = 20;

const EXTENSION_KIND: Record<string, AttachmentKind> = { pdf: "PDF", docx: "DOCX", txt: "TXT" };

function fail(error: ExtractError, message: string): { ok: false; error: ExtractError; message: string } {
  return { ok: false, error, message };
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Rodzaj pliku po zawartości (nagłówki), z rozszerzeniem jako dodatkową kontrolą: niezgodność odrzucamy.
 * DOCX rozpoznajemy tu tylko po sygnaturze ZIP; że to naprawdę DOCX, sprawdza ekstrakcja (spis zawartości archiwum).
 */
export function detectKind(bytes: Uint8Array, fileName: string): DetectResult {
  const extension = /\.([A-Za-z0-9]+)$/.exec(normalizeFileName(fileName))?.[1]?.toLowerCase();
  const byExtension = extension ? EXTENSION_KIND[extension] : undefined;
  if (!byExtension) {
    return { ok: false, error: "UNSUPPORTED", message: MESSAGES.UNSUPPORTED };
  }

  let byContent: AttachmentKind | null = null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    byContent = "PDF";
  } else if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    byContent = "DOCX";
  } else if (bytes.length > 0 && !bytes.includes(0) && decodeUtf8Strict(bytes) !== null) {
    byContent = "TXT";
  }

  if (byContent !== byExtension) {
    return { ok: false, error: "MISMATCH", message: MESSAGES.MISMATCH };
  }
  return { ok: true, kind: byContent };
}

/** Usuwa znaki sterujące (w tym NUL, którego Postgres nie przyjmie), normalizuje końce linii i puste linie. */
export function sanitizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  let cut = text.slice(0, max);
  // Nie zostawiamy połówki pary zastępczej (np. emoji) na końcu.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    cut = cut.slice(0, -1);
  }
  return { text: cut.trimEnd(), truncated: true };
}

function finishText(raw: string, limits: ExtractLimits, noTextMessage: string, alreadyTruncated = false): ExtractResult {
  const cleaned = sanitizeText(raw);
  if (cleaned.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
    return fail("NO_TEXT", noTextMessage);
  }
  const limited = truncateText(cleaned, limits.maxTextChars);
  return { ok: true, text: limited.text, truncated: limited.truncated || alreadyTruncated };
}

const TIMED_OUT = Symbol("timed-out");

/**
 * Uruchamia pracę z limitem czasu. Praca dostaje funkcję `expired()` i powinna ją sprawdzać między krokami. Wyścig z
 * timerem przerywa tylko oczekiwanie wywołującego: kodu, który blokuje wątek, nie przerwie (patrz uwaga na górze pliku).
 */
async function withDeadline<T>(timeoutMs: number, work: (expired: () => boolean) => Promise<T>): Promise<T | typeof TIMED_OUT> {
  const deadline = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  const running = work(() => Date.now() > deadline);
  // Praca może zakończyć się błędem już po przegranym wyścigu: nie zostawiamy nieobsłużonego odrzucenia.
  running.catch(() => undefined);
  try {
    return await Promise.race([running, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function extractPdf(bytes: Uint8Array, limits: ExtractLimits, expired: () => boolean): Promise<ExtractResult> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Kopia bajtów: pdf.js może przejąć bufor, a oryginał jeszcze zapisujemy w magazynie.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    return fail("CORRUPT", MESSAGES.CORRUPT);
  }

  try {
    const pages = Math.min(pdf.numPages, limits.pdfMaxPages);
    const parts: string[] = [];
    let chars = 0;
    let truncated = pdf.numPages > pages;

    for (let number = 1; number <= pages; number++) {
      if (expired()) {
        return fail("TIMEOUT", MESSAGES.TIMEOUT);
      }
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      page.cleanup();
      const text = content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
      parts.push(text);
      chars += text.length;
      if (chars >= limits.maxTextChars) {
        truncated = truncated || number < pages || chars > limits.maxTextChars;
        break;
      }
    }
    return finishText(parts.join("\n\n"), limits, MESSAGES.NO_TEXT_PDF, truncated);
  } catch {
    return fail("CORRUPT", MESSAGES.CORRUPT);
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

async function extractDocx(bytes: Uint8Array, limits: ExtractLimits, expired: () => boolean): Promise<ExtractResult> {
  const inspection = inspectZip(bytes, { maxEntries: limits.zipMaxEntries, maxUncompressedBytes: limits.zipMaxUncompressedBytes });
  if (!inspection.ok) {
    switch (inspection.error) {
      case "TOO_MANY_ENTRIES":
      case "TOO_LARGE":
        return fail("ARCHIVE_TOO_LARGE", MESSAGES.ARCHIVE_TOO_LARGE);
      case "ZIP64":
      case "UNSUPPORTED":
        return fail("UNSUPPORTED", MESSAGES.ZIP_UNSUPPORTED);
      default:
        return fail("CORRUPT", MESSAGES.CORRUPT);
    }
  }
  const names = new Set(inspection.entries.map((entry) => entry.name));
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) {
    return fail("UNSUPPORTED", MESSAGES.NOT_DOCX);
  }

  // Zadeklarowane rozmiary mógł sfałszować sam plik, więc sprawdzamy faktyczne rozpakowanie z twardym limitem.
  const inflation = await verifyZipInflation(bytes, inspection.entries, limits.zipMaxUncompressedBytes);
  if (!inflation.ok) {
    return inflation.error === "TOO_LARGE"
      ? fail("ARCHIVE_TOO_LARGE", MESSAGES.ARCHIVE_TOO_LARGE)
      : fail("CORRUPT", MESSAGES.CORRUPT);
  }
  if (expired()) {
    return fail("TIMEOUT", MESSAGES.TIMEOUT);
  }

  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return finishText(result.value, limits, MESSAGES.NO_TEXT);
  } catch {
    return fail("CORRUPT", MESSAGES.CORRUPT);
  }
}

function extractTxt(bytes: Uint8Array, limits: ExtractLimits): ExtractResult {
  const decoded = decodeUtf8Strict(bytes);
  if (decoded === null || decoded.includes("\u0000")) {
    return fail("UNSUPPORTED", MESSAGES.UNSUPPORTED);
  }
  return finishText(decoded, limits, MESSAGES.NO_TEXT);
}

/** Wyciąga tekst z pliku znanego rodzaju (`detectKind`). Wynik nigdy nie jest pusty ani nie zawiera NUL. */
export async function extractText(args: { kind: AttachmentKind; bytes: Uint8Array; limits: ExtractLimits }): Promise<ExtractResult> {
  const { kind, bytes, limits } = args;
  if (kind === "TXT") {
    return extractTxt(bytes, limits);
  }
  const outcome = await withDeadline(limits.extractTimeoutMs, (expired) =>
    kind === "PDF" ? extractPdf(bytes, limits, expired) : extractDocx(bytes, limits, expired),
  );
  return outcome === TIMED_OUT ? fail("TIMEOUT", MESSAGES.TIMEOUT) : outcome;
}
