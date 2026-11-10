import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ prisma: { llmCallLog: { create } } }));

import { computeCostUsd, logLlmCall } from "@/lib/ai/log";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeCostUsd", () => {
  it("liczy koszt z cennika modelu", () => {
    // 1000 * 0.75 + 500 * 3.75 = 2625 (USD za mln tokenów) => 0.002625
    expect(computeCostUsd("google", "gemini-3.8-flash", { inputTokens: 1000, outputTokens: 500 })).toBe(0.002625);
  });

  it("zwraca null dla nieznanego modelu", () => {
    expect(computeCostUsd("google", "nieznany", { inputTokens: 1000, outputTokens: 500 })).toBeNull();
  });

  it("zwraca null, gdy brak informacji o tokenach", () => {
    expect(computeCostUsd("google", "gemini-3.8-flash", { inputTokens: undefined, outputTokens: 5 })).toBeNull();
    expect(computeCostUsd("google", "gemini-3.8-flash", {})).toBeNull();
  });
});

describe("logLlmCall", () => {
  const base = {
    projectId: "p1",
    userId: "u1",
    operation: "chat",
    provider: "google" as const,
    modelId: "gemini-3.8-flash",
    promptVersion: "v1",
    durationMs: 1234.6,
    status: "OK" as const,
  };

  it("zapisuje model, czas, tokeny, koszt i identyfikator projektu", async () => {
    create.mockResolvedValue({});

    await logLlmCall({ ...base, usage: { inputTokens: 1000, outputTokens: 500 }, stepCount: 2 });

    expect(create).toHaveBeenCalledWith({
      data: {
        projectId: "p1",
        userId: "u1",
        operation: "chat",
        provider: "google",
        model: "gemini-3.8-flash",
        promptVersion: "v1",
        durationMs: 1235,
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.002625,
        stepCount: 2,
        status: "OK",
        errorCode: null,
      },
    });
  });

  it("zapisuje błąd bez tokenów i kosztu", async () => {
    create.mockResolvedValue({});

    await logLlmCall({ ...base, status: "PROVIDER_RATE_LIMIT", errorCode: "429" });

    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "PROVIDER_RATE_LIMIT", errorCode: "429", inputTokens: null, costUsd: null });
  });

  it("nie przerywa działania, gdy zapis logu się nie uda", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValue(new Error("baza niedostępna"));

    await expect(logLlmCall(base)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
