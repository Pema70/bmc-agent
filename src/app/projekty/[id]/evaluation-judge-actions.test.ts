import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantProjectId: vi.fn(),
  runJudge: vi.fn(),
  isJudgeUiEnabled: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole: mocks.requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({ getVariantProjectId: mocks.getVariantProjectId, getVariantForProject: vi.fn() }));
vi.mock("@/lib/db/evaluations", () => ({ createManualEvaluation: vi.fn(), getEvaluation: vi.fn() }));
vi.mock("@/lib/ai/evaluate", () => ({ runEvaluation: vi.fn() }));
vi.mock("@/lib/ai/judge", () => ({ runJudge: mocks.runJudge }));
vi.mock("@/lib/ai/judge-config", () => ({ isJudgeUiEnabled: mocks.isJudgeUiEnabled }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { judgeModelAction } from "@/app/projekty/[id]/evaluation-actions";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const editorAccess = { ok: true, session, projectId: "p1", role: "EDITOR" };
const viewerAccess = { ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" };
const evaluation = { id: "j1", source: "JUDGE", variantVersion: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProjectRole.mockResolvedValue(editorAccess);
  mocks.isJudgeUiEnabled.mockReturnValue(true);
  mocks.getVariantProjectId.mockResolvedValue("p1");
  mocks.runJudge.mockResolvedValue({ ok: true, evaluation });
});

describe("judgeModelAction", () => {
  it("wymaga roli EDITOR; VIEWER dostaje FORBIDDEN bez odczytu wariantu i bez wywołania sędziego", async () => {
    mocks.requireProjectRole.mockResolvedValue(viewerAccess);

    const result = await judgeModelAction("p1", "v1");

    expect(mocks.requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it("brak sesji lub obcy projekt: przerwanie z requireProjectRole", async () => {
    mocks.requireProjectRole.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(judgeModelAction("p-obcy", "v1")).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it("bez flagi JUDGE_UI_ENABLED lub konfiguracji: DISABLED, bez odczytu wariantu i bez sędziego", async () => {
    mocks.isJudgeUiEnabled.mockReturnValue(false);

    const result = await judgeModelAction("p1", "v1");

    expect(result).toMatchObject({ ok: false, error: "DISABLED" });
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it("zły identyfikator wariantu: VALIDATION bez odczytu i bez sędziego", async () => {
    for (const bad of ["", "   ", "x".repeat(65)]) {
      await expect(judgeModelAction("p1", bad)).resolves.toMatchObject({ ok: false, error: "VALIDATION" });
    }
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it("wariant z innego projektu lub nieistniejący: NOT_FOUND bez sędziego", async () => {
    mocks.getVariantProjectId.mockResolvedValue("p-inny");
    await expect(judgeModelAction("p1", "v-obcy")).resolves.toMatchObject({ ok: false, error: "NOT_FOUND" });
    mocks.getVariantProjectId.mockResolvedValue(null);
    await expect(judgeModelAction("p1", "v1")).resolves.toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it("kolejność: rola, flaga, wariant, dopiero potem sędzia", async () => {
    const order: string[] = [];
    mocks.requireProjectRole.mockImplementation(async () => (order.push("rola"), editorAccess));
    mocks.isJudgeUiEnabled.mockImplementation(() => (order.push("flaga"), true));
    mocks.getVariantProjectId.mockImplementation(async () => (order.push("wariant"), "p1"));
    mocks.runJudge.mockImplementation(async () => (order.push("sedzia"), { ok: true, evaluation }));

    await judgeModelAction("p1", "v1");

    expect(order).toEqual(["rola", "flaga", "wariant", "sedzia"]);
  });

  it("sukces: sędzia z użytkownikiem z sesji i triggerem UI, odświeżenie strony", async () => {
    const result = await judgeModelAction("p1", "v1");

    expect(result).toEqual({ ok: true, evaluation });
    expect(mocks.runJudge).toHaveBeenCalledWith({ projectId: "p1", variantId: "v1", userId: "u1", trigger: "UI" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("błąd sędziego (limit): przekazuje komunikat i retryAfterSec, bez odświeżania", async () => {
    mocks.runJudge.mockResolvedValue({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 30 });

    const result = await judgeModelAction("p1", "v1");

    expect(result).toEqual({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 30 });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
