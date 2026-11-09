"use server";

import { registerUser } from "@/lib/auth/register";
import { getSession } from "@/lib/auth/session";
import type { RegisterInput } from "@/lib/schemas/auth";

export type RegisterFormState =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Partial<Record<keyof RegisterInput, string>> };

function formValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

export async function registerAction(formData: FormData): Promise<RegisterFormState> {
  // Rejestracja jest publiczna, ale zalogowany użytkownik nie zakłada drugiego konta.
  if (await getSession()) {
    return { ok: false, message: "Jesteś już zalogowany." };
  }

  const result = await registerUser({
    email: formValue(formData, "email"),
    password: formValue(formData, "password"),
    name: formValue(formData, "name"),
  });

  if (result.ok) {
    return { ok: true };
  }
  if (result.error === "EMAIL_TAKEN") {
    return { ok: false, message: "Konto z tym adresem e-mail już istnieje." };
  }
  return { ok: false, message: "Popraw zaznaczone pola.", fieldErrors: result.fieldErrors };
}
