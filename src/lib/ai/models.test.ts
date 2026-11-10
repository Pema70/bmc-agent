import { beforeEach, describe, expect, it, vi } from "vitest";

const { createGoogleGenerativeAI, googleModel } = vi.hoisted(() => {
  const googleModel = { modelId: "mock-model" };
  return { googleModel, createGoogleGenerativeAI: vi.fn(() => vi.fn(() => googleModel)) };
});

vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI }));

import { getChatModel, loadModelConfig } from "@/lib/ai/models";

const googleEnv = {
  LLM_PROVIDER: "google",
  LLM_MODEL: "gemini-3.8-flash",
  GOOGLE_GENERATIVE_AI_API_KEY: "sekretny-klucz",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadModelConfig", () => {
  it("czyta dostawcę, model i klucz", () => {
    expect(loadModelConfig(googleEnv)).toEqual({
      provider: "google",
      modelId: "gemini-3.8-flash",
      apiKey: "sekretny-klucz",
    });
  });

  it("odrzuca nieznanego dostawcę", () => {
    expect(() => loadModelConfig({ ...googleEnv, LLM_PROVIDER: "mistral" })).toThrow("LLM_PROVIDER");
  });

  it("odrzuca brak LLM_PROVIDER i pusty LLM_MODEL", () => {
    expect(() => loadModelConfig({})).toThrow("LLM_PROVIDER");
    expect(() => loadModelConfig({ ...googleEnv, LLM_MODEL: "  " })).toThrow("LLM_MODEL");
  });

  it("zgłasza brak klucza z nazwą zmiennej, ale bez wartości kluczy", () => {
    const env = { LLM_PROVIDER: "google", LLM_MODEL: "gemini-3.8-flash", OPENAI_API_KEY: "inny-sekret" };
    let message = "";
    try {
      loadModelConfig(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(message).not.toContain("inny-sekret");
  });

  it("dla jeszcze nieobsługiwanych dostawców daje jawny błąd konfiguracji", () => {
    for (const provider of ["openai", "anthropic"]) {
      expect(() => loadModelConfig({ LLM_PROVIDER: provider, LLM_MODEL: "x", OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" })).toThrow(
        "nie jest jeszcze obsługiwany",
      );
    }
  });
});

describe("getChatModel", () => {
  it("tworzy model Google z kluczem z env", () => {
    const resolved = getChatModel("chat", googleEnv);

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: "sekretny-klucz" });
    expect(resolved).toEqual({ model: googleModel, provider: "google", modelId: "gemini-3.8-flash" });
  });

  it("nie tworzy klienta przy błędnej konfiguracji", () => {
    expect(() => getChatModel("chat", { LLM_PROVIDER: "google", LLM_MODEL: "x" })).toThrow();
    expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
  });
});
