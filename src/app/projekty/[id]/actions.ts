"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectRole } from "@/lib/auth/permissions";
import { VERSION_CONFLICT_MESSAGE } from "@/lib/bmc/messages";
import { getVariantProjectId, saveVariantState } from "@/lib/db/variants";
import { SaveCanvasInput, VariantId, type BmcState } from "@/lib/schemas/bmc";

export type SaveCanvasResult =
  | { ok: true; version: number; state: BmcState }
  | { ok: false; error: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "VERSION_CONFLICT"; message: string };

export async function saveCanvasAction(
  projectId: string,
  variantId: string,
  version: number,
  state: unknown,
): Promise<SaveCanvasResult> {
  // 1. Sesja i rola. Brak sesji: przekierowanie, osoba spoza projektu: 404 (w requireProjectRole).
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: "Nie masz uprawnień do edycji tego modelu." };
  }

  // 2. Wariant musi należeć do projektu, do którego sprawdziliśmy uprawnienia.
  const parsedVariantId = VariantId.safeParse(variantId);
  const variantProjectId = parsedVariantId.success ? await getVariantProjectId(parsedVariantId.data) : null;
  if (!parsedVariantId.success || variantProjectId !== access.projectId) {
    return { ok: false, error: "NOT_FOUND", message: "Nie znaleziono tego wariantu w projekcie." };
  }

  // 3. Walidacja wersji i stanu (limity D5 egzekwuje BmcState).
  const parsed = SaveCanvasInput.safeParse({ version, state });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: `Nie zapisano: ${z.prettifyError(parsed.error)}` };
  }

  // 4. Zapis z optymistycznym blokowaniem.
  const result = await saveVariantState(parsedVariantId.data, parsed.data.version, parsed.data.state);
  if (!result.ok) {
    return result.error === "VERSION_CONFLICT"
      ? { ok: false, error: "VERSION_CONFLICT", message: VERSION_CONFLICT_MESSAGE }
      : { ok: false, error: "VALIDATION", message: `Nie zapisano: ${result.message}` };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, version: result.version, state: parsed.data.state };
}
