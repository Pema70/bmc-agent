import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateProjectAction } from "@/app/projekty/actions";
import { ProjectForm } from "@/components/projects/project-form";
import { hasRole, requireProjectRole } from "@/lib/auth/permissions";
import { getProject } from "@/lib/db/projects";
import { PROJECT_ROLE_LABELS } from "@/lib/schemas/project";

export const metadata: Metadata = { title: "Projekt" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProjectRole(id, "VIEWER");
  if (!access.ok) {
    notFound();
  }

  const project = await getProject(access.projectId);
  if (!project) {
    notFound();
  }

  const canEdit = hasRole(access.role, "OWNER");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <Link href="/projekty" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          ← Wszystkie projekty
        </Link>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{project.name}</h1>
          <span className="shrink-0 text-sm text-zinc-500">Twoja rola: {PROJECT_ROLE_LABELS[access.role]}</span>
        </div>
        {project.description ? (
          <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">{project.description}</p>
        ) : (
          <p className="text-zinc-500">Brak opisu.</p>
        )}
      </header>

      {canEdit ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Edycja projektu</h2>
          <ProjectForm
            action={updateProjectAction.bind(null, project.id)}
            initial={{ name: project.name, description: project.description }}
            submitLabel="Zapisz zmiany"
            pendingLabel="Zapisywanie…"
          />
        </section>
      ) : null}
    </main>
  );
}
