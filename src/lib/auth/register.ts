import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { RegisterInput } from "@/lib/schemas/auth";

export type RegisterResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; error: "VALIDATION"; fieldErrors: Partial<Record<keyof RegisterInput, string>> }
  | { ok: false; error: "EMAIL_TAKEN" };

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function registerUser(input: unknown): Promise<RegisterResult> {
  const parsed = RegisterInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof RegisterInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "email" || field === "password" || field === "name") && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { ok: false, error: "VALIDATION", fieldErrors };
  }

  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return { ok: false, error: "EMAIL_TAKEN" };
  }

  try {
    const user = await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
      select: { id: true, email: true },
    });
    return { ok: true, user };
  } catch (error) {
    // Dwie równoległe rejestracje na ten sam e-mail: wygrywa unikalny indeks w bazie.
    if (isUniqueConstraintError(error)) {
      return { ok: false, error: "EMAIL_TAKEN" };
    }
    throw error;
  }
}
