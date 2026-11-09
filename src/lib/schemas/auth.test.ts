import { describe, expect, it } from "vitest";
import { LoginInput, RegisterInput } from "@/lib/schemas/auth";

const valid = { email: "jan@example.com", password: "tajnehaslo" };

describe("RegisterInput", () => {
  it("przyjmuje poprawne dane", () => {
    expect(RegisterInput.parse(valid)).toEqual({ ...valid, name: undefined });
  });

  it("zamienia e-mail na małe litery i usuwa spacje", () => {
    const result = RegisterInput.parse({ ...valid, email: "  Jan.Kowalski@Example.COM " });
    expect(result.email).toBe("jan.kowalski@example.com");
  });

  it("odrzuca niepoprawny e-mail", () => {
    expect(RegisterInput.safeParse({ ...valid, email: "to-nie-email" }).success).toBe(false);
  });

  it("wymaga hasła o długości 8–72 znaków", () => {
    expect(RegisterInput.safeParse({ ...valid, password: "a".repeat(7) }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...valid, password: "a".repeat(8) }).success).toBe(true);
    expect(RegisterInput.safeParse({ ...valid, password: "a".repeat(72) }).success).toBe(true);
    expect(RegisterInput.safeParse({ ...valid, password: "a".repeat(73) }).success).toBe(false);
  });

  it("odrzuca hasło, które ma ≤72 znaki, ale >72 bajty w UTF-8", () => {
    const password = "ą".repeat(40); // 40 znaków, 80 bajtów
    const result = RegisterInput.safeParse({ ...valid, password });
    expect(result.success).toBe(false);
  });

  it("traktuje puste imię jako brak imienia i przycina spacje", () => {
    expect(RegisterInput.parse({ ...valid, name: "   " }).name).toBeUndefined();
    expect(RegisterInput.parse({ ...valid, name: "  Jan " }).name).toBe("Jan");
  });

  it("zwraca komunikaty po polsku", () => {
    const result = RegisterInput.safeParse({ ...valid, password: "krotkie" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Hasło musi mieć co najmniej 8 znaków.");
  });
});

describe("LoginInput", () => {
  it("normalizuje e-mail tak samo jak rejestracja", () => {
    expect(LoginInput.parse({ email: " JAN@Example.com", password: "x" }).email).toBe("jan@example.com");
  });

  it("odrzuca puste hasło", () => {
    expect(LoginInput.safeParse({ email: "jan@example.com", password: "" }).success).toBe(false);
  });
});
