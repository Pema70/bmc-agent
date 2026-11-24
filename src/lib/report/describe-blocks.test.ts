import { describe, expect, it } from "vitest";
import { describeAllBlocks, describeBlock, type DescribedProposal } from "@/lib/report/describe-blocks";
import type { ResolvedEntry } from "@/lib/report/provenance";
import { BLOCK_KEYS } from "@/lib/schemas/bmc";

const empty = { proposalId: undefined, sourceKind: undefined, attachmentName: undefined, roundNumber: undefined, questionIndex: undefined, strategyName: undefined };

const manual = (text: string): ResolvedEntry => ({ blockKey: "channels", text, origin: { ...empty, kind: "MANUAL" }, certainty: "ZAPISANE" });
const accepted = (text: string, extra: Partial<ResolvedEntry["origin"] & object> = {}): ResolvedEntry => ({
  blockKey: "channels",
  text,
  origin: { ...empty, kind: "PROPOSAL", sourceKind: "CONVERSATION", ...extra },
  certainty: "ZAPISANE",
});
const unknown = (text: string): ResolvedEntry => ({ blockKey: "channels", text, origin: null, certainty: "NIEZNANE" });

const proposal = (overrides: Partial<DescribedProposal>): DescribedProposal => ({
  id: "pr1",
  blockKey: "channels",
  operation: "add",
  after: "Sklep online",
  rationale: "Klienci pytają o zakupy przez internet.",
  status: "ACCEPTED",
  resolvedAt: new Date("2026-11-20T10:00:00Z"),
  sourceKind: "CONVERSATION",
  roundNumber: null,
  questionIndex: null,
  ...overrides,
});

describe("describeBlock", () => {
  it("liczy wpisy i rozbija je na pochodzenie, od najliczniejszego", () => {
    const description = describeBlock("channels", [manual("A"), manual("B"), accepted("C"), unknown("D")], []);

    expect(description.entryCount).toBe(4);
    expect(description.breakdown).toEqual([
      { label: "ręczny (tekst użytkownika)", count: 2 },
      { label: "propozycja agenta w rozmowie (zaakceptowana)", count: 1 },
      { label: "źródło nieznane", count: 1 },
    ]);
  });

  it("cytuje uzasadnienie zaakceptowanej propozycji (po id z zapisu pochodzenia)", () => {
    const description = describeBlock("channels", [accepted("Sklep online", { proposalId: "pr1" })], [proposal({})]);

    expect(description.entries[0]).toMatchObject({
      text: "Sklep online",
      rationale: "Klienci pytają o zakupy przez internet.",
      position: null,
    });
    expect(description.withoutRationale).toBe(0);
  });

  it("gdy propozycji z zapisu nie ma w bazie, szuka zaakceptowanej po tekście (najpóźniej rozstrzygnięta wygrywa)", () => {
    const older = proposal({ id: "pr-old", rationale: "Starsze.", resolvedAt: new Date("2026-11-18T10:00:00Z") });
    const newer = proposal({ id: "pr-new", rationale: "Nowsze.", resolvedAt: new Date("2026-11-21T10:00:00Z") });

    const description = describeBlock("channels", [accepted("Sklep online", { proposalId: "usunięta" })], [older, newer]);

    expect(description.entries[0].rationale).toBe("Nowsze.");
  });

  it("wpis bez zaakceptowanej propozycji (ręczny, nieznany, ze strategii) ma brak uzasadnienia", () => {
    const strategy: ResolvedEntry = {
      blockKey: "channels",
      text: "Sklep online",
      origin: { ...empty, kind: "STRATEGY", strategyName: "Online" },
      certainty: "ZAPISANE",
    };

    const description = describeBlock("channels", [manual("Targi"), unknown("Ulotki"), strategy], [proposal({})]);

    expect(description.entries.map((entry) => entry.rationale)).toEqual([null, null, null]);
    expect(description.withoutRationale).toBe(3);
  });

  it("wpis ręczny o tekście identycznym z zaakceptowaną propozycją nie dostaje cudzego uzasadnienia", () => {
    const description = describeBlock("channels", [manual("Sklep online")], [proposal({})]);

    expect(description.entries[0].rationale).toBeNull();
  });

  it("odrzucone i oczekujące propozycje nie dają uzasadnienia", () => {
    const description = describeBlock(
      "channels",
      [accepted("Sklep online")],
      [proposal({ status: "REJECTED" }), proposal({ id: "pr2", status: "PENDING", resolvedAt: null })],
    );

    expect(description.entries[0].rationale).toBeNull();
  });

  it("propozycja z cyklu poprawek podaje rundę i pytanie (numeracja od 1)", () => {
    const description = describeBlock(
      "channels",
      [accepted("Sklep online", { sourceKind: "REFINEMENT", proposalId: "pr1", roundNumber: 2, questionIndex: 0 })],
      [proposal({ sourceKind: "REFINEMENT", roundNumber: 2, questionIndex: 0 })],
    );

    expect(description.entries[0].position).toEqual({ roundNumber: 2, questionNumber: 1 });
  });

  it("uzasadnienie i tekst wpisu to zwykły tekst: znaki sterujące usunięte, znaczniki zostają, długie uzasadnienie skrócone", () => {
    const hostile = proposal({ rationale: `<b>x</b>\u0000‮ ${"a".repeat(2000)}` });

    const description = describeBlock("channels", [accepted("Sklep\u0000 online", { proposalId: "pr1" })], [hostile]);

    expect(description.entries[0].text).toBe("Sklep online");
    expect(description.entries[0].rationale?.startsWith("<b>x</b> aaaa")).toBe(true);
    expect(Array.from(description.entries[0].rationale ?? "").length).toBeLessThanOrEqual(600);
  });

  it("pusty blok i wpisy z innych bloków nie wpływają na wynik", () => {
    const otherBlock: ResolvedEntry = { ...manual("Obcy"), blockKey: "key_partnerships" };

    const description = describeBlock("channels", [otherBlock], []);

    expect(description).toEqual({ blockKey: "channels", entryCount: 0, breakdown: [], entries: [], withoutRationale: 0 });
  });
});

describe("describeAllBlocks", () => {
  it("zwraca opis każdego z dziewięciu bloków w kolejności BLOCK_KEYS", () => {
    const all = describeAllBlocks([manual("A")], []);

    expect(all.map((block) => block.blockKey)).toEqual([...BLOCK_KEYS]);
    expect(all.find((block) => block.blockKey === "channels")?.entryCount).toBe(1);
    expect(all.filter((block) => block.entryCount === 0)).toHaveLength(8);
  });
});
