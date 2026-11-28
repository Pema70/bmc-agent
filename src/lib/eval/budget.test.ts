import { describe, expect, it, vi } from "vitest";
import { RunBudget } from "@/lib/eval/budget";
import { ESTIMATE_ASSUMPTIONS, estimateRun } from "@/lib/eval/estimate";
import { getCase } from "@/lib/eval/cases";

describe("RunBudget (bezpieczniki bieżącego uruchomienia)", () => {
  it("limit tur: przerywa po osiągnięciu limitu, wcześniej nie", async () => {
    const budget = new RunBudget({ maxCostUsd: 10, maxTurns: 2, readCost: async () => ({ totalUsd: 0, unknownCalls: 0 }) });
    expect(await budget.afterTurn()).toBeNull();
    const stop = await budget.afterTurn();
    expect(stop).toMatchObject({ code: "TURN_LIMIT" });
    expect(stop?.message).toContain("--max-tur");
  });

  it("limit kosztu: przerywa po osiągnięciu limitu, a komunikat tłumaczy sprawdzanie po turze", async () => {
    const totals = [0.04, 0.1];
    const readCost = vi.fn(async () => ({ totalUsd: totals.shift() ?? 0.1, unknownCalls: 0 }));
    const budget = new RunBudget({ maxCostUsd: 0.1, maxTurns: 100, readCost });
    expect(await budget.afterTurn()).toBeNull();
    const stop = await budget.afterTurn();
    expect(stop).toMatchObject({ code: "COST_LIMIT" });
    expect(stop?.message).toContain("po turze");
  });

  it("wywołanie z nieznanym kosztem (NULL) zatrzymuje przebieg", async () => {
    const budget = new RunBudget({ maxCostUsd: 10, maxTurns: 100, readCost: async () => ({ totalUsd: 0.01, unknownCalls: 1 }) });
    expect(await budget.afterTurn()).toMatchObject({ code: "COST_UNKNOWN" });
  });

  it("checkCost nie liczy tury", async () => {
    const budget = new RunBudget({ maxCostUsd: 10, maxTurns: 1, readCost: async () => ({ totalUsd: 0, unknownCalls: 0 }) });
    expect(await budget.checkCost()).toBeNull();
    expect(budget.turns).toBe(0);
  });
});

describe("estimateRun", () => {
  it("BUILD: liczba tur z wiadomości, koszt z cennika modelu, sędzia dolicza 3 sądy", () => {
    const build = getCase("BUILD-02");
    if (!build) throw new Error("brak przypadku");
    const plain = estimateRun(build, "gemini-3.5-flash-lite", { judge: false });
    expect(plain.turns).toBe(6);
    const expected = (6 * ESTIMATE_ASSUMPTIONS.chatTurnInputTokens * 0.3 + 6 * ESTIMATE_ASSUMPTIONS.chatTurnOutputTokens * 2.5) / 1_000_000;
    expect(plain.costUsd).toBeCloseTo(expected, 8);

    const withJudge = estimateRun(build, "gemini-3.5-flash-lite", { judge: true, judgeModel: "claude-haiku-5-5" });
    expect(withJudge.calls).toBe(plain.calls + 3);
    expect(withJudge.costUsd).toBeGreaterThan(plain.costUsd ?? 0);
  });

  it("nieznany model albo sędzia bez ceny daje koszt null (nie zgadujemy)", () => {
    const build = getCase("BUILD-01");
    if (!build) throw new Error("brak przypadku");
    expect(estimateRun(build, "nieznany-model", { judge: false }).costUsd).toBeNull();
    expect(estimateRun(build, "gemini-3.5-flash-lite", { judge: true, judgeModel: "nieznany" }).costUsd).toBeNull();
    expect(estimateRun(build, "gemini-3.5-flash-lite", { judge: true }).costUsd).toBeNull();
  });

  it("EVAL: bez tur, jedna ocena; CHAT-S4: tury i analiza wpływu", () => {
    const evalCase = getCase("EVAL-01");
    const s4 = getCase("CHAT-S4");
    if (!evalCase || !s4) throw new Error("brak przypadku");
    expect(estimateRun(evalCase, "gemini-3.5-flash-lite", { judge: false })).toMatchObject({ turns: 0, calls: 1 });
    const impact = estimateRun(s4, "gemini-3.5-flash-lite", { judge: false });
    expect(impact.turns).toBe(2);
    expect(impact.calls).toBe(Math.round(2 * ESTIMATE_ASSUMPTIONS.callsPerChatTurn) + 1);
  });
});
