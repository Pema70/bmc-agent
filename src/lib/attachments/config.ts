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
    storageDir: v.ATTACHMENTS_DIR,
  };
}
