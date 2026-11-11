import { describe, expect, it } from "vitest";
import { applyProposal, checkProposable, type ProposalChange } from "@/lib/bmc/proposals";
import { MAX_ENTRIES_PER_BLOCK, MAX_ENTRIES_TOTAL, emptyBmcState } from "@/lib/schemas/bmc";

const state = { ...emptyBmcState(), channels: ["Sklep online", "Targi"], revenue_streams: ["Sprzedaż"] };

function change(partial: Partial<ProposalChange>): ProposalChange {
  return { blockKey: "channels", operation: "add", before: null, after: null, ...partial };
}

function entries(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

describe("applyProposal", () => {
  it("add dopisuje wpis na końcu bloku i nie zmienia argumentu", () => {
    const snapshot = JSON.stringify(state);

    const result = applyProposal(state, change({ operation: "add", after: "Sprzedaż w sklepie" }));

    expect(result).toEqual({ ok: true, state: { ...state, channels: ["Sklep online", "Targi", "Sprzedaż w sklepie"] } });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("add wpisu identycznego z istniejącym daje DUPLICATE", () => {
    expect(applyProposal(state, change({ operation: "add", after: "Targi" }))).toEqual({
      ok: false,
      error: "DUPLICATE",
    });
  });

  it("edit podmienia wskazany wpis", () => {
    const result = applyProposal(state, change({ operation: "edit", before: "Targi", after: "Targi branżowe" }));

    expect(result).toEqual({ ok: true, state: { ...state, channels: ["Sklep online", "Targi branżowe"] } });
  });

  it("edit nieistniejącego wpisu daje STALE", () => {
    expect(applyProposal(state, change({ operation: "edit", before: "Brak", after: "x" }))).toEqual({
      ok: false,
      error: "STALE",
    });
  });

  it("edit na tekst, który już jest w bloku, daje DUPLICATE", () => {
    expect(applyProposal(state, change({ operation: "edit", before: "Targi", after: "Sklep online" }))).toEqual({
      ok: false,
      error: "DUPLICATE",
    });
  });

  it("remove usuwa wskazany wpis", () => {
    expect(applyProposal(state, change({ operation: "remove", before: "Sklep online" }))).toEqual({
      ok: true,
      state: { ...state, channels: ["Targi"] },
    });
  });

  it("remove nieistniejącego wpisu daje STALE", () => {
    expect(applyProposal(state, change({ operation: "remove", before: "Brak" }))).toEqual({
      ok: false,
      error: "STALE",
    });
  });

  it("edit i remove działają na pierwszym z duplikatów w bloku", () => {
    const withDuplicates = { ...emptyBmcState(), channels: ["A", "B", "A"] };

    const result = applyProposal(withDuplicates, change({ operation: "remove", before: "A" }));

    expect(result).toEqual({ ok: true, state: { ...withDuplicates, channels: ["B", "A"] } });
  });

  it("add ponad limit wpisów w bloku daje LIMIT", () => {
    const full = { ...emptyBmcState(), channels: entries(MAX_ENTRIES_PER_BLOCK, "Kanał") };

    expect(applyProposal(full, change({ operation: "add", after: "Nowy" }))).toEqual({ ok: false, error: "LIMIT" });
  });

  it("add ponad limit łączny daje LIMIT", () => {
    const perBlock = MAX_ENTRIES_TOTAL / 5;
    const full = {
      ...emptyBmcState(),
      customer_segments: entries(perBlock, "S"),
      value_propositions: entries(perBlock, "V"),
      revenue_streams: entries(perBlock, "R"),
      key_resources: entries(perBlock, "Z"),
      key_activities: entries(perBlock, "D"),
    };

    expect(applyProposal(full, change({ blockKey: "channels", operation: "add", after: "Nowy" }))).toEqual({
      ok: false,
      error: "LIMIT",
    });
  });

  it("dopuszcza wpis na granicy limitu", () => {
    const almost = { ...emptyBmcState(), channels: entries(MAX_ENTRIES_PER_BLOCK - 1, "Kanał") };

    expect(applyProposal(almost, change({ operation: "add", after: "Ostatni" })).ok).toBe(true);
  });
});

describe("checkProposable", () => {
  it("dla poprawnej propozycji zwraca ok", () => {
    expect(checkProposable(state, change({ operation: "add", after: "Nowy kanał" }))).toEqual({ ok: true });
  });

  it("odrzuca ADD wpisu identycznego z istniejącym z powodem dla modelu", () => {
    const result = checkProposable(state, change({ operation: "add", after: "Sklep online" }));

    expect(result).toMatchObject({ ok: false, error: "DUPLICATE" });
    expect(result.ok === false && result.reason).toContain("już istnieje");
  });

  it("dla nieistniejącego before podaje powód z prośbą o dokładny tekst", () => {
    const result = checkProposable(state, change({ operation: "edit", before: "Brak", after: "x" }));

    expect(result).toMatchObject({ ok: false, error: "STALE" });
    expect(result.ok === false && result.reason).toContain("dokładny tekst istniejącego wpisu");
  });

  it("nie zmienia stanu", () => {
    const snapshot = JSON.stringify(state);

    checkProposable(state, change({ operation: "remove", before: "Targi" }));

    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
