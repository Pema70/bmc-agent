import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { APP_NAME } from "@/lib/app-info";
import { getSession } from "@/lib/auth/session";

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <Link href={session ? "/projekty" : "/"} className="font-semibold">
          {APP_NAME}
        </Link>
        {session ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">{session.user.email}</span>
            <SignOutButton />
          </div>
        ) : (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/logowanie" className="hover:underline">
              Zaloguj się
            </Link>
            <Link href="/rejestracja" className="hover:underline">
              Zarejestruj się
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
