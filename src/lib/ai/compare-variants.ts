import {
  COMPARE_CONFIG_MESSAGE,
  COMPARE_NOT_FOUND_MESSAGE,
  COMPARE_SAVE_FAILED_MESSAGE,
  COMPARE_SCHEMA_MESSAGE,
  COMPARE_TOO_EMPTY_MESSAGE,
  COMPARE_VALIDATION_MESSAGE,
} from "@/lib/ai/compare-messages";
import { COMPARE_MIN_ENTRIES, COMPARE_MIN_NON_EMPTY_BLOCKS } from "@/lib/ai/config";
import {
  COMPARE_PROMPT_VERSION,
  buildComparePrompt,
  buildCompareSystemPrompt,
} from "@/lib/ai/prompts/compare";
import { runObjectOperation, type ObjectOperationSpec } from "@/lib/ai/run-object-operation";
import { createVariantComparison } from "@/lib/db/comparisons";
import { getProject } from "@/lib/db/projects";
import { getVariantsForCompare, type VariantForCompare } from "@/lib/db/variants";
import { BLOCK_KEYS, countEntries, type BmcState } from "@/lib/schemas/bmc";
import {
  COMPARE_LABELS,
  CompareOutput,
  CompareVariantIds,
  type CompareLabel,
  type VariantComparisonView,
} from "@/lib/schemas/compare";

export const COMPARE_VARIANTS_OPERATION = "compare_variants";

export type RunCompareVariantsContext = {
  projectId: string;
  // Identyfikatory 2-3 różnych wariantów projektu, w kolejności porównania (pierwszy to wariant odniesienia, etykieta A).
  variantIds: readonly string[];
  userId: string;
  trigger: "UI";
  abortSignal?: AbortSignal;
};

export type CompareVariantsErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "LIMIT"
  | "TOO_EMPTY"
  | "CONFIG"
  | "SCHEMA"
  | "PROVIDER"
  | "SAVE_FAILED";

export type RunCompareVariantsResult =
  | { ok: true; comparison: VariantComparisonView }
  | { ok: false; error: CompareVariantsErrorCode; message: string; retryAfterSec?: number };

/** Czy wariant ma dość treści, żeby jego porównanie miało sens. Czysta funkcja. */
export function isCompareVariantSufficient(state: BmcState): boolean {
  const nonEmptyBlocks = BLOCK_KEYS.filter((key) => state[key].length > 0).length;
  return countEntries(state) >= COMPARE_MIN_ENTRIES && nonEmptyBlocks >= COMPARE_MIN_NON_EMPTY_BLOCKS;
}

type LabeledVariant = VariantForCompare & { label: CompareLabel };
type Loaded = {
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
  variants: LabeledVariant[];
};
type Prepared = { labels: ReadonlySet<CompareLabel> };

// Przepływ (limity, model, walidacja, log, zapis) jest we wspólnym helperze. Tu: odczyt wielu wariantów jednym zapytaniem
// po projectId, etykiety nadawane przez serwer (model nie widzi identyfikatorów) i reguły kontekstowe odpowiedzi.
const COMPARE_SPEC: ObjectOperationSpec<
  RunCompareVariantsContext,
  Loaded,
  Prepared,
  CompareOutput,
  VariantComparisonView,
  never
> = {
  tag: "porownanie",
  operation: COMPARE_VARIANTS_OPERATION,
  promptVersion: COMPARE_PROMPT_VERSION,
  schema: CompareOutput,
  schemaName: "bmc_variant_comparison",
  schemaDescription:
    "Porównanie 2-3 wariantów modelu BMC: podsumowanie, uwagi do bloków, zalety i wady każdego wariantu oraz rekomendacja.",
  messages: {
    notFound: COMPARE_NOT_FOUND_MESSAGE,
    tooEmpty: COMPARE_TOO_EMPTY_MESSAGE,
    schema: COMPARE_SCHEMA_MESSAGE,
    config: COMPARE_CONFIG_MESSAGE,
    saveFailed: COMPARE_SAVE_FAILED_MESSAGE,
    saveFailedLog: "Nie udało się zapisać porównania:",
  },
  maxOutputTokens: (limits) => limits.maxOutputTokensLong,
  load: async (ctx) => {
    const found = await getVariantsForCompare(ctx.projectId, ctx.variantIds);
    if (found.length !== ctx.variantIds.length) {
      return null;
    }
    const project = await getProject(ctx.projectId);
    if (!project) {
      return null;
    }
    // Kolejność jak w żądaniu; etykiety A, B, C nadaje serwer.
    return { project, variants: found.map((variant, index) => ({ ...variant, label: COMPARE_LABELS[index] ?? "C" })) };
  },
  prepare: async (_ctx, { variants }) => ({ ok: true, prepared: { labels: new Set(variants.map((variant) => variant.label)) } }),
  isSufficient: ({ variants }) => variants.every((variant) => isCompareVariantSufficient(variant.state)),
  buildPrompt: ({ project, variants }) => ({
    system: buildCompareSystemPrompt(),
    prompt: buildComparePrompt(
      project,
      variants.map((variant) => ({
        label: variant.label,
        name: variant.name,
        description: variant.description,
        state: variant.state,
      })),
    ),
  }),
  // Zbiór etykiet w wyniku = zbiór wejściowy, a rekomendacja wskazuje jedną z nich albo nikogo (null).
  validate: (output, { labels }) => {
    const outputLabels = output.variants.map((variant) => variant.label);
    const sameSet = outputLabels.length === labels.size && outputLabels.every((label) => labels.has(label));
    const recommended = output.recommendation.label;
    return sameSet && (recommended === null || labels.has(recommended));
  },
  save: ({ ctx, loaded, output, resolved, llmCallLogId }) =>
    createVariantComparison({
      projectId: ctx.projectId,
      inputs: loaded.variants.map((variant) => ({
        label: variant.label,
        variantId: variant.id,
        name: variant.name,
        version: variant.version,
        state: variant.state,
      })),
      result: output,
      trigger: ctx.trigger,
      provider: resolved.provider,
      model: resolved.modelId,
      promptVersion: COMPARE_PROMPT_VERSION,
      llmCallLogId,
      createdById: ctx.userId,
    }),
};

/**
 * Jedyna funkcja porównania wariantów (z interfejsu; narzędzie czatu jest odłożone). Wywołujący sprawdza sesję i rolę
 * EDITOR przed wywołaniem. Porównuje ZAPISANE stany wariantów (czytane z bazy po projectId); blokada przy niezapisanych
 * zmianach płótna jest po stronie interfejsu. Model dostaje etykiety A/B/C zamiast identyfikatorów. Bez ponawiania po
 * SCHEMA_ERROR i bez temperatury.
 */
export async function runCompareVariants(ctx: RunCompareVariantsContext): Promise<RunCompareVariantsResult> {
  // Kształt żądania (2-3 różne id) sprawdzamy przed jakimkolwiek odczytem, limitami i modelem.
  const ids = CompareVariantIds.safeParse(ctx.variantIds);
  if (!ids.success) {
    return { ok: false, error: "VALIDATION", message: COMPARE_VALIDATION_MESSAGE };
  }
  const result = await runObjectOperation(COMPARE_SPEC, { ...ctx, variantIds: ids.data });
  return result.ok ? { ok: true, comparison: result.value } : result;
}
