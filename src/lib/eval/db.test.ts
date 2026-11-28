import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  evalRunFindMany: vi.fn(),
  evalRunUpdateMany: vi.fn(),
  evalRunCreate: vi.fn(),
  evalRunUpdate: vi.fn(),
  projectCreate: vi.fn(),
  llmAggregate: vi.fn(),
  llmCount: vi.fn(),
  variantFindFirst: vi.fn(),
  proposalFindMany: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    evalRun: { findMany: mocks.evalRunFindMany, updateMany: mocks.evalRunUpdateMany, create: mocks.evalRunCreate, update: mocks.evalRunUpdate },
    project: { create: mocks.projectCreate },
    llmCallLog: { aggregate: mocks.llmAggregate, count: mocks.llmCount },
    bmcVariant: { findFirst: mocks.variantFindFirst },
    proposal: { findMany: mocks.proposalFindMany },
  },
}));

import { createEvalDb } from "@/lib/eval/db";
import { emptyBmcState } from "@/lib/schemas/bmc";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createEvalDb", () => {
  it("readCost: suma kosztu po projektach i liczba UDANYCH wywołań bez kosztu (nieudane nic nie kosztują)", async () => {
    mocks.llmAggregate.mockResolvedValue({ _sum: { costUsd: { toString: () => "0.012345" } } });
    mocks.llmCount.mockResolvedValue(2);

    const result = await createEvalDb().readCost(["p1", "p2"]);

    expect(result).toEqual({ totalUsd: 0.012345, unknownCalls: 2 });
    expect(mocks.llmAggregate).toHaveBeenCalledWith({ where: { projectId: { in: ["p1", "p2"] } }, _sum: { costUsd: true } });
    expect(mocks.llmCount).toHaveBeenCalledWith({ where: { projectId: { in: ["p1", "p2"] }, status: "OK", costUsd: null } });
  });

  it("readCost bez projektów nie odpytuje bazy", async () => {
    expect(await createEvalDb().readCost([])).toEqual({ totalUsd: 0, unknownCalls: 0 });
    expect(mocks.llmAggregate).not.toHaveBeenCalled();
  });

  it("createProject: właściciel OWNER, wariant główny z podanym stanem i pochodzeniem, bez usuwania czegokolwiek", async () => {
    mocks.projectCreate.mockResolvedValue({ id: "p1", variants: [{ id: "v1" }] });

    const result = await createEvalDb().createProject({
      userId: "u1",
      name: "EV-S1-BUILD-01-p1",
      description: "Nowy model biznesowy.",
      state: emptyBmcState(),
      entryOrigins: [],
    });

    expect(result).toEqual({ projectId: "p1", variantId: "v1" });
    const data = mocks.projectCreate.mock.calls[0][0].data;
    expect(data.name).toBe("EV-S1-BUILD-01-p1");
    expect(data.description).toBe("Nowy model biznesowy.");
    expect(data.members).toEqual({ create: { userId: "u1", role: "OWNER" } });
    expect(data.variants.create).toMatchObject({ isMain: true, createdById: "u1", entryOrigins: [] });
  });

  it("stopStaleRuns zmienia tylko własne wiersze RUNNING serii na STOPPED (CRASHED); createRun zaczyna od RUNNING", async () => {
    mocks.evalRunUpdateMany.mockResolvedValue({ count: 2 });
    mocks.evalRunCreate.mockResolvedValue({ id: "r1" });
    const db = createEvalDb();

    expect(await db.stopStaleRuns("S1")).toBe(2);
    expect(mocks.evalRunUpdateMany).toHaveBeenCalledWith({
      where: { seriesId: "S1", status: "RUNNING" },
      data: expect.objectContaining({ status: "STOPPED", errorCode: "CRASHED" }),
    });

    await db.createRun({
      seriesId: "S1", caseId: "BUILD-01", kind: "BUILD", repetition: 1, attempt: 1, provider: "google", model: "gemini-3.5-flash-lite",
      judgeModel: null, chatPromptVersion: "chat-v6", casesChecksum: "abc", maxOutputTokens: 2000, maxOutputTokensLong: 12000,
      reasoning: null, costLimitUsd: 0.1, turnLimit: 8, projectId: "p1",
    });
    expect(mocks.evalRunCreate.mock.calls[0][0].data).toMatchObject({ status: "RUNNING", architecture: "SINGLE", attempt: 1, reasoning: null });
  });

  it("finishRun zapisuje turnCount i endReason (walidacja Zod: powód spoza listy nie trafia do bazy)", async () => {
    mocks.evalRunUpdate.mockResolvedValue({});
    const db = createEvalDb();

    await db.finishRun("r1", { status: "OK", turnCount: 9, endReason: "ALL_BLOCKS" });
    expect(mocks.evalRunUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({ status: "OK", errorCode: null, turnCount: 9, endReason: "ALL_BLOCKS" }),
    });

    await db.finishRun("r2", { status: "STOPPED", errorCode: "TURN_LIMIT" });
    expect(mocks.evalRunUpdate).toHaveBeenLastCalledWith({
      where: { id: "r2" },
      data: expect.objectContaining({ turnCount: null, endReason: null }),
    });

    mocks.evalRunUpdate.mockClear();
    await expect(db.finishRun("r3", { status: "OK", endReason: "COS_INNEGO" as never })).rejects.toThrow();
    expect(mocks.evalRunUpdate).not.toHaveBeenCalled();
  });

  it("getMainVariant zwraca stan wariantu (do liczenia wypełnionych bloków), a uszkodzony stan to jawny błąd", async () => {
    mocks.variantFindFirst.mockResolvedValueOnce({ id: "v1", version: 4, state: { ...emptyBmcState(), channels: ["Sklep"] } });
    const variant = await createEvalDb().getMainVariant("p1");
    expect(variant).toMatchObject({ id: "v1", version: 4 });
    expect(variant?.state.channels).toEqual(["Sklep"]);

    mocks.variantFindFirst.mockResolvedValueOnce({ id: "v2", version: 1, state: { bzdura: true } });
    await expect(createEvalDb().getMainVariant("p1")).rejects.toThrow("Niepoprawny stan BMC");

    mocks.variantFindFirst.mockResolvedValueOnce(null);
    expect(await createEvalDb().getMainVariant("p1")).toBeNull();
  });

  it("createRun zapisuje poziom reasoning, a poziom spoza listy odrzuca przed zapisem (Zod)", async () => {
    mocks.evalRunCreate.mockResolvedValue({ id: "r2" });
    const data = {
      seriesId: "S1", caseId: "BUILD-01", kind: "BUILD" as const, repetition: 1, attempt: 1, provider: "google", model: "gemini-3.8-flash",
      judgeModel: null, chatPromptVersion: "chat-v6", casesChecksum: "abc", maxOutputTokens: 8000, maxOutputTokensLong: 16000,
      costLimitUsd: 0.1, turnLimit: 8, projectId: "p1",
    };

    await createEvalDb().createRun({ ...data, reasoning: "low" });
    expect(mocks.evalRunCreate.mock.calls[0][0].data).toMatchObject({ reasoning: "low" });

    mocks.evalRunCreate.mockClear();
    await expect(createEvalDb().createRun({ ...data, reasoning: "bardzo-mocno" })).rejects.toThrow();
    expect(mocks.evalRunCreate).not.toHaveBeenCalled();
  });

  it("listPendingProposalIds: tylko PENDING z wariantu projektu, od najstarszej", async () => {
    mocks.proposalFindMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

    expect(await createEvalDb().listPendingProposalIds("p1", "v1")).toEqual(["a", "b"]);
    expect(mocks.proposalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { variantId: "v1", variant: { projectId: "p1" }, status: "PENDING" } }),
    );
  });
});
