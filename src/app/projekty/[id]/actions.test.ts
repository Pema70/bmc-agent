import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireProjectRole, getVariantProjectId, saveVariantState, revalidatePath } = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantProjectId: vi.fn(),
  saveVariantState: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({ getVariantProjectId, saveVariantState }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { saveCanvasAction } from "@/app/projekty/[id]/actions";
import { MAX_ENTRIES_PER_BLOCK, emptyBmcState } from "@/lib/schemas/bmc";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const editorAccess = { ok: true, session, projectId: "p1", role: "EDITOR" };
const validState = { ...emptyBmcState(), channels: [" Sklep online "] };

function entries(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveCanvasAction", () => {
  it("wymaga roli EDITOR", async () => {
    requireProjectRole.mockResolvedValue(editorAccess);
    getVariantProjectId.mockResolvedValue("p1");
    saveVariantState.mockResolvedValue({ ok: true, version: 2 });

    await saveCanvasAction("p1", "v1", 1, validState);

    expect(requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
  });

  it("bez sesji przerywa przed odczytem wariantu i zapisem", async () => {
    requireProjectRole.mockRejectedValue(new Error("REDIRECT:/logowanie"));

    await expect(saveCanvasAction("p1", "v1", 1, validState)).rejects.toThrow("REDIRECT:/logowanie");
    expect(getVariantProjectId).not.toHaveBeenCalled();
    expect(saveVariantState).not.toHaveBeenCalled();
  });

  it("odrzuca zapis przez VIEWER przed odczytem wariantu i zapisem", async () => {
    requireProjectRole.mockResolvedValue({ ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" });

    expect(await saveCanvasAction("p1", "v1", 1, validState)).toEqual({
      ok: false,
      error: "FORBIDDEN",
      message: "Nie masz uprawnień do edycji tego modelu.",
    });
    expect(getVariantProjectId).not.toHaveBeenCalled();
    expect(saveVariantState).not.toHaveBeenCalled();
  });

  it("odrzuca wariant z innego projektu", async () => {
    requireProjectRole.mockResolvedValue(editorAccess);
    getVariantProjectId.mockResolvedValue("p2");

    expect(await saveCanvasAction("p1", "v-obcy", 1, validState)).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(getVariantProjectId).toHaveBeenCalledWith("v-obcy");
    expect(saveVariantState).not.toHaveBeenCalled();
  });

  it("odrzuca nieistniejący wariant i niepoprawny identyfikator", async () => {
    requireProjectRole.mockResolvedValue(editorAccess);
    getVariantProjectId.mockResolvedValue(null);

    expect(await saveCanvasAction("p1", "v404", 1, validState)).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(await saveCanvasAction("p1", "", 1, validState)).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(getVariantProjectId).toHaveBeenCalledTimes(1);
    expect(saveVariantState).not.toHaveBeenCalled();
  });

  it("sprawdza przynależność wariantu przed walidacją stanu", async () => {
    requireProjectRole.mockResolvedValue(editorAccess);
    getVariantProjectId.mockResolvedValue("p2");

    // Stan jest niepoprawny, ale odpowiedź to NOT_FOUND: walidacja nie zdążyła się wykonać.
    expect(await saveCanvasAction("p1", "v-obcy", 1, { zly: "stan" })).toMatchObject({ error: "NOT_FOUND" });
  });

  it("nie zapisuje stanu przekraczającego limit na blok", async () => {
    requireProjectRole.mockResolvedValue(editorAccess);
    getVariantProjectId.mockResolvedValue("p1");

    const state = { ...emptyBmcState(), channels: entries(MAX_ENTRIES_PER_BLOCK + 1, "Kanał") };

    expect(await saveCanvasAction("p1", "v1", 1, state)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(saveVariantState).not.toHaveBeenCalled();
  });

  it("nie zapisuje stanu przekraczającego limit łączny", async () => {
    requireProjectRole.mockResolvedValue(editorAccess);
    getVariantProjectId.mockResolvedValue("p1");

    // 5 bloków po 30 to dokładnie MAX_ENTRIES_TOTAL; szósty blok z 1 wpisem przekracza limit.
    const state = {
      ...emptyBmcState(),
      customer_segments: entries(30, "S"),
      value_propositions: entries(30, "V"),
      channels: entries(30, "C"),
      customer_relationships: entries(30, "R"),
      revenue_streams: entries(30, "P"),
      key_resources: ["Jeden za dużo"],
    };

    expect(await saveCanvasAction("p1", "v1", 1, state)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(saveVariantState).not.toHaveBeenCalled();
  });

  it("odrzuca niepoprawną wersję", async () => {
    requireProjectRole.mockResolvedValue(editorAccess);
    getVariantProjectId.mockResolvedValue("p1");

    expect(await saveCanvasAction("p1", "v1", 0, validState)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(await saveCanvasAction("p1", "v1", 1.5, validState)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(saveVariantState).not.toHaveBeenCalled();
  });

  it("zwraca polski komunikat przy konflikcie wersji", async () => {
    requireProjectRole.mockResolvedValue(editorAccess);
    getVariantProjectId.mockResolvedValue("p1");
    saveVariantState.mockResolvedValue({ ok: false, error: "VERSION_CONFLICT" });

    expect(await saveCanvasAction("p1", "v1", 3, validState)).toEqual({
      ok: false,
      error: "VERSION_CONFLICT",
      message: "Ktoś w międzyczasie zmienił ten model. Odśwież stronę, aby zobaczyć aktualną wersję.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("zapisuje przycięty stan z wersją i zwraca nową wersję", async () => {
    requireProjectRole.mockResolvedValue(editorAccess);
    getVariantProjectId.mockResolvedValue("p1");
    saveVariantState.mockResolvedValue({ ok: true, version: 4 });

    const trimmed = { ...emptyBmcState(), channels: ["Sklep online"] };

    expect(await saveCanvasAction("p1", "v1", 3, validState)).toEqual({ ok: true, version: 4, state: trimmed });
    expect(saveVariantState).toHaveBeenCalledWith("v1", 3, trimmed);
    expect(revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });
});
