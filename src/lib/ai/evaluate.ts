import { NoObjectGeneratedError, Output, generateText } from "ai";
import {
  EVALUATION_MIN_ENTRIES,
  EVALUATION_MIN_NON_EMPTY_BLOCKS,
  loadAiLimits,
} from "@/lib/ai/config";
import { classifyLlmError } from "@/lib/ai/errors";
import { checkUserLimits } from "@/lib/ai/limits";
import { logLlmCall, type TokenUsage } from "@/lib/ai/log";
import { getChatModel } from "@/lib/ai/models";
import {
  EVALUATE_PROMPT_VERSION,
  buildEvaluatePrompt,
  buildEvaluateSystemPrompt,
} from "@/lib/ai/prompts/evaluate";
import { createEvaluation } from "@/lib/db/evaluations";
import { getProject } from "@/lib/db/projects";
import { getVariantForProject } from "@/lib/db/variants";
import { BLOCK_KEYS, countEntries, type BmcState } from "@/lib/schemas/bmc";
import { EvaluationOutput, type EvaluationView } from "@/lib/schemas/evaluation";

export const EVALUATE_OPERATION = "evaluate_bmc";
const MAX_RETRIES = 2;

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

/**
 * Jedyna funkcja oceny modelu, wołana zarówno z interfejsu (Server Action), jak i z narzędzia czatu.
 * Wywołujący sprawdza sesję i rolę EDITOR przed wywołaniem; tu dodatkowo wariant jest czytany
 * po projectId i variantId. variantVersion i migawka stanu pochodzą z jednego odczytu wariantu,
 * wykonanego przed wywołaniem modelu, więc oceniany jest dokładnie ten stan.
 */
export async function runEvaluation(ctx: RunEvaluationContext): Promise<RunEvaluationResult> {
  const variant = await getVariantForProject(ctx.projectId, ctx.variantId);
  const project = variant ? await getProject(ctx.projectId) : null;
  if (!variant || !project) {
    return { ok: false, error: "NOT_FOUND", message: "Nie znaleziono tego wariantu w projekcie." };
  }

  let limits: ReturnType<typeof loadAiLimits>;
  try {
    limits = loadAiLimits();
  } catch (error) {
    console.error("[evaluate] Błędna konfiguracja limitów:", error instanceof Error ? error.message : "nieznany błąd");
    return { ok: false, error: "CONFIG", message: CONFIG_MESSAGE };
  }

  const limitCheck = await checkUserLimits(ctx.userId, new Date(), limits);
  if (!limitCheck.ok) {
    return { ok: false, error: "LIMIT", message: limitCheck.message, retryAfterSec: limitCheck.retryAfterSec };
  }

  if (!isEvaluable(variant.state)) {
    return { ok: false, error: "TOO_EMPTY", message: TOO_EMPTY_MESSAGE };
  }

  let resolved: ReturnType<typeof getChatModel>;
  try {
    resolved = getChatModel("chat");
  } catch (error) {
    console.error("[evaluate] Błędna konfiguracja modelu:", error instanceof Error ? error.message : "nieznany błąd");
    return { ok: false, error: "CONFIG", message: CONFIG_MESSAGE };
  }

  const startedAt = Date.now();
  const base = {
    projectId: ctx.projectId,
    userId: ctx.userId,
    operation: EVALUATE_OPERATION,
    provider: resolved.provider,
    modelId: resolved.modelId,
    promptVersion: EVALUATE_PROMPT_VERSION,
  };
  const duration = () => Date.now() - startedAt;

  let output: EvaluationOutput;
  let usage: TokenUsage;
  try {
    const result = await generateText({
      model: resolved.model,
      system: buildEvaluateSystemPrompt(),
      prompt: buildEvaluatePrompt(project, variant.state),
      output: Output.object({
        schema: EvaluationOutput,
        name: "bmc_evaluation",
        description: "Ocena modelu BMC: cztery kryteria, każde z oceną 1-10 i uzasadnieniem.",
      }),
      maxOutputTokens: limits.maxOutputTokens,
      maxRetries: MAX_RETRIES,
      abortSignal: ctx.abortSignal,
    });
    usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };

    // Druga, jawna walidacja: do bazy trafia wyłącznie obiekt, który przeszedł nasz schemat.
    const parsed = EvaluationOutput.safeParse(result.output);
    if (!parsed.success) {
      await logLlmCall({
        ...base,
        durationMs: duration(),
        usage,
        stepCount: 1,
        status: "SCHEMA_ERROR",
        errorCode: "INVALID_RESPONSE",
      });
      return { ok: false, error: "SCHEMA", message: SCHEMA_MESSAGE };
    }
    output = parsed.data;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      await logLlmCall({
        ...base,
        durationMs: duration(),
        usage: error.usage
          ? { inputTokens: error.usage.inputTokens, outputTokens: error.usage.outputTokens }
          : undefined,
        stepCount: 1,
        status: "SCHEMA_ERROR",
        // Odpowiedź ucięta limitem tokenów to inny problem niż zły format, więc liczymy je osobno.
        errorCode: error.finishReason === "length" ? "TRUNCATED" : "INVALID_RESPONSE",
      });
      return { ok: false, error: "SCHEMA", message: SCHEMA_MESSAGE };
    }

    const classified = classifyLlmError(error);
    console.error("[evaluate] Błąd wywołania modelu:", classified.errorCode);
    await logLlmCall({ ...base, durationMs: duration(), status: classified.status, errorCode: classified.errorCode });
    return {
      ok: false,
      error: classified.kind === "CONFIG" ? "CONFIG" : "PROVIDER",
      message: classified.message,
    };
  }

  const llmCallLogId = await logLlmCall({ ...base, durationMs: duration(), usage, stepCount: 1, status: "OK" });

  try {
    const evaluation = await createEvaluation({
      projectId: ctx.projectId,
      variantId: variant.id,
      variantVersion: variant.version,
      stateSnapshot: variant.state,
      result: output,
      trigger: ctx.trigger,
      provider: resolved.provider,
      model: resolved.modelId,
      promptVersion: EVALUATE_PROMPT_VERSION,
      llmCallLogId,
      createdById: ctx.userId,
    });
    return { ok: true, evaluation };
  } catch (error) {
    console.error("[evaluate] Nie udało się zapisać oceny:", error instanceof Error ? error.message : "nieznany błąd");
    return { ok: false, error: "SAVE_FAILED", message: SAVE_FAILED_MESSAGE };
  }
}
