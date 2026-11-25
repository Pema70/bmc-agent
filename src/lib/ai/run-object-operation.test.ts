import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkUserLimits: vi.fn(),
  getChatModel: vi.fn(),
  logLlmCall: vi.fn(),
}));

vi.mock("@/lib/ai/limits", () => ({ checkUserLimits: mocks.checkUserLimits }));
vi.mock("@/lib/ai/models", () => ({ getChatModel: mocks.getChatModel }));
vi.mock("@/lib/ai/log", () => ({ logLlmCall: mocks.logLlmCall }));

import { runObjectOperation, type ObjectOperationSpec } from "@/lib/ai/run-object-operation";

const Answer = z.strictObject({ answer: z.string().min(1) });
type Answer = z.infer<typeof Answer>;
type Ctx = { projectId: string; userId: string; abortSignal?: AbortSignal };
type Loaded = { id: string };
type Prepared = { note: string };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function generateModel(text: string, finish: "stop" | "length" = "stop") {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: finish, raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

function setModel(model: MockLanguageModelV4) {
  mocks.getChatModel.mockReturnValue({ model, provider: "google", modelId: "m" });
}

const ctx: Ctx = { projectId: "p1", userId: "u1" };

function makeSpec(
  overrides: Partial<ObjectOperationSpec<Ctx, Loaded, Prepared, Answer, string, "BAD_INPUT">> = {},
  trace: string[] = [],
): ObjectOperationSpec<Ctx, Loaded, Prepared, Answer, string, "BAD_INPUT"> {
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
      saveFailed: "zapis się nie udał",
      saveFailedLog: "Nie udało się zapisać:",
    },
    load: async () => (trace.push("load"), { id: "l1" }),
    prepare: async () => (trace.push("prepare"), { ok: true, prepared: { note: "n" } }),
    isSufficient: () => (trace.push("sufficient"), true),
    buildPrompt: () => (trace.push("prompt"), { system: "sys", prompt: "pr" }),
    save: async ({ output, llmCallLogId }) => (trace.push("save"), `${output.answer}:${llmCallLogId}`),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.checkUserLimits.mockResolvedValue({ ok: true });
  mocks.logLlmCall.mockResolvedValue("log-1");
});

describe("runObjectOperation", () => {
  it("model: domyślnie nazwa logiczna chat, a spec.modelName wybiera inną (np. judge)", async () => {
    setModel(generateModel('{"answer":"tak"}'));

    await runObjectOperation(makeSpec(), ctx);
    expect(mocks.getChatModel).toHaveBeenLastCalledWith("chat");

    await runObjectOperation(makeSpec({ modelName: "judge" }), ctx);
    expect(mocks.getChatModel).toHaveBeenLastCalledWith("judge");
  });

  it("sukces: haki w kolejności, jeden log OK, wynik z haka save", async () => {
    const trace: string[] = [];
    mocks.checkUserLimits.mockImplementation(async () => (trace.push("limits"), { ok: true }));
    mocks.getChatModel.mockImplementation(() => {
      trace.push("model");
      return { model: generateModel('{"answer":"tak"}'), provider: "google", modelId: "m" };
    });
    mocks.logLlmCall.mockImplementation(async () => (trace.push("log"), "log-1"));

    const result = await runObjectOperation(makeSpec({}, trace), ctx);

    expect(result).toEqual({ ok: true, value: "tak:log-1" });
    expect(trace).toEqual(["load", "prepare", "limits", "sufficient", "model", "prompt", "log", "save"]);
    expect(mocks.logLlmCall).toHaveBeenCalledTimes(1);
    expect(mocks.logLlmCall).toHaveBeenCalledWith({
      projectId: "p1",
      userId: "u1",
      operation: "test_op",
      provider: "google",
      modelId: "m",
      promptVersion: "test-v1",
      durationMs: expect.any(Number),
      usage: { inputTokens: 10, outputTokens: 5 },
      stepCount: 1,
      status: "OK",
    });
  });

  it("load zwraca null: NOT_FOUND z komunikatu spec, bez prepare, limitów i modelu", async () => {
    const trace: string[] = [];

    const result = await runObjectOperation(makeSpec({ load: async () => null, prepare: async () => (trace.push("prepare"), { ok: true, prepared: { note: "" } }) }), ctx);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND", message: "brak" });
    expect(trace).toEqual([]);
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.getChatModel).not.toHaveBeenCalled();
  });

  it("prepare zwraca błąd: jego kod i komunikat, bez limitów, modelu i logu", async () => {
    const result = await runObjectOperation(
      makeSpec({ prepare: async () => ({ ok: false, error: "BAD_INPUT", message: "zły wsad" }) }),
      ctx,
    );

    expect(result).toEqual({ ok: false, error: "BAD_INPUT", message: "zły wsad" });
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });

  it("przekroczony limit: LIMIT z retryAfterSec, bez isSufficient, modelu i logu", async () => {
    const trace: string[] = [];
    mocks.checkUserLimits.mockResolvedValue({ ok: false, error: "REQUESTS", retryAfterSec: 30, message: "Limit." });

    const result = await runObjectOperation(makeSpec({}, trace), ctx);

    expect(result).toEqual({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 30 });
    expect(trace).toEqual(["load", "prepare"]);
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });

  it("zbyt mało treści: TOO_EMPTY bez modelu i logu", async () => {
    const result = await runObjectOperation(makeSpec({ isSufficient: () => false }), ctx);

    expect(result).toEqual({ ok: false, error: "TOO_EMPTY", message: "pusto" });
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });

  it("validate zwraca false: SCHEMA_ERROR z tokenami i bez zapisu", async () => {
    setModel(generateModel('{"answer":"tak"}'));
    const save = vi.fn();

    const result = await runObjectOperation(makeSpec({ validate: () => false, save }), ctx);

    expect(result).toEqual({ ok: false, error: "SCHEMA", message: "zły format" });
    expect(save).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SCHEMA_ERROR", errorCode: "INVALID_RESPONSE", usage: { inputTokens: 10, outputTokens: 5 }, stepCount: 1 }),
    );
  });

  it("validate dostaje wynik schematu i wynik prepare", async () => {
    setModel(generateModel('{"answer":"tak"}'));
    const validate = vi.fn().mockReturnValue(true);

    await runObjectOperation(makeSpec({ validate }), ctx);

    expect(validate).toHaveBeenCalledWith({ answer: "tak" }, { note: "n" });
  });

  it("niezgodny schemat i ucięta odpowiedź: INVALID_RESPONSE oraz TRUNCATED", async () => {
    setModel(generateModel('{"answer":""}'));
    await runObjectOperation(makeSpec(), ctx);
    expect(mocks.logLlmCall).toHaveBeenLastCalledWith(expect.objectContaining({ errorCode: "INVALID_RESPONSE" }));

    setModel(generateModel('{"answer":"ur', "length"));
    await runObjectOperation(makeSpec(), ctx);
    expect(mocks.logLlmCall).toHaveBeenLastCalledWith(expect.objectContaining({ errorCode: "TRUNCATED" }));
  });

  it("maxOutputTokens: domyślnie z konfiguracji, z haka, gdy podany", async () => {
    const first = generateModel('{"answer":"tak"}');
    setModel(first);
    await runObjectOperation(makeSpec(), ctx);
    expect(first.doGenerateCalls[0].maxOutputTokens).toBe(2000);

    const second = generateModel('{"answer":"tak"}');
    setModel(second);
    await runObjectOperation(makeSpec({ maxOutputTokens: (limits) => limits.maxOutputTokens * 4 }), ctx);
    expect(second.doGenerateCalls[0].maxOutputTokens).toBe(8000);
  });

  it("abortSignal trafia do wywołania modelu", async () => {
    const model = generateModel('{"answer":"tak"}');
    setModel(model);
    const controller = new AbortController();

    await runObjectOperation(makeSpec(), { ...ctx, abortSignal: controller.signal });

    expect(model.doGenerateCalls[0].abortSignal).toBe(controller.signal);
  });

  it("błąd dostawcy: PROVIDER z polskim komunikatem i logiem bez tokenów", async () => {
    setModel(
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new APICallError({ message: "x", url: "https://x", requestBodyValues: {}, statusCode: 429, isRetryable: false });
        },
      }),
    );

    const result = await runObjectOperation(makeSpec(), ctx);

    expect(result).toMatchObject({ ok: false, error: "PROVIDER", message: expect.stringContaining("Przekroczono limit") });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PROVIDER_RATE_LIMIT", errorCode: "429", operation: "test_op" }),
    );
    expect(console.error).toHaveBeenCalledWith("[test] Błąd wywołania modelu:", "429");
  });

  it("błąd buildPrompt jest błędem wywołania (PROVIDER/log), nie wyjątkiem", async () => {
    setModel(generateModel('{"answer":"tak"}'));

    const result = await runObjectOperation(
      makeSpec({
        buildPrompt: () => {
          throw new Error("prompt");
        },
      }),
      ctx,
    );

    expect(result).toMatchObject({ ok: false, error: "PROVIDER" });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "ERROR" }));
  });

  it("błąd zapisu: SAVE_FAILED, log OK już zapisany, wpis w logu serwera z tekstem z spec", async () => {
    setModel(generateModel('{"answer":"tak"}'));

    const result = await runObjectOperation(
      makeSpec({
        save: async () => {
          throw new Error("baza");
        },
      }),
      ctx,
    );

    expect(result).toEqual({ ok: false, error: "SAVE_FAILED", message: "zapis się nie udał" });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "OK" }));
    expect(console.error).toHaveBeenCalledWith("[test] Nie udało się zapisać:", "baza");
  });

  it("konfiguracja modelu: CONFIG bez logu i zapisu", async () => {
    mocks.getChatModel.mockImplementation(() => {
      throw new Error("brak klucza");
    });
    const save = vi.fn();

    const result = await runObjectOperation(makeSpec({ save }), ctx);

    expect(result).toEqual({ ok: false, error: "CONFIG", message: "konfiguracja" });
    expect(console.error).toHaveBeenCalledWith("[test] Błędna konfiguracja modelu:", "brak klucza");
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
