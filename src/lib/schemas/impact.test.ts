import { describe, expect, it } from "vitest";
import { ImpactChange, ImpactChangeRequest, ImpactOutput } from "@/lib/schemas/impact";

const goodOutput = {
  summary: "Zmiana kanału wpływa na relacje i koszty.",
  affected: [
    { blockKey: "customer_relationships", level: "high", impact: "Relacje trzeba oprzeć na kontakcie online." },
    { blockKey: "cost_structure", level: "low", impact: "Spadną koszty punktów sprzedaży." },
  ],
};

describe("ImpactOutput", () => {
  it("przyjmuje poprawny wynik i pustą listę", () => {
    expect(ImpactOutput.safeParse(goodOutput).success).toBe(true);
    expect(ImpactOutput.safeParse({ summary: "Zmiana izolowana.", affected: [] }).success).toBe(true);
  });

  it("odrzuca nieznany stopień i nieznany blok", () => {
    const badLevel = { ...goodOutput, affected: [{ ...goodOutput.affected[0], level: "critical" }] };
    const badBlock = { ...goodOutput, affected: [{ ...goodOutput.affected[0], blockKey: "inne" }] };
    expect(ImpactOutput.safeParse(badLevel).success).toBe(false);
    expect(ImpactOutput.safeParse(badBlock).success).toBe(false);
  });

  it("odrzuca duplikat bloku", () => {
    const duplicate = { ...goodOutput, affected: [goodOutput.affected[0], goodOutput.affected[0]] };
    expect(ImpactOutput.safeParse(duplicate).success).toBe(false);
  });

  it("odrzuca więcej niż 8 pozycji", () => {
    const keys = [
      "customer_segments", "value_propositions", "channels", "customer_relationships", "revenue_streams",
      "key_resources", "key_activities", "key_partnerships", "cost_structure",
    ];
    const nine = { summary: "x", affected: keys.map((blockKey) => ({ blockKey, level: "low", impact: "x" })) };
    expect(ImpactOutput.safeParse(nine).success).toBe(false);
  });

  it("odrzuca za długie teksty, puste teksty, dodatkowe i brakujące pola", () => {
    expect(ImpactOutput.safeParse({ ...goodOutput, summary: "a".repeat(501) }).success).toBe(false);
    expect(ImpactOutput.safeParse({ ...goodOutput, summary: "  " }).success).toBe(false);
    const longImpact = { ...goodOutput, affected: [{ ...goodOutput.affected[0], impact: "a".repeat(301) }] };
    expect(ImpactOutput.safeParse(longImpact).success).toBe(false);
    expect(ImpactOutput.safeParse({ ...goodOutput, id: "podrobione" }).success).toBe(false);
    expect(ImpactOutput.safeParse({ summary: "x" }).success).toBe(false);
  });
});

describe("ImpactChange (PROPOSAL, zależność od operation)", () => {
  const base = { kind: "PROPOSAL", blockKey: "channels" } as const;

  it.each([
    ["add", null, "Sklep online", true],
    ["add", "Stary", "Nowy", false],
    ["add", null, null, false],
    ["edit", "Stary", "Nowy", true],
    ["edit", null, "Nowy", false],
    ["edit", "Stary", null, false],
    ["remove", "Stary", null, true],
    ["remove", "Stary", "Nowy", false],
    ["remove", null, null, false],
  ])("%s (before=%s, after=%s) -> %s", (operation, before, after, valid) => {
    expect(ImpactChange.safeParse({ ...base, operation, before, after }).success).toBe(valid);
  });

  it("odrzuca nieznaną operację", () => {
    expect(ImpactChange.safeParse({ ...base, operation: "move", before: "a", after: "b" }).success).toBe(false);
  });
});

describe("ImpactChange i ImpactChangeRequest (DESCRIPTION)", () => {
  it("przyjmuje opis 5-500 znaków i przycina spacje", () => {
    const parsed = ImpactChangeRequest.safeParse({ kind: "DESCRIPTION", blockKey: "channels", description: "  Tylko online  " });
    expect(parsed).toMatchObject({ success: true, data: { description: "Tylko online" } });
    expect(ImpactChange.safeParse({ kind: "DESCRIPTION", blockKey: "channels", description: "a".repeat(500) }).success).toBe(true);
  });

  it("odrzuca za krótki i za długi opis oraz zły blockKey", () => {
    expect(ImpactChangeRequest.safeParse({ kind: "DESCRIPTION", blockKey: "channels", description: "abcd" }).success).toBe(false);
    expect(ImpactChangeRequest.safeParse({ kind: "DESCRIPTION", blockKey: "channels", description: "a".repeat(501) }).success).toBe(false);
    expect(ImpactChangeRequest.safeParse({ kind: "DESCRIPTION", blockKey: "x", description: "Tylko online" }).success).toBe(false);
  });

  it("żądanie PROPOSAL wymaga proposalId i nie przyjmuje dodatkowych pól", () => {
    expect(ImpactChangeRequest.safeParse({ kind: "PROPOSAL", proposalId: "p1" }).success).toBe(true);
    expect(ImpactChangeRequest.safeParse({ kind: "PROPOSAL" }).success).toBe(false);
    expect(ImpactChangeRequest.safeParse({ kind: "PROPOSAL", proposalId: "p1", blockKey: "channels" }).success).toBe(false);
  });
});
