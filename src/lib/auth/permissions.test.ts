import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession, getProjectRole, notFound } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getProjectRole: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/lib/auth/session", () => ({ requireSession }));
vi.mock("@/lib/db/projects", () => ({ getProjectRole }));
vi.mock("next/navigation", () => ({ notFound }));

import { hasRole, requireProjectRole } from "@/lib/auth/permissions";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };

describe("hasRole", () => {
  it("stosuje hierarchię OWNER > EDITOR > VIEWER", () => {
    expect(hasRole("OWNER", "OWNER")).toBe(true);
    expect(hasRole("OWNER", "EDITOR")).toBe(true);
    expect(hasRole("OWNER", "VIEWER")).toBe(true);
    expect(hasRole("EDITOR", "OWNER")).toBe(false);
    expect(hasRole("EDITOR", "EDITOR")).toBe(true);
    expect(hasRole("EDITOR", "VIEWER")).toBe(true);
    expect(hasRole("VIEWER", "OWNER")).toBe(false);
    expect(hasRole("VIEWER", "EDITOR")).toBe(false);
    expect(hasRole("VIEWER", "VIEWER")).toBe(true);
  });
});

describe("requireProjectRole", () => {
  beforeEach(() => {
    requireSession.mockReset();
    getProjectRole.mockReset();
    notFound.mockClear();
  });

  it("bez sesji przerywa przekierowaniem i nie pyta bazy", async () => {
    requireSession.mockRejectedValue(new Error("REDIRECT:/logowanie"));

    await expect(requireProjectRole("p1", "VIEWER")).rejects.toThrow("REDIRECT:/logowanie");
    expect(getProjectRole).not.toHaveBeenCalled();
  });

  it("dla osoby spoza projektu zwraca 404", async () => {
    requireSession.mockResolvedValue(session);
    getProjectRole.mockResolvedValue(null);

    await expect(requireProjectRole("p1", "VIEWER")).rejects.toThrow("NOT_FOUND");
    expect(getProjectRole).toHaveBeenCalledWith("p1", "u1");
  });

  it("dla niepoprawnego identyfikatora zwraca 404 bez zapytania do bazy", async () => {
    requireSession.mockResolvedValue(session);

    await expect(requireProjectRole("", "VIEWER")).rejects.toThrow("NOT_FOUND");
    await expect(requireProjectRole(["p1"], "VIEWER")).rejects.toThrow("NOT_FOUND");
    expect(getProjectRole).not.toHaveBeenCalled();
  });

  it("przy za niskiej roli zwraca FORBIDDEN", async () => {
    requireSession.mockResolvedValue(session);
    getProjectRole.mockResolvedValue("EDITOR");

    expect(await requireProjectRole("p1", "OWNER")).toEqual({
      ok: false,
      error: "FORBIDDEN",
      session,
      projectId: "p1",
      role: "EDITOR",
    });
  });

  it("przy wystarczającej roli zwraca dostęp", async () => {
    requireSession.mockResolvedValue(session);
    getProjectRole.mockResolvedValue("OWNER");

    expect(await requireProjectRole("p1", "EDITOR")).toEqual({ ok: true, session, projectId: "p1", role: "OWNER" });
    expect(notFound).not.toHaveBeenCalled();
  });
});
