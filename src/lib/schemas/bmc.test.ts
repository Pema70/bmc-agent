import { describe, expect, it } from "vitest";
import {
  BLOCK_INFO,
  BLOCK_KEYS,
  BMC_ENTRY_MAX_LENGTH,
  BmcEntry,
  BmcState,
  MAX_ENTRIES_PER_BLOCK,
  MAX_ENTRIES_TOTAL,
  countEntries,
  emptyBmcState,
} from "@/lib/schemas/bmc";

function stateWith(counts: Partial<Record<(typeof BLOCK_KEYS)[number], number>>) {
  const state = emptyBmcState();
  for (const key of BLOCK_KEYS) {
    state[key] = Array.from({ length: counts[key] ?? 0 }, (_, i) => `${key} ${i + 1}`);
  }
  return state;
}

describe("BmcEntry", () => {
  it("przycina spacje", () => {
    expect(BmcEntry.parse("  Studenci  ")).toBe("Studenci");
  });

  it("odrzuca pusty wpis i wpis z samych spacji", () => {
    expect(BmcEntry.safeParse("").success).toBe(false);
    expect(BmcEntry.safeParse("   ").success).toBe(false);
  });

  it("pilnuje limitu długości", () => {
    expect(BmcEntry.safeParse("a".repeat(BMC_ENTRY_MAX_LENGTH)).success).toBe(true);
    expect(BmcEntry.safeParse("a".repeat(BMC_ENTRY_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe("BmcState", () => {
  it("akceptuje pusty stan i przycina wpisy", () => {
    expect(BmcState.parse(emptyBmcState())).toEqual(emptyBmcState());
    expect(BmcState.parse({ ...emptyBmcState(), channels: [" Sklep online "] }).channels).toEqual(["Sklep online"]);
  });

  it("wymaga wszystkich 9 bloków", () => {
    const missing: Record<string, string[]> = emptyBmcState();
    delete missing.cost_structure;
    expect(BmcState.safeParse(missing).success).toBe(false);
  });

  it("odrzuca nadmiarowy klucz", () => {
    expect(BmcState.safeParse({ ...emptyBmcState(), extra_block: [] }).success).toBe(false);
  });

  it("odrzuca pusty i za długi wpis w bloku", () => {
    expect(BmcState.safeParse({ ...emptyBmcState(), channels: [""] }).success).toBe(false);
    expect(
      BmcState.safeParse({ ...emptyBmcState(), channels: ["a".repeat(BMC_ENTRY_MAX_LENGTH + 1)] }).success,
    ).toBe(false);
  });

  it("odrzuca wartości, które nie są listą tekstów", () => {
    expect(BmcState.safeParse({ ...emptyBmcState(), channels: "Sklep" }).success).toBe(false);
    expect(BmcState.safeParse({ ...emptyBmcState(), channels: [42] }).success).toBe(false);
    expect(BmcState.safeParse(null).success).toBe(false);
  });

  it(`pilnuje limitu ${MAX_ENTRIES_PER_BLOCK} wpisów na blok`, () => {
    expect(BmcState.safeParse(stateWith({ channels: MAX_ENTRIES_PER_BLOCK })).success).toBe(true);
    expect(BmcState.safeParse(stateWith({ channels: MAX_ENTRIES_PER_BLOCK + 1 })).success).toBe(false);
  });

  it(`pilnuje limitu ${MAX_ENTRIES_TOTAL} wpisów łącznie`, () => {
    // 5 bloków po 30 = 150 (dokładnie limit), szósty blok z 1 wpisem przekracza go.
    const atLimit = stateWith({
      customer_segments: 30,
      value_propositions: 30,
      channels: 30,
      customer_relationships: 30,
      revenue_streams: 30,
    });
    expect(countEntries(atLimit)).toBe(MAX_ENTRIES_TOTAL);
    expect(BmcState.safeParse(atLimit).success).toBe(true);

    const overLimit = { ...atLimit, key_resources: ["Zespół"] };
    const result = BmcState.safeParse(overLimit);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(`Model może mieć łącznie najwyżej ${MAX_ENTRIES_TOTAL} wpisów.`);
  });
});

describe("emptyBmcState", () => {
  it("zwraca 9 pustych bloków", () => {
    const state = emptyBmcState();
    expect(Object.keys(state).sort()).toEqual([...BLOCK_KEYS].sort());
    expect(countEntries(state)).toBe(0);
  });

  it("zwraca za każdym razem nowy obiekt", () => {
    const first = emptyBmcState();
    first.channels.push("x");
    expect(emptyBmcState().channels).toEqual([]);
  });
});

describe("BLOCK_INFO", () => {
  it("ma polską nazwę i opis dla każdego bloku", () => {
    for (const key of BLOCK_KEYS) {
      expect(BLOCK_INFO[key].label.length).toBeGreaterThan(0);
      expect(BLOCK_INFO[key].description.length).toBeGreaterThan(0);
    }
  });
});
