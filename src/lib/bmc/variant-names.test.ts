import { describe, expect, it } from "vitest";
import { nextCopyName } from "@/lib/bmc/variant-names";
import { VARIANT_NAME_MAX_LENGTH } from "@/lib/schemas/variant";

describe("nextCopyName", () => {
  it("pierwsza kopia dostaje przyrostek „(kopia)”", () => {
    expect(nextCopyName("Wariant główny", ["Wariant główny"])).toBe("Wariant główny (kopia)");
  });

  it("kolejne kopie dostają numery 2, 3…", () => {
    expect(nextCopyName("Wariant główny", ["Wariant główny", "Wariant główny (kopia)"])).toBe("Wariant główny (kopia 2)");
    expect(
      nextCopyName("Wariant główny", ["Wariant główny", "Wariant główny (kopia)", "Wariant główny (kopia 2)"]),
    ).toBe("Wariant główny (kopia 3)");
  });

  it("kopia kopii nie składa przyrostków", () => {
    expect(nextCopyName("Wariant (kopia)", ["Wariant", "Wariant (kopia)"])).toBe("Wariant (kopia 2)");
    expect(nextCopyName("Wariant (kopia 2)", ["Wariant", "Wariant (kopia)", "Wariant (kopia 2)"])).toBe("Wariant (kopia 3)");
  });

  it("zajęty numer w środku nie jest pomijany po cichu: bierze pierwszy wolny", () => {
    expect(nextCopyName("W", ["W", "W (kopia 2)"])).toBe("W (kopia)");
  });

  it("skraca nazwę bazową, żeby całość mieściła się w limicie", () => {
    const long = "a".repeat(VARIANT_NAME_MAX_LENGTH);
    const result = nextCopyName(long, [long]);
    expect(result.length).toBeLessThanOrEqual(VARIANT_NAME_MAX_LENGTH);
    expect(result.endsWith(" (kopia)")).toBe(true);
    expect(nextCopyName(long, [long, result]).endsWith(" (kopia 2)")).toBe(true);
  });
});
