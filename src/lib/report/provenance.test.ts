import { describe, expect, it } from "vitest";
import { resolveEntryOrigins, type FallbackProposal } from "@/lib/report/provenance";
import { emptyBmcState, type BmcState } from "@/lib/schemas/bmc";

const state: BmcState = {
  ...emptyBmcState(),
  customer_segments: ["Studenci"],
  channels: ["Sklep online", "Targi"],
  value_propositions: ["Własna palarnia"],
};

const stored = [
  { blockKey: "channels", text: "Targi", kind: "PROPOSAL", proposalId: "pr9", sourceKind: "ATTACHMENT", attachmentName: "Opis.pdf", recordedVersion: 3 },
  { blockKey: "customer_segments", text: "Studenci", kind: "MANUAL", recordedVersion: 3 },
];

function accepted(overrides: Partial<FallbackProposal> = {}): FallbackProposal {
  return {
    id: "pr1",
    blockKey: "channels",
    operation: "add",
    after: "Sklep online",
    status: "ACCEPTED",
    resolvedAt: new Date("2026-11-10T10:00:00Z"),
    sourceKind: "CONVERSATION",
    sourceAttachmentName: null,
    roundNumber: null,
    questionIndex: null,
    ...overrides,
  };
}

const find = (result: ReturnType<typeof resolveEntryOrigins>, text: string) => result.entries.find((entry) => entry.text === text);

describe("resolveEntryOrigins: zapisane pochodzenie (pewne)", () => {
  it("wpis z zapisem dostaje pewność ZAPISANE i dane z zapisu (nazwa załącznika jako migawka)", () => {
    const result = resolveEntryOrigins({ state, storedOrigins: stored, proposals: [], strategy: null });

    expect(find(result, "Targi")).toMatchObject({
      certainty: "ZAPISANE",
      origin: { kind: "PROPOSAL", sourceKind: "ATTACHMENT", attachmentName: "Opis.pdf" },
    });
    expect(find(result, "Studenci")).toMatchObject({ certainty: "ZAPISANE", origin: { kind: "MANUAL" } });
  });

  it("zapis ma pierwszeństwo przed dopasowaniem wstecznym", () => {
    const result = resolveEntryOrigins({
      state,
      storedOrigins: stored,
      proposals: [accepted({ blockKey: "channels", after: "Targi", sourceKind: "MODEL_KNOWLEDGE" })],
      strategy: null,
    });

    expect(find(result, "Targi")).toMatchObject({ certainty: "ZAPISANE", origin: { sourceKind: "ATTACHMENT" } });
  });
});

describe("resolveEntryOrigins: dopasowanie wsteczne (wpisy sprzed kroku 9)", () => {
  it("wpis zgodny tekstem z zaakceptowaną propozycją dostaje USTALONE_PO_TEKSCIE ze źródłem propozycji, rundą i pytaniem", () => {
    const result = resolveEntryOrigins({
      state,
      storedOrigins: [],
      proposals: [accepted({ blockKey: "value_propositions", after: "Własna palarnia", sourceKind: "REFINEMENT", roundNumber: 1, questionIndex: 2 })],
      strategy: null,
    });

    expect(find(result, "Własna palarnia")).toMatchObject({
      certainty: "USTALONE_PO_TEKSCIE",
      origin: { kind: "PROPOSAL", proposalId: "pr1", sourceKind: "REFINEMENT", roundNumber: 1, questionIndex: 2 },
    });
  });

  it("liczą się tylko ZAAKCEPTOWANE propozycje add i edit z tym samym blokiem i tekstem", () => {
    const ignored = [
      accepted({ status: "PENDING" }),
      accepted({ status: "REJECTED" }),
      accepted({ operation: "remove", after: null }),
      accepted({ blockKey: "key_resources" }),
      accepted({ after: "Inny tekst" }),
    ];

    const result = resolveEntryOrigins({ state, storedOrigins: [], proposals: ignored, strategy: null });

    expect(find(result, "Sklep online")).toMatchObject({ certainty: "NIEZNANE", origin: null });
  });

  it("kilka pasujących propozycji: wygrywa ostatnio rozstrzygnięta", () => {
    const result = resolveEntryOrigins({
      state,
      storedOrigins: [],
      proposals: [
        accepted({ id: "stara", resolvedAt: new Date("2026-11-01T10:00:00Z"), sourceKind: "CONVERSATION" }),
        accepted({ id: "nowa", resolvedAt: new Date("2026-11-12T10:00:00Z"), sourceKind: "MODEL_KNOWLEDGE" }),
      ],
      strategy: null,
    });

    expect(find(result, "Sklep online")?.origin).toMatchObject({ proposalId: "nowa", sourceKind: "MODEL_KNOWLEDGE" });
  });

  it("wariant ze strategii: wpis zgodny z kandydatem to STRATEGY (USTALONE_PO_TEKSCIE), zmieniony po zapisie to NIEZNANE", () => {
    const candidate = { name: "Szkolenia firmowe", state: { ...emptyBmcState(), customer_segments: ["Studenci"], channels: ["Targi"] } };

    const result = resolveEntryOrigins({ state, storedOrigins: [], proposals: [], strategy: candidate });

    expect(find(result, "Studenci")).toMatchObject({ certainty: "USTALONE_PO_TEKSCIE", origin: { kind: "STRATEGY", strategyName: "Szkolenia firmowe" } });
    expect(find(result, "Sklep online")).toMatchObject({ certainty: "NIEZNANE", origin: null });
  });

  it("propozycja ma pierwszeństwo przed strategią (nowsza zmiana stanu)", () => {
    const result = resolveEntryOrigins({
      state,
      storedOrigins: [],
      proposals: [accepted({ blockKey: "customer_segments", after: "Studenci" })],
      strategy: { name: "S", state: { ...emptyBmcState(), customer_segments: ["Studenci"] } },
    });

    expect(find(result, "Studenci")?.origin?.kind).toBe("PROPOSAL");
  });
});

describe("resolveEntryOrigins: nieznane, liczniki i uszkodzenia", () => {
  it("wpis bez zapisu i bez dopasowania to NIEZNANE (nie „ręczny”), a liczniki sumują się do liczby wpisów", () => {
    const result = resolveEntryOrigins({
      state,
      storedOrigins: [stored[0]],
      proposals: [accepted({ blockKey: "value_propositions", after: "Własna palarnia" })],
      strategy: null,
    });

    expect(find(result, "Studenci")).toMatchObject({ certainty: "NIEZNANE", origin: null });
    expect(result.counts).toEqual({ total: 4, saved: 1, inferred: 1, unknown: 2 });
    expect(result.counts.saved + result.counts.inferred + result.counts.unknown).toBe(result.counts.total);
  });

  it("kolejność wpisów: bloki jak w BMC, wpisy jak w stanie; duplikaty wpisów dzielą wynik", () => {
    const duplicated = { ...state, channels: ["Targi", "Targi"] };

    const result = resolveEntryOrigins({ state: duplicated, storedOrigins: stored, proposals: [], strategy: null });

    expect(result.entries.map((entry) => `${entry.blockKey}:${entry.text}`)).toEqual([
      "customer_segments:Studenci",
      "value_propositions:Własna palarnia",
      "channels:Targi",
      "channels:Targi",
    ]);
    expect(result.entries[2].certainty).toBe("ZAPISANE");
    expect(result.entries[3].certainty).toBe("ZAPISANE");
  });

  it("uszkodzony zapis jest ignorowany z flagą corrupt, a wpisy wracają do dopasowania wstecznego i NIEZNANE", () => {
    const result = resolveEntryOrigins({ state, storedOrigins: { zepsute: true }, proposals: [], strategy: null });

    expect(result.corrupt).toBe(true);
    expect(result.counts).toMatchObject({ saved: 0, unknown: 4 });
  });

  it("zapis o wpisie, którego nie ma już w stanie, jest pomijany; brak zapisu (null, undefined) nie jest uszkodzeniem", () => {
    const result = resolveEntryOrigins({
      state: { ...emptyBmcState(), channels: ["Targi"] },
      storedOrigins: [{ blockKey: "channels", text: "Usunięty", kind: "MANUAL", recordedVersion: 1 }],
      proposals: [],
      strategy: null,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.counts.saved).toBe(0);

    expect(resolveEntryOrigins({ state, storedOrigins: null, proposals: [], strategy: null }).corrupt).toBe(false);
    expect(resolveEntryOrigins({ state, storedOrigins: undefined, proposals: [], strategy: null }).corrupt).toBe(false);
  });

  it("pusty wariant: brak wpisów, zerowe liczniki", () => {
    expect(resolveEntryOrigins({ state: emptyBmcState(), storedOrigins: [], proposals: [], strategy: null })).toEqual({
      entries: [],
      corrupt: false,
      counts: { total: 0, saved: 0, inferred: 0, unknown: 0 },
    });
  });
});
