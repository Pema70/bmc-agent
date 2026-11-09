import Link from "next/link";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-info";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">{APP_DESCRIPTION}</p>
      <div className="flex gap-3">
        <Link
          href="/rejestracja"
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Załóż konto
        </Link>
        <Link
          href="/logowanie"
          className="rounded-md border border-zinc-300 px-4 py-2 font-medium dark:border-zinc-700"
        >
          Zaloguj się
        </Link>
      </div>
    </main>
  );
}
