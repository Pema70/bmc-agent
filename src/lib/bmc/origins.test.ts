import { describe, expect, it } from "vitest";
import {
  originKey,
  originsAfterManualSave,
  originsAfterProposals,
  originsForCopy,
  originsForStrategy,
  pruneOrigins,
  type AppliedProposal,
} from "@/lib/bmc/origins";
import { emptyBmcState, type BmcState } from "@/lib/schemas/bmc";
import type { EntryOrigin } from "@/lib/schemas/origin";

const state = (overrides: Partial<BmcState> = {}): BmcState => ({ ...emptyBmcState(), ...overrides });
const manual = (blockKey: EntryOrigin["blockKey"], text: string, recordedVersion = 1): EntryOrigin => ({
  blockKey,
  text,
  kind: "MANUAL",
  recordedVersion,
});
const proposal = (overrides: Partial<AppliedProposal> = {}): AppliedProposal => ({
  proposalId: "pr1",
  blockKey: "channels",
  operation: "add",
  after: "Targi",
  sourceKind: "CONVERSATION",
  attachmentName: null,
  roundNumber: null,
  questionIndex: null,
  ...overrides,
});

describe("originKey i pruneOrigins", () => {
  it("klucz łączy blok i tekst (ten sam tekst w różnych blokach to różne wpisy)", () => {
    expect(originKey("channels", "Targi")).not.toBe(originKey("key_resources", "Targi"));
  });

  it("zostawia tylko pochodzenie wpisów obecnych w stanie", () => {
    const origins = [manual("channels", "Targi"), manual("channels", "Nie ma"), manual("key_resources", "Targi")];

    expect(pruneOrigins(origins, state({ channels: ["Targi"] }))).toEqual([manual("channels", "Targi")]);
  });
});

describe("originsAfterManualSave", () => {
  const before = state({ channels: ["Sklep online", "Targi"] });

  it("bez zmian: pochodzenie zostaje, nic nie dochodzi (także dla wpisów sprzed kroku 9 bez zapisu)", () => {
    const stored = [manual("channels", "Targi", 2)];

    expect(originsAfterManualSave(before, before, stored, 4)).toEqual(stored);
    expect(originsAfterManualSave(before, before, [], 4)).toEqual([]);
  });

  it("nowy wpis dostaje MANUAL z nową wersją", () => {
    const after = state({ channels: ["Sklep online", "Targi", "Social media"] });

    expect(originsAfterManualSave(before, after, [], 4)).toEqual([manual("channels", "Social media", 4)]);
  });

  it("edycja tekstu to nowy wpis MANUAL, a pochodzenie starego tekstu znika", () => {
    const stored: EntryOrigin[] = [{ blockKey: "channels", text: "Targi", kind: "PROPOSAL", proposalId: "pr1", recordedVersion: 2 }];
    const after = state({ channels: ["Sklep online", "Targi lokalne"] });

    expect(originsAfterManualSave(before, after, stored, 4)).toEqual([manual("channels", "Targi lokalne", 4)]);
  });

  it("usunięcie wpisu usuwa pochodzenie", () => {
    expect(originsAfterManualSave(before, state({ channels: ["Sklep online"] }), [manual("channels", "Targi")], 4)).toEqual([]);
  });

  it("zmiana kolejności wpisów nie zmienia pochodzenia (klucz to blok i tekst)", () => {
    const stored = [manual("channels", "Targi", 2)];

    expect(originsAfterManualSave(before, state({ channels: ["Targi", "Sklep online"] }), stored, 4)).toEqual(stored);
  });

  it("ten sam tekst w innym bloku to nowy wpis", () => {
    expect(originsAfterManualSave(before, state({ channels: ["Sklep online", "Targi"], key_resources: ["Targi"] }), [], 4)).toEqual([
      manual("key_resources", "Targi", 4),
    ]);
  });

  it("duplikat w bloku dzieli jedno pochodzenie (jeden wpis w zapisie)", () => {
    expect(originsAfterManualSave(before, state({ channels: ["Sklep online", "Targi", "Nowy", "Nowy"] }), [], 4)).toEqual([
      manual("channels", "Nowy", 4),
    ]);
  });

  it("nieczytelny poprzedni stan (null): wszystkie wpisy są nowe", () => {
    expect(originsAfterManualSave(null, state({ channels: ["Sklep online"] }), [], 2)).toEqual([manual("channels", "Sklep online", 2)]);
  });
});

describe("originsAfterProposals", () => {
  it("add: nowy tekst dostaje PROPOSAL ze źródłem propozycji; inne pochodzenie zostaje", () => {
    const kept = manual("revenue_streams", "Subskrypcja");

    const result = originsAfterProposals([kept], state({ channels: ["Targi"], revenue_streams: ["Subskrypcja"] }), [proposal()], 4);

    expect(result).toEqual([
      kept,
      { blockKey: "channels", text: "Targi", kind: "PROPOSAL", proposalId: "pr1", sourceKind: "CONVERSATION", recordedVersion: 4 },
    ]);
  });

  it("edit: stary tekst traci pochodzenie, nowy dostaje PROPOSAL", () => {
    const result = originsAfterProposals(
      [manual("channels", "Sklep online")],
      state({ channels: ["Sklep internetowy"] }),
      [proposal({ operation: "edit", after: "Sklep internetowy" })],
      4,
    );

    expect(result).toEqual([expect.objectContaining({ text: "Sklep internetowy", kind: "PROPOSAL" })]);
  });

  it("remove: pochodzenie usuniętego wpisu znika, nic nie dochodzi", () => {
    expect(originsAfterProposals([manual("channels", "Targi")], state(), [proposal({ operation: "remove", after: null })], 4)).toEqual([]);
  });

  it("załącznik, runda i pytanie trafiają do zapisu (nazwa pliku jako migawka)", () => {
    const result = originsAfterProposals(
      [],
      state({ channels: ["Targi"] }),
      [proposal({ sourceKind: "ATTACHMENT", attachmentName: "Opis kawiarni.pdf" })],
      4,
    );
    expect(result[0]).toMatchObject({ sourceKind: "ATTACHMENT", attachmentName: "Opis kawiarni.pdf" });
    expect(result[0]).not.toHaveProperty("roundNumber");

    const refinement = originsAfterProposals(
      [],
      state({ channels: ["Targi"] }),
      [proposal({ sourceKind: "REFINEMENT", roundNumber: 2, questionIndex: 0 })],
      4,
    );
    expect(refinement[0]).toMatchObject({ sourceKind: "REFINEMENT", roundNumber: 2, questionIndex: 0 });
  });

  it("paczka: późniejsza propozycja o tym samym kluczu nadpisuje wcześniejszą, a zmieniony później tekst nie zostawia śladu", () => {
    const result = originsAfterProposals(
      [],
      state({ channels: ["Targi B"] }),
      [
        proposal({ proposalId: "pr1", after: "Targi A" }),
        proposal({ proposalId: "pr2", operation: "edit", after: "Targi B" }),
      ],
      4,
    );

    expect(result).toEqual([expect.objectContaining({ text: "Targi B", proposalId: "pr2" })]);
  });

  it("propozycja, której tekstu nie ma w nowym stanie, nie tworzy pochodzenia", () => {
    expect(originsAfterProposals([], state(), [proposal()], 4)).toEqual([]);
  });
});

describe("originsForStrategy i originsForCopy", () => {
  it("strategia: każdy wpis (bez duplikatów) to STRATEGY z nazwą strategii i wersją 1", () => {
    const result = originsForStrategy(state({ channels: ["Targi", "Targi"], customer_segments: ["Firmy"] }), "Szkolenia firmowe", 1);

    expect(result).toEqual([
      { blockKey: "customer_segments", text: "Firmy", kind: "STRATEGY", strategyName: "Szkolenia firmowe", recordedVersion: 1 },
      { blockKey: "channels", text: "Targi", kind: "STRATEGY", strategyName: "Szkolenia firmowe", recordedVersion: 1 },
    ]);
  });

  it("kopia dziedziczy pochodzenie wpisów obecnych w stanie kopii", () => {
    const source = [manual("channels", "Targi"), manual("channels", "Nie ma")];

    expect(originsForCopy(source, state({ channels: ["Targi"] }))).toEqual([manual("channels", "Targi")]);
  });
});
