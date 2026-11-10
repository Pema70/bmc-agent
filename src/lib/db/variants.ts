import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { BmcState } from "@/lib/schemas/bmc";

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

  // Optymistyczne blokowanie: zapis przechodzi tylko wtedy, gdy nikt nie zmienił wersji w międzyczasie.
  const { count } = await prisma.bmcVariant.updateMany({
    where: { id: variantId, version: expectedVersion },
    data: { state: parsed.data, version: { increment: 1 } },
  });
  return count === 0 ? { ok: false, error: "VERSION_CONFLICT" } : { ok: true, version: expectedVersion + 1 };
}
