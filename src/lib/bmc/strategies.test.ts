import { describe, expect, it } from "vitest";
import { findStrategyViolation } from "@/lib/bmc/strategies";
import { emptyBmcState, type BmcState } from "@/lib/schemas/bmc";
import type { StrategiesOutput } from "@/lib/schemas/variant";

const base: BmcState = {
  ...emptyBmcState(),
  customer_segments: ["Studenci"],
  value_propositions: ["Szybka nauka"],
  channels: ["Aplikacja", "Social media"],
  revenue_streams: ["Subskrypcja"],
};

const stateA: BmcState = {
  ...emptyBmcState(),
  customer_segments: ["Firmy szkoleniowe"],
  value_propositions: ["Szkolenia dla zespołów"],
  channels: ["Sprzedaż bezpośrednia"],
};
const stateB: BmcState = {
  ...emptyBmcState(),
  customer_segments: ["Seniorzy"],
  value_propositions: ["Nauka w małych grupach"],
  channels: ["Domy kultury"],
};

function output(...strategies: Array<{ name: string; state: BmcState }>): StrategiesOutput {
  return { strategies: strategies.map((s) => ({ name: s.name, assumption: "Założenie.", state: s.state })) };
}

describe("findStrategyViolation", () => {
  it("poprawne, różne strategie: brak naruszeń", () => {
    expect(findStrategyViolation(output({ name: "A", state: stateA }, { name: "B", state: stateB }), base)).toBeNull();
  });

  it("strategia identyczna ze stanem bazowym", () => {
    expect(findStrategyViolation(output({ name: "A", state: stateA }, { name: "Kopia", state: structuredClone(base) }), base)).toBe(
      "SAME_AS_BASE",
    );
  });

  it("identyczność niezależna od kolejności wpisów i wielkości liter", () => {
    const reordered: BmcState = { ...structuredClone(base), channels: ["social MEDIA", "aplikacja"] };
    expect(findStrategyViolation(output({ name: "A", state: reordered }, { name: "B", state: stateB }), base)).toBe("SAME_AS_BASE");
  });

  it("dwie takie same strategie pod różnymi nazwami", () => {
    expect(findStrategyViolation(output({ name: "A", state: stateA }, { name: "B", state: structuredClone(stateA) }), base)).toBe(
      "DUPLICATE_STRATEGY",
    );
  });

  it("powtórzona nazwa w wyniku (bez rozróżniania wielkości liter i spacji)", () => {
    expect(findStrategyViolation(output({ name: "Strategia", state: stateA }, { name: " strategia ", state: stateB }), base)).toBe(
      "DUPLICATE_NAME",
    );
  });

  it("zduplikowany wpis w bloku", () => {
    const withDuplicate: BmcState = { ...structuredClone(stateA), channels: ["Sklep", "sklep"] };
    expect(findStrategyViolation(output({ name: "A", state: withDuplicate }, { name: "B", state: stateB }), base)).toBe("DUPLICATE_ENTRY");
  });

  it("ten sam wpis w różnych blokach jest dozwolony", () => {
    const sameAcrossBlocks: BmcState = { ...structuredClone(stateA), channels: ["Partnerzy"], key_partnerships: ["Partnerzy"] };
    expect(findStrategyViolation(output({ name: "A", state: sameAcrossBlocks }, { name: "B", state: stateB }), base)).toBeNull();
  });

  it("stan niezgodny z BmcState (za dużo wpisów w bloku)", () => {
    const tooMany: BmcState = { ...structuredClone(stateA), channels: Array.from({ length: 31 }, (_, i) => `Kanał ${i}`) };
    expect(findStrategyViolation(output({ name: "A", state: tooMany }, { name: "B", state: stateB }), base)).toBe("INVALID_STATE");
  });
});
