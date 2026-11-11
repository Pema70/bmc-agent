import { describe, expect, it } from "vitest";
import {
  CRITERION_LABELS,
  EVALUATION_CRITERIA,
  EVALUATION_SCHEMA_VERSION,
  EvaluationOutput,
  JUSTIFICATION_MAX_LENGTH,
} from "@/lib/schemas/evaluation";

function validOutput() {
  return {
    coherence: { score: 7, justification: "Bloki pasują do siebie." },
    risk_resilience: { score: 4, justification: "Zależność od jednego kanału." },
    feasibility: { score: 6, justification: "Wykonalne z brakami." },
    innovation: { score: 3, justification: "Znane rozwiązanie." },
  };
}

describe("EvaluationOutput", () => {
  it("przyjmuje poprawną ocenę czterech kryteriów", () => {
    expect(EvaluationOutput.safeParse(validOutput()).success).toBe(true);
  });

  it("ma kryterium ryzyka pod kluczem risk_resilience i etykietą „Ryzyko (10 = niskie)”", () => {
    expect(EVALUATION_CRITERIA).toEqual(["coherence", "risk_resilience", "feasibility", "innovation"]);
    expect(CRITERION_LABELS.risk_resilience).toBe("Ryzyko (10 = niskie)");
  });

  it("odrzuca oceny poza zakresem 1-10", () => {
    for (const score of [0, 11, -1]) {
      const output = { ...validOutput(), coherence: { score, justification: "x" } };
      expect(EvaluationOutput.safeParse(output).success).toBe(false);
    }
  });

  it("przyjmuje skrajne oceny 1 i 10", () => {
    const output = { ...validOutput(), coherence: { score: 1, justification: "x" }, innovation: { score: 10, justification: "y" } };
    expect(EvaluationOutput.safeParse(output).success).toBe(true);
  });

  it("odrzuca oceny niecałkowite i nie-liczby", () => {
    expect(EvaluationOutput.safeParse({ ...validOutput(), coherence: { score: 7.5, justification: "x" } }).success).toBe(false);
    expect(EvaluationOutput.safeParse({ ...validOutput(), coherence: { score: "7", justification: "x" } }).success).toBe(false);
  });

  it("odrzuca brakujące kryterium", () => {
    const { innovation: _omitted, ...rest } = validOutput();
    void _omitted;
    expect(EvaluationOutput.safeParse(rest).success).toBe(false);
  });

  it("odrzuca dodatkowy klucz (także w kryterium)", () => {
    expect(EvaluationOutput.safeParse({ ...validOutput(), extra: { score: 5, justification: "x" } }).success).toBe(false);
    expect(
      EvaluationOutput.safeParse({ ...validOutput(), coherence: { score: 5, justification: "x", note: "y" } }).success,
    ).toBe(false);
  });

  it("odrzuca puste i za długie uzasadnienie", () => {
    expect(EvaluationOutput.safeParse({ ...validOutput(), coherence: { score: 5, justification: "   " } }).success).toBe(false);
    expect(
      EvaluationOutput.safeParse({
        ...validOutput(),
        coherence: { score: 5, justification: "a".repeat(JUSTIFICATION_MAX_LENGTH + 1) },
      }).success,
    ).toBe(false);
  });

  it("wersja schematu zaczyna się od 1", () => {
    expect(EVALUATION_SCHEMA_VERSION).toBe(1);
  });
});
