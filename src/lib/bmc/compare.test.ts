import { describe, expect, it } from "vitest";
import { compareStates } from "@/lib/bmc/compare";
import { BLOCK_KEYS, emptyBmcState, type BmcState } from "@/lib/schemas/bmc";

const reference: BmcState = {
  ...emptyBmcState(),
  customer_segments: ["Studenci", "Firmy"],
  channels: ["Aplikacja", "Social media"],
  revenue_streams: ["Subskrypcja"],
};

describe("compareStates", () => {
  it("dwa warianty: wspólne, dodane i brakujące wpisy per blok", () => {
    const other: BmcState = {
      ...emptyBmcState(),
      customer_segments: ["Studenci", "Seniorzy"],
      channels: ["Aplikacja"],
      key_partnerships: ["Uczelnie"],
    };

    const result = compareStates([reference, other]);

    expect(result.referenceIndex).toBe(0);
    expect(result.others).toHaveLength(1);
    const diff = result.others[0];
    expect(diff.index).toBe(1);
    expect(diff.blocks.customer_segments).toEqual({ shared: ["Studenci"], added: ["Seniorzy"], missing: ["Firmy"] });
    expect(diff.blocks.channels).toEqual({ shared: ["Aplikacja"], added: [], missing: ["Social media"] });
    expect(diff.blocks.key_partnerships).toEqual({ shared: [], added: ["Uczelnie"], missing: [] });
    expect(diff.blocks.revenue_streams).toEqual({ shared: [], added: [], missing: ["Subskrypcja"] });
    expect(diff.totals).toEqual({ shared: 2, added: 2, missing: 3 });
  });

  it("trzy warianty: każdy porównany z pierwszym, w kolejności wejścia", () => {
    const b: BmcState = { ...emptyBmcState(), channels: ["Aplikacja", "Newsletter"] };
    const c: BmcState = { ...emptyBmcState(), channels: ["Social media"] };

    const result = compareStates([reference, b, c]);

    expect(result.others.map((item) => item.index)).toEqual([1, 2]);
    expect(result.others[0].blocks.channels).toEqual({ shared: ["Aplikacja"], added: ["Newsletter"], missing: ["Social media"] });
    expect(result.others[1].blocks.channels).toEqual({ shared: ["Social media"], added: [], missing: ["Aplikacja"] });
  });

  it("identyczne stany: same wspólne, nic dodanego ani brakującego", () => {
    const result = compareStates([reference, structuredClone(reference)]);

    expect(result.others[0].totals).toEqual({ shared: 5, added: 0, missing: 0 });
    for (const key of BLOCK_KEYS) {
      expect(result.others[0].blocks[key].added).toEqual([]);
      expect(result.others[0].blocks[key].missing).toEqual([]);
    }
  });

  it("puste bloki po obu stronach nie dają żadnych różnic", () => {
    const result = compareStates([emptyBmcState(), emptyBmcState()]);

    expect(result.others[0].totals).toEqual({ shared: 0, added: 0, missing: 0 });
    for (const key of BLOCK_KEYS) {
      expect(result.others[0].blocks[key]).toEqual({ shared: [], added: [], missing: [] });
    }
  });

  it("wszystkie dziewięć bloków jest zawsze obecne w wyniku", () => {
    const result = compareStates([emptyBmcState(), reference]);

    expect(Object.keys(result.others[0].blocks).sort()).toEqual([...BLOCK_KEYS].sort());
  });

  it("przeredagowany wpis liczy się jako brakujący + dodany (różnica tekstowa, nie semantyczna)", () => {
    const original: BmcState = { ...emptyBmcState(), channels: ["Sklep internetowy"] };
    const reworded: BmcState = { ...emptyBmcState(), channels: ["Internetowy sklep"] };

    const diff = compareStates([original, reworded]).others[0].blocks.channels;

    expect(diff).toEqual({ shared: [], added: ["Internetowy sklep"], missing: ["Sklep internetowy"] });
  });

  it("porównuje dosłowny tekst po trim, z rozróżnieniem wielkości liter", () => {
    const a: BmcState = { ...emptyBmcState(), channels: ["Aplikacja", "sklep"] };
    const b: BmcState = { ...emptyBmcState(), channels: ["  Aplikacja  ", "Sklep"] };

    const diff = compareStates([a, b]).others[0].blocks.channels;

    expect(diff.shared).toEqual(["Aplikacja"]);
    expect(diff.added).toEqual(["Sklep"]);
    expect(diff.missing).toEqual(["sklep"]);
  });

  it("duplikaty traktuje jak multizbiór: nadmiarowy wpis jest dodany, brakujący jest brakujący", () => {
    const a: BmcState = { ...emptyBmcState(), channels: ["Sklep", "Sklep"] };
    const b: BmcState = { ...emptyBmcState(), channels: ["Sklep", "Sklep", "Sklep"] };

    expect(compareStates([a, b]).others[0].blocks.channels).toEqual({ shared: ["Sklep", "Sklep"], added: ["Sklep"], missing: [] });
    expect(compareStates([b, a]).others[0].blocks.channels).toEqual({ shared: ["Sklep", "Sklep"], added: [], missing: ["Sklep"] });
  });

  it("kolejność wpisów: wspólne i dodane wg porównywanego wariantu, brakujące wg odniesienia", () => {
    const a: BmcState = { ...emptyBmcState(), channels: ["1", "2", "3", "4"] };
    const b: BmcState = { ...emptyBmcState(), channels: ["4", "x", "2", "y"] };

    expect(compareStates([a, b]).others[0].blocks.channels).toEqual({ shared: ["4", "2"], added: ["x", "y"], missing: ["1", "3"] });
  });

  it("nie zmienia wejścia i jest deterministyczna", () => {
    const states = [structuredClone(reference), { ...emptyBmcState(), channels: ["Aplikacja", "Nowy"] }];
    const snapshot = structuredClone(states);

    const first = compareStates(states);
    const second = compareStates(states);

    expect(states).toEqual(snapshot);
    expect(first).toEqual(second);
  });

  it("jeden wariant (lub brak) nie daje żadnych porównań", () => {
    expect(compareStates([reference]).others).toEqual([]);
    expect(compareStates([]).others).toEqual([]);
  });
});
