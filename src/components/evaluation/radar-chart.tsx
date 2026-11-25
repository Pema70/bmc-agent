import { radarAxes, radarPoints, radarRing, splitLabel, toPolygonPoints, RADAR_RINGS, type Point, type RadarGeometry } from "@/lib/evaluation/radar";
import { CRITERION_LABELS, EVALUATION_CRITERIA, type EvaluationOutput } from "@/lib/schemas/evaluation";

export type RadarSeries = {
  id: string;
  /** Opis serii w legendzie i w aria-label (data, model). Zwykły tekst. */
  legend: string;
  result: EvaluationOutput;
};

// Skaluje się do szerokości kontenera (viewBox, bez stałych pikseli); etykiety mieszczą się w obszarze 0-420.
const VIEW_WIDTH = 420;
const VIEW_HEIGHT = 330;
const GEOMETRY: RadarGeometry = { cx: 210, cy: 165, radius: 95, labelOffset: 16 };
const LINE_HEIGHT = 15;

// Serie różnią się nie tylko kolorem: linia ciągła i kółka (niebieski), linia przerywana i romby (koral), linia kropkowana
// i kwadraty (zielony). Kolory to tokeny wyglądu o kontraście co najmniej 3:1 na powierzchni i tincie (test
// `design-tokens.test.ts`); geometria pochodzi z `radar.ts`.
const SERIES_STYLE = [
  { color: "text-primary-from", dash: undefined, marker: "circle", strokeWidth: 2.5, fillOpacity: 0.18 },
  { color: "text-accent-from", dash: "6 4", marker: "diamond", strokeWidth: 2, fillOpacity: 0.1 },
  { color: "text-low-fg", dash: "2 4", marker: "square", strokeWidth: 2, fillOpacity: 0.06 },
] as const;

function describeSeries(series: RadarSeries): string {
  const values = EVALUATION_CRITERIA.map((c) => `${CRITERION_LABELS[c]} ${series.result[c].score} z 10`).join(", ");
  return `${series.legend}: ${values}`;
}

function Marker({ kind, point }: { kind: "circle" | "diamond" | "square"; point: Point }) {
  if (kind === "circle") {
    return <circle cx={point.x} cy={point.y} r={4} fill="currentColor" />;
  }
  if (kind === "square") {
    return <rect x={point.x - 4} y={point.y - 4} width={8} height={8} fill="currentColor" />;
  }
  const r = 5;
  const points = `${point.x},${point.y - r} ${point.x + r},${point.y} ${point.x},${point.y + r} ${point.x - r},${point.y}`;
  return <polygon points={points} fill="currentColor" />;
}

/** Wykres radarowy ocen (od jednej do trzech serii). Tabela ocen w panelu jest jego alternatywą tekstową. */
export function RadarChart({ series }: { series: RadarSeries[] }) {
  const axes = radarAxes(GEOMETRY);
  const shown = series.slice(0, SERIES_STYLE.length);
  const label = `Wykres radarowy ocen modelu BMC w skali 1-10. ${shown.map(describeSeries).join(". ")}.`;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="mx-auto h-auto w-full max-w-md text-text"
      >
        <g className="text-grid" fill="none" stroke="currentColor" strokeWidth={1}>
          {RADAR_RINGS.map((level) => (
            <polygon key={level} points={toPolygonPoints(radarRing(level, GEOMETRY))} strokeWidth={level === 10 ? 1.5 : 1} />
          ))}
          {axes.map((axis) => (
            <line key={axis.criterion} x1={GEOMETRY.cx} y1={GEOMETRY.cy} x2={axis.end.x} y2={axis.end.y} />
          ))}
        </g>

        <g fill="currentColor" className="text-muted" fontSize={10}>
          {RADAR_RINGS.map((level) => {
            const top = radarRing(level, GEOMETRY)[0];
            return (
              <text key={level} x={top.x + 3} y={top.y - 2}>
                {level}
              </text>
            );
          })}
        </g>

        {shown.map((item, index) => {
          const style = SERIES_STYLE[index];
          const points = radarPoints(item.result, GEOMETRY);
          return (
            <g key={item.id} className={style.color}>
              <polygon
                points={toPolygonPoints(points)}
                fill="currentColor"
                fillOpacity={style.fillOpacity}
                stroke="currentColor"
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.dash}
                strokeLinejoin="round"
              />
              {points.map((point, i) => (
                <Marker key={EVALUATION_CRITERIA[i]} kind={style.marker} point={point} />
              ))}
            </g>
          );
        })}

        <g fill="currentColor" fontSize={13} fontWeight={700}>
          {axes.map((axis) => {
            const lines = splitLabel(CRITERION_LABELS[axis.criterion]);
            const top = axis.anchor === "middle" && axis.end.y < GEOMETRY.cy;
            const bottom = axis.anchor === "middle" && !top;
            return (
              <text key={axis.criterion} x={axis.label.x} textAnchor={axis.anchor}>
                {lines.map((line, i) => {
                  const y = top
                    ? axis.label.y - (lines.length - 1 - i) * LINE_HEIGHT
                    : bottom
                      ? axis.label.y + 10 + i * LINE_HEIGHT
                      : axis.label.y + 4 + (i - (lines.length - 1) / 2) * LINE_HEIGHT;
                  return (
                    <tspan key={line} x={axis.label.x} y={y}>
                      {line}
                    </tspan>
                  );
                })}
              </text>
            );
          })}
        </g>
      </svg>

      <figcaption>
        <ul className="flex flex-col gap-1 text-sm">
          {shown.map((item, index) => {
            const style = SERIES_STYLE[index];
            return (
              <li key={item.id} className="flex items-center gap-2">
                <svg viewBox="0 0 32 12" width={32} height={12} aria-hidden="true" className={`shrink-0 ${style.color}`}>
                  <line x1={0} y1={6} x2={32} y2={6} stroke="currentColor" strokeWidth={2} strokeDasharray={style.dash} />
                  <Marker kind={style.marker} point={{ x: 16, y: 6 }} />
                </svg>
                <span>{item.legend}</span>
              </li>
            );
          })}
        </ul>
      </figcaption>
    </figure>
  );
}
