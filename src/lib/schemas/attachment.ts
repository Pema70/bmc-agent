import { z } from "zod";

export const ATTACHMENT_FILE_NAME_MAX_CHARS = 200;
// Górna granica rozmiaru pliku w schemacie (faktyczny limit jest w konfiguracji: ATTACHMENT_MAX_BYTES).
export const ATTACHMENT_SIZE_HARD_MAX_BYTES = 50 * 1024 * 1024;
const READ_OFFSET_MAX = 10_000_000;

// Klucz magazynu to losowy identyfikator (24 losowe bajty w base64url = 32 znaki), nigdy nazwa pliku.
export const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const ATTACHMENT_KINDS = ["PDF", "DOCX", "TXT"] as const;
export const AttachmentKind = z.enum(ATTACHMENT_KINDS);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

/**
 * Nazwa pliku od użytkownika to niezaufany tekst: tylko do wyświetlania (jako zwykły tekst) i do bloku danych w prompcie.
 * Nigdy nie trafia do ścieżki ani do atrybutu. Normalizacja: tylko ostatni element ścieżki, znaki sterujące i
 * formatujące (np. nadpisanie kierunku tekstu) usunięte, białe znaki zwinięte, najwyżej 200 znaków.
 */
export function normalizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const limited = Array.from(cleaned).slice(0, ATTACHMENT_FILE_NAME_MAX_CHARS).join("").trim();
  // Nazwa złożona z samych kropek („.”, „..”) nie jest nazwą pliku.
  return /^\.+$/.test(limited) ? "" : limited;
}

export const AttachmentFileName = z
  .string({ error: "Podaj nazwę pliku." })
  .transform(normalizeFileName)
  .pipe(z.string().min(1, { error: "Podaj nazwę pliku." }));

export const AttachmentId = z.string().trim().min(1).max(64);

/**
 * Etykieta załącznika dla agenta: Z{ordinal}. Numer jest stały w obrębie projektu i nigdy nie jest używany ponownie
 * (licznik Project.attachmentSeq), więc stare odczyty w historii czatu wskazują zawsze ten sam załącznik.
 */
export function attachmentLabel(ordinal: number): string {
  return `Z${ordinal}`;
}

const LABEL_PATTERN = /^[Zz]([1-9]\d{0,8})$/;

/** Zwraca numer z etykiety (np. „Z3” → 3) albo null, gdy tekst nie jest etykietą. */
export function parseAttachmentLabel(value: string): number | null {
  const match = LABEL_PATTERN.exec(value.trim());
  return match ? Number(match[1]) : null;
}

// Widok załącznika (lista, interfejs): bez treści i bez klucza magazynu.
export const AttachmentView = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().min(1),
  fileName: z.string().min(1),
  kind: AttachmentKind,
  sizeBytes: z.number().int().min(1),
  textChars: z.number().int().min(0),
  truncated: z.boolean(),
  createdAt: z.date(),
});
export type AttachmentView = z.infer<typeof AttachmentView>;

export type AttachmentWithText = AttachmentView & { extractedText: string };

// Wejście zapisu załącznika. Wywołujący (route handler) ekstrahuje tekst i generuje klucz magazynu; tu tylko kształt.
export const CreateAttachmentInput = z.object({
  projectId: z.string().min(1),
  createdById: z.string().min(1).nullable(),
  fileName: AttachmentFileName,
  kind: AttachmentKind,
  sizeBytes: z.number().int().min(1).max(ATTACHMENT_SIZE_HARD_MAX_BYTES),
  storageKey: z.string().regex(STORAGE_KEY_PATTERN, { error: "Niepoprawny klucz magazynu." }),
  extractedText: z
    .string()
    .refine((value) => value.trim().length > 0, { error: "Tekst załącznika nie może być pusty." })
    // Postgres nie przyjmuje znaku NUL w tekście; ekstraktor go usuwa, a tu pilnujemy to jawnie.
    .refine((value) => !value.includes("\u0000"), { error: "Tekst załącznika zawiera znak NUL." }),
  truncated: z.boolean(),
});
export type CreateAttachmentInput = z.input<typeof CreateAttachmentInput>;

// Argumenty narzędzia read_attachment widziane przez model (krok 7d): etykieta z listy i opcjonalne przesunięcie.
// Pole opcjonalne jest .nullish() (lekcja #35 i #37), a reguły sprawdza execute narzędzia.
export const ReadAttachmentToolInput = z.object({
  attachmentId: z.string().trim().min(1).max(20).describe("Etykieta załącznika z listy w kontekście (np. Z1)."),
  offset: z
    .number()
    .int()
    .min(0)
    .max(READ_OFFSET_MAX)
    .nullish()
    .describe("Od którego znaku czytać; pomiń przy pierwszym odczycie."),
});
export type ReadAttachmentToolInput = z.input<typeof ReadAttachmentToolInput>;

export const ReadAttachmentOutput = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    // Etykieta (Z{n}) i nazwa pliku: serwer weryfikuje po etykiecie, że załącznik został przeczytany (źródło propozycji).
    label: z.string(),
    name: z.string(),
    content: z.string(),
    totalChars: z.number().int().min(0),
    nextOffset: z.number().int().min(0).nullable(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ReadAttachmentOutput = z.infer<typeof ReadAttachmentOutput>;
