import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  prisma: { evaluationResult: { create: mocks.create, findMany: mocks.findMany, findFirst: mocks.findFirst } },
}));

import {
  createEvaluation,
  getEvaluation,
  getEvaluationSnapshot,
  listEvaluationsForVariant,
  parseEvaluationRow,
} from "@/lib/db/evaluations";
import { emptyBmcState } from "@/lib/schemas/bmc";

const result = {
  coherence: { score: 7, justification: "a" },
  risk_resilience: { score: 4, justification: "b" },
  feasibility: { score: 6, justification: "c" },
  innovation: { score: 3, justification: "d" },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    createdAt: new Date("2026-11-11T10:00:00Z"),
    schemaVersion: 1,
    variantVersion: 3,
    source: "AI",
    trigger: "UI",
    provider: "google",
    model: "gemini-3.8-flash",
    promptVersion: "evaluate-v1",
    result,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseEvaluationRow", () => {
  it("zwraca ocenę z poprawnego wiersza", () => {
    const parsed = parseEvaluationRow(row());
    expect(parsed).toMatchObject({ ok: true, evaluation: { id: "e1", variantVersion: 3, model: "gemini-3.8-flash" } });
  });

  it("odrzuca wiersz z obcą wersją schematu (schemaVersion)", () => {
    expect(parseEvaluationRow(row({ schemaVersion: 2 }))).toMatchObject({ ok: false, id: "e1" });
  });

  it("odrzuca wiersz z wynikiem niezgodnym ze schematem", () => {
    expect(parseEvaluationRow(row({ result: { coherence: { score: 99, justification: "x" } } }))).toMatchObject({
      ok: false,
      id: "e1",
    });
  });

  it("odrzuca ocenę AI bez modelu lub wersji promptu", () => {
    expect(parseEvaluationRow(row({ model: null }))).toMatchObject({ ok: false });
    expect(parseEvaluationRow(row({ promptVersion: null }))).toMatchObject({ ok: false });
  });

  it("przyjmuje ocenę ręczną bez modelu i wyzwalacza", () => {
    expect(parseEvaluationRow(row({ source: "MANUAL", trigger: null, provider: null, model: null, promptVersion: null }))).toMatchObject({
      ok: true,
    });
  });
});

describe("listEvaluationsForVariant", () => {
  it("filtruje po projectId ORAZ variantId i nie wybiera migawki stanu", async () => {
    mocks.findMany.mockResolvedValue([]);

    await listEvaluationsForVariant("p1", "v1", 20);

    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ projectId: "p1", variantId: "v1" });
    expect(args.take).toBe(20);
    expect(args.select).not.toHaveProperty("stateSnapshot");
  });

  it("wariant z innego projektu daje pustą listę", async () => {
    mocks.findMany.mockResolvedValue([]);

    await expect(listEvaluationsForVariant("p-obcy", "v1", 20)).resolves.toEqual([]);
  });

  it("uszkodzony rekord daje błąd tylko dla swojego wiersza", async () => {
    mocks.findMany.mockResolvedValue([row({ id: "e2", result: { zle: true } }), row({ id: "e1" })]);

    const items = await listEvaluationsForVariant("p1", "v1", 20);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ ok: false, id: "e2" });
    expect(items[1]).toMatchObject({ ok: true });
  });
});

describe("getEvaluationSnapshot", () => {
  it("czyta po id, projectId i variantId", async () => {
    mocks.findFirst.mockResolvedValue({ id: "e1", stateSnapshot: emptyBmcState() });

    await expect(getEvaluationSnapshot("p1", "v1", "e1")).resolves.toEqual(emptyBmcState());
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "e1", projectId: "p1", variantId: "v1" });
  });

  it("zwraca null dla oceny z innego projektu lub wariantu", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getEvaluationSnapshot("p-obcy", "v1", "e1")).resolves.toBeNull();
  });

  it("uszkodzona migawka to jawny błąd", async () => {
    mocks.findFirst.mockResolvedValue({ id: "e1", stateSnapshot: { channels: [] } });

    await expect(getEvaluationSnapshot("p1", "v1", "e1")).rejects.toThrow(/migawka/i);
  });
});

describe("createEvaluation", () => {
  const input = {
    projectId: "p1",
    variantId: "v1",
    variantVersion: 3,
    stateSnapshot: emptyBmcState(),
    result,
    trigger: "UI" as const,
    provider: "google",
    model: "gemini-3.8-flash",
    promptVersion: "evaluate-v1",
    llmCallLogId: "log-1",
    createdById: "u1",
  };

  it("zapisuje schemaVersion, migawkę i powiązanie z logiem; id pochodzi z bazy", async () => {
    mocks.create.mockResolvedValue(row({ id: "db-id" }));

    const evaluation = await createEvaluation(input);

    expect(evaluation.id).toBe("db-id");
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      schemaVersion: 1,
      variantVersion: 3,
      source: "AI",
      trigger: "UI",
      llmCallLogId: "log-1",
      promptVersion: "evaluate-v1",
    });
  });

  it("nie zapisuje wyniku niezgodnego ze schematem", async () => {
    const bad = { ...input, result: { ...result, coherence: { score: 11, justification: "x" } } };

    await expect(createEvaluation(bad)).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("getEvaluation", () => {
  it("czyta jedną ocenę z filtrem po id, projectId ORAZ variantId, bez migawki stanu", async () => {
    mocks.findFirst.mockResolvedValue(row());

    const item = await getEvaluation("p1", "v1", "e1");

    const args = mocks.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id: "e1", projectId: "p1", variantId: "v1" });
    expect(args.select).not.toHaveProperty("stateSnapshot");
    expect(item).toMatchObject({ ok: true, evaluation: { id: "e1" } });
  });

  it("zwraca null dla oceny z obcego projektu lub wariantu i błąd dla uszkodzonego rekordu", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    expect(await getEvaluation("p-obcy", "v1", "e1")).toBeNull();

    mocks.findFirst.mockResolvedValueOnce(row({ result: { zepsute: true } }));
    expect(await getEvaluation("p1", "v1", "e1")).toMatchObject({ ok: false, id: "e1" });
  });
});
