import { describe, expect, it } from "vitest";
import { loadAiLimits } from "@/lib/ai/config";

describe("loadAiLimits", () => {
  it("zwraca wartości domyślne, w tym MAX_STEPS=3", () => {
    expect(loadAiLimits({})).toEqual({
      maxSteps: 3,
      maxRequestsPerHour: 30,
      maxTokensPerDay: 200_000,
      maxOutputTokens: 2000,
      maxMessageChars: 4000,
      historyLimit: 30,
      maxPendingProposals: 20,
      maxVariantsPerProject: 10,
      maxOutputTokensLong: 12_000,
    });
  });

  it("LLM_REASONING: brak, pusta wartość i provider-default to brak ustawienia; poprawne poziomy przechodzą; reszta to błąd", () => {
    expect(loadAiLimits({}).reasoning).toBeUndefined();
    expect(loadAiLimits({ LLM_REASONING: "" }).reasoning).toBeUndefined();
    expect(loadAiLimits({ LLM_REASONING: "provider-default" }).reasoning).toBeUndefined();
    for (const level of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(loadAiLimits({ LLM_REASONING: level }).reasoning).toBe(level);
    }
    expect(() => loadAiLimits({ LLM_REASONING: "bardzo-mocno" })).toThrow("limitów AI");
  });

  it("nadpisuje wartości z env", () => {
    const limits = loadAiLimits({ MAX_STEPS: "5", CHAT_MAX_REQUESTS_PER_HOUR: "10" });
    expect(limits.maxSteps).toBe(5);
    expect(limits.maxRequestsPerHour).toBe(10);
  });

  it("traktuje pustą zmienną jak brak", () => {
    expect(loadAiLimits({ MAX_STEPS: "" }).maxSteps).toBe(3);
  });

  it("rzuca jawny błąd dla niepoprawnych wartości", () => {
    expect(() => loadAiLimits({ MAX_STEPS: "abc" })).toThrow("limitów AI");
    expect(() => loadAiLimits({ MAX_STEPS: "0" })).toThrow("limitów AI");
    expect(() => loadAiLimits({ CHAT_HISTORY_LIMIT: "1.5" })).toThrow("limitów AI");
  });
});
