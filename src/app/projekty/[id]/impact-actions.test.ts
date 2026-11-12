import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantProjectId: vi.fn(),
  runImpactAnalysis: vi.fn(),
  revalidatePath: vi.fn(),
  getImpactAnalysis: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole: mocks.requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({ getVariantProjectId: mocks.getVariantProjectId }));
vi.mock("@/lib/ai/impact", () => ({ runImpactAnalysis: mocks.runImpactAnalysis }));
vi.mock("@/lib/db/impact", () => ({ getImpactAnalysis: mocks.getImpactAnalysis }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  analyzeImpactAction,
  getImpactAnalysisAction,
} from "@/app/projekty/[id]/impact-actions";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const editorAccess = { ok: true, session, projectId: "p1", role: "EDITOR" };
const viewerAccess = { ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" };

const description = { kind: "DESCRIPTION", blockKey: "channels", description: "Sprzedaż wyłącznie online" };
const proposal = { kind: "PROPOSAL", proposalId: "pr1" };
const analysis = { id: "a1", variantVersion: 3 };
const SAVE_FAILED_MESSAGE = "Model odpowiedział, ale nie udało się zapisać analizy. Spróbuj ponownie";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProjectRole.mockResolvedValue(editorAccess);
  mocks.getVariantProjectId.mockResolvedValue("p1");
  mocks.runImpactAnalysis.mockResolvedValue({ ok: true, analysis });
});

describe("analyzeImpactAction", () => {
  it("wymaga roli EDITOR", async () => {
    await analyzeImpactAction("p1", "v1", description);

    expect(mocks.requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
  });

  it("VIEWER dostaje FORBIDDEN bez odczytu wariantu i bez wywołania modelu", async () => {
    mocks.requireProjectRole.mockResolvedValue(viewerAccess);

    const result = await analyzeImpactAction("p1", "v1", description);

    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expect(mocks.runImpactAnalysis).not.toHaveBeenCalled();
  });

  it("brak sesji lub obcy projekt: przerwanie z requireProjectRole, nic dalej nie jest wołane", async () => {
    mocks.requireProjectRole.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(analyzeImpactAction("p-obcy", "v1", description)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expect(mocks.runImpactAnalysis).not.toHaveBeenCalled();
  });

  it("wariant z innego projektu: NOT_FOUND bez wywołania modelu", async () => {
    mocks.getVariantProjectId.mockResolvedValue("p-inny");

    const result = await analyzeImpactAction("p1", "v-obcy", description);

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(mocks.runImpactAnalysis).not.toHaveBeenCalled();
  });

  it("nieistniejący wariant: NOT_FOUND", async () => {
    mocks.getVariantProjectId.mockResolvedValue(null);

    await expect(analyzeImpactAction("p1", "v1", description)).resolves.toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(mocks.runImpactAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    ["pusty variantId", "", description],
    ["za długi variantId", "x".repeat(65), description],
    ["brak zmiany", "v1", undefined],
    ["zła forma", "v1", { kind: "INNE" }],
    ["za krótki opis", "v1", { ...description, description: "abc" }],
    ["za długi opis", "v1", { ...description, description: "a".repeat(501) }],
    ["zły blockKey", "v1", { ...description, blockKey: "x" }],
    ["PROPOSAL bez proposalId", "v1", { kind: "PROPOSAL" }],
    ["mieszana forma", "v1", { ...proposal, blockKey: "channels" }],
  ])("zły argument (%s): VALIDATION bez odczytu wariantu i bez modelu", async (_label, variantId, change) => {
    const result = await analyzeImpactAction("p1", variantId, change);

    expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expect(mocks.runImpactAnalysis).not.toHaveBeenCalled();
  });

  it("kolejność: rola, wariant w projekcie, dopiero potem analiza", async () => {
    const order: string[] = [];
    mocks.requireProjectRole.mockImplementation(async () => (order.push("rola"), editorAccess));
    mocks.getVariantProjectId.mockImplementation(async () => (order.push("wariant"), "p1"));
    mocks.runImpactAnalysis.mockImplementation(async () => (order.push("analiza"), { ok: true, analysis }));

    await analyzeImpactAction("p1", "v1", description);

    expect(order).toEqual(["rola", "wariant", "analiza"]);
  });

  it("przekazuje do analizy projekt z uprawnień, użytkownika z sesji, wyzwalacz UI i zwalidowaną zmianę", async () => {
    await analyzeImpactAction("p1", "  v1  ", { ...description, description: "  Sprzedaż wyłącznie online  " });

    expect(mocks.runImpactAnalysis).toHaveBeenCalledWith({
      projectId: "p1",
      variantId: "v1",
      userId: "u1",
      trigger: "UI",
      change: { kind: "DESCRIPTION", blockKey: "channels", description: "Sprzedaż wyłącznie online" },
    });
  });

  it("propozycja z innego wariantu: NOT_FOUND z analizy, bez zapisu i bez odświeżania", async () => {
    mocks.runImpactAnalysis.mockResolvedValue({ ok: false, error: "NOT_FOUND", message: "wewnętrzny komunikat" });

    const result = await analyzeImpactAction("p1", "v1", proposal);

    expect(mocks.runImpactAnalysis).toHaveBeenCalledWith(expect.objectContaining({ change: proposal, variantId: "v1" }));
    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND", message: expect.stringContaining("Nie znaleziono") });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sukces zwraca analizę i odświeża stronę projektu", async () => {
    const result = await analyzeImpactAction("p1", "v1", description);

    expect(result).toEqual({ ok: true, analysis });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("SAVE_FAILED: osobny błąd z komunikatem o zapisie, bez odświeżania", async () => {
    mocks.runImpactAnalysis.mockResolvedValue({ ok: false, error: "SAVE_FAILED", message: "cokolwiek" });

    const result = await analyzeImpactAction("p1", "v1", description);

    expect(result).toEqual({ ok: false, error: "SAVE_FAILED", message: SAVE_FAILED_MESSAGE, retryAfterSec: undefined });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("przekazuje szczegółowe błędy (limit z czasem oczekiwania, pusty model, nieaktualna propozycja, dostawca)", async () => {
    mocks.runImpactAnalysis.mockResolvedValue({ ok: false, error: "LIMIT", message: "Limit. Spróbuj za 60 s.", retryAfterSec: 60 });
    await expect(analyzeImpactAction("p1", "v1", description)).resolves.toMatchObject({
      ok: false,
      error: "LIMIT",
      message: "Limit. Spróbuj za 60 s.",
      retryAfterSec: 60,
    });

    mocks.runImpactAnalysis.mockResolvedValue({ ok: false, error: "STALE_PROPOSAL", message: "Ten wpis zmienił się." });
    await expect(analyzeImpactAction("p1", "v1", proposal)).resolves.toMatchObject({
      error: "STALE_PROPOSAL",
      message: "Ten wpis zmienił się.",
    });

    mocks.runImpactAnalysis.mockResolvedValue({ ok: false, error: "PROVIDER", message: "Model jest chwilowo niedostępny." });
    await expect(analyzeImpactAction("p1", "v1", description)).resolves.toMatchObject({
      error: "PROVIDER",
      message: "Model jest chwilowo niedostępny.",
    });
  });
});

describe("getImpactAnalysisAction", () => {
  const item = { ok: true, analysis };

  beforeEach(() => {
    mocks.getImpactAnalysis.mockResolvedValue(item);
  });

  it("wymaga roli VIEWER i czyta analizę z projectId z uprawnień oraz variantId", async () => {
    const result = await getImpactAnalysisAction("p1", "v1", "a1");

    expect(mocks.requireProjectRole).toHaveBeenCalledWith("p1", "VIEWER");
    expect(mocks.getImpactAnalysis).toHaveBeenCalledWith("p1", "v1", "a1");
    expect(result).toEqual({ ok: true, item });
  });

  it("brak uprawnień: FORBIDDEN bez odczytu", async () => {
    mocks.requireProjectRole.mockResolvedValue(viewerAccess);

    await expect(getImpactAnalysisAction("p1", "v1", "a1")).resolves.toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(mocks.getImpactAnalysis).not.toHaveBeenCalled();
  });

  it("zły argument: VALIDATION bez odczytu", async () => {
    await expect(getImpactAnalysisAction("p1", "v1", "  ")).resolves.toMatchObject({ ok: false, error: "VALIDATION" });
    await expect(getImpactAnalysisAction("p1", "", "a1")).resolves.toMatchObject({ ok: false, error: "VALIDATION" });
    expect(mocks.getImpactAnalysis).not.toHaveBeenCalled();
  });

  it("analiza z innego projektu lub wariantu: NOT_FOUND", async () => {
    mocks.getImpactAnalysis.mockResolvedValue(null);

    await expect(getImpactAnalysisAction("p1", "v1", "a-obca")).resolves.toMatchObject({ ok: false, error: "NOT_FOUND" });
  });
});
