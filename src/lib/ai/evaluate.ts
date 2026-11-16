import {
  EVALUATION_MIN_ENTRIES,
  EVALUATION_MIN_NON_EMPTY_BLOCKS,
} from "@/lib/ai/config";
import {
  EVALUATE_PROMPT_VERSION,
  buildEvaluatePrompt,
  buildEvaluateSystemPrompt,
} from "@/lib/ai/prompts/evaluate";
import { runObjectOperation, type ObjectOperationSpec } from "@/lib/ai/run-object-operation";
import { createEvaluation } from "@/lib/db/evaluations";
import { getProject } from "@/lib/db/projects";
import { getVariantForProject } from "@/lib/db/variants";
import { BLOCK_KEYS, countEntries, type BmcState } from "@/lib/schemas/bmc";
import { EvaluationOutput, type EvaluationView } from "@/lib/schemas/evaluation";

export const EVALUATE_OPERATION = "evaluate_bmc";

export type RunEvaluationContext = {
  projectId: string;
  variantId: string;
  userId: string;
  trigger: "UI" | "CHAT";
  abortSignal?: AbortSignal;
};

export type EvaluationErrorCode =
  | "NOT_FOUND"
  | "LIMIT"
  | "TOO_EMPTY"
  | "CONFIG"
  | "SCHEMA"
  | "PROVIDER"
  | "SAVE_FAILED";

export type RunEvaluationResult =
  | { ok: true; evaluation: EvaluationView }
  | { ok: false; error: EvaluationErrorCode; message: string; retryAfterSec?: number };

export const TOO_EMPTY_MESSAGE = `Model jest jeszcze zbyt pusty do oceny. Dodaj co najmniej ${EVALUATION_MIN_ENTRIES} wpisów w co najmniej ${EVALUATION_MIN_NON_EMPTY_BLOCKS} blokach.`;
const CONFIG_MESSAGE = "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.";
const SCHEMA_MESSAGE = "Model zwrócił odpowiedź w niewłaściwym formacie, więc ocena nie została zapisana. Spróbuj ponownie.";
// Model odpowiedział (zużył zapytanie z limitu), więc ponowienie liczy się do limitów.
export const SAVE_FAILED_MESSAGE = "Model odpowiedział, ale nie udało się zapisać oceny. Spróbuj ponownie";

/** Czy model ma dość treści, żeby ocena miała sens (D5). Czysta funkcja. */
export function isEvaluable(state: BmcState): boolean {
  const nonEmptyBlocks = BLOCK_KEYS.filter((key) => state[key].length > 0).length;
  return countEntries(state) >= EVALUATION_MIN_ENTRIES && nonEmptyBlocks >= EVALUATION_MIN_NON_EMPTY_BLOCKS;
}

type Loaded = {
  variant: NonNullable<Awaited<ReturnType<typeof getVariantForProject>>>;
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
};

// Przepływ (odczyt, limity, model, walidacja, log, zapis) jest we wspólnym helperze; tu zostaje to, co specyficzne dla oceny.
const EVALUATION_SPEC: ObjectOperationSpec<RunEvaluationContext, Loaded, undefined, EvaluationOutput, EvaluationView, never> = {
  tag: "evaluate",
  operation: EVALUATE_OPERATION,
  promptVersion: EVALUATE_PROMPT_VERSION,
  schema: EvaluationOutput,
  schemaName: "bmc_evaluation",
  schemaDescription: "Ocena modelu BMC: cztery kryteria, każde z oceną 1-10 i uzasadnieniem.",
  messages: {
    notFound: "Nie znaleziono tego wariantu w projekcie.",
    tooEmpty: TOO_EMPTY_MESSAGE,
    schema: SCHEMA_MESSAGE,
    config: CONFIG_MESSAGE,
    saveFailed: SAVE_FAILED_MESSAGE,
    saveFailedLog: "Nie udało się zapisać oceny:",
  },
  load: async (ctx) => {
    const variant = await getVariantForProject(ctx.projectId, ctx.variantId);
    const project = variant ? await getProject(ctx.projectId) : null;
    return variant && project ? { variant, project } : null;
  },
  prepare: async () => ({ ok: true, prepared: undefined }),
  isSufficient: ({ variant }) => isEvaluable(variant.state),
  buildPrompt: ({ variant, project }) => ({
    system: buildEvaluateSystemPrompt(),
    prompt: buildEvaluatePrompt(project, variant.state),
  }),
  save: ({ ctx, loaded, output, resolved, llmCallLogId }) =>
    createEvaluation({
      projectId: ctx.projectId,
      variantId: loaded.variant.id,
      variantVersion: loaded.variant.version,
      stateSnapshot: loaded.variant.state,
      result: output,
      trigger: ctx.trigger,
      provider: resolved.provider,
      model: resolved.modelId,
      promptVersion: EVALUATE_PROMPT_VERSION,
      llmCallLogId,
      createdById: ctx.userId,
    }),
};

/**
 * Jedyna funkcja oceny modelu, wołana zarówno z interfejsu (Server Action), jak i z narzędzia czatu.
 * Wywołujący sprawdza sesję i rolę EDITOR przed wywołaniem; tu dodatkowo wariant jest czytany
 * po projectId i variantId. variantVersion i migawka stanu pochodzą z jednego odczytu wariantu,
 * wykonanego przed wywołaniem modelu, więc oceniany jest dokładnie ten stan.
 */
export async function runEvaluation(ctx: RunEvaluationContext): Promise<RunEvaluationResult> {
  const result = await runObjectOperation(EVALUATION_SPEC, ctx);
  return result.ok ? { ok: true, evaluation: result.value } : result;
}
