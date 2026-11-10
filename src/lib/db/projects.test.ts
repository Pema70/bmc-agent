import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectCreate, projectUpdateMany, projectFindUnique, memberFindMany, memberFindUnique } = vi.hoisted(() => ({
  projectCreate: vi.fn(),
  projectUpdateMany: vi.fn(),
  projectFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  memberFindUnique: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    project: { create: projectCreate, updateMany: projectUpdateMany, findUnique: projectFindUnique },
    projectMember: { findMany: memberFindMany, findUnique: memberFindUnique },
  },
}));

import { createProject, getProjectRole, listProjectsForUser, updateProjectDetails } from "@/lib/db/projects";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createProject", () => {
  it("tworzy projekt razem z członkostwem OWNER dla twórcy", async () => {
    projectCreate.mockResolvedValue({ id: "p1" });

    expect(await createProject("u1", { name: "Kawiarnia", description: "" })).toEqual({ id: "p1" });
    expect(projectCreate).toHaveBeenCalledWith({
      data: { name: "Kawiarnia", description: "", members: { create: { userId: "u1", role: "OWNER" } } },
      select: { id: true },
    });
  });
});

describe("updateProjectDetails", () => {
  it("aktualizuje tylko projekt, w którym użytkownik jest OWNER", async () => {
    projectUpdateMany.mockResolvedValue({ count: 1 });

    expect(await updateProjectDetails("p1", "u1", { name: "Nowa", description: "Opis" })).toEqual({ ok: true });
    expect(projectUpdateMany).toHaveBeenCalledWith({
      where: { id: "p1", members: { some: { userId: "u1", role: "OWNER" } } },
      data: { name: "Nowa", description: "Opis" },
    });
  });

  it("zwraca NOT_FOUND, gdy użytkownik nie jest właścicielem lub projekt nie istnieje", async () => {
    projectUpdateMany.mockResolvedValue({ count: 0 });

    expect(await updateProjectDetails("p1", "u2", { name: "Nowa", description: "" })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});

describe("listProjectsForUser", () => {
  it("zwraca projekty użytkownika z jego rolą", async () => {
    const updatedAt = new Date("2026-11-10T10:00:00Z");
    memberFindMany.mockResolvedValue([
      { role: "OWNER", project: { id: "p1", name: "A", description: "", updatedAt } },
      { role: "VIEWER", project: { id: "p2", name: "B", description: "x", updatedAt } },
    ]);

    expect(await listProjectsForUser("u1")).toEqual([
      { id: "p1", name: "A", description: "", updatedAt, role: "OWNER" },
      { id: "p2", name: "B", description: "x", updatedAt, role: "VIEWER" },
    ]);
    expect(memberFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" } }));
  });
});

describe("getProjectRole", () => {
  it("zwraca rolę członka albo null", async () => {
    memberFindUnique.mockResolvedValueOnce({ role: "EDITOR" }).mockResolvedValueOnce(null);

    expect(await getProjectRole("p1", "u1")).toBe("EDITOR");
    expect(await getProjectRole("p1", "u2")).toBeNull();
    expect(memberFindUnique).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: "p1", userId: "u1" } },
      select: { role: true },
    });
  });
});
