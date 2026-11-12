"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runImpactAnalysis } from "@/lib/ai/impact";
import { FALLBACK_MESSAGES, impactErrorMessage, type AnalyzeImpactActionErrorCode } from "@/lib/ai/impact-messages";
import { requireProjectRole } from "@/lib/auth/permissions";
import { getImpactAnalysis, type ImpactListItem } from "@/lib/db/impact";
import { getVariantProjectId } from "@/lib/db/variants";
import { VariantId } from "@/lib/schemas/bmc";
import { ImpactChangeRequest, type ImpactView } from "@/lib/schemas/impact";

export type AnalyzeImpactActionResult =
  | { ok: true; analysis: ImpactView }
  | { ok: false; error: AnalyzeImpactActionErrorCode; message: string; retryAfterSec?: number };

export type GetImpactAnalysisActionResult =
  | { ok: true; item: ImpactListItem }
  | { ok: false; error: "FORBIDDEN" | "VALIDATION" | "NOT_FOUND"; message: string };

const AnalysisId = z.string().trim().min(1).max(64);

/**
 * Odczyt jednej zapisanej analizy (np. dla karty w czacie). Rola VIEWER przed jakimkolwiek odczytem;
 * zapytanie zawsze z projectId ORAZ variantId.
 */
export async function getImpactAnalysisAction(
  projectId: string,
  variantId: string,
  analysisId: string,
): Promise<GetImpactAnalysisActionResult> {
  const access = await requireProjectRole(projectId, "VIEWER");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: "Nie masz uprawnień do tego projektu." };
  }
  const variant = VariantId.safeParse(variantId);
  const id = AnalysisId.safeParse(analysisId);
  if (!variant.success || !id.success) {
    return { ok: false, error: "VALIDATION", message: "Nieprawidłowy identyfikator analizy." };
  }
  const item = await getImpactAnalysis(access.projectId, variant.data, id.data);
  if (!item) {
    return { ok: false, error: "NOT_FOUND", message: "Nie znaleziono tej analizy." };
  }
  return { ok: true, item };
}

/**
 * Analiza wpływu zmiany względem zapisanego stanu wariantu (nie tego, co jest w edytorze). Kolejność:
 * rola EDITOR (ok: false przed jakimkolwiek odczytem), kształt argumentów, przynależność wariantu do projektu,
 * dopiero potem propozycja (musi należeć do wariantu), limity i model (w runImpactAnalysis).
 */
export async function analyzeImpactAction(
  projectId: string,
  variantId: string,
  change: unknown,
): Promise<AnalyzeImpactActionResult> {
  // 1. Sesja i rola EDITOR. Brak sesji: przekierowanie, osoba spoza projektu: 404 (w requireProjectRole).
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: FALLBACK_MESSAGES.FORBIDDEN };
  }

  // 2. Walidacja wejścia.
  const variant = VariantId.safeParse(variantId);
  const request = ImpactChangeRequest.safeParse(change);
  if (!variant.success || !request.success) {
    return { ok: false, error: "VALIDATION", message: FALLBACK_MESSAGES.VALIDATION };
  }

  // 3. Wariant musi należeć do projektu, do którego sprawdziliśmy uprawnienia.
  if ((await getVariantProjectId(variant.data)) !== access.projectId) {
    return { ok: false, error: "NOT_FOUND", message: FALLBACK_MESSAGES.NOT_FOUND };
  }

  // 4. Propozycja (dla PROPOSAL), limity, model, walidacja odpowiedzi i zapis.
  const result = await runImpactAnalysis({
    projectId: access.projectId,
    variantId: variant.data,
    userId: access.session.user.id,
    trigger: "UI",
    change: request.data,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      message: impactErrorMessage(result.error, result.message),
      retryAfterSec: result.retryAfterSec,
    };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, analysis: result.analysis };
}
