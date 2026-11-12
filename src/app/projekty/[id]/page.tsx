import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateProjectAction } from "@/app/projekty/actions";
import { BmcCanvas } from "@/components/bmc/bmc-canvas";
import { CanvasEditor } from "@/components/bmc/canvas-editor";
import { VariantWorkspaceProvider, type VariantWorkspaceProviderProps } from "@/components/bmc/variant-workspace";
import { AgentChat } from "@/components/chat/agent-chat";
import { EvaluationPanel } from "@/components/evaluation/evaluation-panel";
import { ImpactPanel } from "@/components/impact/impact-panel";
import { ImpactProvider } from "@/components/impact/impact-provider";
import { ProjectForm } from "@/components/projects/project-form";
import { hasRole, requireProjectRole } from "@/lib/auth/permissions";
import { loadAiLimits } from "@/lib/ai/config";
import { listChatMessages } from "@/lib/db/chat";
import { listEvaluationsForVariant } from "@/lib/db/evaluations";
import { listImpactAnalysesForVariant } from "@/lib/db/impact";
import { listProposalsForVariant } from "@/lib/db/proposals";
import { getProject } from "@/lib/db/projects";
import { getMainVariant } from "@/lib/db/variants";
import { PROJECT_ROLE_LABELS } from "@/lib/schemas/project";
import type { ProposalItem } from "@/lib/schemas/proposal";

const EVALUATIONS_SHOWN = 20;
const IMPACT_ANALYSES_SHOWN = 20;

export const metadata: Metadata = { title: "Projekt" };

// Płótno i czat dzielą wersję, stan i propozycje wariantu tylko tam, gdzie oba istnieją (EDITOR i wyżej).
function Workspace({
  provider,
  children,
}: {
  provider: Omit<VariantWorkspaceProviderProps, "children"> | null;
  children: ReactNode;
}) {
  return provider ? <VariantWorkspaceProvider {...provider}>{children}</VariantWorkspaceProvider> : <>{children}</>;
}

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
  // Z bazy od najnowszej; interfejs potrzebuje kolejności powstawania.
  const initialProposals: ProposalItem[] = [...proposals].reverse().map((proposal) => ({
    id: proposal.id,
    blockKey: proposal.blockKey,
    operation: proposal.operation,
    before: proposal.before,
    after: proposal.after,
    rationale: proposal.rationale,
    status: proposal.status,
  }));
  // Odczyt ocen dla każdego członka (VIEWER i wyżej): rola sprawdzona wyżej, zapytanie po projectId I variantId,
  // lista bez migawki stanu, a uszkodzony wiersz jest pokazywany jako wiersz z błędem.
  const evaluations = variant ? await listEvaluationsForVariant(access.projectId, variant.id, EVALUATIONS_SHOWN) : [];
  // Analizy wpływu: ta sama zasada (VIEWER i wyżej, projectId I variantId, lista bez migawki stanu).
  const impactAnalyses = variant ? await listImpactAnalysesForVariant(access.projectId, variant.id, IMPACT_ANALYSES_SHOWN) : [];
  const workspaceProvider =
    variant && canEditCanvas
      ? {
          projectId: access.projectId,
          variantId: variant.id,
          initialVersion: variant.version,
          initialState: variant.state,
          initialProposals,
        }
      : null;

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

      <Workspace key={variant?.id ?? "brak"} provider={workspaceProvider}>
        <ImpactProvider
          // Nowa analiza (np. z czatu, po router.refresh()) zmienia klucz, więc dostawca wczytuje świeżą listę.
          key={`${variant?.id ?? "brak"}:${impactAnalyses.length}:${newestImpactId(impactAnalyses)}`}
          projectId={access.projectId}
          variantId={variant?.id ?? ""}
          canAnalyze={canEditCanvas}
          currentVersion={variant?.version ?? 0}
          initialItems={impactAnalyses}
        >
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="flex min-w-0 flex-col gap-4" aria-labelledby="canvas-heading">
            <h2 id="canvas-heading" className="text-lg font-semibold">
              {variant ? variant.name : "Business Model Canvas"}
            </h2>
            {variant && canEditCanvas ? (
              <CanvasEditor />
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
              key={variant.id}
              projectId={access.projectId}
              variantId={variant.id}
              initialMessages={chatMessages}
            />
          ) : null}
        </div>
        {variant ? (
          <EvaluationPanel
            // Nowa ocena (np. z czatu, po router.refresh()) zmienia klucz, więc panel wczytuje świeżą listę.
            key={`${variant.id}:${evaluations.length}:${newestEvaluationId(evaluations)}`}
            projectId={access.projectId}
            variantId={variant.id}
            canEvaluate={canEditCanvas}
            currentVersion={variant.version}
            initialItems={evaluations}
          />
        ) : null}
        {variant ? <ImpactPanel /> : null}
        </ImpactProvider>
      </Workspace>

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

function newestImpactId(items: { ok: boolean; id?: string; analysis?: { id: string } }[]): string {
  const first = items[0];
  return first ? (first.analysis?.id ?? first.id ?? "") : "";
}

function newestEvaluationId(items: { ok: boolean; id?: string; evaluation?: { id: string } }[]): string {
  const first = items[0];
  return first ? (first.evaluation?.id ?? first.id ?? "") : "";
}
