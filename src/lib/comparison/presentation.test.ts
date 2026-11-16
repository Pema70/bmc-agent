import { describe, expect, it } from "vitest";
import type { ComparisonListItem } from "@/lib/db/comparisons";
import { emptyBmcState } from "@/lib/schemas/bmc";
import type { CompareOutput, VariantComparisonSummary, VariantComparisonView } from "@/lib/schemas/compare";
import {
  COMPARE_AI_LABEL,
  COMPARE_NOTICE,
  compareHref,
  comparisonItemId,
  describeComparison,
  describeStale,
  filterHistoryBySet,
  firstValidComparisonId,
  mergeComparisonItems,
  orderSelection,
  parseCompareParams,
  selectionState,
  staleVariants,
  summarizeComparison,
  variantDisplayNames,
} from "@/lib/comparison/presentation";

const assessment = (label: "A" | "B" | "C") => ({ label, pros: ["Zaleta"], cons: ["Wada"] });
const result: CompareOutput = {
  summary: "Różnią się kanałami.",
  blockNotes: [],
  variants: [assessment("A"), assessment("B")],
  recommendation: { label: null, rationale: "Brak jednoznacznego wskazania." },
};

function summary(id: string, variantIds: string[], overrides: Partial<VariantComparisonSummary> = {}): VariantComparisonSummary {
  return {
    id,
    createdAt: new Date("2026-11-17T08:30:00Z"),
    schemaVersion: 1,
    trigger: "UI",
    provider: "google",
    model: "gemini-3.5-flash-lite",
    promptVersion: "compare-v1",
    inputs: variantIds.map((variantId, index) => ({
      label: (["A", "B", "C"] as const)[index],
      variantId,
      name: `Wariant ${variantId}`,
      version: 2,
    })),
    result,
    ...overrides,
  };
}

const ok = (id: string, variantIds: string[]): ComparisonListItem => ({ ok: true, comparison: summary(id, variantIds) });
const broken = (id: string): ComparisonListItem => ({ ok: false, id, error: "Zapisane porównanie jest niezgodne ze schematem." });

describe("stałe teksty", () => {
  it("etykieta i ostrzeżenie zgodne z ustaleniami", () => {
    expect(COMPARE_AI_LABEL).toBe("Analiza AI");
    expect(COMPARE_NOTICE).toBe(
      "Porównanie i rekomendacja to opinia modelu językowego, a nie weryfikacja biznesowa. Różnice we wpisach wylicza aplikacja, nie model.",
    );
  });
});

describe("parseCompareParams", () => {
  it("powtórzone parametry w (tablica) i pojedynczy tekst: poprawna liczba to 2-3 różne id, kolejność z adresu", () => {
    expect(parseCompareParams(["v2", "v1"])).toEqual({ ok: true, ids: ["v2", "v1"] });
    expect(parseCompareParams(["v1", "v2", "v3"])).toEqual({ ok: true, ids: ["v1", "v2", "v3"] });
    expect(parseCompareParams("v1")).toEqual({ ok: false }); // jeden wariant
  });

  it("zły kształt: brak parametru, jeden, cztery, duplikaty, puste i za długie id", () => {
    expect(parseCompareParams(undefined)).toEqual({ ok: false });
    expect(parseCompareParams([])).toEqual({ ok: false });
    expect(parseCompareParams(["v1", "v2", "v3", "v4"])).toEqual({ ok: false });
    expect(parseCompareParams(["v1", "v1"])).toEqual({ ok: false });
    expect(parseCompareParams(["v1", ""])).toEqual({ ok: false });
    expect(parseCompareParams(["v1", "a".repeat(65)])).toEqual({ ok: false });
  });
});

describe("compareHref", () => {
  it("buduje adres z powtórzonymi parametrami w, z zakodowanymi id", () => {
    expect(compareHref("p1", ["v1", "v2"])).toBe("/projekty/p1/porownanie?w=v1&w=v2");
    expect(compareHref("p1", ["a&b=c", "v2", "v3"])).toBe("/projekty/p1/porownanie?w=a%26b%3Dc&w=v2&w=v3");
  });

  it("adres z compareHref przechodzi parseCompareParams", () => {
    const href = compareHref("p1", ["v1", "v2", "v3"]);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(parseCompareParams(params.getAll("w"))).toEqual({ ok: true, ids: ["v1", "v2", "v3"] });
  });
});

describe("selectionState i orderSelection", () => {
  it("przycisk aktywny tylko dla 2-3 zaznaczonych", () => {
    expect(selectionState(0).canCompare).toBe(false);
    expect(selectionState(1).canCompare).toBe(false);
    expect(selectionState(2).canCompare).toBe(true);
    expect(selectionState(3).canCompare).toBe(true);
    expect(selectionState(4).canCompare).toBe(false);
    expect(selectionState(1).hint).toContain("co najmniej 2");
    expect(selectionState(4).hint).toContain("najwyżej 3");
    expect(selectionState(2).hint).toContain("względem pierwszego zaznaczonego");
  });

  it("zaznaczone id w kolejności listy, pomija nieistniejące i nie zmienia wejścia", () => {
    const list = [{ id: "glowny" }, { id: "b" }, { id: "c" }];
    const selected = ["c", "glowny", "obcy"];

    expect(orderSelection(list, selected)).toEqual(["glowny", "c"]);
    expect(selected).toEqual(["c", "glowny", "obcy"]);
  });
});

describe("variantDisplayNames", () => {
  it("etykiety A/B/C zamieniane na nazwy z migawki", () => {
    expect(
      variantDisplayNames([
        { label: "A", name: "Wariant główny" },
        { label: "B", name: "Strategia firmowa" },
      ]),
    ).toMatchObject({ A: "Wariant główny", B: "Strategia firmowa" });
  });

  it("powtórzona nazwa dostaje etykietę, żeby dało się je odróżnić", () => {
    const names = variantDisplayNames([
      { label: "A", name: "Strategia" },
      { label: "B", name: "Strategia" },
      { label: "C", name: "Inna" },
    ]);

    expect(names).toEqual({ A: "Strategia (A)", B: "Strategia (B)", C: "Inna" });
  });
});

describe("staleVariants i describeStale", () => {
  const inputs = summary("c1", ["v1", "v2"]).inputs;

  it("wskazuje tylko warianty o wersji większej niż w migawce", () => {
    const stale = staleVariants(inputs, [
      { id: "v1", version: 2 },
      { id: "v2", version: 5 },
    ]);

    expect(stale).toEqual([{ label: "B", name: "Wariant v2", snapshotVersion: 2, currentVersion: 5 }]);
    expect(describeStale(stale[0])).toBe("Porównanie dotyczy wersji 2 wariantu Wariant v2, aktualna to 5.");
  });

  it("brak zmian, wersja nie większa i nieznany wariant nie dają znacznika", () => {
    expect(staleVariants(inputs, [{ id: "v1", version: 2 }, { id: "v2", version: 1 }])).toEqual([]);
    expect(staleVariants(inputs, [])).toEqual([]);
  });
});

describe("filterHistoryBySet", () => {
  it("zostawia porównania dokładnie tego zestawu id, niezależnie od kolejności; uszkodzone zostają jako błędy", () => {
    const items = [ok("c1", ["v1", "v2"]), ok("c2", ["v2", "v1"]), ok("c3", ["v1", "v3"]), ok("c4", ["v1", "v2", "v3"]), broken("zly")];

    const filtered = filterHistoryBySet(items, ["v1", "v2"]);

    expect(filtered.map(comparisonItemId)).toEqual(["c1", "c2", "zly"]);
  });

  it("pusta historia i brak dopasowania", () => {
    expect(filterHistoryBySet([], ["v1", "v2"])).toEqual([]);
    expect(filterHistoryBySet([ok("c1", ["v8", "v9"])], ["v1", "v2"])).toEqual([]);
  });
});

describe("summarizeComparison", () => {
  it("usuwa stany wariantów z migawki", () => {
    const view: VariantComparisonView = {
      id: "c1",
      createdAt: new Date("2026-11-17T08:30:00Z"),
      schemaVersion: 1,
      trigger: "UI",
      provider: "google",
      model: "m",
      promptVersion: "compare-v1",
      inputs: [
        { label: "A", variantId: "v1", name: "A", version: 1, state: { ...emptyBmcState(), channels: ["Sklep"] } },
        { label: "B", variantId: "v2", name: "B", version: 2, state: emptyBmcState() },
      ],
      result,
    };

    const summarized = summarizeComparison(view);

    expect(summarized.inputs).toEqual([
      { label: "A", variantId: "v1", name: "A", version: 1 },
      { label: "B", variantId: "v2", name: "B", version: 2 },
    ]);
    expect(JSON.stringify(summarized)).not.toContain("Sklep");
  });
});

describe("mergeComparisonItems, firstValidComparisonId, describeComparison", () => {
  it("nowe na początek, znane zachowują miejsce, nic nie jest usuwane, bez mutacji", () => {
    const current = [ok("lokalne", ["v1", "v2"]), ok("c1", ["v1", "v2"])];
    const copy = structuredClone(current);

    const merged = mergeComparisonItems(current, [ok("c2", ["v1", "v2"]), ok("c1", ["v1", "v2"])]);

    expect(merged.map(comparisonItemId)).toEqual(["c2", "lokalne", "c1"]);
    expect(current).toEqual(copy);
  });

  it("pierwszy poprawny element listy", () => {
    expect(firstValidComparisonId([broken("x"), ok("c1", ["v1", "v2"])])).toBe("c1");
    expect(firstValidComparisonId([broken("x")])).toBeNull();
  });

  it("opis historii: data UTC, model, wersja promptu", () => {
    expect(describeComparison(summary("c1", ["v1", "v2"]))).toBe(
      "2026-11-17 08:30 UTC · google / gemini-3.5-flash-lite · prompt: compare-v1",
    );
  });
});
