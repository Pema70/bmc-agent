"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runEvaluation, type EvaluationErrorCode } from "@/lib/ai/evaluate";
import { requireProjectRole } from "@/lib/auth/permissions";
import { getEvaluation, type EvaluationListItem } from "@/lib/db/evaluations";
import { getVariantProjectId } from "@/lib/db/variants";
import { VariantId } from "@/lib/schemas/bmc";
import type { EvaluationView } from "@/lib/schemas/evaluation";

export type EvaluateActionErrorCode = EvaluationErrorCode | "FORBIDDEN" | "VALIDATION";

export type EvaluateModelActionResult =
  | { ok: true; evaluation: EvaluationView }
  | { ok: false; error: EvaluateActionErrorCode; message: string; retryAfterSec?: number };

const FORBIDDEN_MESSAGE = "Nie masz uprawnień do oceniania modelu w tym projekcie.";
const NOT_FOUND_MESSAGE = "Nie znaleziono tego wariantu w projekcie.";

export type GetEvaluationActionResult =
  | { ok: true; item: EvaluationListItem }
  | { ok: false; error: "FORBIDDEN" | "VALIDATION" | "NOT_FOUND"; message: string };

const EvaluationId = z.string().trim().min(1).max(64);

/**
 * Odczyt jednej zapisanej oceny dla karty w czacie (karta pokazuje dane z bazy, nie z tekstu modelu).
 * Rola VIEWER przed jakimkolwiek odczytem; zapytanie zawsze z projectId ORAZ variantId.
 */
export async function getEvaluationAction(
  projectId: string,
  variantId: string,
  evaluationId: string,
): Promise<GetEvaluationActionResult> {
  const access = await requireProjectRole(projectId, "VIEWER");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: "Nie masz uprawnień do tego projektu." };
  }
  const variant = VariantId.safeParse(variantId);
  const id = EvaluationId.safeParse(evaluationId);
  if (!variant.success || !id.success) {
    return { ok: false, error: "VALIDATION", message: "Nieprawidłowy identyfikator oceny." };
  }
  const item = await getEvaluation(access.projectId, variant.data, id.data);
  if (!item) {
    return { ok: false, error: "NOT_FOUND", message: "Nie znaleziono tej oceny." };
  }
  return { ok: true, item };
}

/**
 * Ocena zapisanego stanu wariantu (nie tego, co jest w edytorze). Kolejność:
 * rola EDITOR (ok: false przed jakimkolwiek odczytem), kształt argumentu, przynależność wariantu
 * do projektu, dopiero potem limity i model (w runEvaluation).
 */
export async function evaluateModelAction(projectId: string, variantId: string): Promise<EvaluateModelActionResult> {
  // 1. Sesja i rola EDITOR. Brak sesji: przekierowanie, osoba spoza projektu: 404 (w requireProjectRole).
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }

  // 2. Walidacja wejścia.
  const parsed = VariantId.safeParse(variantId);
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: `Nie oceniono: ${z.prettifyError(parsed.error)}` };
  }

  // 3. Wariant musi należeć do projektu, do którego sprawdziliśmy uprawnienia.
  if ((await getVariantProjectId(parsed.data)) !== access.projectId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  // 4. Limity, model, walidacja odpowiedzi i zapis.
  const result = await runEvaluation({
    projectId: access.projectId,
    variantId: parsed.data,
    userId: access.session.user.id,
    trigger: "UI",
  });
  if (!result.ok) {
    return { ok: false, error: result.error, message: result.message, retryAfterSec: result.retryAfterSec };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, evaluation: result.evaluation };
}
