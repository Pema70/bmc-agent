import { describe, expect, it } from "vitest";
import type { StrategyListItem } from "@/lib/db/strategies";
import { emptyBmcState } from "@/lib/schemas/bmc";
import type { StrategyGenerationView } from "@/lib/schemas/strategy";
import {
  STRATEGIES_LABEL,
  STRATEGIES_NOTICE,
  candidateEntryCount,
  describeGeneration,
  firstValidGenerationId,
  isStrategyStale,
  mergeStrategyItems,
  strategiesCountPhrase,
  strategyItemId,
} from "@/lib/strategies/presentation";

function generation(id: string, overrides: Partial<StrategyGenerationView> = {}): StrategyGenerationView {
  const state = { ...emptyBmcState(), channels: ["Sklep"] };
  return {
    id,
    createdAt: new Date("2026-11-16T10:05:00Z"),
    schemaVersion: 1,
    variantVersion: 3,
    guidelines: null,
    trigger: "UI",
    provider: "google",
    model: "gemini-3.5-flash-lite",
    promptVersion: "strategies-v1",
    result: {
      strategies: [
        { name: "A", assumption: "a", state },
        { name: "B", assumption: "b", state: { ...state, channels: ["Inny"] } },
      ],
    },
    savedVariants: [],
    ...overrides,
  };
}

const ok = (id: string, overrides: Partial<StrategyGenerationView> = {}): StrategyListItem => ({
  ok: true,
  generation: generation(id, overrides),
});
const broken = (id: string): StrategyListItem => ({ ok: false, id, error: "Zapisane strategie są niezgodne ze schematem." });

describe("stałe teksty", () => {
  it("etykieta i ostrzeżenie zgodne z ustaleniami", () => {
    expect(STRATEGIES_LABEL).toBe("Strategia AI");
    expect(STRATEGIES_NOTICE).toBe(
      "To propozycje modelu językowego oparte wyłącznie na Twoim modelu i wytycznych, a nie rekomendacje biznesowe. " +
        "Model nie sprawdza rynku ani danych liczbowych. Zapisanie strategii jako wariantu nie zmienia wariantu głównego.",
    );
  });
});

describe("isStrategyStale", () => {
  it("wynik jest nieaktualny tylko dla starszej wersji wariantu", () => {
    expect(isStrategyStale(3, 4)).toBe(true);
    expect(isStrategyStale(4, 4)).toBe(false);
    expect(isStrategyStale(5, 4)).toBe(false);
  });
});

describe("strategiesCountPhrase", () => {
  it.each([
    [1, "1 strategia"],
    [2, "2 strategie"],
    [3, "3 strategie"],
    [4, "4 strategie"],
    [5, "5 strategii"],
    [12, "12 strategii"],
    [22, "22 strategie"],
  ])("%i -> %s", (count, expected) => {
    expect(strategiesCountPhrase(count)).toBe(expected);
  });
});

describe("describeGeneration", () => {
  it("data (UTC), model, wersja promptu i liczba strategii", () => {
    expect(describeGeneration(generation("g1"))).toBe(
      "2026-11-16 10:05 UTC · google / gemini-3.5-flash-lite · prompt: strategies-v1 · 2 strategie",
    );
  });
});

describe("candidateEntryCount i firstValidGenerationId", () => {
  it("liczy wpisy wszystkich bloków", () => {
    expect(candidateEntryCount({ ...emptyBmcState(), channels: ["a", "b"], key_resources: ["c"] })).toBe(3);
  });

  it("pierwszy poprawny element, pomijając uszkodzone; null, gdy brak", () => {
    expect(firstValidGenerationId([broken("x"), ok("g1"), ok("g2")])).toBe("g1");
    expect(firstValidGenerationId([broken("x")])).toBeNull();
    expect(firstValidGenerationId([])).toBeNull();
  });
});

describe("mergeStrategyItems", () => {
  it("nowe generacje idą na początek, znane zachowują kolejność, bez duplikatów", () => {
    const merged = mergeStrategyItems([ok("g2"), ok("g1")], [ok("g3"), ok("g2"), ok("g1")]);

    expect(merged.map(strategyItemId)).toEqual(["g3", "g2", "g1"]);
  });

  it("nie usuwa lokalnych elementów, których nie ma w propsach (np. świeżo wygenerowanych)", () => {
    const merged = mergeStrategyItems([ok("lokalna"), ok("g1")], [ok("g1")]);

    expect(merged.map(strategyItemId)).toEqual(["lokalna", "g1"]);
  });

  it("sumuje zapisane warianty (zapis mógł nastąpić w innej karcie), bez dubli i posortowane", () => {
    const current = [ok("g1", { savedVariants: [{ index: 1, variantId: "v-b", name: "B" }] })];
    const incoming = [
      ok("g1", {
        savedVariants: [
          { index: 0, variantId: "v-a", name: "A" },
          { index: 1, variantId: "v-b", name: "B" },
        ],
      }),
    ];

    const merged = mergeStrategyItems(current, incoming);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      ok: true,
      generation: {
        savedVariants: [
          { index: 0, variantId: "v-a", name: "A" },
          { index: 1, variantId: "v-b", name: "B" },
        ],
      },
    });
  });

  it("uszkodzone rekordy są zachowane jako wiersze z błędem i nie psują reszty", () => {
    const merged = mergeStrategyItems([ok("g1")], [broken("zly"), ok("g1")]);

    expect(merged.map(strategyItemId)).toEqual(["zly", "g1"]);
    expect(merged[0]).toMatchObject({ ok: false });
  });

  it("zwraca nową tablicę i nie zmienia wejścia", () => {
    const current = [ok("g1")];
    const copy = structuredClone(current);

    mergeStrategyItems(current, [ok("g2")]);

    expect(current).toEqual(copy);
  });
});
