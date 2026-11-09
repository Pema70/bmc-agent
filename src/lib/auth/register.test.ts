import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, create } = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ prisma: { user: { findUnique, create } } }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: vi.fn(async (p: string) => `hash(${p})`) }));

import { registerUser } from "@/lib/auth/register";

describe("registerUser", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
  });

  it("zapisuje użytkownika z hashem hasła i znormalizowanym e-mailem", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "u1", email: "jan@example.com" });

    const result = await registerUser({ email: " Jan@Example.com", password: "tajnehaslo", name: "Jan" });

    expect(result).toEqual({ ok: true, user: { id: "u1", email: "jan@example.com" } });
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "jan@example.com" }, select: { id: true } });
    expect(create).toHaveBeenCalledWith({
      data: { email: "jan@example.com", name: "Jan", passwordHash: "hash(tajnehaslo)" },
      select: { id: true, email: true },
    });
  });

  it("zwraca błędy pól i nie dotyka bazy przy niepoprawnych danych", async () => {
    const result = await registerUser({ email: "zly", password: "krotkie" });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error === "VALIDATION") {
      expect(result.fieldErrors.email).toBeDefined();
      expect(result.fieldErrors.password).toBeDefined();
    } else {
      expect.fail("oczekiwano błędu walidacji");
    }
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("zwraca EMAIL_TAKEN, gdy e-mail jest zajęty", async () => {
    findUnique.mockResolvedValue({ id: "u1" });

    expect(await registerUser({ email: "jan@example.com", password: "tajnehaslo" })).toEqual({
      ok: false,
      error: "EMAIL_TAKEN",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("zwraca EMAIL_TAKEN przy naruszeniu unikalności (wyścig dwóch rejestracji)", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));

    expect(await registerUser({ email: "jan@example.com", password: "tajnehaslo" })).toEqual({
      ok: false,
      error: "EMAIL_TAKEN",
    });
  });

  it("przekazuje dalej inne błędy bazy", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(new Error("connection lost"));

    await expect(registerUser({ email: "jan@example.com", password: "tajnehaslo" })).rejects.toThrow(
      "connection lost",
    );
  });
});
