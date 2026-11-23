import { z } from "zod";

// Pusta zmienna (np. `ATTACHMENT_MAX_BYTES=` w .env) liczy się jak brak, żeby zadziałała wartość domyślna.
const envInt = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(min).max(max).default(defaultValue),
  );

const AttachmentEnv = z.object({
  // Najwyżej tyle bajtów na jeden plik (spec §7: np. 10 MB).
  ATTACHMENT_MAX_BYTES: envInt(10 * 1024 * 1024, 1024, 50 * 1024 * 1024),
  // Najwyżej tyle załączników na projekt.
  ATTACHMENT_MAX_PER_PROJECT: envInt(10, 1, 100),
  // Najwyżej tyle znaków wyekstrahowanego tekstu zapisujemy w bazie (dalej przycięcie z flagą `truncated`).
  ATTACHMENT_MAX_TEXT_CHARS: envInt(200_000, 1_000, 2_000_000),
  // Najwyżej tyle znaków tekstu zwraca jedno wywołanie narzędzia read_attachment (reszta przez `offset`).
  READ_ATTACHMENT_MAX_CHARS: envInt(6_000, 500, 50_000),
  // Ekstrakcja (krok 7b): ochrona przed „bombą ZIP” (DOCX) i zbyt kosztownym PDF.
  // Łączny rozmiar plików w archiwum DOCX po rozpakowaniu (sprawdzany ze spisu i faktycznym rozpakowaniem).
  ATTACHMENT_ZIP_MAX_UNCOMPRESSED_BYTES: envInt(100 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024),
  // Najwyżej tyle plików w archiwum DOCX.
  ATTACHMENT_ZIP_MAX_ENTRIES: envInt(1_000, 10, 100_000),
  // Najwyżej tyle stron PDF czytamy (dalej przycięcie z flagą `truncated`).
  ATTACHMENT_PDF_MAX_PAGES: envInt(200, 1, 2_000),
  // Limit czasu ekstrakcji (ms); częściowa ochrona, patrz src/lib/attachments/extract.ts.
  ATTACHMENT_EXTRACT_TIMEOUT_MS: envInt(15_000, 1_000, 120_000),
  // Katalog magazynu plików na dev (interfejs AttachmentStorage pozwala go później podmienić).
  ATTACHMENTS_DIR: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).default(".data/attachments"),
  ),
});

export type AttachmentLimits = {
  maxBytes: number;
  maxPerProject: number;
  maxTextChars: number;
  readMaxChars: number;
  zipMaxUncompressedBytes: number;
  zipMaxEntries: number;
  pdfMaxPages: number;
  extractTimeoutMs: number;
  storageDir: string;
};

export function loadAttachmentLimits(env: Record<string, string | undefined> = process.env): AttachmentLimits {
  const parsed = AttachmentEnv.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Niepoprawna konfiguracja załączników w zmiennych środowiskowych: ${z.prettifyError(parsed.error)}`);
  }
  const v = parsed.data;
  return {
    maxBytes: v.ATTACHMENT_MAX_BYTES,
    maxPerProject: v.ATTACHMENT_MAX_PER_PROJECT,
    maxTextChars: v.ATTACHMENT_MAX_TEXT_CHARS,
    readMaxChars: v.READ_ATTACHMENT_MAX_CHARS,
    zipMaxUncompressedBytes: v.ATTACHMENT_ZIP_MAX_UNCOMPRESSED_BYTES,
    zipMaxEntries: v.ATTACHMENT_ZIP_MAX_ENTRIES,
    pdfMaxPages: v.ATTACHMENT_PDF_MAX_PAGES,
    extractTimeoutMs: v.ATTACHMENT_EXTRACT_TIMEOUT_MS,
    storageDir: v.ATTACHMENTS_DIR,
  };
}
