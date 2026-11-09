import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, verifyPassword } = vi.hoisted(() => ({ findUnique: vi.fn(), verifyPassword: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/auth/password", () => ({ verifyPassword }));

import { authorizeCredentials } from "@/lib/auth/authorize";

const dbUser = { id: "u1", email: "jan@example.com", name: "Jan", passwordHash: "hash" };

describe("authorizeCredentials", () => {
  beforeEach(() => {
    findUnique.mockReset();
    verifyPassword.mockReset();
  });

  it("zwraca użytkownika bez hasha przy poprawnych danych", async () => {
    findUnique.mockResolvedValue(dbUser);
    verifyPassword.mockResolvedValue(true);

    const user = await authorizeCredentials({ email: "JAN@example.com", password: "tajnehaslo" });

    expect(user).toEqual({ id: "u1", email: "jan@example.com", name: "Jan" });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "jan@example.com" } }));
    expect(verifyPassword).toHaveBeenCalledWith("tajnehaslo", "hash");
  });

  it("zwraca null przy błędnym haśle", async () => {
    findUnique.mockResolvedValue(dbUser);
    verifyPassword.mockResolvedValue(false);

    expect(await authorizeCredentials({ email: "jan@example.com", password: "zle" })).toBeNull();
  });

  it("zwraca null dla nieznanego e-maila, ale i tak porównuje hasło (stały czas)", async () => {
    findUnique.mockResolvedValue(null);
    verifyPassword.mockResolvedValue(false);

    expect(await authorizeCredentials({ email: "nikt@example.com", password: "tajnehaslo" })).toBeNull();
    expect(verifyPassword).toHaveBeenCalledOnce();
  });

  it("zwraca null i nie pyta bazy przy niepoprawnym wejściu", async () => {
    expect(await authorizeCredentials(undefined)).toBeNull();
    expect(await authorizeCredentials({ email: "zly", password: "" })).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
