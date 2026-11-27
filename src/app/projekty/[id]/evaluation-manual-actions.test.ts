import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantForProject: vi.fn(),
  createManualEvaluation: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole: mocks.requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({ getVariantForProject: mocks.getVariantForProject, getVariantProjectId: vi.fn() }));
vi.mock("@/lib/db/evaluations", () => ({
  createManualEvaluation: mocks.createManualEvaluation,
  getEvaluation: vi.fn(),
}));
vi.mock("@/lib/ai/evaluate", () => ({ runEvaluation: vi.fn() }));
vi.mock("@/lib/ai/judge", () => ({ runJudge: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createManualEvaluationAction } from "@/app/projekty/[id]/evaluation-actions";
import { emptyBmcState } from "@/lib/schemas/bmc";
import { JUSTIFICATION_MAX_LENGTH } from "@/lib/schemas/evaluation";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const editorAccess = { ok: true, session, projectId: "p1", role: "EDITOR" };
const viewerAccess = { ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" };

const state = { ...emptyBmcState(), channels: ["Sklep online"] };
const input = {
  coherence: { score: 7, justification: "Bloki się uzasadniają." },
  risk_resilience: { score: 4, justification: "Zależność od jednego dostawcy." },
  feasibility: { score: 6, justification: "Zasoby są dostępne." },
  innovation: { score: 3, justification: "Znane rozwiązanie." },
};
const saved = { id: "e1", source: "MANUAL", variantVersion: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProjectRole.mockResolvedValue(editorAccess);
  mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 5, state });
  mocks.createManualEvaluation.mockResolvedValue(saved);
});

describe("createManualEvaluationAction", () => {
  it("wymaga roli EDITOR; VIEWER dostaje FORBIDDEN bez odczytu wariantu i bez zapisu", async () => {
    mocks.requireProjectRole.mockResolvedValue(viewerAccess);

    const result = await createManualEvaluationAction("p1", "v1", input);

    expect(mocks.requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(mocks.getVariantForProject).not.toHaveBeenCalled();
    expect(mocks.createManualEvaluation).not.toHaveBeenCalled();
  });

  it("brak sesji lub obcy projekt: przerwanie z requireProjectRole, nic dalej nie jest wołane", async () => {
    mocks.requireProjectRole.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(createManualEvaluationAction("p-obcy", "v1", input)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.getVariantForProject).not.toHaveBeenCalled();
    expect(mocks.createManualEvaluation).not.toHaveBeenCalled();
  });

  it("wariant spoza projektu (lub nieistniejący): NOT_FOUND bez zapisu; zapytanie po projekcie z uprawnień", async () => {
    mocks.getVariantForProject.mockResolvedValue(null);

    const result = await createManualEvaluationAction("p1", "v-obcy", input);

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(mocks.getVariantForProject).toHaveBeenCalledWith("p1", "v-obcy");
    expect(mocks.createManualEvaluation).not.toHaveBeenCalled();
  });

  it("zły identyfikator wariantu: VALIDATION bez odczytu wariantu", async () => {
    for (const bad of ["", "   ", "x".repeat(65)]) {
      await expect(createManualEvaluationAction("p1", bad, input)).resolves.toMatchObject({ ok: false, error: "VALIDATION" });
    }
    expect(mocks.getVariantForProject).not.toHaveBeenCalled();
  });

  it("kolejność: rola, wariant, dopiero potem zapis", async () => {
    const order: string[] = [];
    mocks.requireProjectRole.mockImplementation(async () => (order.push("rola"), editorAccess));
    mocks.getVariantForProject.mockImplementation(async () => (order.push("wariant"), { id: "v1", version: 5, state }));
    mocks.createManualEvaluation.mockImplementation(async () => (order.push("zapis"), saved));

    await createManualEvaluationAction("p1", "v1", input);

    expect(order).toEqual(["rola", "wariant", "zapis"]);
  });

  it("odrzuca ocenę niezgodną ze schematem (zakres, liczba całkowita, puste lub za długie uzasadnienie, dodatkowe pola)", async () => {
    const bad = [
      { ...input, coherence: { score: 0, justification: "x" } },
      { ...input, coherence: { score: 11, justification: "x" } },
      { ...input, coherence: { score: 5.5, justification: "x" } },
      { ...input, coherence: { score: Number.NaN, justification: "x" } },
      { ...input, coherence: { score: 5, justification: "   " } },
      { ...input, coherence: { score: 5, justification: "a".repeat(JUSTIFICATION_MAX_LENGTH + 1) } },
      { ...input, coherence: { score: 5, justification: "x", extra: 1 } },
      { ...input, innovation: undefined },
      null,
      "tekst",
    ];
    for (const value of bad) {
      await expect(createManualEvaluationAction("p1", "v1", value)).resolves.toMatchObject({ ok: false, error: "VALIDATION" });
    }
    expect(mocks.createManualEvaluation).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("akceptuje uzasadnienie o maksymalnej długości", async () => {
    const edge = { ...input, coherence: { score: 5, justification: "a".repeat(JUSTIFICATION_MAX_LENGTH) } };

    await expect(createManualEvaluationAction("p1", "v1", edge)).resolves.toMatchObject({ ok: true });
  });

  it("zapisuje wersję i migawkę z bazy (nie od klienta), użytkownika z sesji i odświeża stronę", async () => {
    const result = await createManualEvaluationAction("p1", "v1", input);

    expect(result).toEqual({ ok: true, evaluation: saved });
    expect(mocks.createManualEvaluation).toHaveBeenCalledWith({
      projectId: "p1",
      variantId: "v1",
      variantVersion: 5,
      stateSnapshot: state,
      result: input,
      createdById: "u1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("ignoruje pola spoza schematu w argumencie (migawka, wersja) zamiast je zapisywać", async () => {
    const result = await createManualEvaluationAction("p1", "v1", { ...input, variantVersion: 99, stateSnapshot: {} });

    expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(mocks.createManualEvaluation).not.toHaveBeenCalled();
  });
});
