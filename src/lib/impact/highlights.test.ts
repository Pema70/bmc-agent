import { describe, expect, it } from "vitest";
import { impactHighlights } from "@/lib/impact/highlights";
import type { ImpactOutput, ImpactView } from "@/lib/schemas/impact";

function analysis(result: ImpactOutput, blockKey: "channels" | "cost_structure" = "channels"): ImpactView {
  return {
    id: "a1",
    createdAt: new Date("2026-11-12T10:00:00Z"),
    schemaVersion: 1,
    variantVersion: 4,
    proposalId: null,
    change: { kind: "DESCRIPTION", blockKey, description: "Tylko online" },
    trigger: "UI",
    provider: "google",
    model: "m",
    promptVersion: "impact-v1",
    result,
  };
}

describe("impactHighlights", () => {
  const result: ImpactOutput = {
    summary: "x",
    affected: [
      { blockKey: "cost_structure", level: "low", impact: "a" },
      { blockKey: "revenue_streams", level: "high", impact: "b" },
      { blockKey: "customer_segments", level: "medium", impact: "c" },
      { blockKey: "customer_relationships", level: "high", impact: "d" },
    ],
  };

  it("kolejność: stopień malejąco, potem kanoniczna kolejność bloków", () => {
    expect(impactHighlights(analysis(result)).ordered.map((item) => item.blockKey)).toEqual([
      "customer_relationships",
      "revenue_streams",
      "customer_segments",
      "cost_structure",
    ]);
  });

  it("zwraca blok zmieniany, id i wersję analizy", () => {
    expect(impactHighlights(analysis(result))).toMatchObject({ analysisId: "a1", variantVersion: 4, changedBlock: "channels" });
  });

  it("etykiety stopni: Wpływ: niski / średni / wysoki", () => {
    const highlights = impactHighlights(analysis(result));
    expect(highlights.byBlock.cost_structure?.label).toBe("Wpływ: niski");
    expect(highlights.byBlock.customer_segments?.label).toBe("Wpływ: średni");
    expect(highlights.byBlock.revenue_streams?.label).toBe("Wpływ: wysoki");
    expect(highlights.byBlock.revenue_streams).toMatchObject({ level: "high", impact: "b" });
  });

  it("blok zmieniany nie jest dotknięty, nawet gdy rekord go zawiera", () => {
    const withChanged: ImpactOutput = {
      summary: "x",
      affected: [...result.affected, { blockKey: "channels", level: "high", impact: "sam siebie" }],
    };
    const highlights = impactHighlights(analysis(withChanged));
    expect(highlights.byBlock.channels).toBeUndefined();
    expect(highlights.ordered.some((item) => item.blockKey === "channels")).toBe(false);
  });

  it("pusta lista affected: brak wyróżnień, ale blok zmieniany znany", () => {
    const highlights = impactHighlights(analysis({ summary: "Izolowana.", affected: [] }, "cost_structure"));
    expect(highlights.ordered).toEqual([]);
    expect(highlights.byBlock).toEqual({});
    expect(highlights.changedBlock).toBe("cost_structure");
  });

  it("nie zmienia wejścia", () => {
    const input = analysis(result);
    const copy = structuredClone(input.result);
    impactHighlights(input);
    expect(input.result).toEqual(copy);
  });
});
