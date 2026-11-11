import { describe, expect, it } from "vitest";
import type { EvaluationListItem } from "@/lib/db/evaluations";
import {
  comparableEvaluations,
  radarAxes,
  radarPoints,
  radarRing,
  splitLabel,
  toPolygonPoints,
  type RadarGeometry,
} from "@/lib/evaluation/radar";
import { EVALUATION_CRITERIA, type EvaluationOutput, type EvaluationView } from "@/lib/schemas/evaluation";

const g: RadarGeometry = { cx: 200, cy: 160, radius: 100, labelOffset: 14 };

function scores(values: [number, number, number, number]): EvaluationOutput {
  const [coherence, risk_resilience, feasibility, innovation] = values;
  const entry = (score: number) => ({ score, justification: "x" });
  return {
    coherence: entry(coherence),
    risk_resilience: entry(risk_resilience),
    feasibility: entry(feasibility),
    innovation: entry(innovation),
  };
}

function allFinite(points: { x: number; y: number }[]) {
  return points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && !Object.is(p.x, -0) && !Object.is(p.y, -0));
}

describe("radarAxes", () => {
  it("ma osie dla czterech kryteriów w kolejności EVALUATION_CRITERIA", () => {
    const axes = radarAxes(g);

    expect(axes.map((axis) => axis.criterion)).toEqual([...EVALUATION_CRITERIA]);
    expect(axes).toHaveLength(4);
  });

  it("pierwsza oś jest u góry, dalej zgodnie z ruchem wskazówek zegara", () => {
    const [top, right, bottom, left] = radarAxes(g);

    expect(top.end).toEqual({ x: 200, y: 60 });
    expect(right.end).toEqual({ x: 300, y: 160 });
    expect(bottom.end).toEqual({ x: 200, y: 260 });
    expect(left.end).toEqual({ x: 100, y: 160 });
  });

  it("etykiety leżą poza końcem osi, a zakotwiczenie nie wypycha ich na wykres", () => {
    const [top, right, bottom, left] = radarAxes(g);

    expect(top.label).toEqual({ x: 200, y: 46 });
    expect(top.anchor).toBe("middle");
    expect(bottom.anchor).toBe("middle");
    expect(right.label.x).toBe(314);
    expect(right.anchor).toBe("start");
    expect(left.label.x).toBe(86);
    expect(left.anchor).toBe("end");
  });
});

describe("radarPoints", () => {
  it("wartość 10 leży na końcu osi, a 1 przy dziesiątej części promienia", () => {
    const max = radarPoints(scores([10, 10, 10, 10]), g);
    const min = radarPoints(scores([1, 1, 1, 1]), g);

    expect(max).toEqual(radarAxes(g).map((axis) => axis.end));
    expect(min).toEqual([
      { x: 200, y: 150 },
      { x: 210, y: 160 },
      { x: 200, y: 170 },
      { x: 190, y: 160 },
    ]);
  });

  it("zachowuje kolejność kryteriów niezależnie od kolejności kluczy w obiekcie", () => {
    const reordered = {
      innovation: { score: 4, justification: "x" },
      feasibility: { score: 6, justification: "x" },
      risk_resilience: { score: 8, justification: "x" },
      coherence: { score: 10, justification: "x" },
    };

    expect(radarPoints(reordered, g)).toEqual(radarPoints(scores([10, 8, 6, 4]), g));
    expect(radarPoints(scores([10, 8, 6, 4]), g)[0]).toEqual({ x: 200, y: 60 });
    expect(radarPoints(scores([10, 8, 6, 4]), g)[1]).toEqual({ x: 280, y: 160 });
  });

  it("nie zwraca NaN ani -0 dla wartości skrajnych, obciętych i błędnych", () => {
    const weird = [0, 11, -5, 5.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const value of weird) {
      expect(allFinite(radarPoints(scores([value, value, value, value]), g))).toBe(true);
    }
    expect(allFinite(radarPoints(scores([1, 10, 1, 10]), { cx: 0, cy: 0, radius: 100, labelOffset: 0 }))).toBe(true);
  });

  it("obcina wartości spoza 1-10 i traktuje NaN jak środek wykresu", () => {
    expect(radarPoints(scores([11, 11, 11, 11]), g)).toEqual(radarPoints(scores([10, 10, 10, 10]), g));
    expect(radarPoints(scores([0, 0, 0, 0]), g)).toEqual(radarPoints(scores([1, 1, 1, 1]), g));
    expect(radarPoints(scores([Number.NaN, 10, 10, 10]), g)[0]).toEqual({ x: 200, y: 160 });
  });
});

describe("radarRing i toPolygonPoints", () => {
  it("poziom 10 pokrywa się z końcami osi, a każdy okrąg ma cztery wierzchołki", () => {
    expect(radarRing(10, g)).toEqual(radarAxes(g).map((axis) => axis.end));
    expect(radarRing(4, g)).toHaveLength(4);
    expect(allFinite(radarRing(2, g))).toBe(true);
  });

  it("buduje atrybut points", () => {
    expect(toPolygonPoints([{ x: 1, y: 2 }, { x: 3.5, y: 4 }])).toBe("1,2 3.5,4");
  });
});

describe("splitLabel", () => {
  it("dzieli etykietę z dopiskiem w nawiasie na dwa wiersze", () => {
    expect(splitLabel("Ryzyko (10 = niskie)")).toEqual(["Ryzyko", "(10 = niskie)"]);
    expect(splitLabel("Spójność")).toEqual(["Spójność"]);
  });
});

function view(id: string, schemaVersion = 1): EvaluationView {
  return {
    id,
    createdAt: new Date("2026-11-11T10:00:00Z"),
    schemaVersion,
    variantVersion: 1,
    source: "AI",
    trigger: "UI",
    provider: "google",
    model: "m",
    promptVersion: "evaluate-v1",
    result: scores([5, 5, 5, 5]),
  };
}

describe("comparableEvaluations", () => {
  const items: EvaluationListItem[] = [
    { ok: true, evaluation: view("a") },
    { ok: false, id: "uszkodzona", error: "Zapisana ocena jest niezgodna ze schematem." },
    { ok: true, evaluation: view("stara", 0) },
    { ok: true, evaluation: view("b") },
  ];

  it("pomija wybraną, uszkodzone i z innym schemaVersion", () => {
    expect(comparableEvaluations(items, "a").map((e) => e.id)).toEqual(["b"]);
  });

  it("bez poprawnie wybranej oceny nie ma nic do porównania", () => {
    expect(comparableEvaluations(items, null)).toEqual([]);
    expect(comparableEvaluations(items, "uszkodzona")).toEqual([]);
    expect(comparableEvaluations(items, "nie-ma")).toEqual([]);
  });
});
