import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Output, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createGoogleGenerativeAI, googleModel, createAnthropic, anthropicModel } = vi.hoisted(() => {
  const googleModel = { modelId: "mock-model" };
  const anthropicModel = { modelId: "mock-judge" };
  return {
    googleModel,
    anthropicModel,
    createGoogleGenerativeAI: vi.fn(() => vi.fn(() => googleModel)),
    createAnthropic: vi.fn(() => vi.fn(() => anthropicModel)),
  };
});

vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic }));

import { LLM_PROVIDERS, MODEL_PRICING, getChatModel, loadModelConfig } from "@/lib/ai/models";

const googleEnv = {
  LLM_PROVIDER: "google",
  LLM_MODEL: "gemini-3.8-flash",
  GOOGLE_GENERATIVE_AI_API_KEY: "sekretny-klucz",
};
const judgeEnv = {
  JUDGE_PROVIDER: "anthropic",
  JUDGE_MODEL: "claude-haiku-5-5",
  ANTHROPIC_API_KEY: "klucz-sedziego",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadModelConfig (chat)", () => {
  it("czyta dostawcę, model i klucz", () => {
    expect(loadModelConfig(googleEnv)).toEqual({
      provider: "google",
      modelId: "gemini-3.8-flash",
      apiKey: "sekretny-klucz",
    });
  });

  it("odrzuca nieznanego dostawcę, także OpenAI (nieobsługiwany)", () => {
    expect(() => loadModelConfig({ ...googleEnv, LLM_PROVIDER: "mistral" })).toThrow("LLM_PROVIDER");
    expect(() => loadModelConfig({ ...googleEnv, LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" })).toThrow("LLM_PROVIDER");
    expect(LLM_PROVIDERS).toEqual(["google", "anthropic"]);
  });

  it("odrzuca brak LLM_PROVIDER i pusty LLM_MODEL", () => {
    expect(() => loadModelConfig({})).toThrow("LLM_PROVIDER");
    expect(() => loadModelConfig({ ...googleEnv, LLM_MODEL: "  " })).toThrow("LLM_MODEL");
  });

  it("zgłasza brak klucza z nazwą zmiennej, ale bez wartości kluczy", () => {
    const env = { LLM_PROVIDER: "google", LLM_MODEL: "gemini-3.8-flash", ANTHROPIC_API_KEY: "inny-sekret" };
    let message = "";
    try {
      loadModelConfig(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(message).not.toContain("inny-sekret");
  });

  it("Anthropic jest dozwolony tylko dla sędziego: dla czatu daje jawny błąd konfiguracji", () => {
    const env = { LLM_PROVIDER: "anthropic", LLM_MODEL: "claude-haiku-5-5", ANTHROPIC_API_KEY: "k" };
    expect(() => loadModelConfig(env)).toThrow("nie jest dozwolony dla modelu „chat”");
    expect(() => getChatModel("chat", env)).toThrow("nie jest dozwolony");
    expect(createAnthropic).not.toHaveBeenCalled();
  });
});

describe("loadModelConfig (judge)", () => {
  it("czyta JUDGE_PROVIDER, JUDGE_MODEL i ANTHROPIC_API_KEY, niezależnie od LLM_*", () => {
    expect(loadModelConfig({ ...judgeEnv }, "judge")).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-5-5",
      apiKey: "klucz-sedziego",
    });
    expect(loadModelConfig({ ...googleEnv, ...judgeEnv }, "judge").modelId).toBe("claude-haiku-5-5");
    expect(loadModelConfig({ ...googleEnv, ...judgeEnv }).modelId).toBe("gemini-3.8-flash");
  });

  it("bez JUDGE_* błąd wskazuje JUDGE_PROVIDER, a LLM_* nie ratuje konfiguracji", () => {
    expect(() => loadModelConfig(googleEnv, "judge")).toThrow("JUDGE_PROVIDER");
    expect(() => loadModelConfig({ ...judgeEnv, JUDGE_MODEL: " " }, "judge")).toThrow("JUDGE_MODEL");
  });

  it("brak ANTHROPIC_API_KEY: nazwa zmiennej w błędzie, bez wartości innych kluczy", () => {
    const env = { JUDGE_PROVIDER: "anthropic", JUDGE_MODEL: "claude-haiku-5-5", GOOGLE_GENERATIVE_AI_API_KEY: "sekret-google" };
    let message = "";
    try {
      loadModelConfig(env, "judge");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("ANTHROPIC_API_KEY");
    expect(message).not.toContain("sekret-google");
  });

  it("Google jako sędzia jest odrzucony (sędzia ma być z innej rodziny niż modele generujące)", () => {
    const env = { JUDGE_PROVIDER: "google", JUDGE_MODEL: "gemini-3.8-flash", GOOGLE_GENERATIVE_AI_API_KEY: "k" };
    expect(() => loadModelConfig(env, "judge")).toThrow("nie jest dozwolony dla modelu „judge”");
  });
});

describe("getChatModel", () => {
  it("tworzy model Google z kluczem z env", () => {
    const resolved = getChatModel("chat", googleEnv);

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: "sekretny-klucz" });
    expect(createAnthropic).not.toHaveBeenCalled();
    expect(resolved).toEqual({ model: googleModel, provider: "google", modelId: "gemini-3.8-flash" });
  });

  it("nazwa logiczna judge tworzy model Anthropic z kluczem sędziego, bez użycia LLM_*", () => {
    const resolved = getChatModel("judge", { ...judgeEnv });

    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "klucz-sedziego" });
    expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
    expect(resolved).toEqual({ model: anthropicModel, provider: "anthropic", modelId: "claude-haiku-5-5" });
  });

  it("nazwa logiczna ma znaczenie: chat nie czyta JUDGE_*, a judge nie czyta LLM_*", () => {
    expect(getChatModel("chat", { ...googleEnv, ...judgeEnv }).provider).toBe("google");
    expect(getChatModel("judge", { ...googleEnv, ...judgeEnv }).provider).toBe("anthropic");
  });

  it("nie tworzy klienta przy błędnej konfiguracji", () => {
    expect(() => getChatModel("chat", { LLM_PROVIDER: "google", LLM_MODEL: "x" })).toThrow();
    expect(() => getChatModel("judge", { JUDGE_PROVIDER: "anthropic", JUDGE_MODEL: "x" })).toThrow();
    expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
    expect(createAnthropic).not.toHaveBeenCalled();
  });

  it("model sędziego działa z Output.object (zamockowany model SDK, bez prawdziwego API)", async () => {
    const mock = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: '{"score":7}' }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    createAnthropic.mockReturnValueOnce(vi.fn(() => mock));

    const { model } = getChatModel("judge", { ...judgeEnv });
    const result = await generateText({
      model,
      prompt: "x",
      output: Output.object({ schema: z.strictObject({ score: z.number() }), name: "o" }),
    });

    expect(result.output).toEqual({ score: 7 });
  });
});

describe("MODEL_PRICING", () => {
  it("ma ceny modeli generujących (Gemini) i sędziego (Haiku), bez OpenAI i Sonneta", () => {
    expect(MODEL_PRICING["google/gemini-3.5-flash-lite"]).toEqual({ inputPerMTok: 0.3, outputPerMTok: 2.5 });
    expect(MODEL_PRICING["google/gemini-3.6-flash"]).toEqual({ inputPerMTok: 0.75, outputPerMTok: 3.75 });
    expect(MODEL_PRICING["google/gemini-3.8-flash"]).toEqual({ inputPerMTok: 0.75, outputPerMTok: 3.75 });
    expect(MODEL_PRICING["anthropic/claude-haiku-5-5"]).toEqual({ inputPerMTok: 0.1, outputPerMTok: 0.5 });
    expect(Object.keys(MODEL_PRICING).filter((key) => key.startsWith("openai/") || key.includes("sonnet"))).toEqual([]);
  });
});

describe("klucze API tylko po stronie serwera", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it("żaden plik klienta („use client”) nie odwołuje się do kluczy API ani do konfiguracji modeli", () => {
    const root = new URL("../../", import.meta.url);
    const clientFiles = sourceFiles(fileURLToPath(root)).filter((file) =>
      /^\s*(["'])use client\1/.test(readFileSync(file, "utf8")),
    );

    expect(clientFiles.length).toBeGreaterThan(0);
    for (const file of clientFiles) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/API_KEY|ANTHROPIC|JUDGE_|@\/lib\/ai\/models|@ai-sdk\/anthropic/);
    }
  });
});
