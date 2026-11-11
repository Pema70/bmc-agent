import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateProjectAction } from "@/app/projekty/actions";
import { BmcCanvas } from "@/components/bmc/bmc-canvas";
import { CanvasEditor } from "@/components/bmc/canvas-editor";
import { AgentChat } from "@/components/chat/agent-chat";
import { ProjectForm } from "@/components/projects/project-form";
import { hasRole, requireProjectRole } from "@/lib/auth/permissions";
import { loadAiLimits } from "@/lib/ai/config";
import { listChatMessages } from "@/lib/db/chat";
import { listProposalsForVariant } from "@/lib/db/proposals";
import { getProject } from "@/lib/db/projects";
import { getMainVariant } from "@/lib/db/variants";
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

  const variant = await getMainVariant(access.projectId);
  const canEdit = hasRole(access.role, "OWNER");
  const canEditCanvas = hasRole(access.role, "EDITOR");
  // Czat tylko dla EDITOR i wyżej (D10); historię czytamy dopiero po sprawdzeniu roli.
  const chatMessages =
    variant && canEditCanvas ? await listChatMessages(access.projectId, loadAiLimits().historyLimit) : null;

  const proposals = variant && canEditCanvas ? await listProposalsForVariant(access.projectId, variant.id, 200) : [];
  const proposalStatuses = Object.fromEntries(proposals.map((proposal) => [proposal.id, proposal.status]));

  return (
    <main className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-10 px-6 py-16">
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

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="canvas-heading">
          <h2 id="canvas-heading" className="text-lg font-semibold">
            {variant ? variant.name : "Business Model Canvas"}
          </h2>
          {variant && canEditCanvas ? (
            <CanvasEditor
              key={variant.id}
              projectId={access.projectId}
              variantId={variant.id}
              initialVersion={variant.version}
              initialState={variant.state}
            />
          ) : variant ? (
            <BmcCanvas state={variant.state} />
          ) : (
            <p className="text-zinc-600 dark:text-zinc-400">
              Ten projekt nie ma jeszcze wariantu głównego. Powstał przed dodaniem płótna BMC.
            </p>
          )}
        </section>
        {variant && chatMessages ? (
          <AgentChat
            variantVersion={variant.version}
            proposalStatuses={proposalStatuses}
            key={variant.id}
            projectId={access.projectId}
            variantId={variant.id}
            initialMessages={chatMessages}
          />
        ) : null}
      </div>

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
