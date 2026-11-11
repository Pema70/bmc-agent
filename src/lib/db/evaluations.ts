import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { BmcState } from "@/lib/schemas/bmc";
import {
  EVALUATION_SCHEMA_VERSION,
  EvaluationOutput,
  EvaluationSource,
  EvaluationTrigger,
  type EvaluationView,
} from "@/lib/schemas/evaluation";

type EvaluationRow = {
  id: string;
  createdAt: Date;
  schemaVersion: number;
  variantVersion: number;
  source: string;
  trigger: string | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  result: unknown;
};

const LIST_SELECT = {
  id: true,
  createdAt: true,
  schemaVersion: true,
  variantVersion: true,
  source: true,
  trigger: true,
  provider: true,
  model: true,
  promptVersion: true,
  result: true,
} as const;

export type EvaluationListItem = { ok: true; evaluation: EvaluationView } | { ok: false; id: string; error: string };

/** Parsuje jeden wiersz. Niezgodny rekord daje błąd tylko dla siebie, nie dla całej listy. */
export function parseEvaluationRow(row: EvaluationRow): EvaluationListItem {
  if (row.schemaVersion !== EVALUATION_SCHEMA_VERSION) {
    return { ok: false, id: row.id, error: `Nieobsługiwana wersja schematu oceny (${row.schemaVersion}).` };
  }
  const result = EvaluationOutput.safeParse(row.result);
  const source = EvaluationSource.safeParse(row.source);
  const trigger = row.trigger === null ? { success: true as const, data: null } : EvaluationTrigger.safeParse(row.trigger);
  if (!result.success || !source.success || !trigger.success) {
    return { ok: false, id: row.id, error: "Zapisana ocena jest niezgodna ze schematem." };
  }
  if (source.data === "AI" && (!row.provider || !row.model || !row.promptVersion)) {
    return { ok: false, id: row.id, error: "Ocena AI bez modelu lub wersji promptu." };
  }
  return {
    ok: true,
    evaluation: {
      id: row.id,
      createdAt: row.createdAt,
      schemaVersion: row.schemaVersion,
      variantVersion: row.variantVersion,
      source: source.data,
      trigger: trigger.data,
      provider: row.provider,
      model: row.model,
      promptVersion: row.promptVersion,
      result: result.data,
    },
  };
}

export type CreateEvaluationInput = {
  projectId: string;
  variantId: string;
  variantVersion: number;
  stateSnapshot: BmcState;
  result: EvaluationOutput;
  trigger: "UI" | "CHAT";
  provider: string;
  model: string;
  promptVersion: string;
  llmCallLogId: string | null;
  createdById: string | null;
};

/**
 * Zapis oceny AI. Walidacja Zod przed zapisem: wynik niezgodny ze schematem nigdy nie trafia do bazy.
 * Identyfikator oceny zawsze pochodzi stąd (z bazy), nigdy z tekstu modelu.
 */
export async function createEvaluation(input: CreateEvaluationInput): Promise<EvaluationView> {
  const result = EvaluationOutput.parse(input.result);
  const stateSnapshot = BmcState.parse(input.stateSnapshot);
  const row = await prisma.evaluationResult.create({
    data: {
      projectId: input.projectId,
      variantId: input.variantId,
      schemaVersion: EVALUATION_SCHEMA_VERSION,
      variantVersion: input.variantVersion,
      stateSnapshot,
      result,
      source: "AI",
      trigger: input.trigger,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      llmCallLogId: input.llmCallLogId,
      createdById: input.createdById,
    },
    select: LIST_SELECT,
  });
  const parsed = parseEvaluationRow(row);
  if (!parsed.ok) {
    throw new Error(`Zapisana ocena ${row.id} jest niepoprawna: ${parsed.error}`);
  }
  return parsed.evaluation;
}

/**
 * Lista ocen wariantu od najnowszej, bez migawki stanu. Filtruje po projectId ORAZ variantId,
 * więc wariant z innego projektu daje pustą listę.
 */
export async function listEvaluationsForVariant(
  projectId: string,
  variantId: string,
  limit: number,
): Promise<EvaluationListItem[]> {
  const rows = await prisma.evaluationResult.findMany({
    where: { projectId, variantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });
  return rows.map(parseEvaluationRow);
}

/** Migawka stanu ocenionego modelu, czytana osobno po id (też z filtrem po projekcie i wariancie). */
export async function getEvaluationSnapshot(
  projectId: string,
  variantId: string,
  evaluationId: string,
): Promise<BmcState | null> {
  const row = await prisma.evaluationResult.findFirst({
    where: { id: evaluationId, projectId, variantId },
    select: { id: true, stateSnapshot: true },
  });
  if (!row) {
    return null;
  }
  const parsed = BmcState.safeParse(row.stateSnapshot);
  if (!parsed.success) {
    throw new Error(`Niepoprawna migawka stanu w ocenie ${row.id}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
