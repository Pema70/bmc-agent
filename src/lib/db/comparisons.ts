import { prisma } from "@/lib/db/client";
import {
  COMPARE_SCHEMA_VERSION,
  CompareOutput,
  VariantComparisonInputs,
  type VariantComparisonSummary,
  type VariantComparisonView,
} from "@/lib/schemas/compare";
import { OperationTrigger } from "@/lib/schemas/strategy";

// WYJĄTEK od reguły „projectId i variantId”: porównanie dotyczy wielu wariantów i celowo nie ma kluczy obcych do wariantów
// (przeżywa ich usunięcie), więc każdy odczyt filtruje po projectId. Identyfikatory wariantów to walidowana migawka w
// `inputs`, a nie relacja. Zapis wymaga, żeby wywołujący sprawdził, że wszystkie warianty należą do projektu (robi to
// runCompareVariants przez getVariantsForCompare po projectId).

type ComparisonRow = {
  id: string;
  createdAt: Date;
  schemaVersion: number;
  inputs: unknown;
  result: unknown;
  trigger: string;
  provider: string;
  model: string;
  promptVersion: string;
};

const SELECT = {
  id: true,
  createdAt: true,
  schemaVersion: true,
  inputs: true,
  result: true,
  trigger: true,
  provider: true,
  model: true,
  promptVersion: true,
} as const;

export type ComparisonItem = { ok: true; comparison: VariantComparisonView } | { ok: false; id: string; error: string };
export type ComparisonListItem = { ok: true; comparison: VariantComparisonSummary } | { ok: false; id: string; error: string };

/** Parsuje jeden wiersz. Niezgodny rekord daje błąd tylko dla siebie, nie dla całej listy. */
export function parseComparisonRow(row: ComparisonRow): ComparisonItem {
  if (row.schemaVersion !== COMPARE_SCHEMA_VERSION) {
    return { ok: false, id: row.id, error: `Nieobsługiwana wersja schematu porównania (${row.schemaVersion}).` };
  }
  const inputs = VariantComparisonInputs.safeParse(row.inputs);
  const result = CompareOutput.safeParse(row.result);
  const trigger = OperationTrigger.safeParse(row.trigger);
  if (!inputs.success || !result.success || !trigger.success) {
    return { ok: false, id: row.id, error: "Zapisane porównanie jest niezgodne ze schematem." };
  }
  // Etykiety w wyniku muszą odpowiadać etykietom wejścia (tę samą regułę egzekwuje zapis).
  const inputLabels = new Set(inputs.data.map((item) => item.label));
  if (result.data.variants.length !== inputLabels.size || result.data.variants.some((item) => !inputLabels.has(item.label))) {
    return { ok: false, id: row.id, error: "Etykiety w wyniku porównania nie odpowiadają porównywanym wariantom." };
  }
  return {
    ok: true,
    comparison: {
      id: row.id,
      createdAt: row.createdAt,
      schemaVersion: row.schemaVersion,
      trigger: trigger.data,
      provider: row.provider,
      model: row.model,
      promptVersion: row.promptVersion,
      inputs: inputs.data,
      result: result.data,
    },
  };
}

function toSummary(item: ComparisonItem): ComparisonListItem {
  if (!item.ok) {
    return item;
  }
  const { inputs, ...rest } = item.comparison;
  return {
    ok: true,
    comparison: {
      ...rest,
      inputs: inputs.map((input) => ({ label: input.label, variantId: input.variantId, name: input.name, version: input.version })),
    },
  };
}

export type CreateVariantComparisonInput = {
  projectId: string;
  inputs: VariantComparisonInputs;
  result: CompareOutput;
  trigger: OperationTrigger;
  provider: string;
  model: string;
  promptVersion: string;
  llmCallLogId: string | null;
  createdById: string | null;
};

/**
 * Zapis porównania (append-only). Walidacja Zod przed zapisem: wynik niezgodny ze schematem nigdy nie trafia do bazy.
 * Identyfikator porównania zawsze pochodzi stąd (z bazy), nigdy z tekstu modelu.
 */
export async function createVariantComparison(input: CreateVariantComparisonInput): Promise<VariantComparisonView> {
  const inputs = VariantComparisonInputs.parse(input.inputs);
  const result = CompareOutput.parse(input.result);
  const trigger = OperationTrigger.parse(input.trigger);
  const row = await prisma.variantComparison.create({
    data: {
      projectId: input.projectId,
      schemaVersion: COMPARE_SCHEMA_VERSION,
      inputs,
      result,
      trigger,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      llmCallLogId: input.llmCallLogId,
      createdById: input.createdById,
    },
    select: SELECT,
  });
  const parsed = parseComparisonRow(row);
  if (!parsed.ok) {
    throw new Error(`Zapisane porównanie ${row.id} jest niepoprawne: ${parsed.error}`);
  }
  return parsed.comparison;
}

/**
 * Porównania projektu od najnowszego, bez stanów wariantów w pozycjach listy. Filtr po projectId (patrz wyjątek wyżej);
 * obcy projekt daje pustą listę. Uszkodzony rekord to wiersz z błędem, a nie wyjątek dla całej listy.
 */
export async function listVariantComparisons(projectId: string, limit: number): Promise<ComparisonListItem[]> {
  const rows = await prisma.variantComparison.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: SELECT,
  });
  return rows.map((row) => toSummary(parseComparisonRow(row)));
}

/** Jedno porównanie po id (z migawkami stanów, do widoku obok siebie). Filtr po projectId; cudzy projekt lub brak: null. */
export async function getVariantComparison(projectId: string, comparisonId: string): Promise<ComparisonItem | null> {
  const row = await prisma.variantComparison.findFirst({
    where: { id: comparisonId, projectId },
    select: SELECT,
  });
  return row ? parseComparisonRow(row) : null;
}
