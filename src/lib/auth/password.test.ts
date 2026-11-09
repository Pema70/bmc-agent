import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("hashPassword / verifyPassword", () => {
  it("tworzy hash bcrypt różny od hasła i weryfikuje poprawne hasło", async () => {
    const hash = await hashPassword("tajnehaslo");

    expect(hash).not.toContain("tajnehaslo");
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await verifyPassword("tajnehaslo", hash)).toBe(true);
  });

  it("odrzuca błędne hasło", async () => {
    const hash = await hashPassword("tajnehaslo");
    expect(await verifyPassword("innehaslo", hash)).toBe(false);
  });
});
