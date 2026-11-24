"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runGenerateQuestions, type GenerateQuestionsErrorCode } from "@/lib/ai/generate-questions";
import { runRefineFromAnswers, type RefineFromAnswersErrorCode } from "@/lib/ai/refine-from-answers";
import { requireProjectRole } from "@/lib/auth/permissions";
import { APPLY_ERROR_MESSAGES } from "@/lib/bmc/proposals";
import { VERSION_CONFLICT_MESSAGE } from "@/lib/bmc/messages";
import { acceptRoundBatch, type BatchFailure } from "@/lib/db/proposals";
import { cancelRound } from "@/lib/db/refinement";
import { getVariantProjectId } from "@/lib/db/variants";
import { VariantId, type BmcState } from "@/lib/schemas/bmc";
import {
  MAX_REFINEMENT_ROUNDS,
  RefinementRoundId,
  SubmitAnswersInput,
  type RefinementRoundView,
} from "@/lib/schemas/refinement";

// Akcje cyklu poprawek (krok 7), tylko z interfejsu, rola EDITOR i wyżej. Kolejność w każdej: rola (ok: false przed
// jakimkolwiek odczytem), wariant należy do projektu, Zod, dopiero potem operacja. Klient podaje expectedVersion
// (zapisana wersja wariantu, D21); stan niezapisany w edytorze nie opuszcza przeglądarki, więc blokuje go interfejs.

const FORBIDDEN_MESSAGE = "Nie masz uprawnień do cyklu poprawek w tym projekcie.";
const NOT_FOUND_MESSAGE = "Nie znaleziono tego wariantu w projekcie.";
const ROUND_NOT_FOUND_MESSAGE = "Nie znaleziono tej rundy poprawek.";
const ALREADY_RESOLVED_MESSAGE = "Którąś z propozycji rozpatrzono w międzyczasie. Odśwież stronę.";
const NOTHING_PENDING_MESSAGE = "W tej rundzie nie ma oczekujących propozycji.";
const ALREADY_CANCELLED_MESSAGE = "Ta runda jest już zamknięta.";
export const EMPTY_BATCH_MESSAGE = "Na podstawie odpowiedzi nie ma czego zmienić.";

const ExpectedVersion = z.number().int().min(1);

/** Zwraca identyfikator wariantu tylko wtedy, gdy należy do projektu, do którego sprawdziliśmy uprawnienia. */
async function variantInProject(projectId: string, variantId: string): Promise<string | null> {
  const parsed = VariantId.safeParse(variantId);
  if (!parsed.success) {
    return null;
  }
  return (await getVariantProjectId(parsed.data)) === projectId ? parsed.data : null;
}

// ---------------------------------------------------------------------------------------------------------------------

export type StartRoundActionResult =
  | { ok: true; round: RefinementRoundView }
  | { ok: false; error: GenerateQuestionsErrorCode | "FORBIDDEN" | "VALIDATION"; message: string; retryAfterSec?: number };

/** „Rozpocznij rundę”: pytania z najnowszej, aktualnej oceny (bez ukrytych wywołań modelu: brak oceny to STALE_EVALUATION). */
export async function startRefinementRoundAction(
  projectId: string,
  variantId: string,
  expectedVersion: number,
): Promise<StartRoundActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }
  const checkedId = await variantInProject(access.projectId, variantId);
  if (!checkedId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }
  const version = ExpectedVersion.safeParse(expectedVersion);
  if (!version.success) {
    return { ok: false, error: "VALIDATION", message: "Nie rozpoczęto rundy: nieprawidłowa wersja modelu." };
  }

  const result = await runGenerateQuestions({
    projectId: access.projectId,
    variantId: checkedId,
    userId: access.session.user.id,
    expectedVersion: version.data,
  });
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, round: result.round };
}

// ---------------------------------------------------------------------------------------------------------------------

export type SubmitAnswersActionResult =
  // message tylko dla pustej paczki (odpowiedzi nie dały podstaw do zmian); runda jest wtedy PROPOSED i liczy się do limitu.
  | { ok: true; roundId: string; proposalIds: string[]; message?: string }
  | { ok: false; error: RefineFromAnswersErrorCode | "FORBIDDEN"; message: string; retryAfterSec?: number };

/** „Przygotuj poprawki”: odpowiedzi użytkownika (dane, nie polecenia) → paczka propozycji rundy. */
export async function submitAnswersAction(
  projectId: string,
  variantId: string,
  input: unknown,
): Promise<SubmitAnswersActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }
  const checkedId = await variantInProject(access.projectId, variantId);
  if (!checkedId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }
  const parsed = SubmitAnswersInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", message: `Nie przygotowano poprawek: ${z.prettifyError(parsed.error)}` };
  }

  const result = await runRefineFromAnswers({
    projectId: access.projectId,
    variantId: checkedId,
    userId: access.session.user.id,
    roundId: parsed.data.roundId,
    expectedVersion: parsed.data.expectedVersion,
    answers: parsed.data.answers,
  });
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return result.proposalIds.length === 0 ? { ...result, message: EMPTY_BATCH_MESSAGE } : result;
}

// ---------------------------------------------------------------------------------------------------------------------

export type ApplyRoundFailure = BatchFailure & { message: string };

export type ApplyRoundActionResult =
  | { ok: true; version: number; state: BmcState; acceptedCount: number }
  | {
      ok: false;
      error: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "VERSION_CONFLICT" | "ALREADY_RESOLVED" | "NOTHING_PENDING" | "CONFLICTS";
      message: string;
      // Tylko dla CONFLICTS: propozycje, których nie da się zastosować, i powody (żadna zmiana nie została zapisana).
      failures?: ApplyRoundFailure[];
    };

/** „Zastosuj poprawki”: wszystkie oczekujące propozycje rundy albo żadna (D19). */
export async function applyRoundAction(
  projectId: string,
  variantId: string,
  roundId: string,
  expectedVersion: number,
): Promise<ApplyRoundActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }
  const checkedId = await variantInProject(access.projectId, variantId);
  if (!checkedId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }
  const round = RefinementRoundId.safeParse(roundId);
  const version = ExpectedVersion.safeParse(expectedVersion);
  if (!round.success || !version.success) {
    return { ok: false, error: "VALIDATION", message: "Nie zastosowano poprawek: nieprawidłowe dane." };
  }

  const result = await acceptRoundBatch({
    projectId: access.projectId,
    variantId: checkedId,
    roundId: round.data,
    expectedVersion: version.data,
    userId: access.session.user.id,
  });
  if (!result.ok) {
    switch (result.error) {
      case "NOT_FOUND":
        return { ok: false, error: "NOT_FOUND", message: ROUND_NOT_FOUND_MESSAGE };
      case "NOTHING_PENDING":
        return { ok: false, error: "NOTHING_PENDING", message: NOTHING_PENDING_MESSAGE };
      case "ALREADY_RESOLVED":
        return { ok: false, error: "ALREADY_RESOLVED", message: ALREADY_RESOLVED_MESSAGE };
      case "VERSION_CONFLICT":
        return { ok: false, error: "VERSION_CONFLICT", message: VERSION_CONFLICT_MESSAGE };
      case "CONFLICTS": {
        const failures = result.failures.map((failure) => ({ ...failure, message: APPLY_ERROR_MESSAGES[failure.error] }));
        return {
          ok: false,
          error: "CONFLICTS",
          message: `Nie zastosowano żadnej poprawki: ${failures.length} z propozycji nie pasuje do bieżącego modelu. Rozstrzygnij propozycje pojedynczo (Zaakceptuj lub Odrzuć).`,
          failures,
        };
      }
    }
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return { ok: true, version: result.version, state: result.state, acceptedCount: result.acceptedCount };
}

// ---------------------------------------------------------------------------------------------------------------------

export type CancelRoundActionResult =
  | { ok: true; roundNumber: number; message: string }
  | { ok: false; error: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "ALREADY_CANCELLED"; message: string };

/**
 * „Zamknij rundę” (po dwuetapowym potwierdzeniu w interfejsie): zmienia tylko status rundy. Zamknięta runda liczy się do limitu
 * i nie można jej wznowić; propozycje rundy zostają bez zmian.
 */
export async function cancelRoundAction(projectId: string, variantId: string, roundId: string): Promise<CancelRoundActionResult> {
  const access = await requireProjectRole(projectId, "EDITOR");
  if (!access.ok) {
    return { ok: false, error: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }
  const checkedId = await variantInProject(access.projectId, variantId);
  if (!checkedId) {
    return { ok: false, error: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
  }
  const round = RefinementRoundId.safeParse(roundId);
  if (!round.success) {
    return { ok: false, error: "VALIDATION", message: "Nieprawidłowy identyfikator rundy." };
  }

  const result = await cancelRound({ projectId: access.projectId, variantId: checkedId, roundId: round.data });
  if (!result.ok) {
    return result.error === "NOT_FOUND"
      ? { ok: false, error: "NOT_FOUND", message: ROUND_NOT_FOUND_MESSAGE }
      : { ok: false, error: "ALREADY_CANCELLED", message: ALREADY_CANCELLED_MESSAGE };
  }

  revalidatePath(`/projekty/${access.projectId}`);
  return {
    ok: true,
    roundNumber: result.roundNumber,
    message: `Runda ${result.roundNumber} zamknięta. Wykorzystano ${result.roundNumber} z ${MAX_REFINEMENT_ROUNDS} rund.`,
  };
}
