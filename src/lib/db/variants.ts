import { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { originsAfterManualSave, originsForCopy } from "@/lib/bmc/origins";
import { parseStoredOrigins, type EntryOrigin } from "@/lib/schemas/origin";
import { nextCopyName } from "@/lib/bmc/variant-names";
import { BmcState, countEntries } from "@/lib/schemas/bmc";
import type { VariantOrigin } from "@/lib/schemas/variant";

export const MAIN_VARIANT_NAME = "Wariant główny";

export type MainVariant = {
  id: string;
  name: string;
  version: number;
  updatedAt: Date;
  state: BmcState;
};

/**
 * Zwraca null, gdy projekt nie ma wariantu głównego. Stan niezgodny z BmcState to błąd danych:
 * rzucamy jawny wyjątek zamiast pokazywać lub nadpisywać uszkodzony model.
 */
export async function getMainVariant(projectId: string): Promise<MainVariant | null> {
  const variant = await prisma.bmcVariant.findFirst({
    where: { projectId, isMain: true },
    select: { id: true, name: true, version: true, updatedAt: true, state: true },
  });
  if (!variant) {
    return null;
  }

  const parsed = BmcState.safeParse(variant.state);
  if (!parsed.success) {
    throw new Error(`Niepoprawny stan BMC w wariancie ${variant.id}: ${z.prettifyError(parsed.error)}`);
  }
  return { ...variant, state: parsed.data };
}

export async function getVariantProjectId(variantId: string): Promise<string | null> {
  const variant = await prisma.bmcVariant.findUnique({ where: { id: variantId }, select: { projectId: true } });
  return variant?.projectId ?? null;
}

/** Wariant tylko wtedy, gdy należy do wskazanego projektu (jedno zapytanie po id i projectId). */
export async function getVariantForProject(
  projectId: string,
  variantId: string,
): Promise<{ id: string; version: number; state: BmcState } | null> {
  const variant = await prisma.bmcVariant.findFirst({
    where: { id: variantId, projectId },
    select: { id: true, version: true, state: true },
  });
  if (!variant) {
    return null;
  }

  const parsed = BmcState.safeParse(variant.state);
  if (!parsed.success) {
    throw new Error(`Niepoprawny stan BMC w wariancie ${variant.id}: ${z.prettifyError(parsed.error)}`);
  }
  return { id: variant.id, version: variant.version, state: parsed.data };
}

/**
 * Optymistyczne blokowanie: zapis przechodzi tylko wtedy, gdy nikt nie zmienił wersji w międzyczasie.
 * Przyjmuje klienta (także transakcyjnego), żeby akceptacja propozycji mogła zapisać stan
 * i zmienić status propozycji w jednej transakcji. Zwraca liczbę zmienionych wierszy (0 = konflikt).
 */
export async function writeVariantStateIfVersion(
  client: Pick<PrismaClient, "bmcVariant">,
  variantId: string,
  expectedVersion: number,
  state: BmcState,
  // Wymagane, żeby żadna ścieżka zapisu stanu nie pominęła pochodzenia wpisów (krok 9): zapisywane tym samym UPDATE.
  origins: readonly EntryOrigin[],
): Promise<number> {
  const { count } = await client.bmcVariant.updateMany({
    where: { id: variantId, version: expectedVersion },
    data: { state, entryOrigins: origins as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  return count;
}

export type SaveVariantResult =
  | { ok: true; version: number }
  | { ok: false; error: "VALIDATION"; message: string }
  | { ok: false; error: "VERSION_CONFLICT" };

export async function saveVariantState(
  variantId: string,
  expectedVersion: number,
  state: unknown,
): Promise<SaveVariantResult> {
  const parsed = BmcState.safeParse(state);
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: z.prettifyError(parsed.error) };
  }

  // Stary stan i pochodzenie są potrzebne do rozstrzygnięcia, które wpisy są nowe (ręczne). Zapis nadal chroni wersja:
  // jeśli ktoś zmienił wariant po odczycie, updateMany nic nie zmieni (konflikt), więc pochodzenie nie rozjedzie się ze stanem.
  const current = await prisma.bmcVariant.findFirst({
    where: { id: variantId },
    select: { version: true, state: true, entryOrigins: true },
  });
  if (!current || current.version !== expectedVersion) {
    return { ok: false, error: "VERSION_CONFLICT" };
  }
  const oldState = BmcState.safeParse(current.state);
  const origins = originsAfterManualSave(
    oldState.success ? oldState.data : null,
    parsed.data,
    parseStoredOrigins(current.entryOrigins).origins,
    expectedVersion + 1,
  );

  const count = await writeVariantStateIfVersion(prisma, variantId, expectedVersion, parsed.data, origins);
  return count === 0 ? { ok: false, error: "VERSION_CONFLICT" } : { ok: true, version: expectedVersion + 1 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Warianty (krok 6). Każdy odczyt i zapis jest ograniczony do projektu (projectId); stan zawsze czyta serwer z bazy.
// ---------------------------------------------------------------------------------------------------------------------

export type VariantListItem = {
  id: string;
  name: string;
  isMain: boolean;
  origin: VariantOrigin;
  description: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  // Liczba wpisów we wszystkich blokach; null, gdy stan w bazie jest uszkodzony (lista ma się mimo to wyświetlić).
  entryCount: number | null;
};

export const LIST_SELECT = {
  id: true,
  name: true,
  isMain: true,
  origin: true,
  description: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  state: true,
} as const;

export function toListItem(row: {
  id: string;
  name: string;
  isMain: boolean;
  origin: VariantOrigin;
  description: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  state: unknown;
}): VariantListItem {
  const { state, ...rest } = row;
  const parsed = BmcState.safeParse(state);
  return { ...rest, entryCount: parsed.success ? countEntries(parsed.data) : null };
}

/** Warianty projektu (główny pierwszy, potem od najstarszego), bez stanu, z liczbą wpisów. */
export async function listVariants(projectId: string): Promise<VariantListItem[]> {
  const rows = await prisma.bmcVariant.findMany({
    where: { projectId },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: LIST_SELECT,
  });
  return rows.map(toListItem);
}

export type VariantDetails = {
  id: string;
  name: string;
  isMain: boolean;
  origin: VariantOrigin;
  description: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  state: BmcState;
};

/**
 * Wariant tylko wtedy, gdy należy do wskazanego projektu (jedno zapytanie po id i projectId); null dla cudzego.
 * Stan niezgodny z BmcState to błąd danych: rzucamy jawny wyjątek zamiast pokazywać uszkodzony model.
 */
export async function getVariantDetails(projectId: string, variantId: string): Promise<VariantDetails | null> {
  const row = await prisma.bmcVariant.findFirst({
    where: { id: variantId, projectId },
    select: LIST_SELECT,
  });
  if (!row) {
    return null;
  }
  const parsed = BmcState.safeParse(row.state);
  if (!parsed.success) {
    throw new Error(`Niepoprawny stan BMC w wariancie ${row.id}: ${z.prettifyError(parsed.error)}`);
  }
  return {
    id: row.id,
    name: row.name,
    isMain: row.isMain,
    origin: row.origin,
    description: row.description,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    state: parsed.data,
  };
}

export type CreateVariantResult =
  | { ok: true; variant: VariantListItem }
  | { ok: false; error: "NOT_FOUND" | "LIMIT" };

/**
 * Kopia zapisanego wariantu. Stan pochodzi z bazy (nigdy od klienta), nazwę nadaje serwer w transakcji
 * („(kopia)”, „(kopia 2)”…). Limit wariantów na projekt jest egzekwowany pod blokadą wiersza projektu,
 * więc równoległe żądania nie przekroczą go o jedną kopię.
 */
export async function createVariant(args: {
  projectId: string;
  sourceVariantId: string;
  createdById: string;
  maxVariants: number;
}): Promise<CreateVariantResult> {
  const { projectId, sourceVariantId, createdById, maxVariants } = args;

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
    if (locked.length === 0) {
      return { ok: false, error: "NOT_FOUND" } as const;
    }

    const source = await tx.bmcVariant.findFirst({
      where: { id: sourceVariantId, projectId },
      select: { id: true, name: true, state: true, entryOrigins: true },
    });
    if (!source) {
      return { ok: false, error: "NOT_FOUND" } as const;
    }
    const state = BmcState.safeParse(source.state);
    if (!state.success) {
      throw new Error(`Niepoprawny stan BMC w wariancie ${source.id}: ${z.prettifyError(state.error)}`);
    }

    const existing = await tx.bmcVariant.findMany({ where: { projectId }, select: { name: true } });
    if (existing.length >= maxVariants) {
      return { ok: false, error: "LIMIT" } as const;
    }

    const row = await tx.bmcVariant.create({
      data: {
        projectId,
        name: nextCopyName(
          source.name,
          existing.map((variant) => variant.name),
        ),
        isMain: false,
        state: state.data,
        // Kopia dziedziczy pochodzenie wpisów źródła (stan jest ten sam).
        entryOrigins: originsForCopy(parseStoredOrigins(source.entryOrigins).origins, state.data) as unknown as Prisma.InputJsonValue,
        origin: "MANUAL",
        createdById,
      },
      select: LIST_SELECT,
    });
    return { ok: true, variant: toListItem(row) } as const;
  });
}

export type RenameVariantResult = { ok: true } | { ok: false; error: "NOT_FOUND" };

/** Zmiana nazwy nie zmienia `version` (to wersja stanu), więc nie wywołuje fałszywych konfliktów edycji. */
export async function renameVariant(projectId: string, variantId: string, name: string): Promise<RenameVariantResult> {
  const { count } = await prisma.bmcVariant.updateMany({ where: { id: variantId, projectId }, data: { name } });
  return count === 0 ? { ok: false, error: "NOT_FOUND" } : { ok: true };
}

export type SetMainVariantResult =
  | { ok: true; mainVariantId: string; changed: boolean }
  | { ok: false; error: "NOT_FOUND" | "CONFLICT" };

/**
 * Ustawia wariant główny w jednej transakcji z blokadą (FOR UPDATE) wszystkich wariantów projektu.
 * Najpierw zdejmuje isMain ze starego, potem ustawia nowemu (częściowy indeks unikalny dopuszcza jednego głównego).
 * `expectedMainId` to główny, którego widział klient; niezgodność oznacza konflikt (ktoś zmienił głównego w międzyczasie).
 * Nie zmienia `version` ani stanu żadnego wariantu.
 */
export async function setMainVariant(
  projectId: string,
  variantId: string,
  expectedMainId: string | null,
): Promise<SetMainVariantResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; isMain: boolean }>>`
      SELECT "id", "isMain" FROM "BmcVariant" WHERE "projectId" = ${projectId} FOR UPDATE`;
    const target = rows.find((row) => row.id === variantId);
    if (!target) {
      return { ok: false, error: "NOT_FOUND" } as const;
    }
    const current = rows.find((row) => row.isMain);
    if ((current?.id ?? null) !== expectedMainId) {
      return { ok: false, error: "CONFLICT" } as const;
    }
    if (target.isMain) {
      return { ok: true, mainVariantId: variantId, changed: false } as const;
    }

    if (current) {
      await tx.bmcVariant.updateMany({ where: { id: current.id, projectId }, data: { isMain: false } });
    }
    await tx.bmcVariant.updateMany({ where: { id: variantId, projectId }, data: { isMain: true } });
    return { ok: true, mainVariantId: variantId, changed: true } as const;
  });
}

/**
 * Minimalne dane wariantu (bez stanu) do sprawdzeń uprawnień i reguł, np. „czat tylko dla wariantu głównego”.
 * Zapytanie po id i projectId; null dla wariantu z innego projektu.
 */
export async function getVariantMeta(projectId: string, variantId: string): Promise<{ id: string; isMain: boolean } | null> {
  return prisma.bmcVariant.findFirst({ where: { id: variantId, projectId }, select: { id: true, isMain: true } });
}

export type VariantForCompare = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  state: BmcState;
};

/**
 * Warianty do porównania jednym zapytaniem po projectId i liście id, w kolejności żądania. Wariant spoza projektu lub
 * nieistniejący po prostu nie wchodzi do wyniku (wywołujący porównuje liczbę znalezionych z żądaną). Stan niezgodny
 * z BmcState to błąd danych: jawny wyjątek zamiast porównywania uszkodzonego modelu.
 */
export async function getVariantsForCompare(projectId: string, variantIds: readonly string[]): Promise<VariantForCompare[]> {
  const rows = await prisma.bmcVariant.findMany({
    where: { projectId, id: { in: [...variantIds] } },
    select: { id: true, name: true, description: true, version: true, state: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return variantIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) {
      return [];
    }
    const parsed = BmcState.safeParse(row.state);
    if (!parsed.success) {
      throw new Error(`Niepoprawny stan BMC w wariancie ${row.id}: ${z.prettifyError(parsed.error)}`);
    }
    return [{ id: row.id, name: row.name, description: row.description, version: row.version, state: parsed.data }];
  });
}
