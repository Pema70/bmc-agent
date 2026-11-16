import { describe, expect, it } from "vitest";
import { uniqueVariantName } from "@/lib/bmc/variant-names";
import { VARIANT_NAME_MAX_LENGTH } from "@/lib/schemas/variant";

describe("uniqueVariantName", () => {
  it("wolna nazwa zostaje bez zmian (po przycięciu spacji)", () => {
    expect(uniqueVariantName("  Strategia online ", ["Wariant główny"])).toBe("Strategia online");
  });

  it("przy powtórzeniu dostaje numer (2), (3)…", () => {
    expect(uniqueVariantName("Strategia", ["Strategia"])).toBe("Strategia (2)");
    expect(uniqueVariantName("Strategia", ["Strategia", "Strategia (2)"])).toBe("Strategia (3)");
  });

  it("pierwszy wolny numer, także gdy (2) jest wolne, a (3) zajęte", () => {
    expect(uniqueVariantName("S", ["S", "S (3)"])).toBe("S (2)");
  });

  it("skraca nazwę bazową, żeby całość mieściła się w limicie", () => {
    const long = "a".repeat(VARIANT_NAME_MAX_LENGTH);
    const second = uniqueVariantName(long, [long]);
    expect(second.length).toBeLessThanOrEqual(VARIANT_NAME_MAX_LENGTH);
    expect(second.endsWith(" (2)")).toBe(true);
    expect(uniqueVariantName(long, [long, second]).endsWith(" (3)")).toBe(true);
  });
});
