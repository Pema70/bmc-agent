"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, useTransition, type FormEvent } from "react";
import { FormField } from "@/components/auth/form-field";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
      });
      if (!result?.ok) {
        setError("Nieprawidłowy e-mail lub hasło.");
        return;
      }
      router.push("/projekty");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="E-mail" name="email" type="email" autoComplete="email" required />
      <FormField label="Hasło" name="password" type="password" autoComplete="current-password" required />

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Logowanie…" : "Zaloguj się"}
      </button>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Nie masz konta?{" "}
        <Link href="/rejestracja" className="font-medium underline">
          Zarejestruj się
        </Link>
      </p>
    </form>
  );
}
