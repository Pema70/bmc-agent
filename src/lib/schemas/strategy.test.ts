import { describe, expect, it } from "vitest";
import {
  GenerateStrategiesInput,
  SaveStrategyInput,
  StrategyGuidelines,
  STRATEGY_GUIDELINES_MAX_LENGTH,
} from "@/lib/schemas/strategy";

describe("StrategyGuidelines", () => {
  it("przycina spacje, pusty tekst, null i brak dają null", () => {
    expect(StrategyGuidelines.parse("  Skup się na firmach ")).toBe("Skup się na firmach");
    expect(StrategyGuidelines.parse("   ")).toBeNull();
    expect(StrategyGuidelines.parse("")).toBeNull();
    expect(StrategyGuidelines.parse(null)).toBeNull();
    expect(StrategyGuidelines.parse(undefined)).toBeNull();
  });

  it("limit 500 znaków i tylko tekst", () => {
    expect(StrategyGuidelines.safeParse("a".repeat(STRATEGY_GUIDELINES_MAX_LENGTH)).success).toBe(true);
    expect(StrategyGuidelines.safeParse("a".repeat(STRATEGY_GUIDELINES_MAX_LENGTH + 1)).success).toBe(false);
    expect(StrategyGuidelines.safeParse(5).success).toBe(false);
  });
});

describe("GenerateStrategiesInput", () => {
  it("wytyczne są opcjonalne, nieznane klucze odrzucone", () => {
    expect(GenerateStrategiesInput.parse({})).toEqual({ guidelines: null });
    expect(GenerateStrategiesInput.parse({ guidelines: "Mniej kosztów" })).toEqual({ guidelines: "Mniej kosztów" });
    expect(GenerateStrategiesInput.safeParse({ guidelines: "x", variantId: "v1" }).success).toBe(false);
  });
});

describe("SaveStrategyInput", () => {
  const valid = { variantId: "v1", generationId: "g1", index: 0 };

  it("przyjmuje numer strategii 0-2", () => {
    expect(SaveStrategyInput.safeParse(valid).success).toBe(true);
    expect(SaveStrategyInput.safeParse({ ...valid, index: 2 }).success).toBe(true);
  });

  it("odrzuca numer spoza zakresu, niecałkowity, tekstowy oraz puste i za długie id", () => {
    expect(SaveStrategyInput.safeParse({ ...valid, index: 3 }).success).toBe(false);
    expect(SaveStrategyInput.safeParse({ ...valid, index: -1 }).success).toBe(false);
    expect(SaveStrategyInput.safeParse({ ...valid, index: 0.5 }).success).toBe(false);
    expect(SaveStrategyInput.safeParse({ ...valid, index: "0" }).success).toBe(false);
    expect(SaveStrategyInput.safeParse({ ...valid, generationId: "" }).success).toBe(false);
    expect(SaveStrategyInput.safeParse({ ...valid, generationId: "a".repeat(65) }).success).toBe(false);
    expect(SaveStrategyInput.safeParse({ ...valid, state: {} }).success).toBe(false);
  });
});
