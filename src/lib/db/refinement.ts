import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { applyProposal, type ApplyError } from "@/lib/bmc/proposals";
import { prisma } from "@/lib/db/client";
import { BmcState } from "@/lib/schemas/bmc";
import {
  MAX_REFINEMENT_ROUNDS,
  QuestionsOutput,
  RefinementAnswers,
  refineOutputSchema,
  sortRefineProposals,
  type RefinementQuestion,
  type RefinementRoundView,
  type RefinementStatus,
  type RefineOutput,
} from "@/lib/schemas/refinement";

// Każdy odczyt i zapis rundy jest ograniczony do wariantu (variantId) należącego do projektu (projectId z uprawnień).
// Odpowiedzi użytkownika i treści od modelu to dane, nie polecenia: tu tylko je zapisujemy.

const ACTIVE_STATUSES: RefinementStatus[] = ["AWAITING_ANSWERS", "PROPOSED"];

class RollbackSignal extends Error {
  constructor(readonly reason: "WRONG_STATE" | "LIMIT") {
    super(reason);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

type Tx = Prisma.TransactionClient;

async function lockVariant(tx: Tx, projectId: string, variantId: string): Promise<boolean> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "BmcVariant" WHERE "id" = ${variantId} AND "projectId" = ${projectId} FOR UPDATE`;
  return locked.length > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Start rundy
// ---------------------------------------------------------------------------------------------------------------------

export type CreateRefinementRoundResult =
  | { ok: true; roundId: string; roundNumber: number }
  | { ok: false; error: "NOT_FOUND" | "LIMIT" | "ROUND_IN_PROGRESS" | "EVALUATION_NOT_FOUND" };

/**
 * Tworzy rundę (status AWAITING_ANSWERS) w jednej transakcji z blokadą wiersza wariantu (wzór createProposal):
 * - najwyżej `maxRounds` rund na wariant; rundy zamknięte (CANCELLED) liczą się do limitu (ochrona kosztów);
 * - niedokończona runda blokuje start nowej: AWAITING_ANSWERS albo PROPOSED z choć jedną propozycją PENDING;
 * - ocena początkowa musi należeć do tego wariantu i projektu;
 * - `roundNumber` = liczba rund + 1; unikalność (variantId, roundNumber) i CHECK 1..3 w SQL to dalsze linie obrony,
 *   a naruszenie unikalności (równoległe starty) daje LIMIT.
 */
export async function createRefinementRound(
  args: {
    projectId: string;
    variantId: string;
    evaluationId: string;
    variantVersion: number;
    stateSnapshot: BmcState;
    questions: QuestionsOutput;
    provider: string;
    model: string;
    questionsPromptVersion: string;
    questionsLlmCallLogId: string | null;
    createdById: string;
  },
  maxRounds: number = MAX_REFINEMENT_ROUNDS,
): Promise<CreateRefinementRoundResult> {
  const { projectId, variantId } = args;
  const questions = QuestionsOutput.parse(args.questions);
  const stateSnapshot = BmcState.parse(args.stateSnapshot);

  try {
    return await prisma.$transaction(async (tx): Promise<CreateRefinementRoundResult> => {
      if (!(await lockVariant(tx, projectId, variantId))) {
        return { ok: false, error: "NOT_FOUND" };
      }

      const rounds = await tx.refinementRound.findMany({
        where: { variantId, projectId },
        select: { id: true, status: true },
      });
      if (rounds.length >= maxRounds) {
        return { ok: false, error: "LIMIT" };
      }

      const awaiting = rounds.some((round) => round.status === "AWAITING_ANSWERS");
      const proposedIds = rounds.filter((round) => round.status === "PROPOSED").map((round) => round.id);
      const pendingInProposed =
        proposedIds.length > 0 &&
        (await tx.proposal.count({ where: { refinementRoundId: { in: proposedIds }, status: "PENDING" } })) > 0;
      if (awaiting || pendingInProposed) {
        return { ok: false, error: "ROUND_IN_PROGRESS" };
      }

      const evaluation = await tx.evaluationResult.findFirst({
        where: { id: args.evaluationId, variantId, projectId },
        select: { id: true },
      });
      if (!evaluation) {
        return { ok: false, error: "EVALUATION_NOT_FOUND" };
      }

      const roundNumber = rounds.length + 1;
      const created = await tx.refinementRound.create({
        data: {
          projectId,
          variantId,
          roundNumber,
          evaluationId: evaluation.id,
          variantVersion: args.variantVersion,
          stateSnapshot,
          questions,
          provider: args.provider,
          model: args.model,
          questionsPromptVersion: args.questionsPromptVersion,
          questionsLlmCallLogId: args.questionsLlmCallLogId,
          createdById: args.createdById,
        },
        select: { id: true, roundNumber: true },
      });
      return { ok: true, roundId: created.id, roundNumber: created.roundNumber };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "LIMIT" };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Odpowiedzi i paczka propozycji
// ---------------------------------------------------------------------------------------------------------------------

export type SaveAnswersResult =
  | { ok: true; proposalIds: string[] }
  | {
      ok: false;
      error: "NOT_FOUND" | "WRONG_STATE" | "VERSION_CONFLICT" | "LIMIT" | "INVALID" | "NOT_APPLICABLE";
      // Tylko dla NOT_APPLICABLE: numer propozycji w posortowanej paczce i powód.
      index?: number;
      applyError?: ApplyError;
    };

/**
 * Jedna transakcja: zapis odpowiedzi, propozycji PENDING z rundy (sourceKind = REFINEMENT, runda i numer pytania) i
 * zmiana statusu rundy na PROPOSED. Albo wszystko, albo nic.
 * `expectedVersion` to wersja wariantu, względem której powstała paczka; inna bieżąca wersja daje VERSION_CONFLICT.
 * Paczka jest sortowana po numerze pytania (kolejność zastosowania) i sprawdzana sekwencyjnie na bieżącym stanie.
 */
export async function saveAnswersAndProposals(
  args: {
    projectId: string;
    variantId: string;
    roundId: string;
    userId: string;
    expectedVersion: number;
    answers: string[];
    refine: RefineOutput;
    refinePromptVersion: string;
    refineLlmCallLogId: string | null;
  },
  maxPending: number,
): Promise<SaveAnswersResult> {
  const { projectId, variantId, roundId } = args;
  const answers = RefinementAnswers.safeParse(args.answers);
  if (!answers.success) {
    return { ok: false, error: "INVALID" };
  }

  try {
    return await prisma.$transaction(async (tx): Promise<SaveAnswersResult> => {
      if (!(await lockVariant(tx, projectId, variantId))) {
        return { ok: false, error: "NOT_FOUND" };
      }

      const round = await tx.refinementRound.findFirst({
        where: { id: roundId, variantId, projectId },
        select: { status: true, questions: true },
      });
      if (!round) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (round.status !== "AWAITING_ANSWERS") {
        return { ok: false, error: "WRONG_STATE" };
      }
      const questions = QuestionsOutput.safeParse(round.questions);
      if (!questions.success) {
        throw new Error(`Niepoprawne pytania w rundzie ${roundId}: ${z.prettifyError(questions.error)}`);
      }
      const refine = refineOutputSchema(questions.data.questions.length).safeParse(args.refine);
      if (!refine.success || answers.data.length > questions.data.questions.length) {
        return { ok: false, error: "INVALID" };
      }

      const variant = await tx.bmcVariant.findFirst({ where: { id: variantId, projectId }, select: { version: true, state: true } });
      if (!variant) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (variant.version !== args.expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }
      const state = BmcState.safeParse(variant.state);
      if (!state.success) {
        throw new Error(`Niepoprawny stan BMC w wariancie ${variantId}: ${z.prettifyError(state.error)}`);
      }

      const pending = await tx.proposal.count({ where: { variantId, status: "PENDING" } });
      const proposals = sortRefineProposals(refine.data.proposals);
      if (pending + proposals.length > maxPending) {
        return { ok: false, error: "LIMIT" };
      }

      // Sekwencyjna stosowalność na kopii stanu (jak przy akceptacji paczki): obrona w głąb, główne sprawdzenie robi operacja.
      let working = state.data;
      for (const [index, proposal] of proposals.entries()) {
        const applied = applyProposal(working, proposal);
        if (!applied.ok) {
          return { ok: false, error: "NOT_APPLICABLE", index, applyError: applied.error };
        }
        working = applied.state;
      }

      const proposalIds: string[] = [];
      for (const proposal of proposals) {
        const created = await tx.proposal.create({
          data: {
            variantId,
            blockKey: proposal.blockKey,
            operation: proposal.operation === "add" ? "ADD" : proposal.operation === "edit" ? "EDIT" : "REMOVE",
            before: proposal.before,
            after: proposal.after,
            rationale: proposal.rationale,
            baseVersion: args.expectedVersion,
            createdById: args.userId,
            sourceKind: "REFINEMENT",
            refinementRoundId: roundId,
            refinementQuestionIndex: proposal.questionIndex,
          },
          select: { id: true },
        });
        proposalIds.push(created.id);
      }

      const updated = await tx.refinementRound.updateMany({
        where: { id: roundId, variantId, projectId, status: "AWAITING_ANSWERS" },
        data: {
          answers: answers.data,
          result: { proposals },
          status: "PROPOSED",
          refinePromptVersion: args.refinePromptVersion,
          refineLlmCallLogId: args.refineLlmCallLogId,
        },
      });
      if (updated.count === 0) {
        // Równoległa zmiana statusu (np. zamknięcie rundy): wycofujemy też utworzone propozycje.
        throw new RollbackSignal("WRONG_STATE");
      }

      return { ok: true, proposalIds };
    });
  } catch (error) {
    if (error instanceof RollbackSignal) {
      return { ok: false, error: error.reason };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Zamknięcie rundy
// ---------------------------------------------------------------------------------------------------------------------

export type CancelRoundResult =
  | { ok: true; roundNumber: number }
  | { ok: false; error: "NOT_FOUND" | "ALREADY_CANCELLED" };

/**
 * Zamyka rundę (CANCELLED). Zamknięta runda liczy się do limitu rund i nie można jej wznowić. Propozycje rundy
 * (także PENDING) zostają bez zmian: rozstrzyga je użytkownik osobno.
 */
export async function cancelRound(args: { projectId: string; variantId: string; roundId: string }): Promise<CancelRoundResult> {
  const { projectId, variantId, roundId } = args;

  const { count } = await prisma.refinementRound.updateMany({
    where: { id: roundId, variantId, projectId, status: { in: ACTIVE_STATUSES } },
    data: { status: "CANCELLED" },
  });
  const existing = await prisma.refinementRound.findFirst({
    where: { id: roundId, variantId, projectId },
    select: { roundNumber: true },
  });
  if (!existing) {
    return { ok: false, error: "NOT_FOUND" };
  }
  return count === 1 ? { ok: true, roundNumber: existing.roundNumber } : { ok: false, error: "ALREADY_CANCELLED" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Odczyt
// ---------------------------------------------------------------------------------------------------------------------

const VIEW_SELECT = {
  id: true,
  roundNumber: true,
  status: true,
  evaluationId: true,
  variantVersion: true,
  questions: true,
  answers: true,
  createdAt: true,
} as const;

export type RefinementRoundListItem =
  | { ok: true; round: RefinementRoundView }
  // Uszkodzony zapis (np. ręcznie zmieniony JSON) nie psuje strony: pokazujemy wiersz z błędem.
  | { ok: false; id: string; roundNumber: number; error: "CORRUPT" };

type RoundRow = {
  id: string;
  roundNumber: number;
  status: RefinementStatus;
  evaluationId: string;
  variantVersion: number;
  questions: unknown;
  answers: unknown;
  createdAt: Date;
};

function toListItem(row: RoundRow): RefinementRoundListItem {
  const questions = QuestionsOutput.safeParse(row.questions);
  const answers = row.answers === null ? { success: true as const, data: null } : z.array(z.string()).safeParse(row.answers);
  if (!questions.success || !answers.success) {
    return { ok: false, id: row.id, roundNumber: row.roundNumber, error: "CORRUPT" };
  }
  const questionList: RefinementQuestion[] = questions.data.questions;
  return {
    ok: true,
    round: {
      id: row.id,
      roundNumber: row.roundNumber,
      status: row.status,
      evaluationId: row.evaluationId,
      variantVersion: row.variantVersion,
      questions: questionList,
      answers: answers.data,
      createdAt: row.createdAt,
    },
  };
}

/** Rundy wariantu (od pierwszej), tylko z wariantu należącego do projektu. */
export async function listRoundsForVariant(projectId: string, variantId: string): Promise<RefinementRoundListItem[]> {
  const rows = await prisma.refinementRound.findMany({
    where: { variantId, projectId },
    orderBy: { roundNumber: "asc" },
    select: VIEW_SELECT,
  });
  return rows.map(toListItem);
}

/** Jedna runda po id z filtrem po wariancie i projekcie: cudze id daje null. */
export async function getRoundForVariant(
  projectId: string,
  variantId: string,
  roundId: string,
): Promise<RefinementRoundListItem | null> {
  const row = await prisma.refinementRound.findFirst({ where: { id: roundId, variantId, projectId }, select: VIEW_SELECT });
  return row ? toListItem(row) : null;
}

/** Liczba rund wariantu (także zamkniętych), np. do sprawdzenia limitu przed wywołaniem modelu. */
export async function countRoundsForVariant(projectId: string, variantId: string): Promise<number> {
  return prisma.refinementRound.count({ where: { variantId, projectId } });
}
