import { describe, expect, it } from "vitest";
import { EntryOrigin, EntryOrigins, parseStoredOrigins } from "@/lib/schemas/origin";

const valid = { blockKey: "channels", text: "Targi", kind: "MANUAL", recordedVersion: 2 };

describe("EntryOrigin", () => {
  it("przyjmuje ręczne, z propozycji (z załącznika, z rundy) i ze strategii", () => {
    expect(EntryOrigin.safeParse(valid).success).toBe(true);
    expect(
      EntryOrigin.safeParse({
        ...valid,
        kind: "PROPOSAL",
        proposalId: "pr1",
        sourceKind: "ATTACHMENT",
        attachmentName: "Opis.pdf",
        roundNumber: 1,
        questionIndex: 0,
      }).success,
    ).toBe(true);
    expect(EntryOrigin.safeParse({ ...valid, kind: "STRATEGY", strategyName: "Szkolenia" }).success).toBe(true);
  });

  it("odrzuca nieznany blok, rodzaj i źródło, pusty tekst, wersję 0 i dodatkowe pola (strictObject)", () => {
    for (const bad of [
      { ...valid, blockKey: "nieznany" },
      { ...valid, kind: "AI" },
      { ...valid, sourceKind: "INNE" },
      { ...valid, text: "" },
      { ...valid, recordedVersion: 0 },
      { ...valid, dodatkowe: 1 },
      { ...valid, roundNumber: 0 },
    ]) {
      expect(EntryOrigin.safeParse(bad).success).toBe(false);
    }
  });

  it("lista ma najwyżej 150 pozycji (limit wpisów w modelu)", () => {
    expect(EntryOrigins.safeParse(Array(150).fill(valid)).success).toBe(true);
    expect(EntryOrigins.safeParse(Array(151).fill(valid)).success).toBe(false);
  });
});

describe("parseStoredOrigins", () => {
  it("czyta poprawną listę, a brak i null to pusta lista bez flagi uszkodzenia", () => {
    expect(parseStoredOrigins([valid])).toEqual({ origins: [valid], corrupt: false });
    expect(parseStoredOrigins(undefined)).toEqual({ origins: [], corrupt: false });
    expect(parseStoredOrigins(null)).toEqual({ origins: [], corrupt: false });
    expect(parseStoredOrigins([])).toEqual({ origins: [], corrupt: false });
  });

  it("uszkodzony zapis (nie lista, zły element) to pusta lista z flagą corrupt", () => {
    expect(parseStoredOrigins({ to: "obiekt" })).toEqual({ origins: [], corrupt: true });
    expect(parseStoredOrigins([valid, { blockKey: "channels" }])).toEqual({ origins: [], corrupt: true });
    expect(parseStoredOrigins("tekst")).toEqual({ origins: [], corrupt: true });
  });
});
