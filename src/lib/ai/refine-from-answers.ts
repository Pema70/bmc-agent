import { loadAiLimits } from "@/lib/ai/config";
import { isEvaluable } from "@/lib/ai/evaluate";
import { REFINE_PROMPT_VERSION, buildRefinePrompt, buildRefineSystemPrompt } from "@/lib/ai/prompts/refine";
import { runObjectOperation, type ObjectOperationSpec } from "@/lib/ai/run-object-operation";
import { applyProposal } from "@/lib/bmc/proposals";
import { getEvaluation } from "@/lib/db/evaluations";
import { getProject } from "@/lib/db/projects";
import { countPendingProposals } from "@/lib/db/proposals";
import { getRoundForRefine, saveAnswersAndProposals, type RoundForRefine } from "@/lib/db/refinement";
import { getVariantForProject } from "@/lib/db/variants";
import type { BmcState } from "@/lib/schemas/bmc";
import type { EvaluationView } from "@/lib/schemas/evaluation";
import {
  ANSWER_MAX_CHARS,
  REFINE_PROPOSALS_MAX,
  RefineOutput,
  RefinementAnswers,
  sortRefineProposals,
  type RefinementQuestion,
} from "@/lib/schemas/refinement";

export const REFINE_FROM_ANSWERS_OPERATION = "refine_from_answers";

export type RunRefineFromAnswersContext = {
  projectId: string;
  variantId: string;
  userId: string;
  roundId: string;
  // Zapisana wersja wariantu widziana przez klienta (D21).
  expectedVersion: number;
  // Odpowiedzi z interfejsu (niezaufane): walidowane tu przez RefinementAnswers.
  answers: unknown;
  abortSignal?: AbortSignal;
};

export type RefineFromAnswersErrorCode =
  | "NOT_FOUND"
  | "LIMIT"
  | "TOO_EMPTY"
  | "CONFIG"
  | "SCHEMA"
  | "PROVIDER"
  | "SAVE_FAILED"
  | "VALIDATION"
  | "VERSION_CONFLICT"
  | "WRONG_STATE"
  | "PENDING_LIMIT";

export type RunRefineFromAnswersResult =
  | { ok: true; roundId: string; proposalIds: string[] }
  | { ok: false; error: RefineFromAnswersErrorCode; message: string; retryAfterSec?: number };

export const REFINE_NOT_FOUND_MESSAGE = "Nie znaleziono tej rundy poprawek w tym wariancie.";
export const REFINE_TOO_EMPTY_MESSAGE = "Model jest zbyt pusty, żeby przygotować poprawki. Dodaj więcej wpisów i zacznij nową rundę.";
export const REFINE_VALIDATION_MESSAGE = `Odpowiedz na co najmniej jedno pytanie (każda odpowiedź do ${ANSWER_MAX_CHARS} znaków).`;
export const REFINE_VERSION_CONFLICT_MESSAGE = "Model został zmieniony w międzyczasie. Odśwież stronę i spróbuj ponownie.";
export const REFINE_WRONG_STATE_MESSAGE = "Ta runda nie czeka już na odpowiedzi (odpowiedzi zostały wysłane albo runda jest zamknięta).";
export const REFINE_PENDING_LIMIT_MESSAGE = "Najpierw rozstrzygnij oczekujące propozycje: paczka poprawek mogłaby przekroczyć limit oczekujących propozycji.";
const CONFIG_MESSAGE = "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.";
const SCHEMA_MESSAGE = "Model zwrócił odpowiedź w niewłaściwym formacie, więc poprawki nie zostały zapisane. Spróbuj ponownie.";
// Model odpowiedział (zużył zapytanie z limitu), więc ponowienie liczy się do limitów.
export const REFINE_SAVE_FAILED_MESSAGE = "Model odpowiedział, ale nie udało się zapisać poprawek. Spróbuj ponownie";

/**
 * Pusta paczka jest poprawnym wynikiem (odpowiedzi bez podstaw do zmian). Reguła kontekstowa paczki (bez cichego filtrowania): każda propozycja dotyczy pytania z rundy, na które użytkownik
 * odpowiedział, a cała paczka po posortowaniu po numerze pytania stosuje się po kolei na bieżącym stanie. Zwraca opis
 * naruszenia albo null. Czysta funkcja.
 */
export function findRefineViolation(
  output: RefineOutput,
  state: BmcState,
  questions: RefinementQuestion[],
  answers: string[],
): string | null {
  for (const proposal of output.proposals) {
    if (proposal.questionIndex >= questions.length) {
      return `Propozycja wskazuje nieistniejące pytanie ${proposal.questionIndex}.`;
    }
    if (!answers[proposal.questionIndex]?.trim()) {
      return `Propozycja dotyczy pytania ${proposal.questionIndex}, na które nie odpowiedziano.`;
    }
  }
  let working = state;
  for (const [index, proposal] of sortRefineProposals(output.proposals).entries()) {
    const applied = applyProposal(working, proposal);
    if (!applied.ok) {
      return `Propozycja ${index} nie stosuje się do modelu (${applied.error}).`;
    }
    working = applied.state;
  }
  return null;
}

type Loaded = {
  variant: NonNullable<Awaited<ReturnType<typeof getVariantForProject>>>;
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
  round: RoundForRefine;
  evaluation: EvaluationView;
};
// Stan i pytania są w `prepared`, bo hak validate nie widzi `loaded`.
type Prepared = { answers: string[]; maxPending: number; state: BmcState; questions: RefinementQuestion[] };
type PrepareError = "VALIDATION" | "WRONG_STATE" | "VERSION_CONFLICT" | "PENDING_LIMIT" | "CONFIG";
type Saved =
  | { ok: true; proposalIds: string[] }
  | { ok: false; error: "NOT_FOUND" | "WRONG_STATE" | "VERSION_CONFLICT" | "PENDING_LIMIT" };

// Przepływ jest we wspólnym helperze. Tu: walidacja odpowiedzi (dane od użytkownika), stan rundy i wersja, limit
// oczekujących przed modelem, reguła kontekstowa paczki (hak validate) i zapis w jednej transakcji.
const REFINE_SPEC: ObjectOperationSpec<
  RunRefineFromAnswersContext,
  Loaded,
  Prepared,
  RefineOutput,
  Saved,
  PrepareError
> = {
  tag: "poprawki",
  operation: REFINE_FROM_ANSWERS_OPERATION,
  promptVersion: REFINE_PROMPT_VERSION,
  schema: RefineOutput,
  schemaName: "bmc_refinement_proposals",
  schemaDescription: "Paczka od zera do ośmiu propozycji zmian wpisów BMC, każda powiązana z pytaniem z rundy (pusta, gdy odpowiedzi nie dają podstaw do zmian).",
  messages: {
    notFound: REFINE_NOT_FOUND_MESSAGE,
    tooEmpty: REFINE_TOO_EMPTY_MESSAGE,
    schema: SCHEMA_MESSAGE,
    config: CONFIG_MESSAGE,
    saveFailed: REFINE_SAVE_FAILED_MESSAGE,
    saveFailedLog: "Nie udało się zapisać poprawek rundy:",
  },
  maxOutputTokens: (limits) => limits.maxOutputTokensLong,
  load: async (ctx) => {
    const variant = await getVariantForProject(ctx.projectId, ctx.variantId);
    const project = variant ? await getProject(ctx.projectId) : null;
    const round = variant ? await getRoundForRefine(ctx.projectId, ctx.variantId, ctx.roundId) : null;
    if (!variant || !project || !round) {
      return null;
    }
    const evaluation = await getEvaluation(ctx.projectId, ctx.variantId, round.evaluationId);
    if (!evaluation?.ok) {
      throw new Error(`Nie można odczytać oceny ${round.evaluationId} rundy ${round.id}.`);
    }
    return { variant, project, round, evaluation: evaluation.evaluation };
  },
  prepare: async (ctx, { variant, round }) => {
    const answers = RefinementAnswers.safeParse(ctx.answers);
    if (!answers.success || answers.data.length > round.questions.length) {
      return { ok: false, error: "VALIDATION", message: REFINE_VALIDATION_MESSAGE };
    }
    if (round.status !== "AWAITING_ANSWERS") {
      return { ok: false, error: "WRONG_STATE", message: REFINE_WRONG_STATE_MESSAGE };
    }
    if (variant.version !== ctx.expectedVersion) {
      return { ok: false, error: "VERSION_CONFLICT", message: REFINE_VERSION_CONFLICT_MESSAGE };
    }
    let maxPending: number;
    try {
      maxPending = loadAiLimits().maxPendingProposals;
    } catch (error) {
      console.error("[poprawki] Błędna konfiguracja limitów:", error instanceof Error ? error.message : "nieznany błąd");
      return { ok: false, error: "CONFIG", message: CONFIG_MESSAGE };
    }
    // Cała paczka (do REFINE_PROPOSALS_MAX propozycji) musi się zmieścić w limicie oczekujących (D18).
    if ((await countPendingProposals(ctx.projectId, ctx.variantId)) + REFINE_PROPOSALS_MAX > maxPending) {
      return { ok: false, error: "PENDING_LIMIT", message: REFINE_PENDING_LIMIT_MESSAGE };
    }
    return { ok: true, prepared: { answers: answers.data, maxPending, state: variant.state, questions: round.questions } };
  },
  isSufficient: ({ variant }) => isEvaluable(variant.state),
  buildPrompt: ({ variant, project, round, evaluation }, { answers }) => ({
    system: buildRefineSystemPrompt(),
    prompt: buildRefinePrompt(project, variant.state, evaluation.result, round.questions, answers),
  }),
  validate: (output, { state, questions, answers }) => findRefineViolation(output, state, questions, answers) === null,
  save: async ({ ctx, loaded, prepared, output, llmCallLogId }) => {
    const saved = await saveAnswersAndProposals(
      {
        projectId: ctx.projectId,
        variantId: loaded.variant.id,
        roundId: loaded.round.id,
        userId: ctx.userId,
        expectedVersion: ctx.expectedVersion,
        answers: prepared.answers,
        refine: output,
        refinePromptVersion: REFINE_PROMPT_VERSION,
        refineLlmCallLogId: llmCallLogId,
      },
      prepared.maxPending,
    );
    if (saved.ok) {
      return { ok: true, proposalIds: saved.proposalIds };
    }
    switch (saved.error) {
      case "NOT_FOUND":
      case "WRONG_STATE":
      case "VERSION_CONFLICT":
        return { ok: false, error: saved.error };
      case "LIMIT":
        return { ok: false, error: "PENDING_LIMIT" };
      default:
        // INVALID i NOT_APPLICABLE po przejściu schematu i reguły kontekstowej oznaczają błąd po naszej stronie.
        throw new Error(`Zapis poprawek odrzucony: ${saved.error}`);
    }
  },
};

const SAVE_ERROR_MESSAGES: Record<Exclude<Saved, { ok: true }>["error"], string> = {
  NOT_FOUND: REFINE_NOT_FOUND_MESSAGE,
  WRONG_STATE: REFINE_WRONG_STATE_MESSAGE,
  VERSION_CONFLICT: REFINE_VERSION_CONFLICT_MESSAGE,
  PENDING_LIMIT: REFINE_PENDING_LIMIT_MESSAGE,
};

/**
 * „Przygotuj poprawki”: z odpowiedzi użytkownika powstaje paczka propozycji (źródło REFINEMENT) zapisana razem z odpowiedziami
 * i statusem rundy w jednej transakcji. Tylko z interfejsu. Wywołujący sprawdza sesję i rolę EDITOR; tu runda jest czytana po
 * projectId i variantId. Odpowiedzi to dane, nie polecenia (do modelu tylko w bloku danych). Bez ponawiania po SCHEMA_ERROR.
 */
export async function runRefineFromAnswers(ctx: RunRefineFromAnswersContext): Promise<RunRefineFromAnswersResult> {
  const result = await runObjectOperation(REFINE_SPEC, ctx);
  if (!result.ok) {
    return result;
  }
  if (!result.value.ok) {
    return { ok: false, error: result.value.error, message: SAVE_ERROR_MESSAGES[result.value.error] };
  }
  return { ok: true, roundId: ctx.roundId, proposalIds: result.value.proposalIds };
}
