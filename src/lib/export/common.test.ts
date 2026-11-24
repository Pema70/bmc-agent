import { describe, expect, it } from "vitest";
import { AI_NOTICE, formatExportDateTime, staleNote, toEvaluationExport } from "@/lib/export/common";
import { evaluationView } from "@/lib/export/test-fixtures";

describe("toEvaluationExport", () => {
  it("ocena AI: etykieta źródła z modelem i dostawcą, wersja promptu, cztery kryteria w stałej kolejności", () => {
    const result = toEvaluationExport(evaluationView(), 3);

    expect(result).toMatchObject({ isAi: true, sourceText: "Ocena AI: google / gemini-3.5-flash-lite", promptVersion: "evaluate-v1", stale: false, evaluatedVersion: 3 });
    expect(result.rows.map((row) => row.criterion)).toEqual(["coherence", "risk_resilience", "feasibility", "innovation"]);
    expect(result.rows[1]).toMatchObject({ label: "Ryzyko (10 = niskie)", score: 4 });
  });

  it("ocena ręczna: bez modelu i promptu, nie jest AI", () => {
    const result = toEvaluationExport(evaluationView({ source: "MANUAL", provider: null, model: null, promptVersion: null, trigger: null }), 3);

    expect(result).toMatchObject({ isAi: false, sourceText: "Ocena ręczna", promptVersion: null });
  });

  it("uzasadnienia i nazwa modelu przechodzą przez oczyszczanie zwykłego tekstu", () => {
    const view = evaluationView({ model: "gem\u0000ini‮" });
    view.result.coherence.justification = "A\u0007B‮c";

    const result = toEvaluationExport(view, 3);

    expect(result.sourceText).toBe("Ocena AI: google / gemini");
    expect(result.rows[0].justification).toBe("ABc");
  });

  it("ocena starsza niż bieżąca wersja jest oznaczona i ma komunikat; aktualna nie ma", () => {
    const stale = toEvaluationExport(evaluationView({ variantVersion: 1 }), 4);

    expect(stale.stale).toBe(true);
    expect(staleNote(stale, 4)).toContain("wersji 1");
    expect(staleNote(toEvaluationExport(evaluationView(), 3), 3)).toBeNull();
  });
});

describe("stałe teksty i daty", () => {
  it("oznaczenie AI mówi, że to opinia modelu, a nie weryfikacja biznesowa", () => {
    expect(AI_NOTICE).toContain("opinia modelu językowego");
    expect(AI_NOTICE).toContain("nie weryfikacja biznesowa");
  });

  it("data w strefie Europe/Warsaw", () => {
    expect(formatExportDateTime(new Date("2026-07-01T10:30:00Z"))).toContain("12:30");
    expect(formatExportDateTime(new Date("2026-12-01T10:30:00Z"))).toContain("11:30");
  });
});
