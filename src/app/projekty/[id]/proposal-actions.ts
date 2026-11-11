"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectRole } from "@/lib/auth/permissions";
import { APPLY_ERROR_MESSAGES } from "@/lib/bmc/proposals";
import { VERSION_CONFLICT_MESSAGE } from "@/lib/bmc/messages";
import { acceptProposal, rejectProposal } from "@/lib/db/proposals";
import { getVariantProjectId } from "@/lib/db/variants";
import { VariantId, type BmcState } from "@/lib/schemas/bmc";
import { ProposalId, ResolveProposalInput } from "@/lib/schemas/proposal";

type ErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "VERSION_CONFLICT"
  | "ALREADY_RESOLVED"
  | "STALE"
  | "DUPLICATE"
  | "LIMIT";

export type AcceptProposalActionResult =
  | { ok: true; version: number; state: BmcState }
  | { ok: false; error: ErrorCode; message: string };

export type RejectProposalActionResult = { ok: true } | { ok: false; error: ErrorCode; message: string };

const FORBIDDEN_MESSAGE = "Nie masz uprawnień do rozpatrywania propozycji w tym projekcie.";
const NOT_FOUND_MESSAGE = "Nie znaleziono tej propozycji w projekcie.";
const ALREADY_RESOLVED_MESSAGE = "Ta propozycja została już rozpatrzona.";

/** Zwraca identyfikator wariantu tylko wtedy, gdy należy do projektu, do którego sprawdziliśmy uprawnienia. */
async function variantInProject(projectId: string, variantId: string): Promise<string | null> {
  const parsed = VariantId.safeParse(variantId);
  if (!parsed.success) {
    return null;
  }
  return (await getVariantProjectId(parsed.data)) === projectId ? parsed.data : null;
}

export async function acceptProposalAction(
  projectId: string,
  variantId: string,
  proposalId: string,
  version: number,
): Promise<AcceptProposalActionResult> {
  // 1. Sesja i rola EDITOR. Brak sesji: przekierowanie, osoba spoza projektu: 404 (w requireProjectRole).
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }

  // 2. Wariant musi należeć do projektu.
  const checkedVariantId = await variantInProject(access.projectId, variantId);
  if (!checkedVariantId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  // 3. Walidacja wejścia.
  const parsed = ResolveProposalInput.safeParse({ proposalId, version });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: `Nie zaakceptowano: ${z.prettifyError(parsed.error)}` };
  }

  // 4. Zmiana stanu i statusu propozycji w jednej transakcji.
  const result = await acceptProposal({
    projectId: access.projectId,
    variantId: checkedVariantId,
    proposalId: parsed.data.proposalId,
    expectedVersion: parsed.data.version,
    userId: access.session.user.id,
  });
  if (!result.ok) {
    switch (result.error) {
      case "NOT_FOUND":
        return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
      case "ALREADY_RESOLVED":
        return { ok: false, error: "ALREADY_RESOLVED", message: ALREADY_RESOLVED_MESSAGE };
      case "VERSION_CONFLICT":
        return { ok: false, error: "VERSION_CONFLICT", message: VERSION_CONFLICT_MESSAGE };
      default:
        return { ok: false, error: result.error, message: APPLY_ERROR_MESSAGES[result.error] };
    }
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, version: result.version, state: result.state };
}

export async function rejectProposalAction(
  projectId: string,
  variantId: string,
  proposalId: string,
): Promise<RejectProposalActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }

  const checkedVariantId = await variantInProject(access.projectId, variantId);
  if (!checkedVariantId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  const parsedId = ProposalId.safeParse(proposalId);
  if (!parsedId.success) {
    return { ok: false, error: "VALIDATION", message: "Nie odrzucono: niepoprawny identyfikator propozycji." };
  }

  const result = await rejectProposal({
    projectId: access.projectId,
    variantId: checkedVariantId,
    proposalId: parsedId.data,
    userId: access.session.user.id,
  });
  if (!result.ok) {
    return result.error === "ALREADY_RESOLVED"
      ? { ok: false, error: "ALREADY_RESOLVED", message: ALREADY_RESOLVED_MESSAGE }
      : { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true };
}
