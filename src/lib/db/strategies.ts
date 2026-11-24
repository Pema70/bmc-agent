import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { LIST_SELECT as VARIANT_LIST_SELECT, toListItem, type VariantListItem } from "@/lib/db/variants";
import { originsForStrategy } from "@/lib/bmc/origins";
import { uniqueVariantName } from "@/lib/bmc/variant-names";
import { BmcState } from "@/lib/schemas/bmc";
import {
  OperationTrigger,
  STRATEGY_SCHEMA_VERSION,
  StrategyGuidelines,
  type SavedStrategyVariant,
  type StrategyGenerationView,
} from "@/lib/schemas/strategy";
import { StrategiesOutput } from "@/lib/schemas/variant";

// Odczyty są zawsze ograniczone do projektu i wariantu bazowego (projectId ORAZ variantId). Kandydaci to dane z bazy:
// zapis wariantu ze strategii czyta stan z zapisanego wyniku, nigdy od klienta.

type GenerationRow = {
  id: string;
  createdAt: Date;
  schemaVersion: number;
  variantVersion: number;
  guidelines: string | null;
  trigger: string;
  provider: string;
  model: string;
  promptVersion: string;
  result: unknown;
  variants: Array<{ id: string; name: string; generationIndex: number | null }>;
};

// Zapisane warianty tej generacji, tylko z tego samego projektu.
function generationSelect(projectId: string) {
  return {
    id: true,
    createdAt: true,
    schemaVersion: true,
    variantVersion: true,
    guidelines: true,
    trigger: true,
    provider: true,
    model: true,
    promptVersion: true,
    result: true,
    variants: { where: { projectId }, select: { id: true, name: true, generationIndex: true } },
  } as const;
}

export type StrategyListItem = { ok: true; generation: StrategyGenerationView } | { ok: false; id: string; error: string };

/** Parsuje jeden wiersz. Niezgodny rekord daje błąd tylko dla siebie, nie dla całej listy. */
export function parseStrategyRow(row: GenerationRow): StrategyListItem {
  if (row.schemaVersion !== STRATEGY_SCHEMA_VERSION) {
    return { ok: false, id: row.id, error: `Nieobsługiwana wersja schematu strategii (${row.schemaVersion}).` };
  }
  const result = StrategiesOutput.safeParse(row.result);
  const trigger = OperationTrigger.safeParse(row.trigger);
  if (!result.success || !trigger.success) {
    return { ok: false, id: row.id, error: "Zapisane strategie są niezgodne ze schematem." };
  }
  const savedVariants: SavedStrategyVariant[] = row.variants.flatMap((variant) =>
    variant.generationIndex === null ? [] : [{ index: variant.generationIndex, variantId: variant.id, name: variant.name }],
  );
  savedVariants.sort((a, b) => a.index - b.index);
  return {
    ok: true,
    generation: {
      id: row.id,
      createdAt: row.createdAt,
      schemaVersion: row.schemaVersion,
      variantVersion: row.variantVersion,
      guidelines: row.guidelines,
      trigger: trigger.data,
      provider: row.provider,
      model: row.model,
      promptVersion: row.promptVersion,
      result: result.data,
      savedVariants,
    },
  };
}

export type CreateStrategyGenerationInput = {
  projectId: string;
  variantId: string;
  variantVersion: number;
  stateSnapshot: BmcState;
  guidelines: string | null;
  result: StrategiesOutput;
  trigger: OperationTrigger;
  provider: string;
  model: string;
  promptVersion: string;
  llmCallLogId: string | null;
  createdById: string | null;
};

/**
 * Zapis wyniku generowania (append-only). Walidacja Zod przed zapisem: wynik niezgodny ze schematem nigdy nie trafia
 * do bazy. Identyfikator generacji zawsze pochodzi stąd (z bazy), nigdy z tekstu modelu.
 */
export async function createStrategyGeneration(input: CreateStrategyGenerationInput): Promise<StrategyGenerationView> {
  const result = StrategiesOutput.parse(input.result);
  const stateSnapshot = BmcState.parse(input.stateSnapshot);
  const guidelines = StrategyGuidelines.parse(input.guidelines);
  const trigger = OperationTrigger.parse(input.trigger);
  const row = await prisma.strategyGeneration.create({
    data: {
      projectId: input.projectId,
      variantId: input.variantId,
      schemaVersion: STRATEGY_SCHEMA_VERSION,
      variantVersion: input.variantVersion,
      stateSnapshot,
      guidelines,
      result,
      trigger,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      llmCallLogId: input.llmCallLogId,
      createdById: input.createdById,
    },
    select: generationSelect(input.projectId),
  });
  const parsed = parseStrategyRow(row);
  if (!parsed.ok) {
    throw new Error(`Zapisane strategie ${row.id} są niepoprawne: ${parsed.error}`);
  }
  return parsed.generation;
}

/**
 * Generacje wariantu od najnowszej, bez migawki stanu. Filtruje po projectId ORAZ variantId,
 * więc wariant z innego projektu daje pustą listę.
 */
export async function listStrategyGenerationsForVariant(
  projectId: string,
  variantId: string,
  limit: number,
): Promise<StrategyListItem[]> {
  const rows = await prisma.strategyGeneration.findMany({
    where: { projectId, variantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: generationSelect(projectId),
  });
  return rows.map(parseStrategyRow);
}

/** Jedna generacja po id (bez migawki), z filtrem po projekcie i wariancie bazowym. Brak rekordu: null. */
export async function getStrategyGeneration(
  projectId: string,
  variantId: string,
  generationId: string,
): Promise<StrategyListItem | null> {
  const row = await prisma.strategyGeneration.findFirst({
    where: { id: generationId, projectId, variantId },
    select: generationSelect(projectId),
  });
  return row ? parseStrategyRow(row) : null;
}

export type SaveStrategyResult =
  | { ok: true; variant: VariantListItem }
  | { ok: false; error: "NOT_FOUND" | "INVALID_INDEX" | "INVALID_GENERATION" | "LIMIT" }
  | { ok: false; error: "ALREADY_SAVED"; variantId: string };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Zapis kandydata (strategii) jako wariantu. Stan i założenie pochodzą z zapisanego wyniku generacji (nigdy od klienta)
 * i przechodzą ponowne BmcState.safeParse. Jedna transakcja z blokadą wiersza projektu: limit wariantów, numeracja nazw
 * i sprawdzenie „już zapisana” są spójne przy równoległych żądaniach. @@unique([generationId, generationIndex]) chroni
 * dodatkowo przy wyścigu. Drugi zapis tej samej strategii to jawny wynik ALREADY_SAVED z id istniejącego wariantu.
 */
export async function saveStrategyAsVariant(args: {
  projectId: string;
  variantId: string;
  generationId: string;
  index: number;
  userId: string;
  maxVariants: number;
}): Promise<SaveStrategyResult> {
  const { projectId, variantId, generationId, index, userId, maxVariants } = args;

  try {
    return await prisma.$transaction(async (tx): Promise<SaveStrategyResult> => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      if (locked.length === 0) {
        return { ok: false, error: "NOT_FOUND" };
      }

      const generation = await tx.strategyGeneration.findFirst({
        where: { id: generationId, projectId, variantId },
        select: { id: true, schemaVersion: true, result: true },
      });
      if (!generation) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (generation.schemaVersion !== STRATEGY_SCHEMA_VERSION) {
        return { ok: false, error: "INVALID_GENERATION" };
      }
      const output = StrategiesOutput.safeParse(generation.result);
      if (!output.success) {
        return { ok: false, error: "INVALID_GENERATION" };
      }
      const strategy = output.data.strategies[index];
      if (!strategy) {
        return { ok: false, error: "INVALID_INDEX" };
      }
      const state = BmcState.safeParse(strategy.state);
      if (!state.success) {
        return { ok: false, error: "INVALID_GENERATION" };
      }

      const existing = await tx.bmcVariant.findFirst({
        where: { projectId, generationId, generationIndex: index },
        select: { id: true },
      });
      if (existing) {
        return { ok: false, error: "ALREADY_SAVED", variantId: existing.id };
      }

      const names = await tx.bmcVariant.findMany({ where: { projectId }, select: { name: true } });
      if (names.length >= maxVariants) {
        return { ok: false, error: "LIMIT" };
      }

      const row = await tx.bmcVariant.create({
        data: {
          projectId,
          name: uniqueVariantName(
            strategy.name,
            names.map((variant) => variant.name),
          ),
          isMain: false,
          state: state.data,
          // Każdy wpis pochodzi z kandydata strategii (nazwa strategii z chwili zapisu).
          entryOrigins: originsForStrategy(state.data, strategy.name, 1) as unknown as Prisma.InputJsonValue,
          origin: "AI_STRATEGY",
          description: strategy.assumption,
          generationId,
          generationIndex: index,
          createdById: userId,
        },
        select: VARIANT_LIST_SELECT,
      });
      return { ok: true, variant: toListItem(row) };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // Wyścig, którego blokada nie złapała: ktoś zapisał tę samą strategię. Zwracamy istniejący wariant.
    const existing = await prisma.bmcVariant.findFirst({
      where: { projectId, generationId, generationIndex: index },
      select: { id: true },
    });
    if (!existing) {
      throw error;
    }
    return { ok: false, error: "ALREADY_SAVED", variantId: existing.id };
  }
}
