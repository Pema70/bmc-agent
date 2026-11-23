import type { AttachmentLimits } from "@/lib/attachments/config";
import { detectKind, extractText } from "@/lib/attachments/extract";
import { newStorageKey, type AttachmentStorage } from "@/lib/attachments/storage";
import { countAttachments, createAttachment } from "@/lib/db/attachments";
import { normalizeFileName, type AttachmentView } from "@/lib/schemas/attachment";

/**
 * Przyjęcie jednego pliku: walidacja, typ po zawartości, ekstrakcja, zapis pliku w magazynie i rekordu w bazie.
 * Kolejność: nic nie jest zapisane, dopóki plik nie przejdzie wszystkich kontroli. Plik w magazynie powstaje tuż przed
 * rekordem, a gdy rekord się nie zapisze, usuwamy własny, świeżo zapisany plik (nie dane użytkownika).
 */

export type UploadErrorCode =
  | "EMPTY"
  | "INVALID_NAME"
  | "TOO_LARGE"
  | "LIMIT"
  | "UNSUPPORTED"
  | "MISMATCH"
  | "CORRUPT"
  | "NO_TEXT"
  | "ARCHIVE_TOO_LARGE"
  | "TIMEOUT"
  | "NOT_FOUND"
  | "CONFLICT";

export type UploadResult =
  | { ok: true; attachment: AttachmentView }
  | { ok: false; error: UploadErrorCode; message: string };

export function uploadMessages(limits: Pick<AttachmentLimits, "maxBytes" | "maxPerProject">): Record<"EMPTY" | "INVALID_NAME" | "TOO_LARGE" | "LIMIT" | "NOT_FOUND" | "CONFLICT", string> {
  return {
    EMPTY: "Plik jest pusty.",
    INVALID_NAME: "Nazwa pliku jest niepoprawna.",
    TOO_LARGE: `Plik jest za duży (najwyżej ${Math.floor(limits.maxBytes / (1024 * 1024))} MB).`,
    LIMIT: `Osiągnięto limit ${limits.maxPerProject} załączników w projekcie. Usuń któryś, żeby dodać kolejny.`,
    NOT_FOUND: "Nie znaleziono projektu.",
    CONFLICT: "Nie udało się zapisać załącznika. Spróbuj ponownie.",
  };
}

type UploadInput = {
  projectId: string;
  userId: string;
  fileName: string;
  bytes: Uint8Array;
};

export async function uploadAttachment(
  input: UploadInput,
  deps: { limits: AttachmentLimits; storage: AttachmentStorage },
): Promise<UploadResult> {
  const { limits, storage } = deps;
  const messages = uploadMessages(limits);
  const fail = (error: UploadErrorCode, message: string): UploadResult => ({ ok: false, error, message });

  const fileName = normalizeFileName(input.fileName);
  if (!fileName) {
    return fail("INVALID_NAME", messages.INVALID_NAME);
  }
  if (input.bytes.length === 0) {
    return fail("EMPTY", messages.EMPTY);
  }
  if (input.bytes.length > limits.maxBytes) {
    return fail("TOO_LARGE", messages.TOO_LARGE);
  }

  // Wczesne, tanie sprawdzenie limitu (przed kosztowną ekstrakcją). Rozstrzyga i tak transakcja w createAttachment.
  if ((await countAttachments(input.projectId)) >= limits.maxPerProject) {
    return fail("LIMIT", messages.LIMIT);
  }

  const detected = detectKind(input.bytes, fileName);
  if (!detected.ok) {
    return fail(detected.error, detected.message);
  }

  const extracted = await extractText({ kind: detected.kind, bytes: input.bytes, limits });
  if (!extracted.ok) {
    return fail(extracted.error, extracted.message);
  }

  const storageKey = newStorageKey();
  await storage.put(storageKey, input.bytes);

  let created: Awaited<ReturnType<typeof createAttachment>>;
  try {
    created = await createAttachment(
      {
        projectId: input.projectId,
        createdById: input.userId,
        fileName,
        kind: detected.kind,
        sizeBytes: input.bytes.length,
        storageKey,
        extractedText: extracted.text,
        truncated: extracted.truncated,
      },
      limits.maxPerProject,
    );
  } catch (error) {
    await removeOwnFile(storage, storageKey);
    throw error;
  }

  if (!created.ok) {
    await removeOwnFile(storage, storageKey);
    return fail(created.error, messages[created.error]);
  }
  return { ok: true, attachment: created.attachment };
}

async function removeOwnFile(storage: AttachmentStorage, key: string): Promise<void> {
  try {
    await storage.remove(key);
  } catch (error) {
    console.error("[zalaczniki] Nie udało się usunąć świeżo zapisanego pliku po nieudanym zapisie rekordu:", error instanceof Error ? error.message : "nieznany błąd");
  }
}
