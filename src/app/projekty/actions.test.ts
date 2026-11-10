import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession, requireProjectRole, createProject, updateProjectDetails, redirect, revalidatePath } =
  vi.hoisted(() => ({
    requireSession: vi.fn(),
    requireProjectRole: vi.fn(),
    createProject: vi.fn(),
    updateProjectDetails: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    }),
    revalidatePath: vi.fn(),
  }));

vi.mock("@/lib/auth/session", () => ({ requireSession }));
vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole }));
vi.mock("@/lib/db/projects", () => ({ createProject, updateProjectDetails }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { createProjectAction, updateProjectAction } from "@/app/projekty/actions";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };

function form(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createProjectAction", () => {
  it("bez sesji przekierowuje, zanim zwaliduje dane", async () => {
    requireSession.mockRejectedValue(new Error("REDIRECT:/logowanie"));

    await expect(createProjectAction(form({ name: "" }))).rejects.toThrow("REDIRECT:/logowanie");
    expect(createProject).not.toHaveBeenCalled();
  });

  it("zwraca błędy pól i nie zapisuje niepoprawnych danych", async () => {
    requireSession.mockResolvedValue(session);

    const result = await createProjectAction(form({ name: "  " }));

    expect(result).toEqual({
      ok: false,
      message: "Popraw zaznaczone pola.",
      fieldErrors: { name: "Podaj nazwę projektu." },
    });
    expect(createProject).not.toHaveBeenCalled();
  });

  it("tworzy projekt zalogowanego użytkownika i przekierowuje na jego stronę", async () => {
    requireSession.mockResolvedValue(session);
    createProject.mockResolvedValue({ id: "p1" });

    await expect(createProjectAction(form({ name: " Kawiarnia ", description: "Opis" }))).rejects.toThrow(
      "REDIRECT:/projekty/p1",
    );
    expect(createProject).toHaveBeenCalledWith("u1", { name: "Kawiarnia", description: "Opis" });
  });
});

describe("updateProjectAction", () => {
  it("najpierw sprawdza rolę OWNER, potem waliduje dane", async () => {
    requireProjectRole.mockRejectedValue(new Error("REDIRECT:/logowanie"));

    await expect(updateProjectAction("p1", form({ name: "" }))).rejects.toThrow("REDIRECT:/logowanie");
    expect(requireProjectRole).toHaveBeenCalledWith("p1", "OWNER");
    expect(updateProjectDetails).not.toHaveBeenCalled();
  });

  it("odrzuca edycję przez członka bez roli OWNER", async () => {
    requireProjectRole.mockResolvedValue({ ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "EDITOR" });

    expect(await updateProjectAction("p1", form({ name: "Nowa" }))).toEqual({
      ok: false,
      message: "Tylko właściciel może edytować nazwę i opis projektu.",
    });
    expect(updateProjectDetails).not.toHaveBeenCalled();
  });

  it("zwraca błędy pól przy niepoprawnych danych", async () => {
    requireProjectRole.mockResolvedValue({ ok: true, session, projectId: "p1", role: "OWNER" });

    const result = await updateProjectAction("p1", form({ name: "" }));

    expect(result.ok).toBe(false);
    expect(updateProjectDetails).not.toHaveBeenCalled();
  });

  it("zapisuje zmiany właściciela", async () => {
    requireProjectRole.mockResolvedValue({ ok: true, session, projectId: "p1", role: "OWNER" });
    updateProjectDetails.mockResolvedValue({ ok: true });

    expect(await updateProjectAction("p1", form({ name: "Nowa", description: "" }))).toEqual({
      ok: true,
      message: "Zapisano zmiany.",
    });
    expect(updateProjectDetails).toHaveBeenCalledWith("p1", "u1", { name: "Nowa", description: "" });
    expect(revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("zgłasza błąd, gdy baza nie znalazła projektu właściciela", async () => {
    requireProjectRole.mockResolvedValue({ ok: true, session, projectId: "p1", role: "OWNER" });
    updateProjectDetails.mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    expect(await updateProjectAction("p1", form({ name: "Nowa" }))).toEqual({
      ok: false,
      message: "Nie znaleziono projektu albo nie masz już do niego uprawnień.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
