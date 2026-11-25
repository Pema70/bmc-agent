import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Łańcuch importów edytora sięga klienta Prismy; w teście komponentów jest zastąpiony pustym obiektem.
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/app/projekty/[id]/evaluation-actions", () => ({
  evaluateModelAction: vi.fn(),
  createManualEvaluationAction: vi.fn(),
}));

import { EvaluationPanel } from "@/components/evaluation/evaluation-panel";
import { ManualEvaluationForm } from "@/components/evaluation/manual-evaluation-form";
import { RadarChart, type RadarSeries } from "@/components/evaluation/radar-chart";
import type { EvaluationListItem } from "@/lib/db/evaluations";
import { CRITERION_RUBRIC } from "@/lib/evaluation/rubric";
import { CRITERION_LABELS, EVALUATION_CRITERIA, type EvaluationOutput, type EvaluationView } from "@/lib/schemas/evaluation";

function result(score: number): EvaluationOutput {
  const entry = { score, justification: "Uzasadnienie." };
  return { coherence: entry, risk_resilience: entry, feasibility: entry, innovation: entry };
}

function view(overrides: Partial<EvaluationView> = {}): EvaluationView {
  return {
    id: "e1",
    createdAt: new Date("2026-11-20T10:00:00Z"),
    schemaVersion: 1,
    variantVersion: 2,
    source: "AI",
    trigger: "UI",
    provider: "google",
    model: "gemini-3.5-flash-lite",
    promptVersion: "evaluate-v1",
    result: result(7),
    ...overrides,
  };
}

const series = (n: number): RadarSeries[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, legend: `Seria ${i + 1}`, result: result(3 + i * 2) }));

describe("RadarChart", () => {
  it("rysuje trzy serie o różnych stylach: ciągła z kółkami, przerywana z rombami, kropkowana z kwadratami", () => {
    const markup = renderToStaticMarkup(<RadarChart series={series(3)} />);

    expect(markup).toContain("text-primary-from");
    expect(markup).toContain("text-accent-from");
    expect(markup).toContain("text-low-fg");
    expect(markup).toContain('stroke-dasharray="6 4"');
    expect(markup).toContain('stroke-dasharray="2 4"');
    expect(markup).toContain("<circle");
    expect(markup).toContain("<rect");
    // Każda seria ma wpis w legendzie tekstowej i w aria-label.
    for (const label of ["Seria 1", "Seria 2", "Seria 3"]) {
      expect(markup.split(label).length - 1, label).toBeGreaterThanOrEqual(2);
    }
  });

  it("dwie serie nie rysują trzeciego stylu, a czwarta seria jest pomijana", () => {
    expect(renderToStaticMarkup(<RadarChart series={series(2)} />)).not.toContain("text-low-fg");
    const four = renderToStaticMarkup(<RadarChart series={series(4)} />);
    expect(four).not.toContain("Seria 4");
  });

  it("legenda jest zwykłym tekstem (znaczniki zamienione na encje)", () => {
    const markup = renderToStaticMarkup(
      <RadarChart series={[{ id: "x", legend: "<b>x</b>", result: result(5) }]} />,
    );
    expect(markup).not.toContain("<b>");
    expect(markup).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("ManualEvaluationForm", () => {
  const markup = renderToStaticMarkup(
    <ManualEvaluationForm projectId="p1" variantId="v1" onSaved={() => undefined} onCancel={() => undefined} />,
  );

  it("ma pole oceny 1-10 i uzasadnienie (max 600 znaków) dla każdego z czterech kryteriów", () => {
    for (const criterion of EVALUATION_CRITERIA) {
      expect(markup).toContain(CRITERION_LABELS[criterion]);
      expect(markup).toContain(`id="manual-score-${criterion}"`);
      expect(markup).toContain(`id="manual-justification-${criterion}"`);
    }
    expect(markup.match(/maxLength="600"/g)).toHaveLength(4);
    expect(markup.match(/min="1" max="10"|max="10"[^>]*min="1"|min="1"[^>]*max="10"/g)).toHaveLength(4);
  });

  it("pokazuje rubrykę przy polach, w tym orientację ryzyka (10 = niskie)", () => {
    expect(markup).toContain(CRITERION_RUBRIC.coherence.low);
    expect(markup).toContain(CRITERION_RUBRIC.innovation.high);
    expect(markup).toContain("10 oznacza ryzyko NISKIE.");
  });

  it("nie pokazuje żadnych wyników ocen AI ani sędziego (ślepa próba)", () => {
    expect(markup).not.toContain("Ocena AI");
    expect(markup).not.toContain("sędzia");
    expect(markup).not.toContain("<svg");
  });
});

describe("EvaluationPanel", () => {
  const items: EvaluationListItem[] = [{ ok: true, evaluation: view() }];
  const render = (canEvaluate: boolean, initialItems = items) =>
    renderToStaticMarkup(
      <EvaluationPanel
        projectId="p1"
        variantId="v1"
        canEvaluate={canEvaluate}
        currentVersion={2}
        initialItems={initialItems}
      />,
    );

  it("EDITOR widzi przycisk oceny ręcznej, a formularz jest domyślnie zamknięty (wyniki widoczne)", () => {
    const markup = render(true);

    expect(markup).toContain("Dodaj ocenę ręczną");
    expect(markup).toContain("Oceń model");
    expect(markup).not.toContain("manual-evaluation-heading");
    expect(markup).toContain("Historia ocen");
  });

  it("VIEWER nie widzi przycisków oceniania ani formularza", () => {
    const markup = render(false);

    expect(markup).not.toContain("Dodaj ocenę ręczną");
    expect(markup).not.toContain("Oceń model");
  });

  it("ocena ręczna: oznaczenie „Ocena ręczna” zamiast AI i brak wiersza z promptem", () => {
    const manual = view({ id: "m1", source: "MANUAL", trigger: null, provider: null, model: null, promptVersion: null });
    const markup = render(false, [{ ok: true, evaluation: manual }]);

    expect(markup).toContain("Ocena ręczna");
    expect(markup).not.toContain("prompt:");
    expect(markup).not.toContain("border-ai-border");
  });

  it("oceny AI mają oznaczenie AI w kolorze AI i wiersz z promptem", () => {
    const markup = render(false);

    expect(markup).toContain("border-ai-border");
    expect(markup).toContain("prompt: evaluate-v1");
  });
});
