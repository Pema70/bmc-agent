import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantProjectId: vi.fn(),
  runGenerateQuestions: vi.fn(),
  runRefineFromAnswers: vi.fn(),
  acceptRoundBatch: vi.fn(),
  cancelRound: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole: mocks.requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({ getVariantProjectId: mocks.getVariantProjectId }));
vi.mock("@/lib/ai/generate-questions", () => ({ runGenerateQuestions: mocks.runGenerateQuestions }));
vi.mock("@/lib/ai/refine-from-answers", () => ({ runRefineFromAnswers: mocks.runRefineFromAnswers }));
vi.mock("@/lib/db/proposals", () => ({ acceptRoundBatch: mocks.acceptRoundBatch }));
vi.mock("@/lib/db/refinement", () => ({ cancelRound: mocks.cancelRound }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  applyRoundAction,
  cancelRoundAction,
  startRefinementRoundAction,
  submitAnswersAction,
} from "@/app/projekty/[id]/refinement-actions";
import { emptyBmcState } from "@/lib/schemas/bmc";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const editorAccess = { ok: true, session, projectId: "p1", role: "EDITOR" };
const viewerAccess = { ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProjectRole.mockResolvedValue(editorAccess);
  mocks.getVariantProjectId.mockResolvedValue("p1");
  // Domyślne wyniki operacji (testy szczegółowe nadpisują je własnymi).
  mocks.runGenerateQuestions.mockResolvedValue({ ok: false, error: "NOT_FOUND", message: "x" });
  mocks.runRefineFromAnswers.mockResolvedValue({ ok: false, error: "NOT_FOUND", message: "x" });
  mocks.acceptRoundBatch.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
  mocks.cancelRound.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
});

// Wspólne dla wszystkich czterech akcji: kolejność sprawdzeń sesja → rola → wariant → Zod → operacja.
const actions: Array<[string, () => Promise<unknown>, () => void]> = [
  ["startRefinementRoundAction", () => startRefinementRoundAction("p1", "v1", 3), () => expect(mocks.runGenerateQuestions).not.toHaveBeenCalled()],
  [
    "submitAnswersAction",
    () => submitAnswersAction("p1", "v1", { roundId: "r1", expectedVersion: 3, answers: ["Tak"] }),
    () => expect(mocks.runRefineFromAnswers).not.toHaveBeenCalled(),
  ],
  ["applyRoundAction", () => applyRoundAction("p1", "v1", "r1", 3), () => expect(mocks.acceptRoundBatch).not.toHaveBeenCalled()],
  ["cancelRoundAction", () => cancelRoundAction("p1", "v1", "r1"), () => expect(mocks.cancelRound).not.toHaveBeenCalled()],
];

describe.each(actions)("%s: uprawnienia i kolejność sprawdzeń", (_name, run, expectNoOperation) => {
  it("wymaga roli EDITOR", async () => {
    await run();

    expect(mocks.requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
  });

  it("VIEWER dostaje FORBIDDEN bez odczytu wariantu i bez operacji", async () => {
    mocks.requireProjectRole.mockResolvedValue(viewerAccess);

    expect(await run()).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expectNoOperation();
  });

  it("brak sesji lub obcy projekt: przerwanie z requireProjectRole, nic dalej nie jest wołane", async () => {
    mocks.requireProjectRole.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(run()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.getVariantProjectId).not.toHaveBeenCalled();
    expectNoOperation();
  });

  it("wariant z innego projektu lub nieistniejący: NOT_FOUND bez operacji", async () => {
    mocks.getVariantProjectId.mockResolvedValue("p-inny");

    expect(await run()).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expectNoOperation();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("startRefinementRoundAction", () => {
  it("przekazuje projekt z uprawnień, wariant i zapisaną wersję, po sukcesie odświeża stronę", async () => {
    const round = { id: "r1", roundNumber: 1 };
    mocks.runGenerateQuestions.mockResolvedValue({ ok: true, round });

    expect(await startRefinementRoundAction("p1", "v1", 3)).toEqual({ ok: true, round });
    expect(mocks.runGenerateQuestions).toHaveBeenCalledWith({ projectId: "p1", variantId: "v1", userId: "u1", expectedVersion: 3 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("nieprawidłowa wersja: VALIDATION bez operacji; błąd operacji (np. STALE_EVALUATION) przechodzi bez odświeżania", async () => {
    expect(await startRefinementRoundAction("p1", "v1", 0)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(mocks.runGenerateQuestions).not.toHaveBeenCalled();

    mocks.runGenerateQuestions.mockResolvedValue({ ok: false, error: "STALE_EVALUATION", message: "Najpierw oceń model." });
    expect(await startRefinementRoundAction("p1", "v1", 3)).toEqual({ ok: false, error: "STALE_EVALUATION", message: "Najpierw oceń model." });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("submitAnswersAction", () => {
  it("waliduje wejście Zod (strictObject: obce pole projectId odrzucone, puste odpowiedzi odrzucone) przed operacją", async () => {
    expect(await submitAnswersAction("p1", "v1", { roundId: "r1", expectedVersion: 3, answers: ["Tak"], projectId: "p-obcy" })).toMatchObject({
      ok: false,
      error: "VALIDATION",
    });
    expect(await submitAnswersAction("p1", "v1", { roundId: "r1", expectedVersion: 3, answers: ["", " "] })).toMatchObject({
      ok: false,
      error: "VALIDATION",
    });
    expect(mocks.runRefineFromAnswers).not.toHaveBeenCalled();
  });

  it("przekazuje przycięte odpowiedzi i projekt z uprawnień; po sukcesie odświeża stronę", async () => {
    mocks.runRefineFromAnswers.mockResolvedValue({ ok: true, roundId: "r1", proposalIds: ["pr1"] });

    const result = await submitAnswersAction("p1", "v1", { roundId: "r1", expectedVersion: 3, answers: ["  Tak  ", ""] });

    expect(result).toEqual({ ok: true, roundId: "r1", proposalIds: ["pr1"] });
    expect(mocks.runRefineFromAnswers).toHaveBeenCalledWith({
      projectId: "p1",
      variantId: "v1",
      userId: "u1",
      roundId: "r1",
      expectedVersion: 3,
      answers: ["Tak", ""],
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("pusta paczka: ok z komunikatem „Na podstawie odpowiedzi nie ma czego zmienić.” i odświeżeniem strony", async () => {
    mocks.runRefineFromAnswers.mockResolvedValue({ ok: true, roundId: "r1", proposalIds: [] });

    expect(await submitAnswersAction("p1", "v1", { roundId: "r1", expectedVersion: 3, answers: ["nie wiem"] })).toEqual({
      ok: true,
      roundId: "r1",
      proposalIds: [],
      message: "Na podstawie odpowiedzi nie ma czego zmienić.",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("niepusta paczka nie ma komunikatu o braku zmian", async () => {
    mocks.runRefineFromAnswers.mockResolvedValue({ ok: true, roundId: "r1", proposalIds: ["pr1"] });

    const result = await submitAnswersAction("p1", "v1", { roundId: "r1", expectedVersion: 3, answers: ["Tak"] });

    expect(result).toEqual({ ok: true, roundId: "r1", proposalIds: ["pr1"] });
  });

  it("błąd operacji (np. limit użytkownika z retryAfterSec) przechodzi bez zmian", async () => {
    mocks.runRefineFromAnswers.mockResolvedValue({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 90 });

    expect(await submitAnswersAction("p1", "v1", { roundId: "r1", expectedVersion: 3, answers: ["Tak"] })).toEqual({
      ok: false,
      error: "LIMIT",
      message: "Limit.",
      retryAfterSec: 90,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("applyRoundAction", () => {
  it("sukces: wersja, stan i liczba zastosowanych; odświeża stronę", async () => {
    const state = emptyBmcState();
    mocks.acceptRoundBatch.mockResolvedValue({ ok: true, state, version: 4, acceptedCount: 3 });

    expect(await applyRoundAction("p1", "v1", "r1", 3)).toEqual({ ok: true, version: 4, state, acceptedCount: 3 });
    expect(mocks.acceptRoundBatch).toHaveBeenCalledWith({ projectId: "p1", variantId: "v1", roundId: "r1", expectedVersion: 3, userId: "u1" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("STALE w paczce: żadna zmiana, komunikat z liczbą i lista propozycji z powodami", async () => {
    mocks.acceptRoundBatch.mockResolvedValue({
      ok: false,
      error: "CONFLICTS",
      failures: [
        { proposalId: "pr2", error: "STALE" },
        { proposalId: "pr5", error: "DUPLICATE" },
      ],
    });

    const result = await applyRoundAction("p1", "v1", "r1", 3);

    expect(result).toMatchObject({ ok: false, error: "CONFLICTS", message: expect.stringContaining("2 z propozycji") });
    expect(result).toMatchObject({
      failures: [
        { proposalId: "pr2", error: "STALE", message: expect.stringContaining("zmienił się") },
        { proposalId: "pr5", error: "DUPLICATE", message: expect.stringContaining("już istnieje") },
      ],
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", "NOT_FOUND"],
    ["NOTHING_PENDING", "NOTHING_PENDING"],
    ["ALREADY_RESOLVED", "ALREADY_RESOLVED"],
    ["VERSION_CONFLICT", "VERSION_CONFLICT"],
  ])("błąd bazy %s jest przekazany jako %s z polskim komunikatem", async (dbError, expected) => {
    mocks.acceptRoundBatch.mockResolvedValue({ ok: false, error: dbError });

    expect(await applyRoundAction("p1", "v1", "r1", 3)).toMatchObject({ ok: false, error: expected, message: expect.any(String) });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("nieprawidłowe dane (pusty identyfikator rundy, wersja 0): VALIDATION bez operacji", async () => {
    expect(await applyRoundAction("p1", "v1", " ", 3)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(await applyRoundAction("p1", "v1", "r1", 0)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(mocks.acceptRoundBatch).not.toHaveBeenCalled();
  });
});

describe("cancelRoundAction", () => {
  it("zamyka rundę (projekt z uprawnień) i zwraca komunikat o wykorzystanych rundach", async () => {
    mocks.cancelRound.mockResolvedValue({ ok: true, roundNumber: 2 });

    expect(await cancelRoundAction("p1", "v1", "r1")).toEqual({
      ok: true,
      roundNumber: 2,
      message: "Runda 2 zamknięta. Wykorzystano 2 z 3 rund.",
    });
    expect(mocks.cancelRound).toHaveBeenCalledWith({ projectId: "p1", variantId: "v1", roundId: "r1" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("już zamknięta i cudza runda dają osobne błędy bez odświeżania", async () => {
    mocks.cancelRound.mockResolvedValue({ ok: false, error: "ALREADY_CANCELLED" });
    expect(await cancelRoundAction("p1", "v1", "r1")).toMatchObject({ ok: false, error: "ALREADY_CANCELLED" });

    mocks.cancelRound.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
    expect(await cancelRoundAction("p1", "v1", "r-obca")).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("nieprawidłowy identyfikator rundy: VALIDATION bez operacji", async () => {
    expect(await cancelRoundAction("p1", "v1", " ")).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(mocks.cancelRound).not.toHaveBeenCalled();
  });
});
