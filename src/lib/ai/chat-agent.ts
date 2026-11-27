import {
  convertToModelMessages,
  hasToolCall,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  type UIMessageStreamOutcome,
} from "ai";
import type { loadAiLimits } from "@/lib/ai/config";
import { loadAttachmentLimits } from "@/lib/attachments/config";
import { classifyLlmError, toUserFacingError } from "@/lib/ai/errors";
import { checkUserLimits } from "@/lib/ai/limits";
import { logLlmCall, type TokenUsage } from "@/lib/ai/log";
import { getChatModel } from "@/lib/ai/models";
import { PROMPT_VERSION, buildSystemPrompt } from "@/lib/ai/prompts/system";
import { createChatTools } from "@/lib/ai/tools";
import {
  TRUNCATION_ERROR_CODE,
  TRUNCATION_NOTICE,
  dropIncompleteToolParts,
  withTruncationNotice,
} from "@/lib/ai/truncation";
import { listAttachmentsForProject } from "@/lib/db/attachments";
import { listChatMessages, newChatMessageId, saveChatMessage } from "@/lib/db/chat";
import { getProject } from "@/lib/db/projects";
import { getVariantForProject, getVariantMeta } from "@/lib/db/variants";
import { attachmentLabel } from "@/lib/schemas/attachment";
import { chatValidationTools, type ChatUIMessage } from "@/lib/schemas/chat";

const MAX_RETRIES = 2;

type AiLimits = ReturnType<typeof loadAiLimits>;
type ResolvedModel = ReturnType<typeof getChatModel>;
type Project = NonNullable<Awaited<ReturnType<typeof getProject>>>;
type Variant = NonNullable<Awaited<ReturnType<typeof getVariantForProject>>>;

export type PrepareChatTurnInput = {
  projectId: string;
  userId: string;
  variantId: string;
  message: string;
  limits: AiLimits;
};

/** Odmowa przed startem tury: route zamienia ją na odpowiedź HTTP (nic nie zostało zapisane poza tym, co opisuje kod). */
export type ChatTurnRejection = {
  ok: false;
  status: 404 | 409 | 429 | 500 | 503;
  error: "NOT_FOUND" | "VARIANT_NOT_MAIN" | "LIMIT" | "CONFIG";
  message: string;
  headers?: Record<string, string>;
};

/** Wszystko, czego potrzebuje tura po zapisie wiadomości użytkownika. */
export type ChatTurn = {
  projectId: string;
  userId: string;
  variant: Pick<Variant, "id" | "version" | "state">;
  project: Pick<Project, "name" | "description">;
  limits: AiLimits;
  resolved: ResolvedModel;
  attachmentList: { label: string; name: string; kind: string; textChars: number; truncated: boolean }[];
  attachmentReadMaxChars: number;
  messages: ChatUIMessage[];
  assistantId: ReturnType<typeof newChatMessageId>;
  startedAt: number;
};

function reject(
  status: ChatTurnRejection["status"],
  error: ChatTurnRejection["error"],
  message: string,
  headers?: Record<string, string>,
): ChatTurnRejection {
  return { ok: false, status, error, message, headers };
}

/**
 * Kroki 3 do 6 trasy czatu: wariant, wariant główny, limity użytkownika, konfiguracja modelu, projekt, historia,
 * załączniki i zapis wiadomości użytkownika. Kolejność odczytów i zapisów jest taka sama jak w trasie przed refaktoryzacją
 * (pilnują jej testy charakteryzujące w `route.test.ts`). Sesję, rolę i walidację żądania sprawdza wywołujący.
 */
export async function prepareChatTurn(input: PrepareChatTurnInput): Promise<{ ok: true; turn: ChatTurn } | ChatTurnRejection> {
  const { projectId, userId, limits } = input;

  // Wariant musi należeć do projektu, do którego sprawdzono uprawnienia.
  const variant = await getVariantForProject(projectId, input.variantId);
  if (!variant) {
    return reject(404, "NOT_FOUND", "Nie znaleziono tego wariantu w projekcie.");
  }

  // Czat działa tylko na wariancie głównym (D2); sprawdzenie przed limitami, żeby odrzucone żądanie niczego nie zużywało.
  const meta = await getVariantMeta(projectId, variant.id);
  if (!meta) {
    return reject(404, "NOT_FOUND", "Nie znaleziono tego wariantu w projekcie.");
  }
  if (!meta.isMain) {
    return reject(409, "VARIANT_NOT_MAIN", "Czat działa na wariancie głównym.");
  }

  const limitCheck = await checkUserLimits(userId, new Date(), limits);
  if (!limitCheck.ok) {
    return reject(429, "LIMIT", limitCheck.message, { "Retry-After": String(limitCheck.retryAfterSec) });
  }

  // Konfiguracja modelu przed zapisem wiadomości, żeby błąd konfiguracji nie zostawiał osieroconej wiadomości.
  let resolved: ResolvedModel;
  try {
    resolved = getChatModel("chat");
  } catch (error) {
    console.error("[chat] Błędna konfiguracja modelu:", error instanceof Error ? error.message : "nieznany błąd");
    return reject(503, "CONFIG", "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.");
  }

  const project = await getProject(projectId);
  if (!project) {
    return reject(404, "NOT_FOUND", "Nie znaleziono projektu.");
  }
  const history = await listChatMessages(projectId, limits.historyLimit);
  let attachmentLimits: ReturnType<typeof loadAttachmentLimits>;
  try {
    attachmentLimits = loadAttachmentLimits();
  } catch (error) {
    console.error("[chat] Błędna konfiguracja załączników:", error instanceof Error ? error.message : "nieznany błąd");
    return reject(500, "CONFIG", "Agent jest źle skonfigurowany. Sprawdź konfigurację serwera.");
  }
  // Lista załączników (bez treści) do kontekstu; etykieta Z{n}, nie id z bazy. Odczyt zawsze po projectId.
  const attachmentList = (await listAttachmentsForProject(projectId)).map((item) => ({
    label: attachmentLabel(item.ordinal),
    name: item.fileName,
    kind: item.kind,
    textChars: item.textChars,
    truncated: item.truncated,
  }));

  // Zapis wiadomości użytkownika z id nadanym przez serwer.
  const userMessageId = newChatMessageId();
  const userMessage: ChatUIMessage = {
    id: userMessageId,
    role: "user",
    parts: [{ type: "text", text: input.message }],
  };
  await saveChatMessage({ id: userMessageId, projectId, userId, role: "user", parts: userMessage.parts });

  return {
    ok: true,
    turn: {
      projectId,
      userId,
      variant: { id: variant.id, version: variant.version, state: variant.state },
      project: { name: project.name, description: project.description },
      limits,
      resolved,
      attachmentList,
      attachmentReadMaxChars: attachmentLimits.readMaxChars,
      messages: [...history, userMessage],
      assistantId: newChatMessageId(),
      startedAt: Date.now(),
    },
  };
}

/** Jak zakończyła się tura (wynik `finished`). `NO_END`: strumień zamknięty, a `onEnd` nigdy nie wystartowało. */
export type ChatTurnResult =
  | { status: "completed" }
  | { status: "truncated" }
  | { status: "failed"; errorCode: string }
  | { status: "aborted" }
  | { status: "save_failed" }
  | { status: "invalid_response" }
  | { status: "no_end" };

export type RunChatTurnResult = {
  /** Strumień UI do odczytu przez wywołującego (trasa odsyła go jako odpowiedź HTTP, skrypt czyta go do końca). */
  stream: ReadableStream;
  /**
   * Rozwiązuje się zawsze, nigdy nie odrzuca: po zakończeniu zapisu odpowiedzi i logu (zdarzenie `onEnd`) albo, gdy `onEnd`
   * nie wystartuje, po zamknięciu, błędzie lub anulowaniu strumienia (wynik `no_end`).
   */
  finished: Promise<ChatTurnResult>;
};

/**
 * Wywołanie modelu i obsługa strumienia: zapis odpowiedzi po walidacji, log wywołania, znacznik ucięcia. Wyjątek
 * w `createChatTools`, `convertToModelMessages` lub `streamText` odrzuca zwrócony Promise (nic nie wystartowało, więc nie
 * ma strumienia ani `finished` do czekania); trasa zamienia go na 500 tak jak wcześniej.
 */
export async function runChatTurn(turn: ChatTurn, options: { signal?: AbortSignal } = {}): Promise<RunChatTurnResult> {
  const { projectId, userId, resolved, assistantId, startedAt } = turn;

  const chatTools = createChatTools({
    projectId,
    variantId: turn.variant.id,
    userId,
    version: turn.variant.version,
    state: turn.variant.state,
    maxPending: turn.limits.maxPendingProposals,
    readMaxChars: turn.attachmentReadMaxChars,
  });
  const result = streamText({
    model: resolved.model,
    system: buildSystemPrompt(turn.project, turn.variant.state, turn.attachmentList),
    messages: await convertToModelMessages(turn.messages, { tools: chatTools }),
    tools: chatTools,
    stopWhen: [isStepCount(turn.limits.maxSteps), hasToolCall("ask_clarification")],
    maxOutputTokens: turn.limits.maxOutputTokens,
    maxRetries: MAX_RETRIES,
    abortSignal: options.signal,
  });

  let settle: (value: ChatTurnResult) => void = () => {};
  const finished = new Promise<ChatTurnResult>((resolve) => {
    settle = resolve;
  });
  let endStarted = false;

  async function readUsage(): Promise<{ usage?: TokenUsage; stepCount?: number }> {
    try {
      const [usage, steps] = await Promise.all([result.usage, result.steps]);
      return {
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
        },
        stepCount: steps.length,
      };
    } catch {
      return {};
    }
  }

  // Zapis odpowiedzi (po walidacji) i log wywołania.
  async function onEnd(outcome: UIMessageStreamOutcome, responseMessage: ChatUIMessage): Promise<ChatTurnResult> {
    const base = {
      projectId,
      userId,
      operation: "chat",
      provider: resolved.provider,
      modelId: resolved.modelId,
      promptVersion: PROMPT_VERSION,
      durationMs: Date.now() - startedAt,
    };
    const usage = await readUsage();

    if (outcome.status === "failed") {
      const classified = classifyLlmError(outcome.error);
      await logLlmCall({ ...base, ...usage, status: classified.status, errorCode: classified.errorCode });
      return { status: "failed", errorCode: classified.errorCode };
    }
    if (outcome.status !== "completed") {
      await logLlmCall({ ...base, ...usage, status: "ERROR", errorCode: "ABORTED" });
      return { status: "aborted" };
    }

    // Tura ucięta limitem długości: odpowiedź (ze znacznikiem) i tak zapisujemy, żeby wiadomość użytkownika nie została
    // bez odpowiedzi (agent odpowiadałby na nią drugi raz). Nieukończone wywołania narzędzi nie trafiają do historii.
    const truncated = truncation.wasTruncated();
    let parts = truncated ? dropIncompleteToolParts(responseMessage.parts) : responseMessage.parts;
    const validated = await safeValidateUIMessages<ChatUIMessage>({
      messages: [{ ...responseMessage, parts }],
      tools: chatValidationTools,
    });
    if (!validated.success) {
      if (!truncated) {
        console.error("[chat] Odpowiedź modelu niezgodna ze schematem, nie zapisano.");
        await logLlmCall({ ...base, ...usage, status: "SCHEMA_ERROR", errorCode: "INVALID_RESPONSE" });
        return { status: "invalid_response" };
      }
      console.error("[chat] Ucięta odpowiedź niezgodna ze schematem, zapisano sam znacznik.");
      parts = [{ type: "text", text: TRUNCATION_NOTICE }];
    }

    try {
      await saveChatMessage({ id: assistantId, projectId, userId: null, role: "assistant", parts });
      await logLlmCall(
        truncated
          ? { ...base, ...usage, status: "SCHEMA_ERROR", errorCode: TRUNCATION_ERROR_CODE }
          : { ...base, ...usage, status: "OK" },
      );
    } catch (error) {
      console.error("[chat] Nie udało się zapisać odpowiedzi:", error instanceof Error ? error.message : "nieznany błąd");
      await logLlmCall({ ...base, ...usage, status: "ERROR", errorCode: "SAVE_FAILED" });
      return { status: "save_failed" };
    }
    return truncated ? { status: "truncated" } : { status: "completed" };
  }

  const truncation = withTruncationNotice(result.stream, `${assistantId}-truncated`);
  const uiStream = toUIMessageStream({
    stream: truncation.stream,
    tools: chatTools,
    originalMessages: turn.messages,
    generateMessageId: () => assistantId,
    sendReasoning: false,
    onError: (error) => {
      console.error("[chat] Błąd wywołania modelu:", classifyLlmError(error).errorCode);
      return toUserFacingError(error);
    },
    onEnd: async ({ outcome, responseMessage }) => {
      endStarted = true;
      try {
        settle(await onEnd(outcome, responseMessage));
      } catch (error) {
        // Błąd zapisu logu nie może zostawić `finished` w zawieszeniu; wyjątek idzie dalej do AI SDK jak wcześniej.
        settle({ status: "failed", errorCode: "END_HANDLER" });
        throw error;
      }
    },
  });

  // Siatka bezpieczeństwa: gdy strumień się zamknie, zepsuje albo zostanie anulowany bez wywołania `onEnd`
  // (np. odbiorca zrezygnował przed końcem), `finished` i tak się rozwiąże.
  const settleWithoutEnd = () => {
    setTimeout(() => {
      if (!endStarted) settle({ status: "no_end" });
    }, 0);
  };
  const reader = uiStream.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          settleWithoutEnd();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        settleWithoutEnd();
      }
    },
    async cancel(reason) {
      settleWithoutEnd();
      await reader.cancel(reason);
    },
  });

  // Bez await: odpłyń strumień także po rozłączeniu klienta, żeby odpowiedź została zapisana.
  void result.consumeStream({ onError: () => {} });

  return { stream, finished };
}
