"use server";

import { revalidatePath } from "next/cache";
import { loadAttachmentLimits } from "@/lib/attachments/config";
import { createFileSystemStorage } from "@/lib/attachments/storage";
import { requireProjectRole } from "@/lib/auth/permissions";
import { deleteAttachment } from "@/lib/db/attachments";
import { AttachmentId } from "@/lib/schemas/attachment";

export type DeleteAttachmentActionResult =
  | { ok: true }
  | { ok: false; error: "FORBIDDEN" | "VALIDATION" | "NOT_FOUND"; message: string };

/**
 * Usuwa załącznik. Wywoływane wyłącznie po dwuetapowym potwierdzeniu w interfejsie (usunięcie jest nieodwracalne).
 * Kolejność: rola EDITOR → Zod → rekord (zawsze po projectId z uprawnień) → plik w magazynie. Błąd usunięcia pliku
 * nie cofa usunięcia rekordu (jest logowany); numer Z{n} usuniętego załącznika nie wraca (licznik w projekcie).
 */
export async function deleteAttachmentAction(projectId: string, attachmentId: string): Promise<DeleteAttachmentActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: "Nie masz uprawnień do usuwania załączników w tym projekcie." };
  }

  const parsed = AttachmentId.safeParse(attachmentId);
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: "Nieprawidłowy identyfikator załącznika." };
  }

  const deleted = await deleteAttachment(access.projectId, parsed.data);
  if (!deleted.ok) {
    return { ok: false, error: "NOT_FOUND", message: "Nie znaleziono tego załącznika." };
  }

  try {
    await createFileSystemStorage(loadAttachmentLimits().storageDir).remove(deleted.storageKey);
  } catch (error) {
    console.error("[zalaczniki] Rekord usunięty, ale nie udało się usunąć pliku z magazynu:", error instanceof Error ? error.message : "nieznany błąd");
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true };
}
