import { prisma } from "@/lib/db/client";
import { BmcState } from "@/lib/schemas/bmc";
import {
  IMPACT_SCHEMA_VERSION,
  ImpactChange,
  ImpactOutput,
  ImpactTrigger,
  type ImpactView,
} from "@/lib/schemas/impact";

type ImpactRow = {
  id: string;
  createdAt: Date;
  schemaVersion: number;
  variantVersion: number;
  changeKind: string;
  proposalId: string | null;
  change: unknown;
  trigger: string;
  provider: string;
  model: string;
  promptVersion: string;
  result: unknown;
};

const LIST_SELECT = {
  id: true,
  createdAt: true,
  schemaVersion: true,
  variantVersion: true,
  changeKind: true,
  proposalId: true,
  change: true,
  trigger: true,
  provider: true,
  model: true,
  promptVersion: true,
  result: true,
} as const;

export type ImpactListItem = { ok: true; analysis: ImpactView } | { ok: false; id: string; error: string };

/** Parsuje jeden wiersz. Niezgodny rekord daje błąd tylko dla siebie, nie dla całej listy. */
export function parseImpactRow(row: ImpactRow): ImpactListItem {
  if (row.schemaVersion !== IMPACT_SCHEMA_VERSION) {
    return { ok: false, id: row.id, error: `Nieobsługiwana wersja schematu analizy (${row.schemaVersion}).` };
  }
  const result = ImpactOutput.safeParse(row.result);
  const change = ImpactChange.safeParse(row.change);
  const trigger = ImpactTrigger.safeParse(row.trigger);
  if (!result.success || !change.success || !trigger.success) {
    return { ok: false, id: row.id, error: "Zapisana analiza jest niezgodna ze schematem." };
  }
  // proposalId może zniknąć po usunięciu propozycji (SetNull), więc dla PROPOSAL dopuszczamy null;
  // dla DESCRIPTION musi być null.
  if (row.changeKind !== change.data.kind || (change.data.kind === "DESCRIPTION" && row.proposalId !== null)) {
    return { ok: false, id: row.id, error: "Rodzaj zmiany w analizie jest niespójny." };
  }
  return {
    ok: true,
    analysis: {
      id: row.id,
      createdAt: row.createdAt,
      schemaVersion: row.schemaVersion,
      variantVersion: row.variantVersion,
      proposalId: row.proposalId,
      change: change.data,
      trigger: trigger.data,
      provider: row.provider,
      model: row.model,
      promptVersion: row.promptVersion,
      result: result.data,
    },
  };
}

export type CreateImpactAnalysisInput = {
  projectId: string;
  variantId: string;
  variantVersion: number;
  stateSnapshot: BmcState;
  change: ImpactChange;
  proposalId: string | null;
  result: ImpactOutput;
  trigger: "UI" | "CHAT";
  provider: string;
  model: string;
  promptVersion: string;
  llmCallLogId: string | null;
  createdById: string | null;
};

/**
 * Zapis analizy. Walidacja Zod przed zapisem: wynik niezgodny ze schematem nigdy nie trafia do bazy.
 * Identyfikator analizy zawsze pochodzi stąd (z bazy), nigdy z tekstu modelu.
 */
export async function createImpactAnalysis(input: CreateImpactAnalysisInput): Promise<ImpactView> {
  const result = ImpactOutput.parse(input.result);
  const change = ImpactChange.parse(input.change);
  const stateSnapshot = BmcState.parse(input.stateSnapshot);
  const row = await prisma.impactAnalysis.create({
    data: {
      projectId: input.projectId,
      variantId: input.variantId,
      schemaVersion: IMPACT_SCHEMA_VERSION,
      variantVersion: input.variantVersion,
      stateSnapshot,
      changeKind: change.kind,
      proposalId: change.kind === "PROPOSAL" ? input.proposalId : null,
      change,
      result,
      trigger: input.trigger,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      llmCallLogId: input.llmCallLogId,
      createdById: input.createdById,
    },
    select: LIST_SELECT,
  });
  const parsed = parseImpactRow(row);
  if (!parsed.ok) {
    throw new Error(`Zapisana analiza ${row.id} jest niepoprawna: ${parsed.error}`);
  }
  return parsed.analysis;
}

/**
 * Lista analiz wariantu od najnowszej, bez migawki stanu. Filtruje po projectId ORAZ variantId,
 * więc wariant z innego projektu daje pustą listę.
 */
export async function listImpactAnalysesForVariant(
  projectId: string,
  variantId: string,
  limit: number,
): Promise<ImpactListItem[]> {
  const rows = await prisma.impactAnalysis.findMany({
    where: { projectId, variantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });
  return rows.map(parseImpactRow);
}

/** Jedna analiza po id (bez migawki), z filtrem po projekcie i wariancie. Brak rekordu: null. */
export async function getImpactAnalysis(
  projectId: string,
  variantId: string,
  analysisId: string,
): Promise<ImpactListItem | null> {
  const row = await prisma.impactAnalysis.findFirst({
    where: { id: analysisId, projectId, variantId },
    select: LIST_SELECT,
  });
  return row ? parseImpactRow(row) : null;
}
