import { describe, expect, it } from "vitest";
import type { EvaluationListItem } from "@/lib/db/evaluations";
import type { RefinementRoundListItem } from "@/lib/db/refinement";
import { pairRoundEvaluations, type RoundProposalStatus } from "@/lib/report/round-evaluations";

const at = (iso: string) => new Date(iso);

function evaluation(id: string, createdAt: string): EvaluationListItem {
  const criterion = { score: 5, justification: "x" };
  return {
    ok: true,
    evaluation: {
      id,
      createdAt: at(createdAt),
      schemaVersion: 1,
      variantVersion: 1,
      source: "AI",
      trigger: "UI",
      provider: "google",
      model: "m",
      promptVersion: "evaluate-v1",
      result: { coherence: criterion, risk_resilience: criterion, feasibility: criterion, innovation: criterion },
    },
  };
}

function round(id: string, roundNumber: number, evaluationId: string): RefinementRoundListItem {
  return {
    ok: true,
    round: {
      id,
      roundNumber,
      status: "PROPOSED",
      evaluationId,
      variantVersion: 1,
      questions: [],
      answers: ["Tak"],
      createdAt: at("2026-11-20T09:00:00Z"),
    },
  };
}

const resolved = (roundId: string, resolvedAt: string, status: "ACCEPTED" | "REJECTED" = "ACCEPTED"): RoundProposalStatus => ({
  refinementRoundId: roundId,
  status,
  resolvedAt: at(resolvedAt),
});

const evaluations = [evaluation("e3", "2026-11-22T10:00:00Z"), evaluation("e2", "2026-11-21T10:00:00Z"), evaluation("e1", "2026-11-20T08:00:00Z")];

describe("pairRoundEvaluations", () => {
  it("„przed” to ocena rundy, „po” to pierwsza ocena po ostatnim rozstrzygnięciu propozycji rundy", () => {
    const [pair] = pairRoundEvaluations(
      [round("r1", 1, "e1")],
      evaluations,
      [resolved("r1", "2026-11-20T12:00:00Z"), resolved("r1", "2026-11-20T13:00:00Z", "REJECTED")],
    );

    expect(pair).toMatchObject({ ok: true, afterStatus: "FOUND" });
    expect(pair.ok && pair.before?.id).toBe("e1");
    expect(pair.ok && pair.after?.id).toBe("e2");
  });

  it("brak oceny po rundzie to jawny stan NONE, a ocena sprzed rozstrzygnięcia nie liczy się jako „po”", () => {
    const [pair] = pairRoundEvaluations([round("r1", 1, "e1")], evaluations, [resolved("r1", "2026-11-23T10:00:00Z")]);

    expect(pair).toMatchObject({ ok: true, after: null, afterStatus: "NONE" });
    expect(pair.ok && pair.before?.id).toBe("e1");
  });

  it("nierozstrzygnięta propozycja rundy: UNRESOLVED, bez oceny „po”", () => {
    const [pair] = pairRoundEvaluations(
      [round("r1", 1, "e1")],
      evaluations,
      [resolved("r1", "2026-11-20T12:00:00Z"), { refinementRoundId: "r1", status: "PENDING", resolvedAt: null }],
    );

    expect(pair).toMatchObject({ ok: true, after: null, afterStatus: "UNRESOLVED" });
  });

  it("runda bez propozycji: NO_PROPOSALS; propozycje innych rund nie mieszają się", () => {
    const [pair] = pairRoundEvaluations([round("r1", 1, "e1")], evaluations, [resolved("r2", "2026-11-20T12:00:00Z"), resolved(null as never, "2026-11-20T12:00:00Z")]);

    expect(pair).toMatchObject({ ok: true, after: null, afterStatus: "NO_PROPOSALS" });
  });

  it("wiele rund: każda ma własną parę, druga runda zaczyna od oceny „po” pierwszej", () => {
    const pairs = pairRoundEvaluations(
      [round("r1", 1, "e1"), round("r2", 2, "e2")],
      evaluations,
      [resolved("r1", "2026-11-20T12:00:00Z"), resolved("r2", "2026-11-21T12:00:00Z")],
    );

    expect(pairs.map((pair) => (pair.ok ? [pair.before?.id, pair.after?.id] : null))).toEqual([
      ["e1", "e2"],
      ["e2", "e3"],
    ]);
  });

  it("ocena „przed” usunięta lub uszkodzona: before = null, reszta działa; uszkodzone oceny są pomijane", () => {
    const withBroken: EvaluationListItem[] = [{ ok: false, id: "e1", error: "x" }, evaluations[0]];

    const [pair] = pairRoundEvaluations([round("r1", 1, "e1")], withBroken, [resolved("r1", "2026-11-20T12:00:00Z")]);

    expect(pair).toMatchObject({ ok: true, before: null, afterStatus: "FOUND" });
    expect(pair.ok && pair.after?.id).toBe("e3");
  });

  it("uszkodzona runda jest przekazana jako błąd, bez wyjątku", () => {
    const pairs = pairRoundEvaluations([{ ok: false, id: "r9", roundNumber: 3, error: "CORRUPT" }], evaluations, []);

    expect(pairs).toEqual([{ ok: false, roundNumber: 3, error: "CORRUPT" }]);
  });

  it("brak rund: pusta lista", () => {
    expect(pairRoundEvaluations([], evaluations, [])).toEqual([]);
  });
});
