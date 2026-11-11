import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  hasToolCall,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  type UIMessageStreamOutcome,
} from "ai";
import { z } from "zod";
import { loadAiLimits } from "@/lib/ai/config";
import { classifyLlmError, toUserFacingError } from "@/lib/ai/errors";
import { checkUserLimits } from "@/lib/ai/limits";
import { logLlmCall, type TokenUsage } from "@/lib/ai/log";
import { getChatModel } from "@/lib/ai/models";
import { PROMPT_VERSION, buildSystemPrompt } from "@/lib/ai/prompts/system";
import { chatTools } from "@/lib/ai/tools/ask-clarification";
import { getProjectAccess } from "@/lib/auth/permissions";
import { listChatMessages, newChatMessageId, saveChatMessage } from "@/lib/db/chat";
import { getProject } from "@/lib/db/projects";
import { getVariantForProject } from "@/lib/db/variants";
import { ClarificationInput, chatRequestSchema, type ChatUIMessage } from "@/lib/schemas/chat";

const MAX_RETRIES = 2;
const STREAM_VALIDATION_TOOLS = {
  ask_clarification: { inputSchema: ClarificationInput, outputSchema: ClarificationInput },
};

function jsonError(status: number, error: string, message: string, headers?: Record<string, string>): Response {
  return Response.json({ error, message }, { status, headers });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Najpierw sesja: niezalogowany dostaje 401 także przy zepsutym ciele żądania.
    const probe = await getProjectAccess(undefined, "EDITOR");
    if (!probe.ok && probe.error === "UNAUTHENTICATED") {
      return jsonError(401, "UNAUTHENTICATED", "Zaloguj się, aby rozmawiać z agentem.");
    }
    return jsonError(400, "BAD_REQUEST", "Nieprawidłowe żądanie.");
  }

  // 1. Sesja i rola EDITOR przed jakimkolwiek odczytem danych projektu.
  const rawProjectId = typeof body === "object" && body !== null ? Reflect.get(body, "projectId") : undefined;
  const access = await getProjectAccess(rawProjectId, "EDITOR");
  if (!access.ok) {
    if (access.error === "UNAUTHENTICATED") {
      return jsonError(401, "UNAUTHENTICATED", "Zaloguj się, aby rozmawiać z agentem.");
    }
    if (access.error === "FORBIDDEN") {
      return jsonError(403, "FORBIDDEN", "Nie masz uprawnień do rozmowy z agentem w tym projekcie.");
    }
    return jsonError(404, "NOT_FOUND", "Nie znaleziono projektu.");
  }
  const { projectId, session } = access;
  const userId = session.user.id;

  // 2. Walidacja żądania (strict: żadnych dodatkowych pól, w tym id wiadomości).
  let limits: ReturnType<typeof loadAiLimits>;
  try {
    limits = loadAiLimits();
  } catch (error) {
    console.error("[chat] Błędna konfiguracja limitów:", error instanceof Error ? error.message : "nieznany błąd");
    return jsonError(500, "CONFIG", "Agent jest źle skonfigurowany. Sprawdź konfigurację serwera.");
  }
  const parsed = chatRequestSchema(limits.maxMessageChars).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION", z.prettifyError(parsed.error));
  }
  const request = parsed.data;
  if (request.projectId !== projectId) {
    return jsonError(400, "VALIDATION", "Nieprawidłowe żądanie.");
  }

  // 3. Wariant musi należeć do projektu, do którego sprawdziliśmy uprawnienia.
  const variant = await getVariantForProject(projectId, request.variantId);
  if (!variant) {
    return jsonError(404, "NOT_FOUND", "Nie znaleziono tego wariantu w projekcie.");
  }

  // 4. Limity użytkownika.
  const limitCheck = await checkUserLimits(userId, new Date(), limits);
  if (!limitCheck.ok) {
    return jsonError(429, "LIMIT", limitCheck.message, { "Retry-After": String(limitCheck.retryAfterSec) });
  }

  // Konfiguracja modelu przed zapisem wiadomości, żeby błąd konfiguracji nie zostawiał osieroconej wiadomości.
  let resolved: ReturnType<typeof getChatModel>;
  try {
    resolved = getChatModel("chat");
  } catch (error) {
    console.error("[chat] Błędna konfiguracja modelu:", error instanceof Error ? error.message : "nieznany błąd");
    return jsonError(503, "CONFIG", "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.");
  }

  // 5. Historia (zawsze po projectId) i dane projektu.
  const project = await getProject(projectId);
  if (!project) {
    return jsonError(404, "NOT_FOUND", "Nie znaleziono projektu.");
  }
  const history = await listChatMessages(projectId, limits.historyLimit);

  // 6. Zapis wiadomości użytkownika z id nadanym przez serwer.
  const userMessageId = newChatMessageId();
  const userMessage: ChatUIMessage = {
    id: userMessageId,
    role: "user",
    parts: [{ type: "text", text: request.message }],
  };
  await saveChatMessage({
    id: userMessageId,
    projectId,
    userId,
    role: "user",
    parts: userMessage.parts,
  });

  const messages = [...history, userMessage];
  const assistantId = newChatMessageId();
  const startedAt = Date.now();

  // 7. Wywołanie modelu.
  const result = streamText({
    model: resolved.model,
    system: buildSystemPrompt(project, variant.state),
    messages: await convertToModelMessages(messages, { tools: chatTools }),
    tools: chatTools,
    stopWhen: [isStepCount(limits.maxSteps), hasToolCall("ask_clarification")],
    maxOutputTokens: limits.maxOutputTokens,
    maxRetries: MAX_RETRIES,
    abortSignal: req.signal,
  });

  async function readUsage(): Promise<{ usage?: TokenUsage; stepCount?: number }> {
    try {
      const [usage, steps] = await Promise.all([result.usage, result.steps]);
      return { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, stepCount: steps.length };
    } catch {
      return {};
    }
  }

  // 8. Zapis odpowiedzi (po walidacji) i log wywołania.
  async function onEnd(outcome: UIMessageStreamOutcome, responseMessage: ChatUIMessage): Promise<void> {
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
      return;
    }
    if (outcome.status !== "completed") {
      await logLlmCall({ ...base, ...usage, status: "ERROR", errorCode: "ABORTED" });
      return;
    }

    const validated = await safeValidateUIMessages<ChatUIMessage>({
      messages: [responseMessage],
      tools: STREAM_VALIDATION_TOOLS,
    });
    if (!validated.success) {
      console.error("[chat] Odpowiedź modelu niezgodna ze schematem, nie zapisano.");
      await logLlmCall({ ...base, ...usage, status: "SCHEMA_ERROR", errorCode: "INVALID_RESPONSE" });
      return;
    }

    try {
      await saveChatMessage({ id: assistantId, projectId, userId: null, role: "assistant", parts: responseMessage.parts });
      await logLlmCall({ ...base, ...usage, status: "OK" });
    } catch (error) {
      console.error("[chat] Nie udało się zapisać odpowiedzi:", error instanceof Error ? error.message : "nieznany błąd");
      await logLlmCall({ ...base, ...usage, status: "ERROR", errorCode: "SAVE_FAILED" });
    }
  }

  const stream = toUIMessageStream({
    stream: result.stream,
    tools: chatTools,
    originalMessages: messages,
    generateMessageId: () => assistantId,
    sendReasoning: false,
    onError: (error) => {
      console.error("[chat] Błąd wywołania modelu:", classifyLlmError(error).errorCode);
      return toUserFacingError(error);
    },
    onEnd: ({ outcome, responseMessage }) => onEnd(outcome, responseMessage),
  });

  // Bez await: odpłyń strumień także po rozłączeniu klienta, żeby odpowiedź została zapisana.
  void result.consumeStream({ onError: () => {} });

  return createUIMessageStreamResponse({ stream });
}
