import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  llmCallCount: vi.fn(),
  llmCallAggregate: vi.fn(),
  llmCallFindFirst: vi.fn(),
  getChatModel: vi.fn(),
  logLlmCall: vi.fn(),
}));

// Prawdziwe `limits.ts` i `config.ts`; zamockowana tylko baza (log wywołań) i model.
vi.mock("@/lib/db/client", () => ({
  prisma: {
    llmCallLog: { count: mocks.llmCallCount, aggregate: mocks.llmCallAggregate, findFirst: mocks.llmCallFindFirst },
  },
}));
vi.mock("@/lib/ai/models", () => ({ getChatModel: mocks.getChatModel }));
vi.mock("@/lib/ai/log", () => ({ logLlmCall: mocks.logLlmCall }));

import { loadAiLimits } from "@/lib/ai/config";
import { runObjectOperation, type ObjectOperationSpec } from "@/lib/ai/run-object-operation";
import { SCRIPT_LIMIT_OVERRIDES, applyScriptLimitOverrides } from "@/lib/eval/script-limits";

const Answer = z.strictObject({ answer: z.string().min(1) });
type Answer = z.infer<typeof Answer>;
type Ctx = { projectId: string; userId: string };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function spec(): ObjectOperationSpec<Ctx, { id: string }, { note: string }, Answer, string, never> {
  return {
    tag: "test",
    operation: "test_op",
    promptVersion: "test-v1",
    schema: Answer,
    schemaName: "answer",
    schemaDescription: "Odpowiedź testowa.",
    messages: {
      notFound: "brak",
      tooEmpty: "pusto",
      schema: "zły format",
      config: "konfiguracja",
      saveFailed: "zapis",
      saveFailedLog: "Zapis:",
    },
    load: async () => ({ id: "l1" }),
    prepare: async () => ({ ok: true, prepared: { note: "n" } }),
    isSufficient: () => true,
    buildPrompt: () => ({ system: "sys", prompt: "pr" }),
    save: async ({ output }) => output.answer,
  };
}

const ctx: Ctx = { projectId: "p1", userId: "u1" };

beforeEach(() => {
  vi.clearAllMocks();
  // Domyślne limity (30 żądań na godzinę, 200 tys. tokenów na dobę), jakby `.env` ich nie ustawiał.
  vi.stubEnv("CHAT_MAX_REQUESTS_PER_HOUR", "30");
  vi.stubEnv("CHAT_MAX_TOKENS_PER_DAY", "200000");
  // Konto po długiej serii: 100 żądań w ostatniej godzinie i milion tokenów w ostatniej dobie.
  mocks.llmCallCount.mockResolvedValue(100);
  mocks.llmCallAggregate.mockResolvedValue({ _sum: { inputTokens: 900_000, outputTokens: 100_000 } });
  mocks.llmCallFindFirst.mockResolvedValue({ createdAt: new Date() });
  mocks.getChatModel.mockReturnValue({
    model: new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: '{"answer":"tak"}' }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    }),
    provider: "google",
    modelId: "gemini-3.5-flash-lite",
  });
  mocks.logLlmCall.mockResolvedValue("log-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("applyScriptLimitOverrides", () => {
  it("bez nadpisania runObjectOperation zatrzymuje się na limicie użytkownika (kontrola testu)", async () => {
    const result = await runObjectOperation(spec(), ctx);

    expect(result).toMatchObject({ ok: false, error: "LIMIT" });
    expect(mocks.getChatModel).not.toHaveBeenCalled();
  });

  it("po nadpisaniu te same dane w logu nie blokują operacji wewnątrz tury skryptu", async () => {
    applyScriptLimitOverrides(process.env);

    const result = await runObjectOperation(spec(), ctx);

    expect(result).toEqual({ ok: true, value: "tak" });
    expect(mocks.getChatModel).toHaveBeenCalledTimes(1);
  });

  it("limity są czytane przy wywołaniu: zmiana zmiennych po zaimportowaniu modułów działa bez ponownego importu", () => {
    expect(loadAiLimits().maxRequestsPerHour).toBe(30);

    applyScriptLimitOverrides(process.env);

    expect(loadAiLimits().maxRequestsPerHour).toBe(Number(SCRIPT_LIMIT_OVERRIDES.CHAT_MAX_REQUESTS_PER_HOUR));
    expect(loadAiLimits().maxTokensPerDay).toBe(Number(SCRIPT_LIMIT_OVERRIDES.CHAT_MAX_TOKENS_PER_DAY));
  });

  it("zmienia tylko dwa limity i tylko w podanym środowisku (nie dotyka reszty konfiguracji)", () => {
    const env: Record<string, string | undefined> = { MAX_STEPS: "3", LLM_MAX_OUTPUT_TOKENS: "2000" };

    const limits = applyScriptLimitOverrides(env);

    expect(env).toEqual({ MAX_STEPS: "3", LLM_MAX_OUTPUT_TOKENS: "2000", ...SCRIPT_LIMIT_OVERRIDES });
    expect(limits.maxSteps).toBe(3);
    expect(limits.maxOutputTokens).toBe(2000);
  });
});
