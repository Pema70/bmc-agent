import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantProjectId: vi.fn(),
  createVariant: vi.fn(),
  renameVariant: vi.fn(),
  setMainVariant: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole: m.requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({
  getVariantProjectId: m.getVariantProjectId,
  createVariant: m.createVariant,
  renameVariant: m.renameVariant,
  setMainVariant: m.setMainVariant,
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import {
  CONFLICT_MESSAGE,
  createVariantAction,
  renameVariantAction,
  setMainVariantAction,
} from "@/app/projekty/[id]/variant-actions";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const allowed = { ok: true, session, projectId: "p1", role: "OWNER" };
const forbidden = { ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" };

const actions = [
  {
    name: "createVariantAction",
    role: "EDITOR",
    call: (variantId = "v1") => createVariantAction("p1", variantId),
    dbMock: m.createVariant,
  },
  {
    name: "renameVariantAction",
    role: "EDITOR",
    call: (variantId = "v1") => renameVariantAction("p1", variantId, "Nowa nazwa"),
    dbMock: m.renameVariant,
  },
  {
    name: "setMainVariantAction",
    role: "OWNER",
    call: (variantId = "v2") => setMainVariantAction("p1", variantId, "v1"),
    dbMock: m.setMainVariant,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.requireProjectRole.mockResolvedValue(allowed);
  m.getVariantProjectId.mockResolvedValue("p1");
  m.createVariant.mockResolvedValue({ ok: true, variant: { id: "v-nowy", name: "W (kopia)" } });
  m.renameVariant.mockResolvedValue({ ok: true });
  m.setMainVariant.mockResolvedValue({ ok: true, mainVariantId: "v2", changed: true });
});

describe.each(actions)("$name: kolejność sprawdzeń", ({ role, call, dbMock }) => {
  it(`wymaga roli ${role}`, async () => {
    await call();
    expect(m.requireProjectRole).toHaveBeenCalledWith("p1", role);
  });

  it("bez sesji przerywa przed odczytem wariantu i zapisem", async () => {
    m.requireProjectRole.mockRejectedValue(new Error("REDIRECT:/logowanie"));

    await expect(call()).rejects.toThrow("REDIRECT:/logowanie");
    expect(m.getVariantProjectId).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("obcy projekt (404 z requireProjectRole) przerywa przed odczytem wariantu i zapisem", async () => {
    m.requireProjectRole.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.getVariantProjectId).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("za niska rola (ok: false): FORBIDDEN bez odczytu wariantu, zapisu i rewalidacji", async () => {
    m.requireProjectRole.mockResolvedValue(forbidden);

    const result = await call();

    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(m.getVariantProjectId).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("wariant z innego projektu: NOT_FOUND bez zapisu", async () => {
    m.getVariantProjectId.mockResolvedValue("p-obcy");

    const result = await call("v-z-innego-projektu");

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("nieistniejący wariant i niepoprawny identyfikator: NOT_FOUND bez zapisu", async () => {
    m.getVariantProjectId.mockResolvedValue(null);
    expect(await call("v404")).toMatchObject({ ok: false, error: "NOT_FOUND" });

    m.getVariantProjectId.mockClear();
    expect(await call("")).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(m.getVariantProjectId).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });
});

describe("createVariantAction", () => {
  it("tworzy kopię z projektu, użytkownika i limitu z serwera, a nazwy od klienta nie przyjmuje", async () => {
    const result = await createVariantAction("p1", "v1");

    expect(result).toMatchObject({ ok: true, variant: { id: "v-nowy" } });
    expect(m.createVariant).toHaveBeenCalledWith({
      projectId: "p1",
      sourceVariantId: "v1",
      createdById: "u1",
      maxVariants: 10,
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("limit wariantów: komunikat z limitem, bez rewalidacji", async () => {
    m.createVariant.mockResolvedValue({ ok: false, error: "LIMIT" });

    const result = await createVariantAction("p1", "v1");

    expect(result).toMatchObject({ ok: false, error: "LIMIT", message: expect.stringContaining("limit 10 wariantów") });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("brak wariantu źródłowego w bazie: NOT_FOUND", async () => {
    m.createVariant.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
    expect(await createVariantAction("p1", "v1")).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });
});

describe("renameVariantAction", () => {
  it("zapisuje przyciętą nazwę dla wariantu z projektu", async () => {
    const result = await renameVariantAction("p1", "v1", "  Wariant B  ");

    expect(result).toEqual({ ok: true });
    expect(m.renameVariant).toHaveBeenCalledWith("p1", "v1", "Wariant B");
    expect(m.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it.each([[""], ["   "], ["a".repeat(81)]])("niepoprawna nazwa %j: VALIDATION bez zapisu", async (name) => {
    const result = await renameVariantAction("p1", "v1", name);

    expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(m.renameVariant).not.toHaveBeenCalled();
  });

  it("zły wariant jest sprawdzany przed walidacją nazwy", async () => {
    m.getVariantProjectId.mockResolvedValue("p-obcy");

    const result = await renameVariantAction("p1", "v-obcy", "");

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });
});

describe("setMainVariantAction", () => {
  it("przekazuje expectedMainId i zwraca nowego głównego", async () => {
    const result = await setMainVariantAction("p1", "v2", "v1");

    expect(result).toEqual({ ok: true, mainVariantId: "v2", changed: true });
    expect(m.setMainVariant).toHaveBeenCalledWith("p1", "v2", "v1");
    expect(m.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("expectedMainId null jest dozwolone (projekt bez głównego)", async () => {
    await setMainVariantAction("p1", "v2", null);
    expect(m.setMainVariant).toHaveBeenCalledWith("p1", "v2", null);
  });

  it("pusty expectedMainId: VALIDATION bez zapisu", async () => {
    const result = await setMainVariantAction("p1", "v2", "");

    expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(m.setMainVariant).not.toHaveBeenCalled();
  });

  it("konflikt wariantu głównego: CONFLICT z komunikatem o odświeżeniu, bez rewalidacji", async () => {
    m.setMainVariant.mockResolvedValue({ ok: false, error: "CONFLICT" });

    const result = await setMainVariantAction("p1", "v2", "v1");

    expect(result).toEqual({ ok: false, error: "CONFLICT", message: CONFLICT_MESSAGE });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("EDITOR nie może zmienić głównego: wymagana rola OWNER", async () => {
    m.requireProjectRole.mockResolvedValue({ ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "EDITOR" });

    const result = await setMainVariantAction("p1", "v2", "v1");

    expect(m.requireProjectRole).toHaveBeenCalledWith("p1", "OWNER");
    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(m.setMainVariant).not.toHaveBeenCalled();
  });
});
