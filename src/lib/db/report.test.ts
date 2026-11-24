import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  variantFindFirst: vi.fn(),
  proposalFindMany: vi.fn(),
  groupBy: vi.fn(),
  generationFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  comparisonFindMany: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    bmcVariant: { findFirst: m.variantFindFirst },
    proposal: { findMany: m.proposalFindMany },
    llmCallLog: { groupBy: m.groupBy },
    strategyGeneration: { findFirst: m.generationFindFirst },
    variantComparison: { findMany: m.comparisonFindMany },
    $queryRaw: m.queryRaw,
  },
}));

import { listVariantComparisonsForVariant } from "@/lib/db/comparisons";
import { getStrategyCandidate, getVariantForReport, listLlmCallSummary, listProposalsForReport } from "@/lib/db/report";
import { emptyBmcState } from "@/lib/schemas/bmc";

beforeEach(() => {
  vi.clearAllMocks();
});

const variantRow = (overrides: Record<string, unknown> = {}) => ({
  id: "v1",
  name: "Wariant główny",
  isMain: true,
  origin: "MANUAL",
  description: null,
  version: 4,
  createdAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-02T10:00:00Z"),
  state: { ...emptyBmcState(), channels: ["Sklep"] },
  entryOrigins: [],
  generationId: null,
  generationIndex: null,
  ...overrides,
});

describe("getVariantForReport", () => {
  it("czyta wariant po id ORAZ projectId, razem z zapisanym pochodzeniem wpisów", async () => {
    m.variantFindFirst.mockResolvedValue(variantRow());

    const variant = await getVariantForReport("p1", "v1");

    expect(variant).toMatchObject({ id: "v1", version: 4, entryOrigins: [], state: { channels: ["Sklep"] } });
    expect(m.variantFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v1", projectId: "p1" }, select: expect.objectContaining({ entryOrigins: true, generationId: true }) }),
    );
  });

  it("wariant spoza projektu: null", async () => {
    m.variantFindFirst.mockResolvedValue(null);

    expect(await getVariantForReport("p1", "v-obcy")).toBeNull();
  });

  it("stan niezgodny ze schematem to jawny wyjątek, a nie uszkodzony raport", async () => {
    m.variantFindFirst.mockResolvedValue(variantRow({ state: { channels: "nie lista" } }));

    await expect(getVariantForReport("p1", "v1")).rejects.toThrow(/Niepoprawny stan BMC/);
  });
});

describe("listProposalsForReport", () => {
  it("zapytanie po wariancie i projekcie, z datą rozstrzygnięcia; operacje zamienione na małe litery", async () => {
    m.proposalFindMany.mockResolvedValue([
      {
        id: "pr1",
        blockKey: "channels",
        operation: "EDIT",
        after: "Sklep",
        rationale: "Bo tak.",
        status: "ACCEPTED",
        resolvedAt: new Date("2026-11-03T10:00:00Z"),
        sourceKind: "ATTACHMENT",
        sourceAttachmentName: "a.pdf",
        refinementRoundId: null,
        refinementQuestionIndex: null,
      },
    ]);

    const rows = await listProposalsForReport("p1", "v1", 501);

    expect(rows).toEqual([expect.objectContaining({ id: "pr1", operation: "edit", resolvedAt: new Date("2026-11-03T10:00:00Z") })]);
    expect(m.proposalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { variantId: "v1", variant: { projectId: "p1" } }, take: 501 }),
    );
  });

  it("nieznany blockKey w bazie to jawny wyjątek", async () => {
    m.proposalFindMany.mockResolvedValue([{ id: "pr1", blockKey: "obcy", operation: "ADD" }]);

    await expect(listProposalsForReport("p1", "v1", 10)).rejects.toThrow(/blockKey/);
  });
});

describe("listLlmCallSummary", () => {
  it("grupuje tylko udane wywołania projektu po operacji, modelu i wersji promptu", async () => {
    m.groupBy.mockResolvedValue([
      {
        operation: "evaluate_bmc",
        provider: "google",
        model: "gemini-3.5-flash-lite",
        promptVersion: "evaluate-v1",
        _count: { _all: 3 },
        _min: { createdAt: new Date("2026-11-01T10:00:00Z") },
        _max: { createdAt: new Date("2026-11-05T10:00:00Z") },
      },
    ]);

    const rows = await listLlmCallSummary("p1");

    expect(rows).toEqual([
      {
        operation: "evaluate_bmc",
        provider: "google",
        model: "gemini-3.5-flash-lite",
        promptVersion: "evaluate-v1",
        calls: 3,
        firstUsed: new Date("2026-11-01T10:00:00Z"),
        lastUsed: new Date("2026-11-05T10:00:00Z"),
      },
    ]);
    expect(m.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", status: "OK" } }));
  });

  it("brak wywołań: pusta lista", async () => {
    m.groupBy.mockResolvedValue([]);

    expect(await listLlmCallSummary("p1")).toEqual([]);
  });
});

describe("getStrategyCandidate", () => {
  const candidateState = { ...emptyBmcState(), channels: ["Sklep"] };
  const output = {
    strategies: [
      { name: "Online", assumption: "Sprzedaż w sieci.", state: candidateState },
      { name: "Lokalnie", assumption: "Sprzedaż w mieście.", state: candidateState },
    ],
  };

  it("zwraca kandydata o danym numerze; zapytanie po id generacji i projekcie (generacja należy do wariantu bazowego)", async () => {
    m.generationFindFirst.mockResolvedValue({ schemaVersion: 1, result: output });

    expect(await getStrategyCandidate("p1", "g1", 1)).toEqual({ name: "Lokalnie", state: candidateState });
    expect(m.generationFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "g1", projectId: "p1" } }));
  });

  it("brak generacji, obca wersja schematu, zły numer lub uszkodzony wynik: null (bez wyjątku)", async () => {
    m.generationFindFirst.mockResolvedValueOnce(null);
    expect(await getStrategyCandidate("p1", "g1", 0)).toBeNull();
    m.generationFindFirst.mockResolvedValueOnce({ schemaVersion: 2, result: output });
    expect(await getStrategyCandidate("p1", "g1", 0)).toBeNull();
    m.generationFindFirst.mockResolvedValueOnce({ schemaVersion: 1, result: output });
    expect(await getStrategyCandidate("p1", "g1", 7)).toBeNull();
    m.generationFindFirst.mockResolvedValueOnce({ schemaVersion: 1, result: { strategies: "x" } });
    expect(await getStrategyCandidate("p1", "g1", 0)).toBeNull();
  });
});

describe("listVariantComparisonsForVariant", () => {
  const stateA = { ...emptyBmcState(), channels: ["Aplikacja"] };
  const assessment = (label: string) => ({ label, pros: ["Zaleta"], cons: ["Wada"] });
  const comparisonRow = {
    id: "c1",
    createdAt: new Date("2026-11-16T10:00:00Z"),
    schemaVersion: 1,
    inputs: [
      { label: "A", variantId: "v1", name: "Główny", version: 3, state: stateA },
      { label: "B", variantId: "v2", name: "Strategia", version: 1, state: stateA },
    ],
    result: {
      summary: "Różnią się kanałami.",
      blockNotes: [],
      variants: [assessment("A"), assessment("B")],
      recommendation: { label: null, rationale: "Brak jednoznacznego wskazania." },
    },
    trigger: "UI",
    provider: "google",
    model: "gemini-3.5-flash-lite",
    promptVersion: "compare-v1",
  };

  it("filtr po wariancie robi baza (zawieranie JSONB), a drugie zapytanie znów ogranicza do projektu; stany wariantów są usunięte", async () => {
    m.queryRaw.mockResolvedValue([{ id: "c1" }]);
    m.comparisonFindMany.mockResolvedValue([comparisonRow]);

    const items = await listVariantComparisonsForVariant("p1", "v1", 11);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ok: true, comparison: { id: "c1", inputs: [{ label: "A", variantId: "v1" }, { label: "B", variantId: "v2" }] } });
    expect(JSON.stringify(items)).not.toContain("Aplikacja");

    const [strings, ...values] = m.queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain('"projectId" = ?');
    expect(strings.join("?")).toContain('"inputs" @> ?::jsonb');
    expect(values).toEqual(["p1", JSON.stringify([{ variantId: "v1" }]), 11]);
    expect(m.comparisonFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", id: { in: ["c1"] } } }));
  });

  it("wariant bez porównań: pusta lista bez drugiego zapytania", async () => {
    m.queryRaw.mockResolvedValue([]);

    expect(await listVariantComparisonsForVariant("p1", "v-bez", 10)).toEqual([]);
    expect(m.comparisonFindMany).not.toHaveBeenCalled();
  });

  it("uszkodzony rekord to pozycja z błędem, a nie wyjątek dla listy", async () => {
    m.queryRaw.mockResolvedValue([{ id: "c1" }]);
    m.comparisonFindMany.mockResolvedValue([{ ...comparisonRow, result: { summary: 1 } }]);

    const items = await listVariantComparisonsForVariant("p1", "v1", 10);

    expect(items).toEqual([expect.objectContaining({ ok: false, id: "c1" })]);
  });
});
