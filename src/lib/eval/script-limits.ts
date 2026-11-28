import { loadAiLimits, type AiLimits } from "@/lib/ai/config";

// Maksima dozwolone przez schemat w `config.ts`. Zmienne ustawiamy tylko w procesie skryptu ewaluacji (nie w `.env`
// i nie w procesie serwera HTTP), żeby operacje wewnątrz tury (`evaluate_bmc`, `analyze_impact`) i bezpośrednie
// wywołania skryptu nie zatrzymywały się na limitach użytkownika konta pomiarowego.
export const SCRIPT_LIMIT_OVERRIDES = {
  CHAT_MAX_REQUESTS_PER_HOUR: "10000",
  CHAT_MAX_TOKENS_PER_DAY: "100000000",
} as const;

/**
 * Podnosi limity w podanym środowisku (domyślnie `process.env` procesu skryptu) i sprawdza, że faktycznie obowiązują.
 * `loadAiLimits` czyta zmienne przy każdym wywołaniu, więc kolejność importów modułów aplikacji nie ma znaczenia.
 */
export function applyScriptLimitOverrides(env: Record<string, string | undefined> = process.env): AiLimits {
  Object.assign(env, SCRIPT_LIMIT_OVERRIDES);
  const limits = loadAiLimits(env);
  if (limits.maxRequestsPerHour < 10_000 || limits.maxTokensPerDay < 100_000_000) {
    throw new Error("Nie udało się podnieść limitów użytkownika w procesie skryptu. Przebieg wstrzymany.");
  }
  return limits;
}
