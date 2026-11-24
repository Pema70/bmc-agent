import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { BlockKey, BmcState } from "@/lib/schemas/bmc";
import { STRATEGY_SCHEMA_VERSION } from "@/lib/schemas/strategy";
import { StrategiesOutput } from "@/lib/schemas/variant";
import type { ProposalSourceKind, ProposalStatus } from "@/lib/schemas/proposal";

// Odczyty na potrzeby raportu (krok 9). Każdy filtruje po projectId (wariant: po projectId ORAZ variantId); żaden nie zapisuje.

export type ReportVariant = {
  id: string;
  name: string;
  isMain: boolean;
  origin: "MANUAL" | "AI_STRATEGY";
  description: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  state: BmcState;
  entryOrigins: unknown;
  generationId: string | null;
  generationIndex: number | null;
};

/** Wariant z zapisanym pochodzeniem wpisów, tylko z projektu z uprawnień. Stan niezgodny ze schematem to jawny wyjątek. */
export async function getVariantForReport(projectId: string, variantId: string): Promise<ReportVariant | null> {
  const row = await prisma.bmcVariant.findFirst({
    where: { id: variantId, projectId },
    select: {
      id: true,
      name: true,
      isMain: true,
      origin: true,
      description: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      state: true,
      entryOrigins: true,
      generationId: true,
      generationIndex: true,
    },
  });
  if (!row) {
    return null;
  }
  const state = BmcState.safeParse(row.state);
  if (!state.success) {
    throw new Error(`Niepoprawny stan BMC w wariancie ${row.id}: ${z.prettifyError(state.error)}`);
  }
  return { ...row, state: state.data };
}

export type ReportProposal = {
  id: string;
  blockKey: BlockKey;
  operation: "add" | "edit" | "remove";
  after: string | null;
  rationale: string;
  status: ProposalStatus;
  resolvedAt: Date | null;
  sourceKind: ProposalSourceKind;
  sourceAttachmentName: string | null;
  refinementRoundId: string | null;
  refinementQuestionIndex: number | null;
};

const OPERATION_FROM_DB = { ADD: "add", EDIT: "edit", REMOVE: "remove" } as const;

/** Najnowsze propozycje wariantu (dowolnego statusu) z datą rozstrzygnięcia, tylko z wariantu należącego do projektu. */
export async function listProposalsForReport(projectId: string, variantId: string, limit: number): Promise<ReportProposal[]> {
  const rows = await prisma.proposal.findMany({
    where: { variantId, variant: { projectId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      blockKey: true,
      operation: true,
      after: true,
      rationale: true,
      status: true,
      resolvedAt: true,
      sourceKind: true,
      sourceAttachmentName: true,
      refinementRoundId: true,
      refinementQuestionIndex: true,
    },
  });
  return rows.map((row) => {
    const blockKey = BlockKey.safeParse(row.blockKey);
    if (!blockKey.success) {
      throw new Error(`Niepoprawny blockKey „${row.blockKey}” w propozycji ${row.id}.`);
    }
    return { ...row, blockKey: blockKey.data, operation: OPERATION_FROM_DB[row.operation] };
  });
}

export type LlmCallSummaryRow = {
  operation: string;
  provider: string;
  model: string;
  promptVersion: string;
  calls: number;
  firstUsed: Date;
  lastUsed: Date;
};

/** Zbiorcze zestawienie udanych wywołań modelu w projekcie (operacja, model, wersja promptu). Bez treści i bez kosztów. */
export async function listLlmCallSummary(projectId: string): Promise<LlmCallSummaryRow[]> {
  const groups = await prisma.llmCallLog.groupBy({
    by: ["operation", "provider", "model", "promptVersion"],
    where: { projectId, status: "OK" },
    _count: { _all: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
    orderBy: [{ operation: "asc" }, { model: "asc" }, { promptVersion: "asc" }],
  });
  return groups.flatMap((group) =>
    group._min.createdAt && group._max.createdAt
      ? [
          {
            operation: group.operation,
            provider: group.provider,
            model: group.model,
            promptVersion: group.promptVersion,
            calls: group._count._all,
            firstUsed: group._min.createdAt,
            lastUsed: group._max.createdAt,
          },
        ]
      : [],
  );
}

/**
 * Kandydat strategii, z którego powstał wariant (do wstecznego ustalenia pochodzenia wpisów wariantów sprzed kroku 9).
 * Generacja należy do wariantu bazowego (innego niż zapisany), więc filtrujemy po projectId. Brak lub uszkodzenie: null.
 */
export async function getStrategyCandidate(
  projectId: string,
  generationId: string,
  index: number,
): Promise<{ name: string; state: BmcState } | null> {
  const row = await prisma.strategyGeneration.findFirst({
    where: { id: generationId, projectId },
    select: { schemaVersion: true, result: true },
  });
  if (!row || row.schemaVersion !== STRATEGY_SCHEMA_VERSION) {
    return null;
  }
  const output = StrategiesOutput.safeParse(row.result);
  const strategy = output.success ? output.data.strategies[index] : undefined;
  const state = strategy ? BmcState.safeParse(strategy.state) : null;
  return strategy && state?.success ? { name: strategy.name, state: state.data } : null;
}
