import { describe, expect, it } from "vitest";
import { buildEvaluateSystemPrompt } from "@/lib/ai/prompts/evaluate";
import { CRITERION_RUBRIC, RUBRIC_RISK_REMINDER } from "@/lib/evaluation/rubric";
import { EVALUATION_CRITERIA } from "@/lib/schemas/evaluation";

describe("CRITERION_RUBRIC", () => {
  const prompt = buildEvaluateSystemPrompt();

  it("ma definicję dla każdego z czterech kryteriów", () => {
    expect(Object.keys(CRITERION_RUBRIC).sort()).toEqual([...EVALUATION_CRITERIA].sort());
  });

  it("każda definicja i próg występują dosłownie w prompcie oceny AI (jedno źródło prawdy dla porównywalności)", () => {
    for (const criterion of EVALUATION_CRITERIA) {
      const { description, low, mid, high } = CRITERION_RUBRIC[criterion];
      expect(prompt, `${criterion}: opis`).toContain(`${criterion}`);
      expect(prompt, `${criterion}: opis i progi`).toContain(`${description} 1-3: ${low}; 4-6: ${mid}; 7-10: ${high}`);
    }
  });

  it("przypomnienie o orientacji ryzyka jest w prompcie", () => {
    expect(prompt).toContain(RUBRIC_RISK_REMINDER);
  });
});
