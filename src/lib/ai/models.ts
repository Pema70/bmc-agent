import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { z } from "zod";

// Jedyne miejsce z wiedzą o dostawcach i nazwach modeli. Reszta kodu używa nazwy logicznej.

export const LLM_PROVIDERS = ["google", "openai", "anthropic"] as const;
export const LlmProvider = z.enum(LLM_PROVIDERS);
export type LlmProvider = z.infer<typeof LlmProvider>;

export type LogicalModelName = "chat";

const API_KEY_ENV: Record<LlmProvider, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

// Pakiety @ai-sdk/openai i @ai-sdk/anthropic dochodzą w osobnych PR-ach, gdy będą potrzebne.
const SUPPORTED_PROVIDERS: readonly LlmProvider[] = ["google"];

const ModelEnv = z.object({
  LLM_PROVIDER: LlmProvider,
  LLM_MODEL: z.string().trim().min(1, { error: "LLM_MODEL nie może być puste." }),
});

export type ResolvedModel = {
  model: LanguageModel;
  provider: LlmProvider;
  modelId: string;
};

export type ModelConfig = { provider: LlmProvider; modelId: string; apiKey: string };

/** Czyta i waliduje konfigurację z env. W komunikatach błędów nigdy nie ma wartości kluczy. */
export function loadModelConfig(env: Record<string, string | undefined> = process.env): ModelConfig {
  const parsed = ModelEnv.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Niepoprawna konfiguracja modelu (LLM_PROVIDER, LLM_MODEL): ${z.prettifyError(parsed.error)}`);
  }
  const { LLM_PROVIDER: provider, LLM_MODEL: modelId } = parsed.data;

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Dostawca „${provider}” nie jest jeszcze obsługiwany w tej wersji aplikacji.`);
  }

  const keyName = API_KEY_ENV[provider];
  const apiKey = env[keyName]?.trim();
  if (!apiKey) {
    throw new Error(`Brak klucza API: ustaw ${keyName} w pliku .env (wymagany dla LLM_PROVIDER=${provider}).`);
  }
  return { provider, modelId, apiKey };
}

export function getChatModel(
  name: LogicalModelName = "chat",
  env: Record<string, string | undefined> = process.env,
): ResolvedModel {
  void name; // jedna nazwa logiczna; kolejne (np. compare-a) dochodzą w kroku 10
  const { provider, modelId, apiKey } = loadModelConfig(env);

  switch (provider) {
    case "google":
      return { model: createGoogleGenerativeAI({ apiKey })(modelId), provider, modelId };
    default:
      throw new Error(`Dostawca „${provider}” nie jest jeszcze obsługiwany w tej wersji aplikacji.`);
  }
}

// Ceny w USD za 1 mln tokenów, według cenników dostawców sprawdzonych 2026-11-10.
// Liczone z cennika płatnego także przy darmowym planie (D9), żeby porównanie modeli było spójne.
// Nieznany model: koszt null (nie zgadujemy).
export const MODEL_PRICING_CHECKED_AT = "2026-11-10";
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "google/gemini-3.8-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 }, // od 2027-01-01: 1.50 / 7.50
  "google/gemini-3.5-flash-lite": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "openai/gpt-6-luna": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  "anthropic/claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
};
