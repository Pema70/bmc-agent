import { loadAiLimits } from "@/lib/ai/config";
import { prisma } from "@/lib/db/client";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type LimitCheck =
  | { ok: true }
  | { ok: false; error: "REQUESTS" | "TOKENS"; retryAfterSec: number; message: string };

/**
 * Limity na użytkownika liczone z LlmCallLog: zapytania z ostatniej godziny i tokeny z ostatniej doby.
 * Sprawdzenie nie jest atomowe: dwa równoległe żądania mogą przekroczyć limit o jedno (D6).
 */
export async function checkUserLimits(
  userId: string,
  now: Date = new Date(),
  limits = loadAiLimits(),
): Promise<LimitCheck> {
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);

  const [requests, tokens, oldestInHour, oldestInDay] = await Promise.all([
    prisma.llmCallLog.count({ where: { userId, createdAt: { gte: hourAgo } } }),
    prisma.llmCallLog.aggregate({
      where: { userId, createdAt: { gte: dayAgo } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.llmCallLog.findFirst({
      where: { userId, createdAt: { gte: hourAgo } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.llmCallLog.findFirst({
      where: { userId, createdAt: { gte: dayAgo } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  if (requests >= limits.maxRequestsPerHour) {
    const retryAfterSec = secondsUntil(oldestInHour?.createdAt, HOUR_MS, now);
    return {
      ok: false,
      error: "REQUESTS",
      retryAfterSec,
      message: `Osiągnięto limit ${limits.maxRequestsPerHour} zapytań do agenta na godzinę. Spróbuj ponownie za ${formatWait(retryAfterSec)}.`,
    };
  }

  const usedTokens = (tokens._sum.inputTokens ?? 0) + (tokens._sum.outputTokens ?? 0);
  if (usedTokens >= limits.maxTokensPerDay) {
    const retryAfterSec = secondsUntil(oldestInDay?.createdAt, DAY_MS, now);
    return {
      ok: false,
      error: "TOKENS",
      retryAfterSec,
      message: `Wykorzystano dzienny limit tokenów agenta. Spróbuj ponownie za ${formatWait(retryAfterSec)}.`,
    };
  }

  return { ok: true };
}

function secondsUntil(oldest: Date | undefined, windowMs: number, now: Date): number {
  if (!oldest) {
    return 60;
  }
  return Math.max(1, Math.ceil((oldest.getTime() + windowMs - now.getTime()) / 1000));
}

function formatWait(seconds: number): string {
  if (seconds < 90) {
    return `${seconds} s`;
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes < 90 ? `${minutes} min` : `${Math.ceil(minutes / 60)} godz.`;
}
