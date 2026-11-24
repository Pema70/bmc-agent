import Link from "next/link";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-info";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-lg text-muted">{APP_DESCRIPTION}</p>
      <div className="flex gap-3">
        <Link
          href="/rejestracja"
          className="rounded-lg bg-cta px-4 py-2 font-bold"
        >
          Załóż konto
        </Link>
        <Link
          href="/logowanie"
          className="rounded-lg border border-border px-4 py-2 font-bold"
        >
          Zaloguj się
        </Link>
      </div>
    </main>
  );
}
