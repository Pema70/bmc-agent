import { describe, expect, it } from "vitest";
import { emptyBmcState } from "@/lib/schemas/bmc";
import {
  COMPARE_BLOCK_NOTE_MAX_LENGTH,
  COMPARE_POINTS_MAX,
  COMPARE_POINT_MAX_LENGTH,
  COMPARE_RATIONALE_MAX_LENGTH,
  COMPARE_SUMMARY_MAX_LENGTH,
  CompareOutput,
  CompareVariantIds,
  VariantComparisonInputs,
} from "@/lib/schemas/compare";

const assessment = (label: string) => ({ label, pros: ["Zaleta"], cons: ["Wada"] });
const good = {
  summary: "Warianty różnią się kanałami.",
  blockNotes: [{ blockKey: "channels", comment: "A sprzedaje online, B stacjonarnie." }],
  variants: [assessment("A"), assessment("B")],
  recommendation: { label: "A", rationale: "Spójniejszy model." },
};

describe("CompareOutput", () => {
  it("przyjmuje poprawny wynik dla 2 i 3 wariantów oraz rekomendację null", () => {
    expect(CompareOutput.safeParse(good).success).toBe(true);
    expect(CompareOutput.safeParse({ ...good, variants: [assessment("A"), assessment("B"), assessment("C")] }).success).toBe(true);
    expect(CompareOutput.safeParse({ ...good, recommendation: { label: null, rationale: "Brak jednoznacznego wskazania." } }).success).toBe(true);
    expect(CompareOutput.safeParse({ ...good, blockNotes: [] }).success).toBe(true);
  });

  it("odrzuca brak etykiety, nieznaną etykietę i etykietę małą literą", () => {
    expect(CompareOutput.safeParse({ ...good, variants: [{ pros: ["a"], cons: ["b"] }, assessment("B")] }).success).toBe(false);
    expect(CompareOutput.safeParse({ ...good, variants: [assessment("A"), assessment("D")] }).success).toBe(false);
    expect(CompareOutput.safeParse({ ...good, variants: [assessment("A"), assessment("b")] }).success).toBe(false);
  });

  it("odrzuca 1 i 4 warianty oraz powtórzoną etykietę", () => {
    expect(CompareOutput.safeParse({ ...good, variants: [assessment("A")] }).success).toBe(false);
    expect(
      CompareOutput.safeParse({ ...good, variants: [assessment("A"), assessment("B"), assessment("C"), assessment("A")] }).success,
    ).toBe(false);
    expect(CompareOutput.safeParse({ ...good, variants: [assessment("A"), assessment("A")] }).success).toBe(false);
  });

  it("rekomendacja: etykieta spoza A/B/C, brak pola label i brak uzasadnienia są odrzucone", () => {
    expect(CompareOutput.safeParse({ ...good, recommendation: { label: "Z", rationale: "x" } }).success).toBe(false);
    expect(CompareOutput.safeParse({ ...good, recommendation: { rationale: "x" } }).success).toBe(false);
    expect(CompareOutput.safeParse({ ...good, recommendation: { label: "A", rationale: "" } }).success).toBe(false);
    expect(CompareOutput.safeParse({ ...good, recommendation: { label: "A", rationale: "x", id: "v1" } }).success).toBe(false);
  });

  it("odrzuca dodatkowe klucze (np. identyfikator wariantu) na każdym poziomie", () => {
    expect(CompareOutput.safeParse({ ...good, id: "podrobione" }).success).toBe(false);
    expect(CompareOutput.safeParse({ ...good, variants: [{ ...assessment("A"), variantId: "v1" }, assessment("B")] }).success).toBe(false);
    expect(CompareOutput.safeParse({ ...good, blockNotes: [{ blockKey: "channels", comment: "x", extra: 1 }] }).success).toBe(false);
  });

  it("uwagi do bloków: zły klucz bloku i powtórzony blok są odrzucone, najwyżej 9", () => {
    expect(CompareOutput.safeParse({ ...good, blockNotes: [{ blockKey: "nieznany", comment: "x" }] }).success).toBe(false);
    expect(
      CompareOutput.safeParse({
        ...good,
        blockNotes: [
          { blockKey: "channels", comment: "a" },
          { blockKey: "channels", comment: "b" },
        ],
      }).success,
    ).toBe(false);
  });

  it("za długie i puste pola", () => {
    expect(CompareOutput.safeParse({ ...good, summary: "a".repeat(COMPARE_SUMMARY_MAX_LENGTH + 1) }).success).toBe(false);
    expect(CompareOutput.safeParse({ ...good, summary: "" }).success).toBe(false);
    expect(
      CompareOutput.safeParse({ ...good, blockNotes: [{ blockKey: "channels", comment: "a".repeat(COMPARE_BLOCK_NOTE_MAX_LENGTH + 1) }] }).success,
    ).toBe(false);
    expect(
      CompareOutput.safeParse({ ...good, variants: [{ ...assessment("A"), pros: ["a".repeat(COMPARE_POINT_MAX_LENGTH + 1)] }, assessment("B")] }).success,
    ).toBe(false);
    expect(
      CompareOutput.safeParse({ ...good, variants: [{ ...assessment("A"), cons: Array.from({ length: COMPARE_POINTS_MAX + 1 }, () => "x") }, assessment("B")] })
        .success,
    ).toBe(false);
    expect(CompareOutput.safeParse({ ...good, variants: [{ ...assessment("A"), pros: [] }, assessment("B")] }).success).toBe(false);
    expect(
      CompareOutput.safeParse({ ...good, recommendation: { label: "A", rationale: "a".repeat(COMPARE_RATIONALE_MAX_LENGTH + 1) } }).success,
    ).toBe(false);
  });

  it("najgorszy przypadek na granicy limitów jest poprawny i mieści się w budżecie znaków", () => {
    const full = (label: string) => ({
      label,
      pros: Array.from({ length: COMPARE_POINTS_MAX }, () => "p".repeat(COMPARE_POINT_MAX_LENGTH)),
      cons: Array.from({ length: COMPARE_POINTS_MAX }, () => "c".repeat(COMPARE_POINT_MAX_LENGTH)),
    });
    const keys = ["customer_segments", "value_propositions", "channels", "customer_relationships", "revenue_streams", "key_resources", "key_activities", "key_partnerships", "cost_structure"];
    const worst = {
      summary: "s".repeat(COMPARE_SUMMARY_MAX_LENGTH),
      blockNotes: keys.map((blockKey) => ({ blockKey, comment: "n".repeat(COMPARE_BLOCK_NOTE_MAX_LENGTH) })),
      variants: [full("A"), full("B"), full("C")],
      recommendation: { label: "A", rationale: "r".repeat(COMPARE_RATIONALE_MAX_LENGTH) },
    };

    expect(CompareOutput.safeParse(worst).success).toBe(true);
    // Szacunek z komentarza: ok. 9,3 tys. znaków, a przy ok. 3,6 znaku na token ok. 2,6 tys. tokenów (limit 12000).
    expect(JSON.stringify(worst).length).toBeLessThan(10_000);
    expect(JSON.stringify(worst).length / 3.6).toBeLessThan(12_000 / 4);
  });
});

describe("CompareVariantIds", () => {
  it("2-3 różne identyfikatory", () => {
    expect(CompareVariantIds.safeParse(["v1", "v2"]).success).toBe(true);
    expect(CompareVariantIds.safeParse(["v1", "v2", "v3"]).success).toBe(true);
  });

  it("1, 4, duplikaty, puste id i nie-tablica są odrzucone", () => {
    expect(CompareVariantIds.safeParse(["v1"]).success).toBe(false);
    expect(CompareVariantIds.safeParse(["v1", "v2", "v3", "v4"]).success).toBe(false);
    expect(CompareVariantIds.safeParse(["v1", "v1"]).success).toBe(false);
    expect(CompareVariantIds.safeParse(["v1", ""]).success).toBe(false);
    expect(CompareVariantIds.safeParse("v1").success).toBe(false);
  });
});

describe("VariantComparisonInputs", () => {
  const item = (label: string, variantId: string) => ({ label, variantId, name: `Wariant ${label}`, version: 1, state: emptyBmcState() });

  it("migawka 2-3 wariantów z unikalnymi etykietami", () => {
    expect(VariantComparisonInputs.safeParse([item("A", "v1"), item("B", "v2")]).success).toBe(true);
    expect(VariantComparisonInputs.safeParse([item("A", "v1")]).success).toBe(false);
    expect(VariantComparisonInputs.safeParse([item("A", "v1"), item("A", "v2")]).success).toBe(false);
    expect(VariantComparisonInputs.safeParse([item("A", "v1"), { ...item("B", "v2"), state: { channels: 5 } }]).success).toBe(false);
    expect(VariantComparisonInputs.safeParse([item("A", "v1"), { ...item("B", "v2"), extra: 1 }]).success).toBe(false);
  });
});
