import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Projekty" };

export default async function ProjectsPage() {
  const session = await requireSession();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Projekty</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Zalogowano jako <strong>{session.user.name ?? session.user.email}</strong>. Lista projektów pojawi się w
        kolejnym kroku.
      </p>
    </main>
  );
}
