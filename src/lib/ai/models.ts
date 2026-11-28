import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { z } from "zod";

// Jedyne miejsce z wiedzą o dostawcach i nazwach modeli. Reszta kodu używa nazwy logicznej.
// Modele generujące to wyłącznie Gemini (`chat`); Anthropic służy tylko sędziemu (`judge`).
// OpenAI nie jest obsługiwane (OPENAI_API_KEY w .env.example jest nieużywany).

export const LLM_PROVIDERS = ["google", "anthropic"] as const;
export const LlmProvider = z.enum(LLM_PROVIDERS);
export type LlmProvider = z.infer<typeof LlmProvider>;

export type LogicalModelName = "chat" | "judge";

const API_KEY_ENV: Record<LlmProvider, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

// Nazwa logiczna → zmienne środowiskowe i dozwolony dostawca. Sędzia jest z innej rodziny niż modele generujące,
// więc `chat` przyjmuje tylko Google, a `judge` tylko Anthropic (zła kombinacja to jawny błąd konfiguracji).
const LOGICAL_MODELS: Record<
  LogicalModelName,
  { providerVar: string; modelVar: string; allowed: readonly LlmProvider[] }
> = {
  chat: { providerVar: "LLM_PROVIDER", modelVar: "LLM_MODEL", allowed: ["google"] },
  judge: { providerVar: "JUDGE_PROVIDER", modelVar: "JUDGE_MODEL", allowed: ["anthropic"] },
};

export type ResolvedModel = {
  model: LanguageModel;
  provider: LlmProvider;
  modelId: string;
};

export type ModelConfig = { provider: LlmProvider; modelId: string; apiKey: string };

type Env = Record<string, string | undefined>;

/** Czyta i waliduje konfigurację z env. W komunikatach błędów nigdy nie ma wartości kluczy. */
export function loadModelConfig(env: Env = process.env, name: LogicalModelName = "chat"): ModelConfig {
  const { providerVar, modelVar, allowed } = LOGICAL_MODELS[name];
  const parsed = z
    .object({
      provider: LlmProvider,
      modelId: z.string().trim().min(1, { error: `${modelVar} nie może być puste.` }),
    })
    .safeParse({ provider: env[providerVar], modelId: env[modelVar] });
  if (!parsed.success) {
    throw new Error(`Niepoprawna konfiguracja modelu (${providerVar}, ${modelVar}): ${z.prettifyError(parsed.error)}`);
  }
  const { provider, modelId } = parsed.data;

  if (!allowed.includes(provider)) {
    throw new Error(
      `Dostawca „${provider}” nie jest dozwolony dla modelu „${name}” (${providerVar}): dozwolone: ${allowed.join(", ")}.`,
    );
  }

  const keyName = API_KEY_ENV[provider];
  const apiKey = env[keyName]?.trim();
  if (!apiKey) {
    throw new Error(`Brak klucza API: ustaw ${keyName} w pliku .env (wymagany dla ${providerVar}=${provider}).`);
  }
  return { provider, modelId, apiKey };
}

export function getChatModel(name: LogicalModelName = "chat", env: Env = process.env): ResolvedModel {
  const { provider, modelId, apiKey } = loadModelConfig(env, name);

  switch (provider) {
    case "google":
      return { model: createGoogleGenerativeAI({ apiKey })(modelId), provider, modelId };
    case "anthropic":
      return { model: createAnthropic({ apiKey })(modelId), provider, modelId };
  }
}

// Ceny w USD za 1 mln tokenów, według cenników dostawców sprawdzonych 2026-11-26.
// Liczone z cennika płatnego także przy darmowym planie (D9), żeby porównanie modeli było spójne.
// Nieznany model: koszt null (nie zgadujemy).
// Zastrzeżenia, których `computeCostUsd` nie zna (jedna cena na model, bez progów i dat):
//  - gemini-3.6-flash i gemini-3.8-flash: od 2027-01-01 cena rośnie do 1.50 / 7.50; jedna seria pomiarowa używa
//    jednego cennika (najlepiej przed tą datą), a seria przez tę datę wymaga adnotacji w wynikach;
//  - claude-haiku-5-5: powyżej 100 tys. tokenów promptu cena wynosi 0.50 / 2.50; prompty sędziego mieszczą się poniżej.
export const MODEL_PRICING_CHECKED_AT = "2026-11-26";
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "google/gemini-3.5-flash-lite": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "google/gemini-3.6-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  "google/gemini-3.8-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  "anthropic/claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
};

// Modele generujące dozwolone w skrypcie ewaluacji (argument `--modele`): klucze cennika dostawcy `google`.
// Jedno źródło prawdy z `MODEL_PRICING`: model bez ceny nie przejdzie, bo koszt byłby nieznany.
export const ALLOWED_CHAT_MODELS: readonly string[] = Object.keys(MODEL_PRICING)
  .filter((key) => key.startsWith("google/"))
  .map((key) => key.slice("google/".length));
