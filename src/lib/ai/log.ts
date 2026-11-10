import { prisma } from "@/lib/db/client";
import { MODEL_PRICING, type LlmProvider } from "@/lib/ai/models";
import type { LlmCallStatus } from "@/generated/prisma/client";

export type TokenUsage = { inputTokens?: number | null; outputTokens?: number | null };

/** Koszt w USD albo null, gdy model nie ma ceny w MODEL_PRICING lub brak informacji o tokenach. */
export function computeCostUsd(provider: LlmProvider, modelId: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICING[`${provider}/${modelId}`];
  if (!price || usage.inputTokens == null || usage.outputTokens == null) {
    return null;
  }
  const cost = (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export type LlmCallRecord = {
  projectId?: string | null;
  userId?: string | null;
  operation: string;
  provider: LlmProvider;
  modelId: string;
  promptVersion: string;
  durationMs: number;
  usage?: TokenUsage;
  stepCount?: number | null;
  status: LlmCallStatus;
  errorCode?: string | null;
};

/**
 * Zapisuje jedno wywołanie LLM. Nie przyjmuje treści promptów ani odpowiedzi, a kod błędu
 * ma być krótkim kodem (np. "429"), nie komunikatem dostawcy. Błąd zapisu logu nie może
 * przerwać odpowiedzi dla użytkownika, więc jest jawnie raportowany w logu serwera.
 */
export async function logLlmCall(record: LlmCallRecord): Promise<void> {
  const usage = record.usage ?? {};
  try {
    await prisma.llmCallLog.create({
      data: {
        projectId: record.projectId ?? null,
        userId: record.userId ?? null,
        operation: record.operation,
        provider: record.provider,
        model: record.modelId,
        promptVersion: record.promptVersion,
        durationMs: Math.max(0, Math.round(record.durationMs)),
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        costUsd: computeCostUsd(record.provider, record.modelId, usage),
        stepCount: record.stepCount ?? null,
        status: record.status,
        errorCode: record.errorCode?.slice(0, 100) ?? null,
      },
    });
  } catch (error) {
    console.error("[ai] Nie udało się zapisać LlmCallLog:", error instanceof Error ? error.message : "nieznany błąd");
  }
}
