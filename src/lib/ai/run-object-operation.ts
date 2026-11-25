import { NoObjectGeneratedError, Output, generateText } from "ai";
import type { ZodType } from "zod";
import { loadAiLimits, type AiLimits } from "@/lib/ai/config";
import { classifyLlmError } from "@/lib/ai/errors";
import { checkUserLimits } from "@/lib/ai/limits";
import { logLlmCall, type TokenUsage } from "@/lib/ai/log";
import { getChatModel, type LogicalModelName, type ResolvedModel } from "@/lib/ai/models";

const MAX_RETRIES = 2;

export type ObjectOperationContext = {
  projectId: string;
  userId: string;
  abortSignal?: AbortSignal;
};

export type ObjectOperationErrorCode =
  | "NOT_FOUND"
  | "LIMIT"
  | "TOO_EMPTY"
  | "CONFIG"
  | "SCHEMA"
  | "PROVIDER"
  | "SAVE_FAILED";

export type ObjectOperationResult<TSaved, TPrepareError extends string = never> =
  | { ok: true; value: TSaved }
  | { ok: false; error: ObjectOperationErrorCode | TPrepareError; message: string; retryAfterSec?: number };

export type PrepareResult<TPrepared, TPrepareError extends string> =
  | { ok: true; prepared: TPrepared }
  | { ok: false; error: TPrepareError; message: string };

export type ObjectOperationSpec<
  TCtx extends ObjectOperationContext,
  TLoaded,
  TPrepared,
  TOutput,
  TSaved,
  TPrepareError extends string,
> = {
  /** Prefiks wpisów w logu serwera, np. "evaluate". */
  tag: string;
  /** Nazwa logiczna modelu z `models.ts`; domyślnie `chat` (operacje dotychczasowe bez zmian). */
  modelName?: LogicalModelName;
  /** Wartość kolumn LlmCallLog.operation i promptVersion. */
  operation: string;
  promptVersion: string;
  schema: ZodType<TOutput>;
  schemaName: string;
  schemaDescription: string;
  messages: {
    notFound: string;
    tooEmpty: string;
    schema: string;
    config: string;
    saveFailed: string;
    /** Tekst wpisu w logu serwera przy błędzie zapisu, np. "Nie udało się zapisać oceny:". */
    saveFailedLog: string;
  };
  /** Limit tokenów wyjścia; domyślnie `limits.maxOutputTokens`. */
  maxOutputTokens?: (limits: AiLimits) => number;
  /** Odczyt danych (wariant, projekt itd.) po projectId i variantId; null = NOT_FOUND. */
  load: (ctx: TCtx) => Promise<TLoaded | null>;
  /** Krok po odczycie i przed limitami (np. rozwiązanie zmiany z propozycji); błąd kończy operację bez modelu. */
  prepare: (ctx: TCtx, loaded: TLoaded) => Promise<PrepareResult<TPrepared, TPrepareError>>;
  /** Czy dane mają dość treści, żeby wołać model (sprawdzane po limitach). */
  isSufficient: (loaded: TLoaded) => boolean;
  buildPrompt: (loaded: TLoaded, prepared: TPrepared) => { system: string; prompt: string };
  /** Dodatkowa reguła po przejściu schematu; false = SCHEMA_ERROR (bez cichego filtrowania). */
  validate?: (output: TOutput, prepared: TPrepared) => boolean;
  save: (args: {
    ctx: TCtx;
    loaded: TLoaded;
    prepared: TPrepared;
    output: TOutput;
    resolved: ResolvedModel;
    llmCallLogId: string | null;
  }) => Promise<TSaved>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "nieznany błąd";
}

/**
 * Wspólny przepływ operacji AI zwracającej obiekt według schematu Zod (ocena, analiza wpływu, kolejne w kroku 6):
 * odczyt → przygotowanie → limity → minimalna zawartość → model → walidacja → log → zapis.
 * Kolejność jest istotna: odczyt i przygotowanie nie zużywają limitów, a limit, zbyt pusty model i odrzucona zmiana
 * nigdy nie wołają modelu ani nie zapisują logu. Odpowiedź niezgodna ze schematem nie jest zapisywana.
 * Wywołujący sprawdza sesję i rolę przed wywołaniem.
 */
export async function runObjectOperation<
  TCtx extends ObjectOperationContext,
  TLoaded,
  TPrepared,
  TOutput,
  TSaved,
  TPrepareError extends string = never,
>(
  spec: ObjectOperationSpec<TCtx, TLoaded, TPrepared, TOutput, TSaved, TPrepareError>,
  ctx: TCtx,
): Promise<ObjectOperationResult<TSaved, TPrepareError>> {
  const loaded = await spec.load(ctx);
  if (!loaded) {
    return { ok: false, error: "NOT_FOUND", message: spec.messages.notFound };
  }

  const prep = await spec.prepare(ctx, loaded);
  if (!prep.ok) {
    return { ok: false, error: prep.error, message: prep.message };
  }
  const prepared = prep.prepared;

  let limits: AiLimits;
  try {
    limits = loadAiLimits();
  } catch (error) {
    console.error(`[${spec.tag}] Błędna konfiguracja limitów:`, errorMessage(error));
    return { ok: false, error: "CONFIG", message: spec.messages.config };
  }

  const limitCheck = await checkUserLimits(ctx.userId, new Date(), limits);
  if (!limitCheck.ok) {
    return { ok: false, error: "LIMIT", message: limitCheck.message, retryAfterSec: limitCheck.retryAfterSec };
  }

  if (!spec.isSufficient(loaded)) {
    return { ok: false, error: "TOO_EMPTY", message: spec.messages.tooEmpty };
  }

  let resolved: ResolvedModel;
  try {
    resolved = getChatModel(spec.modelName ?? "chat");
  } catch (error) {
    console.error(`[${spec.tag}] Błędna konfiguracja modelu:`, errorMessage(error));
    return { ok: false, error: "CONFIG", message: spec.messages.config };
  }

  const startedAt = Date.now();
  const base = {
    projectId: ctx.projectId,
    userId: ctx.userId,
    operation: spec.operation,
    provider: resolved.provider,
    modelId: resolved.modelId,
    promptVersion: spec.promptVersion,
  };
  const duration = () => Date.now() - startedAt;

  let output: TOutput;
  let usage: TokenUsage;
  try {
    const { system, prompt } = spec.buildPrompt(loaded, prepared);
    const result = await generateText({
      model: resolved.model,
      system,
      prompt,
      output: Output.object({
        schema: spec.schema,
        name: spec.schemaName,
        description: spec.schemaDescription,
      }),
      maxOutputTokens: spec.maxOutputTokens ? spec.maxOutputTokens(limits) : limits.maxOutputTokens,
      maxRetries: MAX_RETRIES,
      abortSignal: ctx.abortSignal,
    });
    usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };

    // Druga, jawna walidacja: do bazy trafia wyłącznie obiekt, który przeszedł nasz schemat i regułę kontekstową.
    const parsed = spec.schema.safeParse(result.output);
    if (!parsed.success || (spec.validate && !spec.validate(parsed.data, prepared))) {
      await logLlmCall({
        ...base,
        durationMs: duration(),
        usage,
        stepCount: 1,
        status: "SCHEMA_ERROR",
        errorCode: "INVALID_RESPONSE",
      });
      return { ok: false, error: "SCHEMA", message: spec.messages.schema };
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
      return { ok: false, error: "SCHEMA", message: spec.messages.schema };
    }

    const classified = classifyLlmError(error);
    console.error(`[${spec.tag}] Błąd wywołania modelu:`, classified.errorCode);
    await logLlmCall({ ...base, durationMs: duration(), status: classified.status, errorCode: classified.errorCode });
    return {
      ok: false,
      error: classified.kind === "CONFIG" ? "CONFIG" : "PROVIDER",
      message: classified.message,
    };
  }

  const llmCallLogId = await logLlmCall({ ...base, durationMs: duration(), usage, stepCount: 1, status: "OK" });

  try {
    const value = await spec.save({ ctx, loaded, prepared, output, resolved, llmCallLogId });
    return { ok: true, value };
  } catch (error) {
    console.error(`[${spec.tag}] ${spec.messages.saveFailedLog}`, errorMessage(error));
    return { ok: false, error: "SAVE_FAILED", message: spec.messages.saveFailed };
  }
}
