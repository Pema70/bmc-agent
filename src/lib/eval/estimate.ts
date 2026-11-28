import { MODEL_PRICING } from "@/lib/ai/models";
import type { EvalCaseDefinition } from "@/lib/eval/cases";

// Szacunek kosztu do trybu na sucho (plan 10f). NIEZMIERZONY: stałe z pomiaru 10e (tury czatu na gemini-3.5-flash-lite:
// ok. 4,4 do 9,7 tys. tokenów wejścia na turę, ok. 1,5 kroku na turę) i założeń z planu kroku 10; pilot w 10g je koryguje.
export const ESTIMATE_ASSUMPTIONS = {
  chatTurnInputTokens: 7_000,
  chatTurnOutputTokens: 1_000,
  callsPerChatTurn: 1.5,
  evaluateInputTokens: 2_500,
  evaluateOutputTokens: 700,
  impactInputTokens: 3_000,
  impactOutputTokens: 800,
  judgeInputTokens: 2_000,
  judgeOutputTokens: 800,
  judgeRuns: 3,
} as const;

export type RunEstimate = { turns: number; calls: number; costUsd: number | null };

function tokensCost(key: string, inputTokens: number, outputTokens: number): number | null {
  const price = MODEL_PRICING[key];
  if (!price) return null;
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
}

/**
 * Szacunek jednego przebiegu przypadku: liczba tur czatu, liczba wywołań modelu i koszt w USD (null, gdy cennik nie zna
 * modelu generującego albo sędziego). Sędzia: 3 sądy na gotowy model (BUILD i EVAL), jeśli `judge`.
 */
export function estimateRun(definition: EvalCaseDefinition, model: string, options: { judge: boolean; judgeModel?: string }): RunEstimate {
  const a = ESTIMATE_ASSUMPTIONS;
  const chatKey = `google/${model}`;
  let turns = 0;
  let calls = 0;
  let cost: number | null = 0;

  const add = (amount: number | null) => {
    cost = cost === null || amount === null ? null : cost + amount;
  };

  if (definition.kind === "BUILD") {
    turns = definition.messages.length;
  } else if (definition.kind === "CHAT") {
    turns = definition.turns.filter((t) => t.type === "message").length;
  }
  calls += Math.round(turns * a.callsPerChatTurn);
  add(tokensCost(chatKey, turns * a.chatTurnInputTokens, turns * a.chatTurnOutputTokens));

  if (definition.kind === "EVAL" || definition.id === "CHAT-S3") {
    calls += 1;
    add(tokensCost(chatKey, a.evaluateInputTokens, a.evaluateOutputTokens));
  }
  if (definition.id === "CHAT-S4") {
    calls += 1;
    add(tokensCost(chatKey, a.impactInputTokens, a.impactOutputTokens));
  }
  if (options.judge && (definition.kind === "BUILD" || definition.kind === "EVAL")) {
    calls += a.judgeRuns;
    add(
      options.judgeModel
        ? tokensCost(`anthropic/${options.judgeModel}`, a.judgeRuns * a.judgeInputTokens, a.judgeRuns * a.judgeOutputTokens)
        : null,
    );
  }
  return { turns, calls, costUsd: cost };
}
