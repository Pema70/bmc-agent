import { z } from "zod";
import { CHAT_MESSAGE_MAX_CHARS } from "@/lib/schemas/chat";

// Pusta zmienna (np. `MAX_STEPS=` w .env) liczy się jak brak, żeby zadziałała wartość domyślna.
const envInt = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(min).max(max).default(defaultValue),
  );

const LimitsEnv = z.object({
  // Każdy krok to osobne zapytanie do API, a darmowy plan Gemini ma niskie limity (D6).
  MAX_STEPS: envInt(3, 1, 10),
  CHAT_MAX_REQUESTS_PER_HOUR: envInt(30, 1, 10_000),
  CHAT_MAX_TOKENS_PER_DAY: envInt(200_000, 1_000, 100_000_000),
  LLM_MAX_OUTPUT_TOKENS: envInt(2000, 100, 32_000),
  CHAT_MAX_MESSAGE_CHARS: envInt(CHAT_MESSAGE_MAX_CHARS, 1, 20_000),
  CHAT_HISTORY_LIMIT: envInt(30, 1, 200),
  MAX_PENDING_PROPOSALS: envInt(20, 1, 200),
  // Najwyżej tyle wariantów na projekt (kopie i zapisane strategie); usuwania wariantów jeszcze nie ma.
  MAX_VARIANTS_PER_PROJECT: envInt(10, 1, 50),
  // Limit tokenów wyjścia dla operacji z dużym wynikiem (strategie, porównanie); osobny, żeby nie rozdymać czatu.
  LLM_MAX_OUTPUT_TOKENS_LONG: envInt(12_000, 1_000, 32_000),
});

export type AiLimits = {
  maxSteps: number;
  maxRequestsPerHour: number;
  maxTokensPerDay: number;
  maxOutputTokens: number;
  maxMessageChars: number;
  historyLimit: number;
  maxPendingProposals: number;
  maxVariantsPerProject: number;
  maxOutputTokensLong: number;
};

export function loadAiLimits(env: Record<string, string | undefined> = process.env): AiLimits {
  const parsed = LimitsEnv.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Niepoprawna konfiguracja limitów AI w zmiennych środowiskowych: ${z.prettifyError(parsed.error)}`);
  }
  const v = parsed.data;
  return {
    maxSteps: v.MAX_STEPS,
    maxRequestsPerHour: v.CHAT_MAX_REQUESTS_PER_HOUR,
    maxTokensPerDay: v.CHAT_MAX_TOKENS_PER_DAY,
    maxOutputTokens: v.LLM_MAX_OUTPUT_TOKENS,
    maxMessageChars: v.CHAT_MAX_MESSAGE_CHARS,
    historyLimit: v.CHAT_HISTORY_LIMIT,
    maxPendingProposals: v.MAX_PENDING_PROPOSALS,
    maxVariantsPerProject: v.MAX_VARIANTS_PER_PROJECT,
    maxOutputTokensLong: v.LLM_MAX_OUTPUT_TOKENS_LONG,
  };
}

// Minimalna zawartość modelu BMC do oceny (D5). Poniżej tego ocena nie ma sensu i tylko zużywa limity.
export const EVALUATION_MIN_ENTRIES = 5;
export const EVALUATION_MIN_NON_EMPTY_BLOCKS = 3;

// Minimalna zawartość modelu BMC do analizy wpływu (niższa niż dla oceny): zmiana musi mieć o co się oprzeć.
export const IMPACT_MIN_ENTRIES = 3;
export const IMPACT_MIN_NON_EMPTY_BLOCKS = 2;

// Minimalna zawartość wariantu bazowego do generowania strategii (jak ocena): strategia z pustego modelu to zgadywanie.
export const STRATEGY_MIN_ENTRIES = 5;
export const STRATEGY_MIN_NON_EMPTY_BLOCKS = 3;

// Minimalna zawartość każdego porównywanego wariantu (jak analiza wpływu).
export const COMPARE_MIN_ENTRIES = 3;
export const COMPARE_MIN_NON_EMPTY_BLOCKS = 2;
