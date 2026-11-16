"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runCompareVariants, type CompareVariantsErrorCode } from "@/lib/ai/compare-variants";
import {
  COMPARE_COMPARISON_NOT_FOUND_MESSAGE,
  COMPARE_FORBIDDEN_MESSAGE,
  COMPARE_INVALID_ID_MESSAGE,
  COMPARE_NOT_FOUND_MESSAGE,
  COMPARE_READ_FORBIDDEN_MESSAGE,
  COMPARE_VALIDATION_MESSAGE,
} from "@/lib/ai/compare-messages";
import { requireProjectRole } from "@/lib/auth/permissions";
import { getVariantComparison, type ComparisonItem } from "@/lib/db/comparisons";
import { getVariantProjectId } from "@/lib/db/variants";
import { VariantId } from "@/lib/schemas/bmc";
import { CompareVariantIds, VariantComparisonId, type VariantComparisonView } from "@/lib/schemas/compare";

export type CompareVariantsActionResult =
  | { ok: true; comparison: VariantComparisonView }
  | { ok: false; error: CompareVariantsErrorCode | "FORBIDDEN"; message: string; retryAfterSec?: number };

export type GetVariantComparisonActionResult =
  | { ok: true; item: ComparisonItem }
  | { ok: false; error: "FORBIDDEN" | "VALIDATION" | "NOT_FOUND"; message: string };

// Górny bezpiecznik rozmiaru listy przed odczytem przynależności (właściwy limit 2-3 egzekwuje CompareVariantIds).
const SHAPE_MAX_IDS = 10;

/**
 * Porównanie 2-3 wariantów (EDITOR+) na ich ZAPISANYCH stanach. Kolejność: rola (ok: false przed jakimkolwiek odczytem),
 * kształt listy identyfikatorów, wszystkie warianty należą do projektu, ścisły Zod (2-3 różne), dopiero potem limity
 * i model (w runCompareVariants). Blokada przy niezapisanych zmianach płótna jest po stronie interfejsu.
 */
export async function compareVariantsAction(projectId: string, variantIds: unknown): Promise<CompareVariantsActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: COMPARE_FORBIDDEN_MESSAGE };
  }

  const shape = z.array(VariantId).max(SHAPE_MAX_IDS).safeParse(variantIds);
  if (!shape.success) {
    return { ok: false, error: "VALIDATION", message: COMPARE_VALIDATION_MESSAGE };
  }
  const owners = await Promise.all(shape.data.map((id) => getVariantProjectId(id)));
  if (owners.some((owner) => owner !== access.projectId)) {
    return { ok: false, error: "NOT_FOUND", message: COMPARE_NOT_FOUND_MESSAGE };
  }

  const parsed = CompareVariantIds.safeParse(shape.data);
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: COMPARE_VALIDATION_MESSAGE };
  }

  const result = await runCompareVariants({
    projectId: access.projectId,
    variantIds: parsed.data,
    userId: access.session.user.id,
    trigger: "UI",
  });
  if (!result.ok) {
    return { ok: false, error: result.error, message: result.message, retryAfterSec: result.retryAfterSec };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, comparison: result.comparison };
}

/**
 * Odczyt jednego zapisanego porównania (VIEWER+). Rola przed jakimkolwiek odczytem; zapytanie po projectId (wyjątek od
 * reguły „projectId i variantId”: porównanie dotyczy wielu wariantów).
 */
export async function getVariantComparisonAction(
  projectId: string,
  comparisonId: string,
): Promise<GetVariantComparisonActionResult> {
  const access = await requireProjectRole(projectId, "VIEWER");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: COMPARE_READ_FORBIDDEN_MESSAGE };
  }
  const id = VariantComparisonId.safeParse(comparisonId);
  if (!id.success) {
    return { ok: false, error: "VALIDATION", message: COMPARE_INVALID_ID_MESSAGE };
  }
  const item = await getVariantComparison(access.projectId, id.data);
  if (!item) {
    return { ok: false, error: "NOT_FOUND", message: COMPARE_COMPARISON_NOT_FOUND_MESSAGE };
  }
  return { ok: true, item };
}
