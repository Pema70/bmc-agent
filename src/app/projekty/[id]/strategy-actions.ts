"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadAiLimits } from "@/lib/ai/config";
import { runGenerateStrategies, type GenerateStrategiesErrorCode } from "@/lib/ai/generate-strategies";
import { requireProjectRole } from "@/lib/auth/permissions";
import { getStrategyGeneration, saveStrategyAsVariant, type StrategyListItem } from "@/lib/db/strategies";
import { getVariantProjectId, type VariantListItem } from "@/lib/db/variants";
import { VariantId } from "@/lib/schemas/bmc";
import {
  GenerateStrategiesInput,
  SaveStrategyInput,
  StrategyGenerationId,
  type StrategyGenerationView,
} from "@/lib/schemas/strategy";

type ActionError = GenerateStrategiesErrorCode | "FORBIDDEN";

export type GenerateStrategiesActionResult =
  | { ok: true; generation: StrategyGenerationView }
  | { ok: false; error: ActionError; message: string; retryAfterSec?: number };

type SaveErrorCode = "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "LIMIT" | "CONFIG" | "INVALID_GENERATION";

export type SaveStrategyActionResult =
  | { ok: true; variant: VariantListItem }
  | { ok: false; error: SaveErrorCode; message: string }
  | { ok: false; error: "ALREADY_SAVED"; message: string; variantId: string };

export type GetStrategyGenerationActionResult =
  | { ok: true; item: StrategyListItem }
  | { ok: false; error: "FORBIDDEN" | "VALIDATION" | "NOT_FOUND"; message: string };

const FORBIDDEN_MESSAGE = "Nie masz uprawnień do generowania strategii w tym projekcie.";
const NOT_FOUND_MESSAGE = "Nie znaleziono tego wariantu w projekcie.";
const CONFIG_MESSAGE = "Aplikacja jest źle skonfigurowana. Sprawdź konfigurację serwera.";

/** Zwraca identyfikator wariantu tylko wtedy, gdy należy do projektu, do którego sprawdziliśmy uprawnienia. */
async function variantInProject(projectId: string, variantId: string): Promise<string | null> {
  const parsed = VariantId.safeParse(variantId);
  if (!parsed.success) {
    return null;
  }
  return (await getVariantProjectId(parsed.data)) === projectId ? parsed.data : null;
}

/**
 * Generowanie strategii dla zapisanego stanu wariantu (EDITOR+). Kolejność: rola (ok: false przed jakimkolwiek odczytem),
 * wariant należy do projektu, Zod, dopiero potem limity i model (w runGenerateStrategies). Wynik to kandydaci,
 * nie warianty.
 */
export async function generateStrategiesAction(
  projectId: string,
  variantId: string,
  guidelines?: unknown,
): Promise<GenerateStrategiesActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }

  const checkedId = await variantInProject(access.projectId, variantId);
  if (!checkedId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  const parsed = GenerateStrategiesInput.safeParse({ guidelines });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: `Nie wygenerowano strategii: ${z.prettifyError(parsed.error)}` };
  }

  const result = await runGenerateStrategies({
    projectId: access.projectId,
    variantId: checkedId,
    userId: access.session.user.id,
    trigger: "UI",
    guidelines: parsed.data.guidelines,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, message: result.message, retryAfterSec: result.retryAfterSec };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, generation: result.generation };
}

/**
 * Zapis kandydata jako wariantu (EDITOR+). Stan i założenie czyta serwer z zapisanej generacji, nie od klienta.
 * Kolejność: rola, wariant bazowy należy do projektu, Zod, operacja.
 */
export async function saveStrategyAsVariantAction(
  projectId: string,
  variantId: string,
  generationId: string,
  index: number,
): Promise<SaveStrategyActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: "Nie masz uprawnień do zapisywania wariantów w tym projekcie." };
  }

  const checkedId = await variantInProject(access.projectId, variantId);
  if (!checkedId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  const parsed = SaveStrategyInput.safeParse({ variantId: checkedId, generationId, index });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: `Nie zapisano strategii: ${z.prettifyError(parsed.error)}` };
  }

  let maxVariants: number;
  try {
    maxVariants = loadAiLimits().maxVariantsPerProject;
  } catch (error) {
    console.error("[strategie] Błędna konfiguracja limitów:", error instanceof Error ? error.message : "nieznany błąd");
    return { ok: false, error: "CONFIG", message: CONFIG_MESSAGE };
  }

  const result = await saveStrategyAsVariant({
    projectId: access.projectId,
    variantId: parsed.data.variantId,
    generationId: parsed.data.generationId,
    index: parsed.data.index,
    userId: access.session.user.id,
    maxVariants,
  });
  if (!result.ok) {
    switch (result.error) {
      case "ALREADY_SAVED":
        return {
          ok: false,
          error: "ALREADY_SAVED",
          message: "Ta strategia została już zapisana jako wariant.",
          variantId: result.variantId,
        };
      case "LIMIT":
        return {
          ok: false,
          error: "LIMIT",
          message: `Osiągnięto limit ${maxVariants} wariantów w projekcie. Usuwanie wariantów będzie dostępne w kolejnym kroku.`,
        };
      case "INVALID_GENERATION":
      case "INVALID_INDEX":
        return { ok: false, error: "INVALID_GENERATION", message: "Zapisane strategie są niepoprawne i nie można ich zapisać." };
      default:
        return { ok: false, error: "NOT_FOUND", message: "Nie znaleziono tych strategii w projekcie." };
    }
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, variant: result.variant };
}

/**
 * Odczyt jednej zapisanej generacji (VIEWER+). Rola przed jakimkolwiek odczytem; zapytanie zawsze z projectId
 * ORAZ variantId wariantu bazowego.
 */
export async function getStrategyGenerationAction(
  projectId: string,
  variantId: string,
  generationId: string,
): Promise<GetStrategyGenerationActionResult> {
  const access = await requireProjectRole(projectId, "VIEWER");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: "Nie masz uprawnień do tego projektu." };
  }
  const variant = VariantId.safeParse(variantId);
  const id = StrategyGenerationId.safeParse(generationId);
  if (!variant.success || !id.success) {
    return { ok: false, error: "VALIDATION", message: "Nieprawidłowy identyfikator strategii." };
  }
  const item = await getStrategyGeneration(access.projectId, variant.data, id.data);
  if (!item) {
    return { ok: false, error: "NOT_FOUND", message: "Nie znaleziono tych strategii." };
  }
  return { ok: true, item };
}
