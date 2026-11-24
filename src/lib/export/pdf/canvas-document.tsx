import { Document, Line, Page, Polygon, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { CanvasBlockData, CanvasExportData } from "@/lib/export/canvas-data";
import { AI_NOTICE, EMPTY_BLOCK_TEXT, formatExportDateTime, staleNote } from "@/lib/export/common";
import { EXPORT_FONT_FAMILY } from "@/lib/export/pdf/fonts";
import { exportText } from "@/lib/export/sanitize";
import { radarAxes, radarPoints, radarRing, splitLabel, toPolygonPoints, RADAR_RINGS, type RadarGeometry } from "@/lib/evaluation/radar";
import { CRITERION_LABELS, SCORE_MAX } from "@/lib/schemas/evaluation";

const INK = "#000000";
const MUTED = "#444444";

const styles = StyleSheet.create({
  page: { fontFamily: EXPORT_FONT_FAMILY, fontSize: 8, color: INK, paddingTop: 24, paddingHorizontal: 24, paddingBottom: 52 },
  title: { fontSize: 16, fontWeight: 700 },
  subtitle: { fontSize: 10, marginTop: 2 },
  meta: { fontSize: 8, color: MUTED, marginTop: 2 },
  notice: { fontSize: 8, marginTop: 6, marginBottom: 8, paddingVertical: 3, paddingHorizontal: 5, borderWidth: 0.75, borderColor: INK },
  topRow: { flexDirection: "row", flexGrow: 1, minHeight: 300 },
  bottomRow: { flexDirection: "row", minHeight: 90 },
  column: { flex: 1, flexDirection: "column" },
  cell: { flexGrow: 1, flexBasis: 0, borderWidth: 0.75, borderColor: INK, padding: 4 },
  cellTitle: { fontSize: 8.5, fontWeight: 700, marginBottom: 3 },
  entry: { marginBottom: 2 },
  empty: { color: MUTED },
  footer: { position: "absolute", left: 24, right: 24, bottom: 16, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
  footerNotice: { flex: 1, paddingRight: 12 },
  h2: { fontSize: 13, fontWeight: 700, marginBottom: 4 },
  evalRow: { flexDirection: "row", gap: 16 },
  table: { flex: 1 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: MUTED, paddingVertical: 4 },
  th: { fontWeight: 700 },
  tdCriterion: { width: 110 },
  tdScore: { width: 40 },
  tdJustification: { flex: 1, paddingLeft: 6 },
});

function Cell({ block }: { block: CanvasBlockData | undefined }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellTitle}>{block ? block.title : ""}</Text>
      {block && block.entries.length > 0 ? (
        block.entries.map((entry, index) => (
          <Text key={index} style={styles.entry}>
            {`• ${entry}`}
          </Text>
        ))
      ) : (
        <Text style={styles.empty}>{EMPTY_BLOCK_TEXT}</Text>
      )}
    </View>
  );
}

const RADAR: RadarGeometry = { cx: 132, cy: 100, radius: 60, labelOffset: 12 };
const RADAR_WIDTH = 264;
const RADAR_HEIGHT = 200;

function Radar({ scores }: { scores: Record<string, number> }) {
  const axes = radarAxes(RADAR);
  const polygon = radarPoints(
    {
      coherence: { score: scores.coherence },
      risk_resilience: { score: scores.risk_resilience },
      feasibility: { score: scores.feasibility },
      innovation: { score: scores.innovation },
    },
    RADAR,
  );
  return (
    <Svg width={RADAR_WIDTH} height={RADAR_HEIGHT} viewBox={`0 0 ${RADAR_WIDTH} ${RADAR_HEIGHT}`}>
      {RADAR_RINGS.map((level) => (
        <Polygon key={level} points={toPolygonPoints(radarRing(level, RADAR))} stroke={level === SCORE_MAX ? INK : "#999999"} strokeWidth={0.5} fill="none" />
      ))}
      {axes.map((axis) => (
        <Line key={axis.criterion} x1={RADAR.cx} y1={RADAR.cy} x2={axis.end.x} y2={axis.end.y} stroke="#999999" strokeWidth={0.5} />
      ))}
      <Polygon points={toPolygonPoints(polygon)} stroke={INK} strokeWidth={1.5} fill="#cccccc" fillOpacity={0.6} />
      {axes.flatMap((axis) => {
        const lines = splitLabel(CRITERION_LABELS[axis.criterion]);
        const above = axis.label.y < RADAR.cy - 1;
        return lines.map((line, index) => (
          <Text
            key={`${axis.criterion}-${index}`}
            x={axis.label.x}
            y={axis.label.y + (above ? (index - (lines.length - 1)) * 9 : index * 9 + 3)}
            textAnchor={axis.anchor}
            style={{ fontFamily: EXPORT_FONT_FAMILY, fontSize: 8 }}
          >
            {line}
          </Text>
        ));
      })}
    </Svg>
  );
}

function Footer() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerNotice}>{AI_NOTICE}</Text>
      <Text render={({ pageNumber, totalPages }) => `Strona ${pageNumber} z ${totalPages}`} />
    </View>
  );
}

/**
 * PDF z układem płótna BMC (A4 poziomo): klasyczny układ dziewięciu bloków, pod nim ocena z radarem (jeśli istnieje).
 * Wszystkie teksty to zwykłe węzły tekstowe (bez HTML i Markdown) po oczyszczeniu w `loadCanvasExportData`.
 */
export function CanvasDocument({ data }: { data: CanvasExportData }) {
  const block = (key: CanvasBlockData["blockKey"]) => data.blocks.find((item) => item.blockKey === key);
  const evaluation = data.evaluation;
  const stale = evaluation ? staleNote(evaluation, data.variantVersion) : null;

  return (
    <Document
      title={`${exportText(data.projectName, 100)} / ${exportText(data.variantName, 100)}`}
      author="BMC Agent"
      creator="BMC Agent"
      producer="BMC Agent"
      language="pl-PL"
    >
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>{data.projectName}</Text>
        <Text style={styles.subtitle}>{`Wariant: ${data.variantName}`}</Text>
        <Text style={styles.meta}>
          {`Wersja zapisanego stanu: ${data.variantVersion}. Wygenerowano: ${formatExportDateTime(data.generatedAt)}. Eksport dotyczy zapisanego stanu wariantu.`}
        </Text>
        <Text style={styles.notice}>{AI_NOTICE}</Text>

        <View style={styles.topRow}>
          <View style={styles.column}>
            <Cell block={block("key_partnerships")} />
          </View>
          <View style={styles.column}>
            <Cell block={block("key_activities")} />
            <Cell block={block("key_resources")} />
          </View>
          <View style={styles.column}>
            <Cell block={block("value_propositions")} />
          </View>
          <View style={styles.column}>
            <Cell block={block("customer_relationships")} />
            <Cell block={block("channels")} />
          </View>
          <View style={styles.column}>
            <Cell block={block("customer_segments")} />
          </View>
        </View>
        <View style={styles.bottomRow}>
          <Cell block={block("cost_structure")} />
          <Cell block={block("revenue_streams")} />
        </View>
        <Footer />
      </Page>

      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.h2}>{evaluation ? `Najnowsza ocena${evaluation.isAi ? " (AI)" : ""}` : "Ocena"}</Text>
        {evaluation ? (
          <View>
            <Text style={styles.meta}>
              {`${evaluation.sourceText}${evaluation.promptVersion ? `, wersja promptu: ${evaluation.promptVersion}` : ""}. Data: ${evaluation.createdAt}. Dotyczy wersji modelu: ${evaluation.evaluatedVersion}.`}
            </Text>
            {stale ? <Text style={styles.notice}>{stale}</Text> : null}
            <View style={styles.evalRow}>
              <View style={styles.table}>
                <View style={styles.tr}>
                  <Text style={[styles.tdCriterion, styles.th]}>Kryterium</Text>
                  <Text style={[styles.tdScore, styles.th]}>Ocena</Text>
                  <Text style={[styles.tdJustification, styles.th]}>{evaluation.isAi ? "Uzasadnienie (AI)" : "Uzasadnienie"}</Text>
                </View>
                {evaluation.rows.map((row) => (
                  <View key={row.criterion} style={styles.tr} wrap={false}>
                    <Text style={styles.tdCriterion}>{row.label}</Text>
                    <Text style={styles.tdScore}>{`${row.score}/${SCORE_MAX}`}</Text>
                    <Text style={styles.tdJustification}>{row.justification}</Text>
                  </View>
                ))}
              </View>
              <Radar scores={Object.fromEntries(evaluation.rows.map((row) => [row.criterion, row.score]))} />
            </View>
          </View>
        ) : (
          <Text>
            {data.evaluationUnreadable
              ? "Najnowsza zapisana ocena jest nieczytelna (niezgodna ze schematem), więc nie została dołączona."
              : "Ten wariant nie ma jeszcze oceny."}
          </Text>
        )}
        <Footer />
      </Page>
    </Document>
  );
}
