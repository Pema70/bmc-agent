import { STRATEGY_MIN_ENTRIES, STRATEGY_MIN_NON_EMPTY_BLOCKS } from "@/lib/ai/config";
import {
  STRATEGIES_PROMPT_VERSION,
  buildStrategiesPrompt,
  buildStrategiesSystemPrompt,
} from "@/lib/ai/prompts/strategies";
import { runObjectOperation, type ObjectOperationSpec } from "@/lib/ai/run-object-operation";
import { findStrategyViolation } from "@/lib/bmc/strategies";
import { createStrategyGeneration } from "@/lib/db/strategies";
import { getProject } from "@/lib/db/projects";
import { getVariantForProject } from "@/lib/db/variants";
import { BLOCK_KEYS, countEntries, type BmcState } from "@/lib/schemas/bmc";
import { StrategyGuidelines, type StrategyGenerationView } from "@/lib/schemas/strategy";
import { StrategiesOutput } from "@/lib/schemas/variant";

export const GENERATE_STRATEGIES_OPERATION = "generate_strategies";

export type RunGenerateStrategiesContext = {
  projectId: string;
  variantId: string;
  userId: string;
  trigger: "UI";
  guidelines?: string | null;
  abortSignal?: AbortSignal;
};

export type GenerateStrategiesErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "LIMIT"
  | "TOO_EMPTY"
  | "CONFIG"
  | "SCHEMA"
  | "PROVIDER"
  | "SAVE_FAILED";

export type RunGenerateStrategiesResult =
  | { ok: true; generation: StrategyGenerationView }
  | { ok: false; error: GenerateStrategiesErrorCode; message: string; retryAfterSec?: number };

export const STRATEGIES_NOT_FOUND_MESSAGE = "Nie znaleziono tego wariantu w projekcie.";
export const STRATEGIES_TOO_EMPTY_MESSAGE = `Model jest jeszcze zbyt pusty, żeby wygenerować strategie. Dodaj co najmniej ${STRATEGY_MIN_ENTRIES} wpisów w co najmniej ${STRATEGY_MIN_NON_EMPTY_BLOCKS} blokach.`;
export const STRATEGIES_VALIDATION_MESSAGE = "Nieprawidłowe wytyczne: tekst może mieć najwyżej 500 znaków.";
const CONFIG_MESSAGE = "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.";
const SCHEMA_MESSAGE = "Model zwrócił odpowiedź w niewłaściwym formacie, więc strategie nie zostały zapisane. Spróbuj ponownie.";
// Model odpowiedział (zużył zapytanie z limitu), więc ponowienie liczy się do limitów.
export const STRATEGIES_SAVE_FAILED_MESSAGE = "Model odpowiedział, ale nie udało się zapisać strategii. Spróbuj ponownie";

/** Czy wariant bazowy ma dość treści, żeby generowanie strategii miało sens. Czysta funkcja. */
export function isStrategyBaseSufficient(state: BmcState): boolean {
  const nonEmptyBlocks = BLOCK_KEYS.filter((key) => state[key].length > 0).length;
  return countEntries(state) >= STRATEGY_MIN_ENTRIES && nonEmptyBlocks >= STRATEGY_MIN_NON_EMPTY_BLOCKS;
}

type Loaded = {
  variant: NonNullable<Awaited<ReturnType<typeof getVariantForProject>>>;
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
};
type Prepared = { guidelines: string | null; baseState: BmcState };

// Przepływ (limity, model, walidacja, log, zapis) jest we wspólnym helperze. Tu: wytyczne jako dane, reguły kontekstowe
// odpowiedzi (hak validate) i zapis kandydatów. Strategie są dużym wyjściem, więc limit tokenów to LLM_MAX_OUTPUT_TOKENS_LONG.
const STRATEGIES_SPEC: ObjectOperationSpec<
  RunGenerateStrategiesContext,
  Loaded,
  Prepared,
  StrategiesOutput,
  StrategyGenerationView,
  "VALIDATION"
> = {
  tag: "strategie",
  operation: GENERATE_STRATEGIES_OPERATION,
  promptVersion: STRATEGIES_PROMPT_VERSION,
  schema: StrategiesOutput,
  schemaName: "bmc_strategies",
  schemaDescription: "Dwie do trzech alternatywnych strategii: nazwa, założenie i pełny model BMC każdej z nich.",
  messages: {
    notFound: STRATEGIES_NOT_FOUND_MESSAGE,
    tooEmpty: STRATEGIES_TOO_EMPTY_MESSAGE,
    schema: SCHEMA_MESSAGE,
    config: CONFIG_MESSAGE,
    saveFailed: STRATEGIES_SAVE_FAILED_MESSAGE,
    saveFailedLog: "Nie udało się zapisać strategii:",
  },
  maxOutputTokens: (limits) => limits.maxOutputTokensLong,
  load: async (ctx) => {
    const variant = await getVariantForProject(ctx.projectId, ctx.variantId);
    const project = variant ? await getProject(ctx.projectId) : null;
    return variant && project ? { variant, project } : null;
  },
  prepare: async (ctx, { variant }) => {
    const guidelines = StrategyGuidelines.safeParse(ctx.guidelines);
    if (!guidelines.success) {
      return { ok: false, error: "VALIDATION", message: STRATEGIES_VALIDATION_MESSAGE };
    }
    return { ok: true, prepared: { guidelines: guidelines.data, baseState: variant.state } };
  },
  isSufficient: ({ variant }) => isStrategyBaseSufficient(variant.state),
  buildPrompt: ({ variant, project }, { guidelines }) => ({
    system: buildStrategiesSystemPrompt(),
    prompt: buildStrategiesPrompt(project, variant.state, guidelines),
  }),
  validate: (output, { baseState }) => findStrategyViolation(output, baseState) === null,
  save: ({ ctx, loaded, prepared, output, resolved, llmCallLogId }) =>
    createStrategyGeneration({
      projectId: ctx.projectId,
      variantId: loaded.variant.id,
      variantVersion: loaded.variant.version,
      stateSnapshot: loaded.variant.state,
      guidelines: prepared.guidelines,
      result: output,
      trigger: ctx.trigger,
      provider: resolved.provider,
      model: resolved.modelId,
      promptVersion: STRATEGIES_PROMPT_VERSION,
      llmCallLogId,
      createdById: ctx.userId,
    }),
};

/**
 * Jedyna funkcja generowania strategii (z interfejsu; narzędzie czatu jest odłożone). Wywołujący sprawdza sesję
 * i rolę EDITOR przed wywołaniem; tu wariant jest czytany po projectId i variantId, a stan bazowy i migawka pochodzą
 * z jednego odczytu wykonanego przed wywołaniem modelu. Wynik to kandydaci (StrategyGeneration), a nie warianty:
 * wariant powstaje dopiero po zapisaniu kandydata przez użytkownika. Bez ponawiania po SCHEMA_ERROR i bez temperatury.
 */
export async function runGenerateStrategies(ctx: RunGenerateStrategiesContext): Promise<RunGenerateStrategiesResult> {
  const result = await runObjectOperation(STRATEGIES_SPEC, ctx);
  return result.ok ? { ok: true, generation: result.value } : result;
}
