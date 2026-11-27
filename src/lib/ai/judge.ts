import { SAVE_FAILED_MESSAGE, TOO_EMPTY_MESSAGE, isEvaluable, type EvaluationErrorCode } from "@/lib/ai/evaluate";
import { JUDGE_PROMPT_VERSION, buildJudgePrompt, buildJudgeSystemPrompt } from "@/lib/ai/prompts/judge";
import { runObjectOperation, type ObjectOperationSpec } from "@/lib/ai/run-object-operation";
import { createEvaluation } from "@/lib/db/evaluations";
import { getVariantForProject } from "@/lib/db/variants";
import { EvaluationOutput, type EvaluationView } from "@/lib/schemas/evaluation";

export const JUDGE_OPERATION = "judge_bmc";

export type RunJudgeContext = {
  projectId: string;
  variantId: string;
  /** Użytkownik z sesji (UI) albo konto pomiarowe (SCRIPT); jego limity obowiązują jak przy ocenie. */
  userId: string;
  trigger: "UI" | "SCRIPT";
  abortSignal?: AbortSignal;
};

export type RunJudgeResult =
  | { ok: true; evaluation: EvaluationView }
  | { ok: false; error: EvaluationErrorCode; message: string; retryAfterSec?: number };

type Loaded = { variant: NonNullable<Awaited<ReturnType<typeof getVariantForProject>>> };

// Sędzia czyta wyłącznie wariant (stan BMC). Projekt (nazwa, opis) nie jest odczytywany, więc nie ma jak trafić do promptu.
const JUDGE_SPEC: ObjectOperationSpec<RunJudgeContext, Loaded, undefined, EvaluationOutput, EvaluationView, never> = {
  tag: "judge",
  modelName: "judge",
  operation: JUDGE_OPERATION,
  promptVersion: JUDGE_PROMPT_VERSION,
  schema: EvaluationOutput,
  schemaName: "bmc_judge_evaluation",
  schemaDescription: "Ocena modelu BMC: cztery kryteria, każde z oceną 1-10 i uzasadnieniem.",
  messages: {
    notFound: "Nie znaleziono tego wariantu w projekcie.",
    tooEmpty: TOO_EMPTY_MESSAGE,
    schema: "Sędzia zwrócił odpowiedź w niewłaściwym formacie, więc ocena nie została zapisana. Spróbuj ponownie.",
    config: "Sędzia jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.",
    saveFailed: SAVE_FAILED_MESSAGE,
    saveFailedLog: "Nie udało się zapisać oceny sędziego:",
  },
  load: async (ctx) => {
    const variant = await getVariantForProject(ctx.projectId, ctx.variantId);
    return variant ? { variant } : null;
  },
  prepare: async () => ({ ok: true, prepared: undefined }),
  isSufficient: ({ variant }) => isEvaluable(variant.state),
  buildPrompt: ({ variant }) => ({
    system: buildJudgeSystemPrompt(),
    prompt: buildJudgePrompt(variant.state),
  }),
  save: ({ ctx, loaded, output, resolved, llmCallLogId }) =>
    createEvaluation({
      projectId: ctx.projectId,
      variantId: loaded.variant.id,
      variantVersion: loaded.variant.version,
      stateSnapshot: loaded.variant.state,
      result: output,
      source: "JUDGE",
      trigger: ctx.trigger,
      provider: resolved.provider,
      model: resolved.modelId,
      promptVersion: JUDGE_PROMPT_VERSION,
      llmCallLogId,
      createdById: ctx.userId,
    }),
};

/**
 * Niezależny agent oceniający (sędzia): ta sama rubryka i ten sam `EvaluationOutput` co `evaluate_bmc`, ale osobny model
 * (`judge`, inna rodzina niż modele generujące) i wejście wyłącznie ze stanu BMC. Wywołujący sprawdza sesję i rolę EDITOR
 * (UI) albo odpowiada za konto pomiarowe (SCRIPT) przed wywołaniem. Limity użytkownika liczą się jak przy ocenie.
 */
export async function runJudge(ctx: RunJudgeContext): Promise<RunJudgeResult> {
  const result = await runObjectOperation(JUDGE_SPEC, ctx);
  return result.ok ? { ok: true, evaluation: result.value } : result;
}
