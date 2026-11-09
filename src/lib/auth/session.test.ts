import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSession, redirect } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/options", () => ({ authOptions: { marker: "authOptions" } }));

import { getSession, requireSession } from "@/lib/auth/session";

describe("getSession", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    redirect.mockClear();
  });

  it("czyta sesję przez getServerSession z authOptions i zwraca AppSession", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "u1", email: "jan@example.com", name: null },
      expires: "2099-01-01T00:00:00.000Z",
    });

    expect(await getSession()).toEqual({ user: { id: "u1", email: "jan@example.com", name: null } });
    expect(getServerSession).toHaveBeenCalledWith({ marker: "authOptions" });
  });

  it("zwraca null bez sesji", async () => {
    getServerSession.mockResolvedValue(null);
    expect(await getSession()).toBeNull();
  });

  it("zwraca null, gdy sesja nie ma id użytkownika", async () => {
    getServerSession.mockResolvedValue({ user: { email: "jan@example.com" }, expires: "2099-01-01" });
    expect(await getSession()).toBeNull();
  });
});

describe("requireSession", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    redirect.mockClear();
  });

  it("przekierowuje niezalogowanego na /logowanie", async () => {
    getServerSession.mockResolvedValue(null);

    await expect(requireSession()).rejects.toThrow("REDIRECT:/logowanie");
    expect(redirect).toHaveBeenCalledWith("/logowanie");
  });

  it("zwraca sesję zalogowanego", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", email: "jan@example.com", name: "Jan" } });

    expect(await requireSession()).toEqual({ user: { id: "u1", email: "jan@example.com", name: "Jan" } });
    expect(redirect).not.toHaveBeenCalled();
  });
});
