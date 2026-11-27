import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateProjectAction } from "@/app/projekty/actions";
import { BmcCanvas } from "@/components/bmc/bmc-canvas";
import { CanvasEditor } from "@/components/bmc/canvas-editor";
import { VariantWorkspaceProvider, type VariantWorkspaceProviderProps } from "@/components/bmc/variant-workspace";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { AgentChat } from "@/components/chat/agent-chat";
import { EvaluationPanel } from "@/components/evaluation/evaluation-panel";
import { ExportPanel } from "@/components/export/export-panel";
import { ImpactPanel } from "@/components/impact/impact-panel";
import { ImpactProvider } from "@/components/impact/impact-provider";
import { ProjectShell } from "@/components/project/project-shell";
import { ProjectForm } from "@/components/projects/project-form";
import { RefinementPanel } from "@/components/refinement/refinement-panel";
import { StrategiesPanel } from "@/components/strategies/strategies-panel";
import { ComparePicker } from "@/components/variants/compare-picker";
import { VariantActions } from "@/components/variants/variant-actions";
import { VariantSwitcher } from "@/components/variants/variant-switcher";
import { hasRole, requireProjectRole } from "@/lib/auth/permissions";
import { loadAiLimits } from "@/lib/ai/config";
import { isJudgeUiEnabled } from "@/lib/ai/judge-config";
import { loadAttachmentLimits } from "@/lib/attachments/config";
import { listAttachmentsForProject } from "@/lib/db/attachments";
import { listChatMessages } from "@/lib/db/chat";
import { listEvaluationsForVariant } from "@/lib/db/evaluations";
import { listImpactAnalysesForVariant } from "@/lib/db/impact";
import { countPendingProposals, listProposalsForVariant } from "@/lib/db/proposals";
import { getProject } from "@/lib/db/projects";
import { listRoundProposalIds, listRoundsForVariant } from "@/lib/db/refinement";
import { listStrategyGenerationsForVariant } from "@/lib/db/strategies";
import { getVariantDetails, listVariants } from "@/lib/db/variants";
import { VariantId } from "@/lib/schemas/bmc";
import { MAX_REFINEMENT_ROUNDS } from "@/lib/schemas/refinement";
import { availablePanels, parseChatParam, parsePanelParam } from "@/lib/ui/panels";
import { PROJECT_ROLE_LABELS } from "@/lib/schemas/project";
import type { ProposalItem } from "@/lib/schemas/proposal";
import { toVariantSummary } from "@/lib/variants/presentation";

const EVALUATIONS_SHOWN = 20;
const IMPACT_ANALYSES_SHOWN = 20;
const STRATEGIES_SHOWN = 20;

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

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wariant?: string | string[]; panel?: string | string[]; czat?: string | string[] }>;
}) {
  const { id } = await params;
  const { wariant, panel, czat } = await searchParams;
  const access = await requireProjectRole(id, "VIEWER");
  if (!access.ok) {
    notFound();
  }

  const project = await getProject(access.projectId);
  if (!project) {
    notFound();
  }

  const variantList = await listVariants(access.projectId);
  const mainListed = variantList.find((item) => item.isMain) ?? null;

  // Brak parametru: wariant główny. Parametr: wariant tego projektu (zapytanie po projectId); powtórzony,
  // niepoprawny, obcy lub nieistniejący id to 404.
  let selectedId: string | null = mainListed?.id ?? null;
  if (Array.isArray(wariant)) {
    notFound();
  }
  if (wariant !== undefined && wariant !== "") {
    const parsedId = VariantId.safeParse(wariant);
    if (!parsedId.success) {
      notFound();
    }
    selectedId = parsedId.data;
  }
  const variant = selectedId ? await getVariantDetails(access.projectId, selectedId) : null;
  if (selectedId && !variant) {
    notFound();
  }

  const isOwner = hasRole(access.role, "OWNER");
  const canEdit = isOwner;
  const canEditCanvas = hasRole(access.role, "EDITOR");
  // Czat tylko dla EDITOR i wyżej (D10) i tylko na wariancie głównym (D2); historię czytamy po sprawdzeniu roli.
  const chatMessages =
    variant && variant.isMain && canEditCanvas ? await listChatMessages(access.projectId, loadAiLimits().historyLimit) : null;

  // Propozycje są przypięte do wariantu: czytamy je dla wyświetlanego wariantu, więc na wariancie niegłównym działają
  // tak samo jak na głównym (przyciski w płótnie), a propozycje innych wariantów się tu nie pojawiają.
  const proposals = variant && canEditCanvas ? await listProposalsForVariant(access.projectId, variant.id, 200) : [];
  // Z bazy od najnowszej; interfejs potrzebuje kolejności powstawania.
  const initialProposals: ProposalItem[] = [...proposals].reverse().map((proposal) => ({
    id: proposal.id,
    blockKey: proposal.blockKey,
    operation: proposal.operation,
    before: proposal.before,
    after: proposal.after,
    rationale: proposal.rationale,
    sourceKind: proposal.sourceKind,
    sourceAttachmentName: proposal.sourceAttachmentName,
    status: proposal.status,
  }));
  // Odczyt ocen dla każdego członka (VIEWER i wyżej): rola sprawdzona wyżej, zapytanie po projectId I variantId,
  // lista bez migawki stanu, a uszkodzony wiersz jest pokazywany jako wiersz z błędem.
  const evaluations = variant ? await listEvaluationsForVariant(access.projectId, variant.id, EVALUATIONS_SHOWN) : [];
  // Analizy wpływu: ta sama zasada (VIEWER i wyżej, projectId I variantId, lista bez migawki stanu).
  const impactAnalyses = variant ? await listImpactAnalysesForVariant(access.projectId, variant.id, IMPACT_ANALYSES_SHOWN) : [];
  // Strategie (kandydaci): ta sama zasada (VIEWER i wyżej, projectId I variantId, lista bez migawki stanu, uszkodzony
  // rekord jako wiersz z błędem).
  const strategyGenerations = variant
    ? await listStrategyGenerationsForVariant(access.projectId, variant.id, STRATEGIES_SHOWN)
    : [];
  // Cykl poprawek (EDITOR i wyżej, dla wyświetlanego wariantu): rundy i przynależność propozycji do rund, oba zapytania po
  // projectId I variantId. Wersja, której dotyczy najnowsza ocena, pozwala panelowi rozstrzygnąć, czy ocena jest aktualna.
  const refinementRounds = variant && canEditCanvas ? await listRoundsForVariant(access.projectId, variant.id) : [];
  const refinementProposalIds = variant && canEditCanvas ? await listRoundProposalIds(access.projectId, variant.id) : {};
  const newestEvaluation = evaluations[0];
  const latestEvaluationVersion = newestEvaluation?.ok ? newestEvaluation.evaluation.variantVersion : null;
  // Do potwierdzenia zmiany głównego (tylko właściciel, tylko na wariancie niegłównym): ile propozycji czeka na starym głównym.
  const pendingOnMain =
    isOwner && variant && !variant.isMain && mainListed
      ? await countPendingProposals(access.projectId, mainListed.id)
      : 0;
  const variantSummaries = variantList.map(toVariantSummary);
  // Załączniki: lista bez treści, odczyt dla każdego członka (VIEWER i wyżej), zapytanie po projectId z uprawnień.
  const attachmentLimits = loadAttachmentLimits();
  const attachments = (await listAttachmentsForProject(access.projectId)).map((item) => ({
    ...item,
    createdAt: item.createdAt.toISOString(),
  }));
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

  // Pasek narzędzi i panele (plan `docs/plan-design.md`): panel i stan czatu z adresu (`?panel=`, `?czat=`) tylko z allowlisty
  // i tylko dla paneli dostępnych dla roli; wartości obce są ignorowane. Zmiana panelu po stronie klienta nie woła serwera.
  const available = availablePanels({ hasVariant: variant !== null, canEditCanvas });
  const initialPanel = parsePanelParam(panel, available);
  const initialChatOpen = parseChatParam(czat);
  const chatKind = chatMessages && variant ? "chat" : variant && canEditCanvas ? "notice" : "none";
  const chatNode =
    chatMessages && variant ? (
      <AgentChat key={variant.id} projectId={access.projectId} variantId={variant.id} initialMessages={chatMessages} />
    ) : variant && canEditCanvas ? (
      <aside className="flex flex-col gap-2 p-5 text-sm">
        <p className="font-bold">Czat działa na wariancie głównym</p>
        <p className="text-muted">
          Ten wariant nie jest główny, więc rozmowa z agentem jest tu niedostępna. Oceny i analizy wpływu działają na każdym
          wariancie.
        </p>
        {mainListed ? (
          <Link href={`/projekty/${access.projectId}`} className="w-fit font-bold underline">
            Przejdź do wariantu głównego
          </Link>
        ) : null}
      </aside>
    ) : null;

  const canvasNode =
    variant && canEditCanvas ? (
      <CanvasEditor />
    ) : variant ? (
      <BmcCanvas state={variant.state} />
    ) : (
      <p className="text-muted">Ten projekt nie ma jeszcze wariantu głównego. Powstał przed dodaniem płótna BMC.</p>
    );

  const panels = {
    ...(variant
      ? {
          ocena: (
            <EvaluationPanel
              // Nowa ocena (np. z czatu, po router.refresh()) zmienia klucz, więc panel wczytuje świeżą listę.
              key={`${variant.id}:${evaluations.length}:${newestEvaluationId(evaluations)}`}
              projectId={access.projectId}
              variantId={variant.id}
              canEvaluate={canEditCanvas}
              judgeEnabled={isJudgeUiEnabled()}
              currentVersion={variant.version}
              initialItems={evaluations}
            />
          ),
          wplyw: <ImpactPanel />,
          warianty: (
            <>
              <VariantSwitcher key="przelacznik" projectId={access.projectId} variants={variantSummaries} currentId={variant.id} />
              <VariantActions
                key="akcje"
                projectId={access.projectId}
                current={{ id: variant.id, name: variant.name, isMain: variant.isMain }}
                mainVariantId={mainListed?.id ?? null}
                canEdit={canEditCanvas}
                isOwner={isOwner}
                pendingOnMain={pendingOnMain}
              />
              <StrategiesPanel
                key="strategie"
                // Bez key zależnego od listy: nowe generacje dołącza sam z props initialItems (bez remountu).
                projectId={access.projectId}
                variantId={variant.id}
                canGenerate={canEditCanvas}
                currentVersion={variant.version}
                initialItems={strategyGenerations}
              />
            </>
          ),
          porownanie: <ComparePicker projectId={access.projectId} variants={variantSummaries} />,
          eksport: <ExportPanel projectId={access.projectId} variantId={variant.id} variantVersion={variant.version} />,
        }
      : {}),
    ...(variant && canEditCanvas
      ? {
          poprawki: (
            <RefinementPanel
              initialRounds={refinementRounds}
              initialRoundProposalIds={refinementProposalIds}
              latestEvaluationVersion={latestEvaluationVersion}
            />
          ),
        }
      : {}),
    zalaczniki: (
      <AttachmentsPanel
        projectId={access.projectId}
        canEdit={canEditCanvas}
        items={attachments}
        maxPerProject={attachmentLimits.maxPerProject}
        maxMegabytes={Math.floor(attachmentLimits.maxBytes / (1024 * 1024))}
      />
    ),
  };

  const header = (
    <header className="flex flex-col gap-2">
      <h1 className="text-gradient-title w-fit max-w-full pb-1 text-4xl leading-tight font-bold break-words sm:text-5xl lg:text-6xl">
        {project.name}
      </h1>
      {project.description ? (
        <p className="max-w-4xl text-lg whitespace-pre-line text-muted">{project.description}</p>
      ) : (
        <p className="text-muted">Brak opisu.</p>
      )}
      <p className="text-sm text-muted">Twoja rola: {PROJECT_ROLE_LABELS[access.role]}</p>
    </header>
  );

  const footer = canEdit ? (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">Edycja projektu</h2>
      <ProjectForm
        action={updateProjectAction.bind(null, project.id)}
        initial={{ name: project.name, description: project.description }}
        submitLabel="Zapisz zmiany"
        pendingLabel="Zapisywanie…"
      />
    </section>
  ) : null;

  const awaitingAnswers = refinementRounds.some((item) => item.ok && item.round.status === "AWAITING_ANSWERS");

  return (
    // Workspace ma key zależny wyłącznie od wariantu (jak dotąd): remount tylko przy zmianie wariantu. Przełączanie paneli,
    // zwijanie czatu i zmiana adresu `?panel=` odbywają się w kliencie i niczego nie przemontowują.
    <Workspace key={variant?.id ?? "brak"} provider={workspaceProvider}>
      <ImpactProvider
        // Bez key zależnego od listy: dostawca obejmuje płótno i czat, więc remount po router.refresh() zgubiłby
        // niezapisane zmiany w edytorze i rozmowę. Nowe analizy dołącza sam z props initialItems.
        projectId={access.projectId}
        variantId={variant?.id ?? ""}
        canAnalyze={canEditCanvas}
        currentVersion={variant?.version ?? 0}
        initialItems={impactAnalyses}
      >
        <ProjectShell
          header={header}
          variant={
            variant
              ? { name: variant.name, isMain: variant.isMain, fromStrategy: variant.origin === "AI_STRATEGY", version: variant.version }
              : null
          }
          canvas={canvasNode}
          chatKind={chatKind}
          chat={chatNode}
          panels={panels}
          initialPanel={initialPanel}
          initialChatOpen={initialChatOpen}
          badgeData={{
            evaluation: { hasAny: evaluations.length > 0, latestVersion: latestEvaluationVersion },
            variantCount: variantList.length,
            refinement: { rounds: refinementRounds.length, awaitingAnswers, max: MAX_REFINEMENT_ROUNDS },
            attachments: { count: attachments.length, max: attachmentLimits.maxPerProject },
          }}
          footer={footer}
        />
      </ImpactProvider>
    </Workspace>
  );
}

function newestEvaluationId(items: { ok: boolean; id?: string; evaluation?: { id: string } }[]): string {
  const first = items[0];
  return first ? (first.evaluation?.id ?? first.id ?? "") : "";
}
