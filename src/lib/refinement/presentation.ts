import { ANSWER_MAX_CHARS, MAX_REFINEMENT_ROUNDS, type RefinementStatus } from "@/lib/schemas/refinement";
import type { ProposalStatus } from "@/lib/schemas/proposal";

// Logika prezentacji panelu „Cykl poprawek” (krok 7g): czyste funkcje, bez Reacta i bez dostępu do bazy.

export const REFINEMENT_LABEL = "Poprawki AI";
export const REFINEMENT_NOTICE =
  "Agent zadaje kilka pytań na podstawie najnowszej oceny modelu, a z Twoich odpowiedzi przygotowuje paczkę propozycji zmian. To sugestie modelu językowego do rozważenia, a nie weryfikacja biznesowa: nic nie zmienia się samo, dopóki sam nie zastosujesz poprawek albo nie zaakceptujesz propozycji. Najwyżej 3 rundy na wariant.";
export const DIRTY_BLOCK_MESSAGE = "Najpierw zapisz albo cofnij swoje zmiany";
export const NEEDS_EVALUATION_MESSAGE = "Najpierw oceń model: runda poprawek zaczyna się od aktualnej oceny.";
export const ROUNDS_EXHAUSTED_MESSAGE = `Wykorzystano wszystkie ${MAX_REFINEMENT_ROUNDS} rundy poprawek tego wariantu. Dalsze zmiany wprowadzaj ręcznie.`;
export const ROUND_ACTIVE_MESSAGE = "Dokończ bieżącą rundę (odpowiedz na pytania albo rozstrzygnij propozycje) albo ją zamknij.";
export const NO_ANSWERS_MESSAGE = "Odpowiedz na co najmniej jedno pytanie.";
export const ANSWER_TOO_LONG_MESSAGE = `Odpowiedź może mieć najwyżej ${ANSWER_MAX_CHARS} znaków.`;
export const NO_PENDING_MESSAGE = "Wszystkie propozycje tej rundy są już rozstrzygnięte.";
export const REEVALUATE_MESSAGE = "Zastosowano poprawki: oceń model ponownie, żeby zobaczyć, czy się poprawił.";
export const SUGGESTION_NOTICE =
  "Podpowiedź tylko wstawia tekst: zapisze się jako Twoja odpowiedź, więc popraw ją, jeśli nie jest prawdziwa.";
export const EMPTY_BATCH_NOTE = "Na podstawie odpowiedzi nie ma czego zmienić.";

// Wspólny koszt rundy (punkt 17 planu): zużywa próbę także wtedy, gdy nie powstaną propozycje.
export const ROUND_COST_NOTICE = `Runda zużywa jedną z ${MAX_REFINEMENT_ROUNDS} prób, także gdy na podstawie odpowiedzi nie powstaną żadne propozycje.`;

export function roundLabel(roundNumber: number): string {
  return `Runda ${roundNumber} z ${MAX_REFINEMENT_ROUNDS}`;
}

/** Informacja przy „Rozpocznij rundę”: numer następnej rundy i koszt. */
export function startNotice(roundsUsed: number): string {
  return `To będzie runda ${roundsUsed + 1} z ${MAX_REFINEMENT_ROUNDS}. ${ROUND_COST_NOTICE}`;
}

/** Informacja przy „Przygotuj poprawki”. */
export function submitNotice(roundNumber: number): string {
  return `To jest runda ${roundNumber} z ${MAX_REFINEMENT_ROUNDS}. ${ROUND_COST_NOTICE}`;
}

export function cancelPrompt(roundNumber: number): string {
  return `Zamknąć rundę ${roundNumber}? Zamknięta runda liczy się do limitu ${MAX_REFINEMENT_ROUNDS} rund na wariant i nie można jej wznowić.`;
}

/**
 * Faza rundy do wyświetlenia. PROPOSED rozbijamy według propozycji: bez propozycji (pusta paczka), z oczekującymi albo
 * wszystkie rozstrzygnięte. Statusy propozycji pochodzą z bieżącego stanu przestrzeni roboczej.
 */
export type RoundPhase = "AWAITING_ANSWERS" | "EMPTY" | "PENDING" | "RESOLVED" | "CANCELLED";

export function roundPhase(status: RefinementStatus, proposalStatuses: readonly ProposalStatus[]): RoundPhase {
  if (status === "CANCELLED") {
    return "CANCELLED";
  }
  if (status === "AWAITING_ANSWERS") {
    return "AWAITING_ANSWERS";
  }
  if (proposalStatuses.length === 0) {
    return "EMPTY";
  }
  return proposalStatuses.includes("PENDING") ? "PENDING" : "RESOLVED";
}

export const PHASE_LABELS: Record<RoundPhase, string> = {
  AWAITING_ANSWERS: "Czeka na odpowiedzi",
  EMPTY: "Bez poprawek",
  PENDING: "Propozycje czekają na decyzję",
  RESOLVED: "Rozstrzygnięta",
  CANCELLED: "Zamknięta",
};

/** Runda wymaga uwagi użytkownika (blokuje start nowej): czeka na odpowiedzi albo ma oczekujące propozycje. */
export function isActivePhase(phase: RoundPhase): boolean {
  return phase === "AWAITING_ANSWERS" || phase === "PENDING";
}

export type Availability = { enabled: boolean; reason: string | null };

export type StartAvailability = Availability & { needsEvaluation: boolean };

/**
 * Czy można rozpocząć rundę. Kolejność przyczyn: limit rund, niedokończona runda, niezapisane zmiany, brak aktualnej oceny
 * (oceny nie uruchamiamy ukrytym wywołaniem: użytkownik używa „Oceń model”). Zamknięte rundy liczą się do limitu.
 */
export function startAvailability(input: {
  roundsUsed: number;
  hasActiveRound: boolean;
  dirty: boolean;
  version: number;
  latestEvaluationVersion: number | null;
}): StartAvailability {
  if (input.roundsUsed >= MAX_REFINEMENT_ROUNDS) {
    return { enabled: false, reason: ROUNDS_EXHAUSTED_MESSAGE, needsEvaluation: false };
  }
  if (input.hasActiveRound) {
    return { enabled: false, reason: ROUND_ACTIVE_MESSAGE, needsEvaluation: false };
  }
  if (input.dirty) {
    return { enabled: false, reason: DIRTY_BLOCK_MESSAGE, needsEvaluation: false };
  }
  if (input.latestEvaluationVersion === null || input.latestEvaluationVersion !== input.version) {
    return { enabled: false, reason: NEEDS_EVALUATION_MESSAGE, needsEvaluation: true };
  }
  return { enabled: true, reason: null, needsEvaluation: false };
}

/** Odpowiedzi z pól formularza: przycięte, jedna pozycja na pytanie (puste pole = pytanie pominięte). */
export function normalizeAnswers(drafts: readonly string[], questionCount: number): string[] {
  return Array.from({ length: questionCount }, (_, index) => (drafts[index] ?? "").trim());
}

export function submitAvailability(input: { dirty: boolean; drafts: readonly string[]; questionCount: number }): Availability {
  if (input.dirty) {
    return { enabled: false, reason: DIRTY_BLOCK_MESSAGE };
  }
  const answers = normalizeAnswers(input.drafts, input.questionCount);
  if (answers.some((answer) => answer.length > ANSWER_MAX_CHARS)) {
    return { enabled: false, reason: ANSWER_TOO_LONG_MESSAGE };
  }
  if (!answers.some((answer) => answer.length > 0)) {
    return { enabled: false, reason: NO_ANSWERS_MESSAGE };
  }
  return { enabled: true, reason: null };
}

export function applyAvailability(input: { dirty: boolean; pendingCount: number }): Availability {
  if (input.dirty) {
    return { enabled: false, reason: DIRTY_BLOCK_MESSAGE };
  }
  if (input.pendingCount === 0) {
    return { enabled: false, reason: NO_PENDING_MESSAGE };
  }
  return { enabled: true, reason: null };
}

/**
 * Baner „oceń model ponownie”: ostatnia runda ma przyjęte propozycje, a najnowsza ocena nie dotyczy bieżącej wersji
 * wariantu (po „Zastosuj poprawki” wersja rośnie). Bez automatycznego wywołania oceny.
 */
export function shouldShowReevaluateBanner(input: {
  latestRoundAcceptedCount: number;
  version: number;
  latestEvaluationVersion: number | null;
}): boolean {
  return input.latestRoundAcceptedCount > 0 && input.latestEvaluationVersion !== input.version;
}

export function describeAppliedCount(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = count === 1 ? "poprawkę" : lastTwo >= 12 && lastTwo <= 14 ? "poprawek" : last >= 2 && last <= 4 ? "poprawki" : "poprawek";
  return `Zastosowano ${count} ${noun}.`;
}

export function pluralProposals(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) {
    return "1 propozycja";
  }
  return `${count} ${lastTwo >= 12 && lastTwo <= 14 ? "propozycji" : last >= 2 && last <= 4 ? "propozycje" : "propozycji"}`;
}
