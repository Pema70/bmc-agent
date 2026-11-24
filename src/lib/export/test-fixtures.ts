import type { CanvasExportData } from "@/lib/export/canvas-data";
import { toEvaluationExport } from "@/lib/export/common";
import { BLOCK_INFO, BLOCK_KEYS, type BlockKey } from "@/lib/schemas/bmc";
import type { EvaluationView } from "@/lib/schemas/evaluation";

/** Fixtury testów eksportu (dane przykładowe, nie poufne). */
export const POLISH_LOWER = "ąćęłńóśźż";
export const POLISH_UPPER = "ĄĆĘŁŃÓŚŹŻ";

export function evaluationView(overrides: Partial<EvaluationView> = {}): EvaluationView {
  return {
    id: "e1",
    createdAt: new Date("2026-11-20T10:00:00Z"),
    schemaVersion: 1,
    variantVersion: 3,
    source: "AI",
    trigger: "UI",
    provider: "google",
    model: "gemini-3.5-flash-lite",
    promptVersion: "evaluate-v1",
    result: {
      coherence: { score: 8, justification: "Segmenty i kanały pasują do propozycji wartości." },
      risk_resilience: { score: 4, justification: "Zależność od jednego dostawcy ziarna." },
      feasibility: { score: 7, justification: "Zasoby są dostępne: palarnia i lokal." },
      innovation: { score: 5, justification: "Subskrypcja jest znana na rynku." },
    },
    ...overrides,
  };
}

export function canvasData(overrides: Partial<CanvasExportData> = {}, entries: Partial<Record<BlockKey, string[]>> = {}): CanvasExportData {
  const defaults: Partial<Record<BlockKey, string[]>> = {
    customer_segments: ["Pracownicy biurowi", "Studenci"],
    value_propositions: ["Świeżo palona kawa", `Zażółć gęślą jaźń ${POLISH_LOWER} ${POLISH_UPPER}`],
    channels: ["Sklep online", "Lokal stacjonarny"],
    key_partnerships: ["Plantacje w Etiopii"],
  };
  const merged = { ...defaults, ...entries };
  return {
    generatedAt: new Date("2026-11-25T12:00:00Z"),
    projectName: "Kawiarnia Ziarno",
    variantName: "Wariant główny",
    variantVersion: 3,
    blocks: BLOCK_KEYS.map((blockKey) => ({ blockKey, title: BLOCK_INFO[blockKey].label, entries: merged[blockKey] ?? [] })),
    evaluation: toEvaluationExport(evaluationView(), 3),
    evaluationUnreadable: false,
    ...overrides,
  };
}
