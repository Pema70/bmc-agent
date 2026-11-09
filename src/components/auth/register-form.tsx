"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, useTransition, type FormEvent } from "react";
import { registerAction, type RegisterFormState } from "@/app/rejestracja/actions";
import { FormField } from "@/components/auth/form-field";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/schemas/auth";

type FailedState = Extract<RegisterFormState, { ok: false }>;

export function RegisterForm() {
  const router = useRouter();
  const [state, setState] = useState<FailedState | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await registerAction(formData);
      if (!result.ok) {
        setState(result);
        return;
      }

      const signInResult = await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
      });
      if (!signInResult?.ok) {
        setState({ ok: false, message: "Konto zostało utworzone, ale logowanie się nie powiodło. Zaloguj się ręcznie." });
        return;
      }
      router.push("/projekty");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="Imię (opcjonalnie)" name="name" autoComplete="name" error={state?.fieldErrors?.name} />
      <FormField
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state?.fieldErrors?.email}
      />
      <FormField
        label="Hasło"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        error={state?.fieldErrors?.password}
        hint={`Od ${PASSWORD_MIN_LENGTH} do ${PASSWORD_MAX_LENGTH} znaków.`}
      />

      {state?.message ? (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Tworzenie konta…" : "Załóż konto"}
      </button>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Masz już konto?{" "}
        <Link href="/logowanie" className="font-medium underline">
          Zaloguj się
        </Link>
      </p>
    </form>
  );
}
