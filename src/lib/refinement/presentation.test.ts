import { describe, expect, it } from "vitest";
import {
  ANSWER_TOO_LONG_MESSAGE,
  DIRTY_BLOCK_MESSAGE,
  EMPTY_BATCH_NOTE,
  NEEDS_EVALUATION_MESSAGE,
  NO_ANSWERS_MESSAGE,
  NO_PENDING_MESSAGE,
  ROUNDS_EXHAUSTED_MESSAGE,
  ROUND_ACTIVE_MESSAGE,
  ROUND_COST_NOTICE,
  applyAvailability,
  cancelPrompt,
  describeAppliedCount,
  isActivePhase,
  normalizeAnswers,
  pluralProposals,
  roundLabel,
  roundPhase,
  shouldShowReevaluateBanner,
  startAvailability,
  startNotice,
  submitAvailability,
  submitNotice,
} from "@/lib/refinement/presentation";

describe("komunikaty o koszcie rundy (punkt 17: zużywa jedną z 3 prób także bez propozycji)", () => {
  it("start i „Przygotuj poprawki” pokazują numer rundy i koszt", () => {
    expect(startNotice(0)).toBe(`To będzie runda 1 z 3. ${ROUND_COST_NOTICE}`);
    expect(startNotice(2)).toContain("runda 3 z 3");
    expect(submitNotice(2)).toBe(`To jest runda 2 z 3. ${ROUND_COST_NOTICE}`);
    expect(ROUND_COST_NOTICE).toContain("zużywa jedną z 3 prób");
    expect(ROUND_COST_NOTICE).toContain("także gdy na podstawie odpowiedzi nie powstaną żadne propozycje");
  });

  it("etykieta rundy i potwierdzenie zamknięcia (limit 3, bez wznawiania)", () => {
    expect(roundLabel(2)).toBe("Runda 2 z 3");
    expect(cancelPrompt(2)).toBe("Zamknąć rundę 2? Zamknięta runda liczy się do limitu 3 rund na wariant i nie można jej wznowić.");
  });
});

describe("roundPhase", () => {
  it("zamknięta i czekająca na odpowiedzi nie zależą od propozycji", () => {
    expect(roundPhase("CANCELLED", ["PENDING"])).toBe("CANCELLED");
    expect(roundPhase("AWAITING_ANSWERS", [])).toBe("AWAITING_ANSWERS");
  });

  it("PROPOSED: bez propozycji to pusta paczka, z oczekującymi to PENDING, bez oczekujących to RESOLVED", () => {
    expect(roundPhase("PROPOSED", [])).toBe("EMPTY");
    expect(roundPhase("PROPOSED", ["ACCEPTED", "PENDING"])).toBe("PENDING");
    expect(roundPhase("PROPOSED", ["ACCEPTED", "REJECTED"])).toBe("RESOLVED");
  });

  it("aktywne fazy blokują start nowej rundy: czekająca na odpowiedzi i z oczekującymi propozycjami", () => {
    expect(isActivePhase("AWAITING_ANSWERS")).toBe(true);
    expect(isActivePhase("PENDING")).toBe(true);
    for (const phase of ["EMPTY", "RESOLVED", "CANCELLED"] as const) {
      expect(isActivePhase(phase)).toBe(false);
    }
  });
});

describe("startAvailability", () => {
  const ok = { roundsUsed: 0, hasActiveRound: false, dirty: false, version: 4, latestEvaluationVersion: 4 };

  it("można rozpocząć rundę przy aktualnej ocenie, bez niezapisanych zmian i bez aktywnej rundy", () => {
    expect(startAvailability(ok)).toEqual({ enabled: true, reason: null, needsEvaluation: false });
  });

  it("brak oceny albo ocena z innej wersji: najpierw oceń model (bez ukrytego wywołania)", () => {
    expect(startAvailability({ ...ok, latestEvaluationVersion: null })).toEqual({ enabled: false, reason: NEEDS_EVALUATION_MESSAGE, needsEvaluation: true });
    expect(startAvailability({ ...ok, latestEvaluationVersion: 3 })).toMatchObject({ enabled: false, needsEvaluation: true });
  });

  it("niezapisane zmiany blokują start z komunikatem jak w pozostałych panelach", () => {
    expect(startAvailability({ ...ok, dirty: true })).toEqual({ enabled: false, reason: DIRTY_BLOCK_MESSAGE, needsEvaluation: false });
    expect(DIRTY_BLOCK_MESSAGE).toBe("Najpierw zapisz albo cofnij swoje zmiany");
  });

  it("trzy wykorzystane rundy (także zamknięte) i aktywna runda blokują start", () => {
    expect(startAvailability({ ...ok, roundsUsed: 3 })).toMatchObject({ enabled: false, reason: ROUNDS_EXHAUSTED_MESSAGE });
    expect(startAvailability({ ...ok, hasActiveRound: true })).toMatchObject({ enabled: false, reason: ROUND_ACTIVE_MESSAGE });
  });

  it("kolejność przyczyn: limit, aktywna runda, niezapisane zmiany, ocena", () => {
    const all = { roundsUsed: 3, hasActiveRound: true, dirty: true, version: 4, latestEvaluationVersion: null };

    expect(startAvailability(all).reason).toBe(ROUNDS_EXHAUSTED_MESSAGE);
    expect(startAvailability({ ...all, roundsUsed: 1 }).reason).toBe(ROUND_ACTIVE_MESSAGE);
    expect(startAvailability({ ...all, roundsUsed: 1, hasActiveRound: false }).reason).toBe(DIRTY_BLOCK_MESSAGE);
    expect(startAvailability({ ...all, roundsUsed: 1, hasActiveRound: false, dirty: false }).reason).toBe(NEEDS_EVALUATION_MESSAGE);
  });
});

describe("odpowiedzi i „Przygotuj poprawki”", () => {
  it("normalizeAnswers przycina i uzupełnia do liczby pytań (puste pole = pominięte)", () => {
    expect(normalizeAnswers(["  Firmy  ", ""], 3)).toEqual(["Firmy", "", ""]);
    expect(normalizeAnswers([], 2)).toEqual(["", ""]);
  });

  it("wymaga co najmniej jednej niepustej odpowiedzi (białe znaki się nie liczą)", () => {
    expect(submitAvailability({ dirty: false, drafts: ["", "   "], questionCount: 3 })).toEqual({ enabled: false, reason: NO_ANSWERS_MESSAGE });
    expect(submitAvailability({ dirty: false, drafts: ["", "Tak"], questionCount: 3 })).toEqual({ enabled: true, reason: null });
  });

  it("odpowiedź ponad 1000 znaków po przycięciu blokuje wysłanie", () => {
    expect(submitAvailability({ dirty: false, drafts: ["a".repeat(1001)], questionCount: 1 })).toEqual({ enabled: false, reason: ANSWER_TOO_LONG_MESSAGE });
    expect(submitAvailability({ dirty: false, drafts: [`  ${"a".repeat(1000)}  `], questionCount: 1 }).enabled).toBe(true);
  });

  it("niezapisane zmiany blokują wysłanie przed innymi przyczynami", () => {
    expect(submitAvailability({ dirty: true, drafts: [""], questionCount: 1 }).reason).toBe(DIRTY_BLOCK_MESSAGE);
  });
});

describe("applyAvailability i baner", () => {
  it("„Zastosuj poprawki” wymaga oczekujących propozycji i zapisanego modelu", () => {
    expect(applyAvailability({ dirty: false, pendingCount: 2 })).toEqual({ enabled: true, reason: null });
    expect(applyAvailability({ dirty: false, pendingCount: 0 })).toEqual({ enabled: false, reason: NO_PENDING_MESSAGE });
    expect(applyAvailability({ dirty: true, pendingCount: 2 }).reason).toBe(DIRTY_BLOCK_MESSAGE);
  });

  it("baner „oceń ponownie”: ostatnia runda ma przyjęte propozycje, a ocena nie dotyczy bieżącej wersji", () => {
    expect(shouldShowReevaluateBanner({ latestRoundAcceptedCount: 2, version: 5, latestEvaluationVersion: 4 })).toBe(true);
    expect(shouldShowReevaluateBanner({ latestRoundAcceptedCount: 2, version: 5, latestEvaluationVersion: null })).toBe(true);
    // Ocena „po” wykonana: baner znika. Brak przyjętych (np. pusta paczka): baner nie jest potrzebny.
    expect(shouldShowReevaluateBanner({ latestRoundAcceptedCount: 2, version: 5, latestEvaluationVersion: 5 })).toBe(false);
    expect(shouldShowReevaluateBanner({ latestRoundAcceptedCount: 0, version: 5, latestEvaluationVersion: 4 })).toBe(false);
  });
});

describe("odmiana", () => {
  it.each([
    [1, "Zastosowano 1 poprawkę."],
    [2, "Zastosowano 2 poprawki."],
    [5, "Zastosowano 5 poprawek."],
    [12, "Zastosowano 12 poprawek."],
    [22, "Zastosowano 22 poprawki."],
  ])("describeAppliedCount(%i)", (count, expected) => {
    expect(describeAppliedCount(count)).toBe(expected);
  });

  it.each([
    [1, "1 propozycja"],
    [3, "3 propozycje"],
    [8, "8 propozycji"],
  ])("pluralProposals(%i)", (count, expected) => {
    expect(pluralProposals(count)).toBe(expected);
  });

  it("komunikat o pustej paczce", () => {
    expect(EMPTY_BATCH_NOTE).toBe("Na podstawie odpowiedzi nie ma czego zmienić.");
  });
});
