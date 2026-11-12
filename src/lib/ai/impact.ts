import { NoObjectGeneratedError, Output, generateText } from "ai";
import {
  IMPACT_MIN_ENTRIES,
  IMPACT_MIN_NON_EMPTY_BLOCKS,
  loadAiLimits,
} from "@/lib/ai/config";
import { classifyLlmError } from "@/lib/ai/errors";
import { checkUserLimits } from "@/lib/ai/limits";
import { logLlmCall, type TokenUsage } from "@/lib/ai/log";
import { getChatModel } from "@/lib/ai/models";
import {
  IMPACT_PROMPT_VERSION,
  buildImpactPrompt,
  buildImpactSystemPrompt,
} from "@/lib/ai/prompts/impact";
import { createImpactAnalysis } from "@/lib/db/impact";
import { getProject } from "@/lib/db/projects";
import { getProposalInVariant } from "@/lib/db/proposals";
import { getVariantForProject } from "@/lib/db/variants";
import { APPLY_ERROR_MESSAGES, checkProposable } from "@/lib/bmc/proposals";
import { BLOCK_KEYS, countEntries, type BmcState } from "@/lib/schemas/bmc";
import {
  ImpactChange,
  ImpactChangeRequest,
  ImpactOutput,
  type ImpactView,
} from "@/lib/schemas/impact";

export const IMPACT_OPERATION = "analyze_impact";
const MAX_RETRIES = 2;

export type RunImpactContext = {
  projectId: string;
  variantId: string;
  userId: string;
  trigger: "UI" | "CHAT";
  change: ImpactChangeRequest;
  abortSignal?: AbortSignal;
};

export type ImpactErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "STALE_PROPOSAL"
  | "LIMIT"
  | "TOO_EMPTY"
  | "CONFIG"
  | "SCHEMA"
  | "PROVIDER"
  | "SAVE_FAILED";

export type RunImpactResult =
  | { ok: true; analysis: ImpactView }
  | { ok: false; error: ImpactErrorCode; message: string; retryAfterSec?: number };

export const IMPACT_TOO_EMPTY_MESSAGE = `Model jest jeszcze zbyt pusty do analizy wpływu. Dodaj co najmniej ${IMPACT_MIN_ENTRIES} wpisy w co najmniej ${IMPACT_MIN_NON_EMPTY_BLOCKS} blokach.`;
export const IMPACT_NOT_FOUND_MESSAGE = "Nie znaleziono tego wariantu lub oczekującej propozycji w projekcie.";
const VALIDATION_MESSAGE = "Nieprawidłowy opis zmiany.";
const CONFIG_MESSAGE = "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.";
const SCHEMA_MESSAGE = "Model zwrócił odpowiedź w niewłaściwym formacie, więc analiza nie została zapisana. Spróbuj ponownie.";
// Model odpowiedział (zużył zapytanie z limitu), więc ponowienie liczy się do limitów.
export const IMPACT_SAVE_FAILED_MESSAGE = "Model odpowiedział, ale nie udało się zapisać analizy. Spróbuj ponownie";

/** Czy model ma dość treści, żeby analiza wpływu miała sens (D7). Czysta funkcja. */
export function isImpactAnalyzable(state: BmcState): boolean {
  const nonEmptyBlocks = BLOCK_KEYS.filter((key) => state[key].length > 0).length;
  return countEntries(state) >= IMPACT_MIN_ENTRIES && nonEmptyBlocks >= IMPACT_MIN_NON_EMPTY_BLOCKS;
}

type ResolvedChange =
  | { ok: true; change: ImpactChange; proposalId: string | null }
  | { ok: false; error: "VALIDATION" | "NOT_FOUND" | "STALE_PROPOSAL"; message: string };

async function resolveChange(ctx: RunImpactContext, state: BmcState): Promise<ResolvedChange> {
  const request = ImpactChangeRequest.safeParse(ctx.change);
  if (!request.success) {
    return { ok: false, error: "VALIDATION", message: VALIDATION_MESSAGE };
  }

  if (request.data.kind === "DESCRIPTION") {
    const { blockKey, description } = request.data;
    return { ok: true, change: { kind: "DESCRIPTION", blockKey, description }, proposalId: null };
  }

  // Zmiana z propozycji pochodzi z bazy (wariant i projekt z kontekstu serwera), nie z tekstu klienta ani modelu.
  const proposal = await getProposalInVariant(ctx.projectId, ctx.variantId, request.data.proposalId);
  if (!proposal || proposal.status !== "PENDING") {
    return { ok: false, error: "NOT_FOUND", message: IMPACT_NOT_FOUND_MESSAGE };
  }
  // Te same reguły co przy akceptacji (checkProposable na aktualnym stanie): analizujemy tylko propozycję,
  // którą dałoby się teraz zastosować. Odrzucenie następuje przed limitami i modelem.
  const check = checkProposable(state, proposal);
  if (!check.ok) {
    return { ok: false, error: "STALE_PROPOSAL", message: APPLY_ERROR_MESSAGES[check.error] };
  }
  const change = ImpactChange.safeParse({
    kind: "PROPOSAL",
    blockKey: proposal.blockKey,
    operation: proposal.operation,
    before: proposal.before,
    after: proposal.after,
  });
  if (!change.success) {
    return { ok: false, error: "VALIDATION", message: VALIDATION_MESSAGE };
  }
  return { ok: true, change: change.data, proposalId: proposal.id };
}

/**
 * Jedyna funkcja analizy wpływu, wołana zarówno z interfejsu (Server Action), jak i z narzędzia czatu.
 * Wywołujący sprawdza sesję i rolę EDITOR przed wywołaniem; tu dodatkowo wariant i propozycja są czytane
 * po projectId i variantId. variantVersion i migawka stanu pochodzą z jednego odczytu wariantu,
 * wykonanego przed wywołaniem modelu, więc analizowany jest dokładnie ten stan.
 */
export async function runImpactAnalysis(ctx: RunImpactContext): Promise<RunImpactResult> {
  const variant = await getVariantForProject(ctx.projectId, ctx.variantId);
  const project = variant ? await getProject(ctx.projectId) : null;
  if (!variant || !project) {
    return { ok: false, error: "NOT_FOUND", message: IMPACT_NOT_FOUND_MESSAGE };
  }

  const resolvedChange = await resolveChange(ctx, variant.state);
  if (!resolvedChange.ok) {
    return { ok: false, error: resolvedChange.error, message: resolvedChange.message };
  }
  const { change, proposalId } = resolvedChange;

  let limits: ReturnType<typeof loadAiLimits>;
  try {
    limits = loadAiLimits();
  } catch (error) {
    console.error("[impact] Błędna konfiguracja limitów:", error instanceof Error ? error.message : "nieznany błąd");
    return { ok: false, error: "CONFIG", message: CONFIG_MESSAGE };
  }

  const limitCheck = await checkUserLimits(ctx.userId, new Date(), limits);
  if (!limitCheck.ok) {
    return { ok: false, error: "LIMIT", message: limitCheck.message, retryAfterSec: limitCheck.retryAfterSec };
  }

  if (!isImpactAnalyzable(variant.state)) {
    return { ok: false, error: "TOO_EMPTY", message: IMPACT_TOO_EMPTY_MESSAGE };
  }

  let resolved: ReturnType<typeof getChatModel>;
  try {
    resolved = getChatModel("chat");
  } catch (error) {
    console.error("[impact] Błędna konfiguracja modelu:", error instanceof Error ? error.message : "nieznany błąd");
    return { ok: false, error: "CONFIG", message: CONFIG_MESSAGE };
  }

  const startedAt = Date.now();
  const base = {
    projectId: ctx.projectId,
    userId: ctx.userId,
    operation: IMPACT_OPERATION,
    provider: resolved.provider,
    modelId: resolved.modelId,
    promptVersion: IMPACT_PROMPT_VERSION,
  };
  const duration = () => Date.now() - startedAt;

  let output: ImpactOutput;
  let usage: TokenUsage;
  try {
    const result = await generateText({
      model: resolved.model,
      system: buildImpactSystemPrompt(),
      prompt: buildImpactPrompt(project, variant.state, change),
      output: Output.object({
        schema: ImpactOutput,
        name: "bmc_impact_analysis",
        description: "Analiza wpływu zmiany w jednym bloku BMC na pozostałe bloki: podsumowanie i lista dotkniętych bloków.",
      }),
      maxOutputTokens: limits.maxOutputTokens,
      maxRetries: MAX_RETRIES,
      abortSignal: ctx.abortSignal,
    });
    usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };

    // Druga, jawna walidacja: do bazy trafia wyłącznie obiekt, który przeszedł nasz schemat,
    // a blok zmieniany nie może występować wśród dotkniętych (analiza dotyczy "pozostałych").
    const parsed = ImpactOutput.safeParse(result.output);
    if (!parsed.success || parsed.data.affected.some((item) => item.blockKey === change.blockKey)) {
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
    console.error("[impact] Błąd wywołania modelu:", classified.errorCode);
    await logLlmCall({ ...base, durationMs: duration(), status: classified.status, errorCode: classified.errorCode });
    return {
      ok: false,
      error: classified.kind === "CONFIG" ? "CONFIG" : "PROVIDER",
      message: classified.message,
    };
  }

  const llmCallLogId = await logLlmCall({ ...base, durationMs: duration(), usage, stepCount: 1, status: "OK" });

  try {
    const analysis = await createImpactAnalysis({
      projectId: ctx.projectId,
      variantId: variant.id,
      variantVersion: variant.version,
      stateSnapshot: variant.state,
      change,
      proposalId,
      result: output,
      trigger: ctx.trigger,
      provider: resolved.provider,
      model: resolved.modelId,
      promptVersion: IMPACT_PROMPT_VERSION,
      llmCallLogId,
      createdById: ctx.userId,
    });
    return { ok: true, analysis };
  } catch (error) {
    console.error("[impact] Nie udało się zapisać analizy:", error instanceof Error ? error.message : "nieznany błąd");
    return { ok: false, error: "SAVE_FAILED", message: IMPACT_SAVE_FAILED_MESSAGE };
  }
}
