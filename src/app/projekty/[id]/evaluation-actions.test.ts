import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantProjectId: vi.fn(),
  runEvaluation: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole: mocks.requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({ getVariantProjectId: mocks.getVariantProjectId }));
vi.mock("@/lib/ai/evaluate", () => ({ runEvaluation: mocks.runEvaluation }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { evaluateModelAction } from "@/app/projekty/[id]/evaluation-actions";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const editorAccess = { ok: true, session, projectId: "p1", role: "EDITOR" };
const viewerAccess = { ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" };

const evaluation = { id: "e1", variantVersion: 3 };
const SAVE_FAILED_MESSAGE = "Model odpowiedział, ale nie udało się zapisać oceny. Spróbuj ponownie";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProjectRole.mockResolvedValue(editorAccess);
  mocks.getVariantProjectId.mockResolvedValue("p1");
  mocks.runEvaluation.mockResolvedValue({ ok: true, evaluation });
});

describe("evaluateModelAction", () => {
  it("wymaga roli EDITOR", async () => {
    await evaluateModelAction("p1", "v1");

    expect(mocks.requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
  });

  it("VIEWER dostaje FORBIDDEN bez odczytu wariantu i bez wywołania modelu", async () => {
    mocks.requireProjectRole.mockResolvedValue(viewerAccess);

    const result = await evaluateModelAction("p1", "v1");

    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expect(mocks.runEvaluation).not.toHaveBeenCalled();
  });

  it("brak sesji lub obcy projekt: przerwanie z requireProjectRole, nic dalej nie jest wołane", async () => {
    mocks.requireProjectRole.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(evaluateModelAction("p-obcy", "v1")).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expect(mocks.runEvaluation).not.toHaveBeenCalled();
  });

  it("wariant z innego projektu: NOT_FOUND bez wywołania modelu", async () => {
    mocks.getVariantProjectId.mockResolvedValue("p-inny");

    const result = await evaluateModelAction("p1", "v-obcy");

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(mocks.runEvaluation).not.toHaveBeenCalled();
  });

  it("nieistniejący wariant: NOT_FOUND", async () => {
    mocks.getVariantProjectId.mockResolvedValue(null);

    await expect(evaluateModelAction("p1", "v1")).resolves.toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(mocks.runEvaluation).not.toHaveBeenCalled();
  });

  it("zły argument: VALIDATION bez odczytu wariantu i bez modelu", async () => {
    for (const bad of ["", "   ", "x".repeat(65)]) {
      const result = await evaluateModelAction("p1", bad);

      expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    }
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expect(mocks.runEvaluation).not.toHaveBeenCalled();
  });

  it("kolejność: rola, wariant w projekcie, dopiero potem ocena", async () => {
    const order: string[] = [];
    mocks.requireProjectRole.mockImplementation(async () => (order.push("rola"), editorAccess));
    mocks.getVariantProjectId.mockImplementation(async () => (order.push("wariant"), "p1"));
    mocks.runEvaluation.mockImplementation(async () => (order.push("ocena"), { ok: true, evaluation }));

    await evaluateModelAction("p1", "v1");

    expect(order).toEqual(["rola", "wariant", "ocena"]);
  });

  it("przekazuje do oceny projekt z uprawnień, użytkownika z sesji i wyzwalacz UI", async () => {
    await evaluateModelAction("p1", "v1");

    expect(mocks.runEvaluation).toHaveBeenCalledWith({
      projectId: "p1",
      variantId: "v1",
      userId: "u1",
      trigger: "UI",
    });
  });

  it("sukces zwraca ocenę i odświeża stronę projektu", async () => {
    const result = await evaluateModelAction("p1", "v1");

    expect(result).toEqual({ ok: true, evaluation });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("SAVE_FAILED: osobny błąd z komunikatem o zapisie, bez odświeżania", async () => {
    mocks.runEvaluation.mockResolvedValue({ ok: false, error: "SAVE_FAILED", message: SAVE_FAILED_MESSAGE });

    const result = await evaluateModelAction("p1", "v1");

    expect(result).toMatchObject({
      ok: false,
      error: "SAVE_FAILED",
      message: "Model odpowiedział, ale nie udało się zapisać oceny. Spróbuj ponownie",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("przekazuje błędy oceny (limit, pusty model) wraz z czasem oczekiwania", async () => {
    mocks.runEvaluation.mockResolvedValue({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 90 });

    await expect(evaluateModelAction("p1", "v1")).resolves.toEqual({
      ok: false,
      error: "LIMIT",
      message: "Limit.",
      retryAfterSec: 90,
    });

    mocks.runEvaluation.mockResolvedValue({ ok: false, error: "TOO_EMPTY", message: "Za mało." });
    await expect(evaluateModelAction("p1", "v1")).resolves.toMatchObject({ ok: false, error: "TOO_EMPTY" });
  });
});
