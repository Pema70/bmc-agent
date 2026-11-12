import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  prisma: { impactAnalysis: { create: mocks.create, findMany: mocks.findMany, findFirst: mocks.findFirst } },
}));

import { createImpactAnalysis, getImpactAnalysis, listImpactAnalysesForVariant, parseImpactRow } from "@/lib/db/impact";
import { emptyBmcState } from "@/lib/schemas/bmc";

const result = {
  summary: "Zmiana wpływa na relacje.",
  affected: [{ blockKey: "customer_relationships", level: "high", impact: "Kontakt online." }],
};
const descriptionChange = { kind: "DESCRIPTION", blockKey: "channels", description: "Tylko online" };
const proposalChange = { kind: "PROPOSAL", blockKey: "channels", operation: "add", before: null, after: "Sklep" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    createdAt: new Date("2026-11-12T10:00:00Z"),
    schemaVersion: 1,
    variantVersion: 3,
    changeKind: "DESCRIPTION",
    proposalId: null,
    change: descriptionChange,
    trigger: "UI",
    provider: "google",
    model: "gemini-3.8-flash",
    promptVersion: "impact-v1",
    result,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseImpactRow", () => {
  it("zwraca analizę z poprawnego wiersza", () => {
    expect(parseImpactRow(row())).toMatchObject({ ok: true, analysis: { id: "a1", variantVersion: 3, model: "gemini-3.8-flash" } });
  });

  it("dopuszcza PROPOSAL bez proposalId (propozycja usunięta, SetNull)", () => {
    expect(parseImpactRow(row({ changeKind: "PROPOSAL", change: proposalChange, proposalId: null }))).toMatchObject({ ok: true });
  });

  it.each([
    ["obca wersja schematu", { schemaVersion: 2 }],
    ["wynik niezgodny ze schematem", { result: { summary: "x", affected: [{ blockKey: "channels", level: "zly", impact: "x" }] } }],
    ["zmiana niezgodna ze schematem", { change: { kind: "PROPOSAL", blockKey: "channels", operation: "add", before: "a", after: "b" } }],
    ["changeKind różny od change.kind", { changeKind: "PROPOSAL" }],
    ["DESCRIPTION z proposalId", { proposalId: "pr1" }],
    ["nieznany trigger", { trigger: "API" }],
  ])("odrzuca wiersz: %s", (_label, overrides) => {
    expect(parseImpactRow(row(overrides))).toMatchObject({ ok: false, id: "a1" });
  });
});

describe("createImpactAnalysis", () => {
  const input = {
    projectId: "p1",
    variantId: "v1",
    variantVersion: 3,
    stateSnapshot: emptyBmcState(),
    change: { kind: "DESCRIPTION" as const, blockKey: "channels" as const, description: "Tylko online" },
    proposalId: null,
    result: { summary: result.summary, affected: [{ blockKey: "customer_relationships" as const, level: "high" as const, impact: "Kontakt online." }] },
    trigger: "UI" as const,
    provider: "google",
    model: "gemini-3.8-flash",
    promptVersion: "impact-v1",
    llmCallLogId: "log-1",
    createdById: "u1",
  };

  it("zapisuje zwalidowany wynik i zwraca analizę z id z bazy", async () => {
    mocks.create.mockResolvedValue(row({ id: "z-bazy" }));

    const analysis = await createImpactAnalysis(input);

    expect(analysis.id).toBe("z-bazy");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changeKind: "DESCRIPTION", proposalId: null, schemaVersion: 1, llmCallLogId: "log-1" }),
      }),
    );
  });

  it("wynik niezgodny ze schematem nigdy nie trafia do bazy", async () => {
    const bad = { ...input, result: { summary: "x", affected: [{ blockKey: "channels", level: "critical", impact: "x" }] } };

    await expect(createImpactAnalysis(bad as never)).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("dla DESCRIPTION ignoruje podane proposalId", async () => {
    mocks.create.mockResolvedValue(row());

    await createImpactAnalysis({ ...input, proposalId: "pr1" });

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ proposalId: null }) }));
  });
});

describe("odczyt analiz", () => {
  it("lista filtruje po projectId ORAZ variantId i nie pobiera migawki stanu", async () => {
    mocks.findMany.mockResolvedValue([row(), row({ id: "a2", result: { summary: "" } })]);

    const items = await listImpactAnalysesForVariant("p1", "v1", 20);

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "p1", variantId: "v1" }, take: 20 }),
    );
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty("stateSnapshot");
    expect(items[0]).toMatchObject({ ok: true });
    expect(items[1]).toMatchObject({ ok: false, id: "a2" });
  });

  it("wariant z innego projektu daje pustą listę, a obce id null", async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue(null);

    expect(await listImpactAnalysesForVariant("p-obcy", "v1", 20)).toEqual([]);
    expect(await getImpactAnalysis("p-obcy", "v1", "a1")).toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1", projectId: "p-obcy", variantId: "v1" } }),
    );
  });
});
