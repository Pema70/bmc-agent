import type { EvaluationListItem } from "@/lib/db/evaluations";
import {
  EVALUATION_CRITERIA,
  SCORE_MAX,
  SCORE_MIN,
  type EvaluationCriterion,
  type EvaluationOutput,
  type EvaluationView,
} from "@/lib/schemas/evaluation";

export type Point = { x: number; y: number };

export type RadarGeometry = {
  cx: number;
  cy: number;
  /** Promień osi odpowiadający ocenie SCORE_MAX. */
  radius: number;
  /** Odstęp etykiety od końca osi. */
  labelOffset: number;
};

export type RadarAxis = {
  criterion: EvaluationCriterion;
  /** Kąt w radianach; pierwsze kryterium u góry, dalej zgodnie z ruchem wskazówek zegara. */
  angle: number;
  end: Point;
  label: Point;
  anchor: "start" | "middle" | "end";
};

/** Poziomy siatki (okręgi wielokątne). */
export const RADAR_RINGS = [2, 4, 6, 8, 10] as const;

function round(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // bez -0
}

function polar(g: RadarGeometry, angle: number, distance: number): Point {
  return { x: round(g.cx + distance * Math.cos(angle)), y: round(g.cy + distance * Math.sin(angle)) };
}

function angleOf(index: number): number {
  return -Math.PI / 2 + (index * 2 * Math.PI) / EVALUATION_CRITERIA.length;
}

/** Długość osi dla oceny: wartość spoza zakresu jest obcinana do 1-10, a wartość nieskończona lub NaN daje środek. */
function scoreToDistance(score: number, radius: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  const clamped = Math.min(SCORE_MAX, Math.max(SCORE_MIN, score));
  return (clamped / SCORE_MAX) * radius;
}

/** Osie w kolejności EVALUATION_CRITERIA, z końcem osi i miejscem na etykietę. */
export function radarAxes(g: RadarGeometry): RadarAxis[] {
  return EVALUATION_CRITERIA.map((criterion, index) => {
    const angle = angleOf(index);
    const horizontal = Math.cos(angle);
    // Etykieta po prawej stronie osi zaczyna się przy osi, po lewej kończy się przy osi, u góry i na dole jest wyśrodkowana.
    const anchor = Math.abs(horizontal) < 0.01 ? "middle" : horizontal > 0 ? "start" : "end";
    return {
      criterion,
      angle,
      end: polar(g, angle, g.radius),
      label: polar(g, angle, g.radius + g.labelOffset),
      anchor,
    };
  });
}

/** Wierzchołki wielokąta ocen, w kolejności EVALUATION_CRITERIA. */
export function radarPoints(scores: EvaluationOutput | Record<EvaluationCriterion, { score: number }>, g: RadarGeometry): Point[] {
  return EVALUATION_CRITERIA.map((criterion, index) =>
    polar(g, angleOf(index), scoreToDistance(scores[criterion].score, g.radius)),
  );
}

/** Wierzchołki jednego okręgu siatki dla danej oceny. */
export function radarRing(level: number, g: RadarGeometry): Point[] {
  return EVALUATION_CRITERIA.map((_, index) => polar(g, angleOf(index), scoreToDistance(level, g.radius)));
}

/** Atrybut `points` elementu <polygon>. */
export function toPolygonPoints(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/** Etykieta w dwóch wierszach, jeśli ma dopisek w nawiasie, np. "Ryzyko" / "(10 = niskie)". */
export function splitLabel(label: string): string[] {
  const index = label.indexOf(" (");
  return index === -1 ? [label] : [label.slice(0, index), label.slice(index + 1)];
}

/**
 * Oceny, które można nałożyć na wybraną: poprawnie odczytane, z tym samym schemaVersion, inne niż wybrana.
 * Uszkodzone lub niezgodne wiersze listy nie są wybieralne.
 */
export function comparableEvaluations(items: EvaluationListItem[], selectedId: string | null): EvaluationView[] {
  const selected = items.find((item) => item.ok && item.evaluation.id === selectedId);
  if (!selected || !selected.ok) {
    return [];
  }
  const schemaVersion = selected.evaluation.schemaVersion;
  const result: EvaluationView[] = [];
  for (const item of items) {
    if (item.ok && item.evaluation.id !== selectedId && item.evaluation.schemaVersion === schemaVersion) {
      result.push(item.evaluation);
    }
  }
  return result;
}
