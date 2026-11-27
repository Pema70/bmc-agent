import type { RefinementRoundListItem } from "@/lib/db/refinement";
import type { EvaluationListItem } from "@/lib/db/evaluations";
import type { EvaluationView } from "@/lib/schemas/evaluation";
import type { ProposalStatus } from "@/lib/schemas/proposal";
import type { RefinementRoundView } from "@/lib/schemas/refinement";

/**
 * Para ocen „przed” i „po” dla rundy poprawek (plan kroku 9, jak punkt 3 „Zmian po akceptacji” planu kroku 7):
 * „przed” to ocena, na której runda powstała (`RefinementRound.evaluationId`); „po” to pierwsza ocena wariantu utworzona
 * po ostatnim rozstrzygnięciu propozycji rundy **od tego samego źródła co „przed”** (AI, ręczna albo sędzia), żeby
 * różnica ocen nie porównywała różnych oceniających (np. ocena AI przed rundą i ocena sędziego po niej). Brak oceny „po”
 * to jawny stan, nie błąd.
 */

export type RoundProposalStatus = { refinementRoundId: string | null; status: ProposalStatus; resolvedAt: Date | null };

export type AfterStatus =
  | "FOUND"
  /** Propozycje rozstrzygnięte, ale nie wykonano jeszcze oceny po rundzie. */
  | "NONE"
  /** Część propozycji rundy czeka na decyzję. */
  | "UNRESOLVED"
  /** Runda nie ma propozycji (anulowana, bez odpowiedzi albo pusta paczka). */
  | "NO_PROPOSALS";

export type RoundEvaluationPair =
  | {
      ok: true;
      round: RefinementRoundView;
      before: EvaluationView | null;
      after: EvaluationView | null;
      afterStatus: AfterStatus;
    }
  | { ok: false; roundNumber: number; error: "CORRUPT" };

export function pairRoundEvaluations(
  rounds: readonly RefinementRoundListItem[],
  evaluations: readonly EvaluationListItem[],
  proposals: readonly RoundProposalStatus[],
): RoundEvaluationPair[] {
  const valid = evaluations.flatMap((item) => (item.ok ? [item.evaluation] : []));
  // Od najstarszej, żeby pierwsza ocena po rundzie była pierwszym trafieniem.
  const ascending = [...valid].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  return rounds.map((item): RoundEvaluationPair => {
    if (!item.ok) {
      return { ok: false, roundNumber: item.roundNumber, error: "CORRUPT" };
    }
    const round = item.round;
    const before = valid.find((evaluation) => evaluation.id === round.evaluationId) ?? null;
    const own = proposals.filter((proposal) => proposal.refinementRoundId === round.id);

    if (own.length === 0) {
      return { ok: true, round, before, after: null, afterStatus: "NO_PROPOSALS" };
    }
    if (own.some((proposal) => proposal.status === "PENDING")) {
      return { ok: true, round, before, after: null, afterStatus: "UNRESOLVED" };
    }
    const lastResolved = own.reduce((latest, proposal) => Math.max(latest, proposal.resolvedAt?.getTime() ?? 0), 0);
    const after =
      lastResolved === 0
        ? null
        : (ascending.find(
            (evaluation) => evaluation.createdAt.getTime() > lastResolved && (!before || evaluation.source === before.source),
          ) ?? null);
    return { ok: true, round, before, after, afterStatus: after ? "FOUND" : "NONE" };
  });
}
