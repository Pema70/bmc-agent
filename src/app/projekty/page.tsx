import type { Metadata } from "next";
import Link from "next/link";
import { createProjectAction } from "@/app/projekty/actions";
import { ProjectForm } from "@/components/projects/project-form";
import { requireSession } from "@/lib/auth/session";
import { listProjectsForUser } from "@/lib/db/projects";
import { PROJECT_ROLE_LABELS } from "@/lib/schemas/project";

export const metadata: Metadata = { title: "Projekty" };

const dateFormat = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" });

export default async function ProjectsPage() {
  const session = await requireSession();
  const projects = await listProjectsForUser(session.user.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Projekty</h1>
        {projects.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Nie masz jeszcze żadnego projektu. Utwórz pierwszy poniżej.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projekty/${project.id}`}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="flex items-center justify-between gap-4">
                    <span className="font-medium">{project.name}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{PROJECT_ROLE_LABELS[project.role]}</span>
                  </span>
                  {project.description ? (
                    <span className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{project.description}</span>
                  ) : null}
                  <span className="text-xs text-zinc-500">Zmieniono: {dateFormat.format(project.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Nowy projekt</h2>
        <ProjectForm action={createProjectAction} submitLabel="Utwórz projekt" pendingLabel="Tworzenie…" />
      </section>
    </main>
  );
}
