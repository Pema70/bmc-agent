import { describe, expect, it } from "vitest";
import {
  addEntry,
  countChanges,
  remainingInBlock,
  remainingTotal,
  removeEntry,
  updateEntry,
} from "@/lib/bmc/state";
import {
  BMC_ENTRY_MAX_LENGTH,
  MAX_ENTRIES_PER_BLOCK,
  MAX_ENTRIES_TOTAL,
  emptyBmcState,
  type BmcState,
} from "@/lib/schemas/bmc";

function entries(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

function withChannels(...items: string[]): BmcState {
  return { ...emptyBmcState(), channels: items };
}

describe("addEntry", () => {
  it("dodaje przycięty wpis na koniec bloku i nie zmienia argumentu", () => {
    const state = withChannels("Sklep");

    const result = addEntry(state, "channels", "  Aplikacja  ");

    expect(result).toEqual({ ok: true, state: withChannels("Sklep", "Aplikacja") });
    expect(state.channels).toEqual(["Sklep"]);
  });

  it("odrzuca pusty i za długi wpis", () => {
    expect(addEntry(emptyBmcState(), "channels", "   ")).toEqual({ ok: false, error: "Wpis nie może być pusty." });
    expect(addEntry(emptyBmcState(), "channels", "a".repeat(BMC_ENTRY_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it(`odrzuca wpis ponad ${MAX_ENTRIES_PER_BLOCK} w bloku`, () => {
    const state = withChannels(...entries(MAX_ENTRIES_PER_BLOCK, "K"));

    expect(addEntry(state, "channels", "Jeszcze jeden")).toEqual({
      ok: false,
      error: `Blok ma już ${MAX_ENTRIES_PER_BLOCK} wpisów (limit na blok).`,
    });
  });

  it(`odrzuca wpis ponad ${MAX_ENTRIES_TOTAL} łącznie`, () => {
    const state: BmcState = {
      ...emptyBmcState(),
      customer_segments: entries(30, "S"),
      value_propositions: entries(30, "V"),
      channels: entries(30, "C"),
      customer_relationships: entries(30, "R"),
      revenue_streams: entries(30, "P"),
    };

    expect(addEntry(state, "key_resources", "Zespół")).toEqual({
      ok: false,
      error: `Model ma już ${MAX_ENTRIES_TOTAL} wpisów (limit łączny).`,
    });
  });
});

describe("updateEntry", () => {
  it("zmienia wskazany wpis", () => {
    expect(updateEntry(withChannels("A", "B"), "channels", 1, " C ")).toEqual({
      ok: true,
      state: withChannels("A", "C"),
    });
  });

  it("odrzuca pusty tekst i nieistniejący indeks", () => {
    expect(updateEntry(withChannels("A"), "channels", 0, "").ok).toBe(false);
    expect(updateEntry(withChannels("A"), "channels", 1, "B")).toEqual({ ok: false, error: "Ten wpis już nie istnieje." });
    expect(updateEntry(withChannels("A"), "channels", -1, "B").ok).toBe(false);
  });

  it("pozwala edytować wpis w pełnym bloku", () => {
    const state = withChannels(...entries(MAX_ENTRIES_PER_BLOCK, "K"));
    expect(updateEntry(state, "channels", 0, "Nowy").ok).toBe(true);
  });
});

describe("removeEntry", () => {
  it("usuwa wskazany wpis i nie zmienia argumentu", () => {
    const state = withChannels("A", "B", "C");

    expect(removeEntry(state, "channels", 1)).toEqual({ ok: true, state: withChannels("A", "C") });
    expect(state.channels).toEqual(["A", "B", "C"]);
  });

  it("odrzuca nieistniejący indeks", () => {
    expect(removeEntry(withChannels("A"), "channels", 5)).toEqual({ ok: false, error: "Ten wpis już nie istnieje." });
  });
});

describe("liczniki limitów", () => {
  it("liczą, ile wpisów zostało w bloku i łącznie", () => {
    const state = withChannels("A", "B");

    expect(remainingInBlock(state, "channels")).toBe(MAX_ENTRIES_PER_BLOCK - 2);
    expect(remainingInBlock(state, "cost_structure")).toBe(MAX_ENTRIES_PER_BLOCK);
    expect(remainingTotal(state)).toBe(MAX_ENTRIES_TOTAL - 2);
  });
});

describe("countChanges", () => {
  it("zwraca 0 dla identycznego stanu", () => {
    expect(countChanges(withChannels("A", "B"), withChannels("A", "B"))).toBe(0);
  });

  it("liczy dodanie, usunięcie i edycję po 1", () => {
    const saved = withChannels("A", "B");

    expect(countChanges(saved, withChannels("A", "B", "C"))).toBe(1);
    expect(countChanges(saved, withChannels("B"))).toBe(1);
    expect(countChanges(saved, withChannels("A", "X"))).toBe(1);
  });

  it("nie liczy przesunięcia wpisów po usunięciu jako wielu zmian", () => {
    expect(countChanges(withChannels("A", "B", "C", "D"), withChannels("B", "C", "D"))).toBe(1);
  });

  it("wraca do 0, gdy zmiana zostanie cofnięta ręcznie", () => {
    const saved = withChannels("A");
    const edited = updateEntry(saved, "channels", 0, "B");
    if (!edited.ok) {
      expect.fail("oczekiwano poprawnej edycji");
    }
    const reverted = updateEntry(edited.state, "channels", 0, "A");
    if (!reverted.ok) {
      expect.fail("oczekiwano poprawnej edycji");
    }
    expect(countChanges(saved, reverted.state)).toBe(0);
  });

  it("sumuje zmiany z różnych bloków i rozróżnia powtórzone wpisy", () => {
    const saved: BmcState = { ...emptyBmcState(), channels: ["A", "A"], cost_structure: ["X"] };
    const current: BmcState = { ...emptyBmcState(), channels: ["A"], cost_structure: ["X", "Y"] };

    expect(countChanges(saved, current)).toBe(2);
  });
});
