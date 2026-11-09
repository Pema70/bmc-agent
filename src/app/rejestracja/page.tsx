import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Rejestracja" };

export default async function RegisterPage() {
  if (await getSession()) {
    redirect("/projekty");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Załóż konto</h1>
      <RegisterForm />
    </main>
  );
}
