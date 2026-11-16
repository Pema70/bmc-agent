import {
  IMPACT_MIN_ENTRIES,
  IMPACT_MIN_NON_EMPTY_BLOCKS,
} from "@/lib/ai/config";
import {
  IMPACT_PROMPT_VERSION,
  buildImpactPrompt,
  buildImpactSystemPrompt,
} from "@/lib/ai/prompts/impact";
import { runObjectOperation, type ObjectOperationSpec } from "@/lib/ai/run-object-operation";
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

type Loaded = {
  variant: NonNullable<Awaited<ReturnType<typeof getVariantForProject>>>;
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
};
type Prepared = { change: ImpactChange; proposalId: string | null };

// Przepływ (limity, model, walidacja, log, zapis) jest we wspólnym helperze; tu zostaje to, co specyficzne dla analizy:
// rozwiązanie zmiany (przed limitami) i reguła „blok zmieniany nie występuje wśród dotkniętych”.
const IMPACT_SPEC: ObjectOperationSpec<
  RunImpactContext,
  Loaded,
  Prepared,
  ImpactOutput,
  ImpactView,
  "VALIDATION" | "NOT_FOUND" | "STALE_PROPOSAL"
> = {
  tag: "impact",
  operation: IMPACT_OPERATION,
  promptVersion: IMPACT_PROMPT_VERSION,
  schema: ImpactOutput,
  schemaName: "bmc_impact_analysis",
  schemaDescription: "Analiza wpływu zmiany w jednym bloku BMC na pozostałe bloki: podsumowanie i lista dotkniętych bloków.",
  messages: {
    notFound: IMPACT_NOT_FOUND_MESSAGE,
    tooEmpty: IMPACT_TOO_EMPTY_MESSAGE,
    schema: SCHEMA_MESSAGE,
    config: CONFIG_MESSAGE,
    saveFailed: IMPACT_SAVE_FAILED_MESSAGE,
    saveFailedLog: "Nie udało się zapisać analizy:",
  },
  load: async (ctx) => {
    const variant = await getVariantForProject(ctx.projectId, ctx.variantId);
    const project = variant ? await getProject(ctx.projectId) : null;
    return variant && project ? { variant, project } : null;
  },
  prepare: async (ctx, { variant }) => {
    const resolvedChange = await resolveChange(ctx, variant.state);
    if (!resolvedChange.ok) {
      return { ok: false, error: resolvedChange.error, message: resolvedChange.message };
    }
    return { ok: true, prepared: { change: resolvedChange.change, proposalId: resolvedChange.proposalId } };
  },
  isSufficient: ({ variant }) => isImpactAnalyzable(variant.state),
  buildPrompt: ({ variant, project }, { change }) => ({
    system: buildImpactSystemPrompt(),
    prompt: buildImpactPrompt(project, variant.state, change),
  }),
  // Analiza dotyczy „pozostałych” bloków, więc blok zmieniany na liście dotkniętych to błąd odpowiedzi.
  validate: (output, { change }) => !output.affected.some((item) => item.blockKey === change.blockKey),
  save: ({ ctx, loaded, prepared, output, resolved, llmCallLogId }) =>
    createImpactAnalysis({
      projectId: ctx.projectId,
      variantId: loaded.variant.id,
      variantVersion: loaded.variant.version,
      stateSnapshot: loaded.variant.state,
      change: prepared.change,
      proposalId: prepared.proposalId,
      result: output,
      trigger: ctx.trigger,
      provider: resolved.provider,
      model: resolved.modelId,
      promptVersion: IMPACT_PROMPT_VERSION,
      llmCallLogId,
      createdById: ctx.userId,
    }),
};

/**
 * Jedyna funkcja analizy wpływu, wołana zarówno z interfejsu (Server Action), jak i z narzędzia czatu.
 * Wywołujący sprawdza sesję i rolę EDITOR przed wywołaniem; tu dodatkowo wariant i propozycja są czytane
 * po projectId i variantId. variantVersion i migawka stanu pochodzą z jednego odczytu wariantu,
 * wykonanego przed wywołaniem modelu, więc analizowany jest dokładnie ten stan.
 */
export async function runImpactAnalysis(ctx: RunImpactContext): Promise<RunImpactResult> {
  const result = await runObjectOperation(IMPACT_SPEC, ctx);
  return result.ok ? { ok: true, analysis: result.value } : result;
}
