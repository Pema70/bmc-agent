"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadAiLimits } from "@/lib/ai/config";
import { requireProjectRole } from "@/lib/auth/permissions";
import { MAIN_VARIANT_CONFLICT_MESSAGE } from "@/lib/bmc/messages";
import { createVariant, getVariantProjectId, renameVariant, setMainVariant, type VariantListItem } from "@/lib/db/variants";
import { VariantId } from "@/lib/schemas/bmc";
import { CreateVariantInput, RenameVariantInput, SetMainVariantInput } from "@/lib/schemas/variant";

type ErrorCode = "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "LIMIT" | "CONFLICT" | "CONFIG";

export type VariantActionFailure = { ok: false; error: ErrorCode; message: string };
export type CreateVariantActionResult = { ok: true; variant: VariantListItem } | VariantActionFailure;
export type RenameVariantActionResult = { ok: true } | VariantActionFailure;
export type SetMainVariantActionResult = { ok: true; mainVariantId: string; changed: boolean } | VariantActionFailure;

const NOT_FOUND_MESSAGE = "Nie znaleziono tego wariantu w projekcie.";
const CONFIG_MESSAGE = "Aplikacja jest źle skonfigurowana. Sprawdź konfigurację serwera.";

function forbidden(message: string): VariantActionFailure {
  return { ok: false, error: "FORBIDDEN", message };
}

/** Zwraca identyfikator wariantu tylko wtedy, gdy należy do projektu, do którego sprawdziliśmy uprawnienia. */
async function variantInProject(projectId: string, variantId: string): Promise<string | null> {
  const parsed = VariantId.safeParse(variantId);
  if (!parsed.success) {
    return null;
  }
  return (await getVariantProjectId(parsed.data)) === projectId ? parsed.data : null;
}

/**
 * Kopia zapisanego wariantu (EDITOR+). Stan kopiowany jest z bazy, nie od klienta; nazwę nadaje serwer.
 * Kolejność: rola, wariant należy do projektu, Zod, operacja.
 */
export async function createVariantAction(projectId: string, sourceVariantId: string): Promise<CreateVariantActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return forbidden("Nie masz uprawnień do tworzenia wariantów w tym projekcie.");
  }

  const checkedId = await variantInProject(access.projectId, sourceVariantId);
  if (!checkedId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  const parsed = CreateVariantInput.safeParse({ sourceVariantId: checkedId });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: `Nie utworzono wariantu: ${z.prettifyError(parsed.error)}` };
  }

  let maxVariants: number;
  try {
    maxVariants = loadAiLimits().maxVariantsPerProject;
  } catch (error) {
    console.error("[warianty] Błędna konfiguracja limitów:", error instanceof Error ? error.message : "nieznany błąd");
    return { ok: false, error: "CONFIG", message: CONFIG_MESSAGE };
  }

  const result = await createVariant({
    projectId: access.projectId,
    sourceVariantId: parsed.data.sourceVariantId,
    createdById: access.session.user.id,
    maxVariants,
  });
  if (!result.ok) {
    return result.error === "LIMIT"
      ? {
          ok: false,
          error: "LIMIT",
          message: `Osiągnięto limit ${maxVariants} wariantów w projekcie. Usuwanie wariantów będzie dostępne w kolejnym kroku.`,
        }
      : { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, variant: result.variant };
}

/** Zmiana nazwy wariantu (EDITOR+). Nazwy nie muszą być unikalne. Nie zmienia `version`. */
export async function renameVariantAction(
  projectId: string,
  variantId: string,
  name: string,
): Promise<RenameVariantActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return forbidden("Nie masz uprawnień do zmiany nazwy wariantu w tym projekcie.");
  }

  const checkedId = await variantInProject(access.projectId, variantId);
  if (!checkedId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  const parsed = RenameVariantInput.safeParse({ variantId: checkedId, name });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: `Nie zmieniono nazwy: ${z.prettifyError(parsed.error)}` };
  }

  const result = await renameVariant(access.projectId, parsed.data.variantId, parsed.data.name);
  if (!result.ok) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true };
}

/**
 * Ustawienie wariantu głównego (OWNER). `expectedMainId` to główny, którego widział klient; niezgodność = konflikt.
 * Nie zmienia `version` ani stanu żadnego wariantu.
 */
export async function setMainVariantAction(
  projectId: string,
  variantId: string,
  expectedMainId: string | null,
): Promise<SetMainVariantActionResult> {
  const access = await requireProjectRole(projectId, "OWNER");
  if (!access.ok) {
    return forbidden("Tylko właściciel projektu może zmienić wariant główny.");
  }

  const checkedId = await variantInProject(access.projectId, variantId);
  if (!checkedId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  const parsed = SetMainVariantInput.safeParse({ variantId: checkedId, expectedMainId });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: `Nie zmieniono wariantu głównego: ${z.prettifyError(parsed.error)}` };
  }

  const result = await setMainVariant(access.projectId, parsed.data.variantId, parsed.data.expectedMainId);
  if (!result.ok) {
    return result.error === "CONFLICT"
      ? { ok: false, error: "CONFLICT", message: MAIN_VARIANT_CONFLICT_MESSAGE }
      : { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, mainVariantId: result.mainVariantId, changed: result.changed };
}
