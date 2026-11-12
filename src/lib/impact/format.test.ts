import { describe, expect, it } from "vitest";
import { describeChange, isImpactStale, sortAffected } from "@/lib/impact/format";
import type { AffectedBlock } from "@/lib/schemas/impact";

describe("sortAffected", () => {
  const affected: AffectedBlock[] = [
    { blockKey: "cost_structure", level: "low", impact: "a" },
    { blockKey: "revenue_streams", level: "high", impact: "b" },
    { blockKey: "customer_segments", level: "medium", impact: "c" },
    { blockKey: "channels", level: "high", impact: "d" },
  ];

  it("sortuje stopniem malejąco, potem kolejnością bloków, bez zmiany wejścia", () => {
    const copy = [...affected];
    expect(sortAffected(affected).map((item) => item.blockKey)).toEqual([
      "channels",
      "revenue_streams",
      "customer_segments",
      "cost_structure",
    ]);
    expect(affected).toEqual(copy);
  });
});

describe("describeChange", () => {
  it("opis użytkownika", () => {
    expect(describeChange({ kind: "DESCRIPTION", blockKey: "channels", description: "Tylko online" })).toBe(
      "Blok Kanały: Tylko online",
    );
  });

  it("propozycja: operacja i wpisy jako zwykły tekst", () => {
    const text = describeChange({
      kind: "PROPOSAL",
      blockKey: "channels",
      operation: "edit",
      before: "<b>Stary</b>",
      after: "Nowy",
    });
    expect(text).toContain("Zmiana wpisu");
    expect(text).toContain("„<b>Stary</b>” → „Nowy”");
  });

  it("dodanie i usunięcie pokazują tylko jeden wpis", () => {
    expect(describeChange({ kind: "PROPOSAL", blockKey: "channels", operation: "add", before: null, after: "X" })).toContain("„X”");
    expect(describeChange({ kind: "PROPOSAL", blockKey: "channels", operation: "remove", before: "Y", after: null })).not.toContain("→");
  });
});

describe("isImpactStale", () => {
  it("starsza wersja analizy niż aktualna", () => {
    expect(isImpactStale(2, 3)).toBe(true);
    expect(isImpactStale(3, 3)).toBe(false);
  });
});
