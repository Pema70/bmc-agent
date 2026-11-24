import { EVALUATION_MIN_ENTRIES, EVALUATION_MIN_NON_EMPTY_BLOCKS } from "@/lib/ai/config";
import { isEvaluable } from "@/lib/ai/evaluate";
import {
  QUESTIONS_PROMPT_VERSION,
  buildQuestionsPrompt,
  buildQuestionsSystemPrompt,
} from "@/lib/ai/prompts/questions";
import { runObjectOperation, type ObjectOperationSpec } from "@/lib/ai/run-object-operation";
import { listEvaluationsForVariant } from "@/lib/db/evaluations";
import { getProject } from "@/lib/db/projects";
import { createRefinementRound, getRefinementGate } from "@/lib/db/refinement";
import { sanitizeQuestions } from "@/lib/refinement/suggestions";
import { getVariantForProject } from "@/lib/db/variants";
import type { EvaluationView } from "@/lib/schemas/evaluation";
import {
  MAX_REFINEMENT_ROUNDS,
  QuestionsOutput,
  type RefinementRoundView,
} from "@/lib/schemas/refinement";

export const GENERATE_QUESTIONS_OPERATION = "generate_questions";

export type RunGenerateQuestionsContext = {
  projectId: string;
  variantId: string;
  userId: string;
  // Zapisana wersja wariantu widziana przez klienta (D21): inna bieżąca wersja to VERSION_CONFLICT.
  expectedVersion: number;
  abortSignal?: AbortSignal;
};

export type GenerateQuestionsErrorCode =
  | "NOT_FOUND"
  | "LIMIT"
  | "TOO_EMPTY"
  | "CONFIG"
  | "SCHEMA"
  | "PROVIDER"
  | "SAVE_FAILED"
  | "VERSION_CONFLICT"
  | "STALE_EVALUATION"
  | "ROUNDS_LIMIT"
  | "ROUND_IN_PROGRESS";

export type RunGenerateQuestionsResult =
  | { ok: true; round: RefinementRoundView }
  | { ok: false; error: GenerateQuestionsErrorCode; message: string; retryAfterSec?: number };

export const QUESTIONS_NOT_FOUND_MESSAGE = "Nie znaleziono tego wariantu w projekcie.";
export const QUESTIONS_TOO_EMPTY_MESSAGE = `Model jest jeszcze zbyt pusty do cyklu poprawek. Dodaj co najmniej ${EVALUATION_MIN_ENTRIES} wpisów w co najmniej ${EVALUATION_MIN_NON_EMPTY_BLOCKS} blokach.`;
export const QUESTIONS_VERSION_CONFLICT_MESSAGE = "Model został zmieniony w międzyczasie. Odśwież stronę i spróbuj ponownie.";
export const QUESTIONS_STALE_EVALUATION_MESSAGE = "Najpierw oceń model: runda poprawek zaczyna się od aktualnej oceny.";
export const QUESTIONS_ROUNDS_LIMIT_MESSAGE = `Wykorzystano wszystkie ${MAX_REFINEMENT_ROUNDS} rundy poprawek tego wariantu. Dalsze zmiany wprowadzaj ręcznie.`;
export const QUESTIONS_ROUND_IN_PROGRESS_MESSAGE =
  "Poprzednia runda nie jest zakończona. Dokończ ją (odpowiedz na pytania lub rozstrzygnij propozycje) albo ją zamknij.";
const CONFIG_MESSAGE = "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.";
const SCHEMA_MESSAGE = "Model zwrócił odpowiedź w niewłaściwym formacie, więc pytania nie zostały zapisane. Spróbuj ponownie.";
// Model odpowiedział (zużył zapytanie z limitu), więc ponowienie liczy się do limitów.
export const QUESTIONS_SAVE_FAILED_MESSAGE = "Model odpowiedział, ale nie udało się zapisać pytań. Spróbuj ponownie";

type Loaded = {
  variant: NonNullable<Awaited<ReturnType<typeof getVariantForProject>>>;
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
  // Najnowsza zapisana ocena wariantu (null, gdy brak lub nie da się jej odczytać).
  evaluation: EvaluationView | null;
};
type Prepared = { evaluation: EvaluationView };
type PrepareError = "VERSION_CONFLICT" | "STALE_EVALUATION" | "ROUNDS_LIMIT" | "ROUND_IN_PROGRESS";
type Saved =
  | { ok: true; round: RefinementRoundView }
  | { ok: false; error: "NOT_FOUND" | "STALE_EVALUATION" | "ROUNDS_LIMIT" | "ROUND_IN_PROGRESS" };

// Przepływ (limity, model, walidacja, log, zapis) jest we wspólnym helperze. Tu: ocena początkowa wskazana przez serwer
// (najnowsza i aktualna dla wersji wariantu), limit rund przed wywołaniem modelu i zapis rundy.
const QUESTIONS_SPEC: ObjectOperationSpec<
  RunGenerateQuestionsContext,
  Loaded,
  Prepared,
  QuestionsOutput,
  Saved,
  PrepareError
> = {
  tag: "pytania",
  operation: GENERATE_QUESTIONS_OPERATION,
  promptVersion: QUESTIONS_PROMPT_VERSION,
  schema: QuestionsOutput,
  schemaName: "bmc_refinement_questions",
  schemaDescription: "Trzy do pięciu pytań do użytkownika, które pomogą poprawić najsłabsze miejsca modelu BMC.",
  messages: {
    notFound: QUESTIONS_NOT_FOUND_MESSAGE,
    tooEmpty: QUESTIONS_TOO_EMPTY_MESSAGE,
    schema: SCHEMA_MESSAGE,
    config: CONFIG_MESSAGE,
    saveFailed: QUESTIONS_SAVE_FAILED_MESSAGE,
    saveFailedLog: "Nie udało się zapisać rundy poprawek:",
  },
  load: async (ctx) => {
    const variant = await getVariantForProject(ctx.projectId, ctx.variantId);
    const project = variant ? await getProject(ctx.projectId) : null;
    if (!variant || !project) {
      return null;
    }
    const [latest] = await listEvaluationsForVariant(ctx.projectId, ctx.variantId, 1);
    return { variant, project, evaluation: latest?.ok ? latest.evaluation : null };
  },
  prepare: async (ctx, { variant, evaluation }) => {
    if (variant.version !== ctx.expectedVersion) {
      return { ok: false, error: "VERSION_CONFLICT", message: QUESTIONS_VERSION_CONFLICT_MESSAGE };
    }
    const gate = await getRefinementGate(ctx.projectId, ctx.variantId);
    if (gate.rounds >= MAX_REFINEMENT_ROUNDS) {
      return { ok: false, error: "ROUNDS_LIMIT", message: QUESTIONS_ROUNDS_LIMIT_MESSAGE };
    }
    if (gate.inProgress) {
      return { ok: false, error: "ROUND_IN_PROGRESS", message: QUESTIONS_ROUND_IN_PROGRESS_MESSAGE };
    }
    if (!evaluation || evaluation.variantVersion !== variant.version) {
      return { ok: false, error: "STALE_EVALUATION", message: QUESTIONS_STALE_EVALUATION_MESSAGE };
    }
    return { ok: true, prepared: { evaluation } };
  },
  isSufficient: ({ variant }) => isEvaluable(variant.state),
  buildPrompt: ({ variant, project }, { evaluation }) => ({
    system: buildQuestionsSystemPrompt(),
    prompt: buildQuestionsPrompt(project, variant.state, evaluation.result),
  }),
  save: async ({ ctx, loaded, prepared, output, resolved, llmCallLogId }) => {
    // Druga linia obrony po prompcie: usuwa niedozwolone podpowiedzi (heurystyka) i zapisuje liczniki w rundzie.
    const sanitized = sanitizeQuestions(output);
    const created = await createRefinementRound({
      projectId: ctx.projectId,
      variantId: loaded.variant.id,
      evaluationId: prepared.evaluation.id,
      variantVersion: loaded.variant.version,
      stateSnapshot: loaded.variant.state,
      questions: { ...sanitized.questions, suggestionsGuard: sanitized.guard },
      provider: resolved.provider,
      model: resolved.modelId,
      questionsPromptVersion: QUESTIONS_PROMPT_VERSION,
      questionsLlmCallLogId: llmCallLogId,
      createdById: ctx.userId,
    });
    if (!created.ok) {
      // Wyścig (druga karta zdążyła rozpocząć rundę lub oceny już nie ma): bez zapisu, powód dla użytkownika.
      return {
        ok: false,
        error:
          created.error === "LIMIT"
            ? "ROUNDS_LIMIT"
            : created.error === "ROUND_IN_PROGRESS"
              ? "ROUND_IN_PROGRESS"
              : created.error === "EVALUATION_NOT_FOUND"
                ? "STALE_EVALUATION"
                : "NOT_FOUND",
      };
    }
    return {
      ok: true,
      round: {
        id: created.roundId,
        roundNumber: created.roundNumber,
        status: "AWAITING_ANSWERS",
        evaluationId: prepared.evaluation.id,
        variantVersion: loaded.variant.version,
        questions: sanitized.questions.questions,
        answers: null,
        createdAt: created.createdAt,
      },
    };
  },
};

const SAVE_ERROR_MESSAGES: Record<Exclude<Saved, { ok: true }>["error"], string> = {
  NOT_FOUND: QUESTIONS_NOT_FOUND_MESSAGE,
  STALE_EVALUATION: QUESTIONS_STALE_EVALUATION_MESSAGE,
  ROUNDS_LIMIT: QUESTIONS_ROUNDS_LIMIT_MESSAGE,
  ROUND_IN_PROGRESS: QUESTIONS_ROUND_IN_PROGRESS_MESSAGE,
};

/**
 * Początek rundy poprawek: pytania na podstawie najnowszej zapisanej oceny wariantu (musi być aktualna dla bieżącej
 * wersji, D14), tylko z interfejsu (nie jest narzędziem czatu). Wywołujący sprawdza sesję i rolę EDITOR; tu wariant jest
 * czytany po projectId i variantId, a stan, ocena i migawka pochodzą z jednego odczytu przed wywołaniem modelu.
 * Limit 3 rund i niedokończona runda są sprawdzane przed modelem (nie zużywają limitów).
 */
export async function runGenerateQuestions(ctx: RunGenerateQuestionsContext): Promise<RunGenerateQuestionsResult> {
  const result = await runObjectOperation(QUESTIONS_SPEC, ctx);
  if (!result.ok) {
    return result;
  }
  if (!result.value.ok) {
    return { ok: false, error: result.value.error, message: SAVE_ERROR_MESSAGES[result.value.error] };
  }
  return { ok: true, round: result.value.round };
}
