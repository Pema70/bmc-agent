import { formatExportDateTime, toEvaluationExport, type EvaluationExport } from "@/lib/export/common";
import { exportText } from "@/lib/export/sanitize";
import {
  CERTAINTY_LABELS,
  MANUAL_EDIT_NOTE,
  SOURCE_CODE_LEGEND,
  SOURCE_LEGEND_NOTE,
  sourceCode,
  sourceLabel,
  type SourceCode,
} from "@/lib/report/labels";
import type { ReportData } from "@/lib/report/types";
import { BLOCK_INFO, BLOCK_KEYS, type BlockKey } from "@/lib/schemas/bmc";
import { COMPARE_LABELS } from "@/lib/schemas/compare";
import { CRITERION_LABELS } from "@/lib/schemas/evaluation";
import { IMPACT_LEVEL_LABELS } from "@/lib/schemas/impact";
import { REFINEMENT_STATUS_LABELS } from "@/lib/schemas/refinement";

/**
 * Model rozszerzonego raportu gotowy do wstawienia do dokumentu (krok 9e): wszystkie teksty z bazy są już oczyszczone
 * (`exportText`), daty sformatowane (Europe/Warsaw), a każda treść z modelu ma etykietę „AI”. PDF i DOCX składają się z
 * tego samego modelu, więc różnią się tylko układem. Identyfikatory z bazy nie trafiają do modelu.
 */

export const REPORT_TITLE = "Raport wariantu modelu biznesowego";
const MAX_TEXT = 1500;

export type ReportCanvasBlock = { blockKey: BlockKey; title: string; entries: Array<{ code: SourceCode; text: string }> };

export type ReportBlockDescription = {
  title: string;
  entryCount: number;
  breakdown: string;
  entries: Array<{ text: string; sourceLabel: string; rationale: string | null; position: string | null }>;
  withoutRationale: number;
};

export type ReportSourceRow = { blockTitle: string; text: string; code: SourceCode; label: string; certainty: string };

export type ReportAttachmentRow = { name: string; kind: string; size: string; chars: string; addedAt: string; usage: string };

export type ReportScoreRow = { label: string; score: number | null };

export type ReportEvaluationHistoryRow = { date: string; source: string; version: number; scores: string };

export type ReportRoundProposalRow = {
  /** Numer pytania liczony od 1 albo „?”, gdy zapis go nie ma. */
  question: string;
  blockTitle: string;
  operation: string;
  before: string;
  after: string;
  status: string;
};

export type ReportRound = {
  heading: string;
  status: string;
  questions: Array<{ number: number; blockTitle: string; criterion: string; question: string; answer: string }>;
  proposals: ReportRoundProposalRow[];
  before: string;
  after: string;
};

export type ReportImpact = {
  heading: string;
  meta: string;
  change: string;
  summary: string;
  affected: Array<{ blockTitle: string; level: string; text: string }>;
};

export type ReportComparison = {
  heading: string;
  meta: string;
  variants: string[];
  summary: string;
  blockNotes: Array<{ blockTitle: string; comment: string }>;
  assessments: Array<{ label: string; pros: string[]; cons: string[] }>;
  recommendation: string;
};

export type ReportModelRow = { operation: string; model: string; promptVersion: string; calls: number; period: string };

export type ReportExportData = {
  projectName: string;
  projectDescription: string;
  variantName: string;
  variantInfo: string;
  generatedAt: string;
  version: number;
  canvas: ReportCanvasBlock[];
  legend: Array<{ code: SourceCode; meaning: string }>;
  legendNote: string;
  blocks: ReportBlockDescription[];
  attachments: ReportAttachmentRow[];
  sourceRows: ReportSourceRow[];
  sourceSummary: string;
  latestEvaluation: EvaluationExport | null;
  evaluationHistory: ReportEvaluationHistoryRow[];
  evaluationNotes: string[];
  rounds: ReportRound[];
  impacts: ReportImpact[];
  impactNotes: string[];
  comparisons: ReportComparison[];
  comparisonNotes: string[];
  models: ReportModelRow[];
  modelNotes: string[];
  notes: string[];
};

function clean(value: string | null | undefined): string {
  return exportText(value, MAX_TEXT);
}

function blockTitle(blockKey: BlockKey): string {
  return BLOCK_INFO[blockKey].label;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function scoreLine(rows: Array<{ label: string; score: number }>): string {
  return rows.map((row) => `${row.label}: ${row.score}`).join("; ");
}

const PROPOSAL_STATUS_TEXT = { ACCEPTED: "przyjęta", REJECTED: "odrzucona", PENDING: "oczekująca" } as const;
const NO_VALUE = "(brak)";

const OPERATION_LABELS = { add: "Dodanie wpisu", edit: "Zmiana wpisu", remove: "Usunięcie wpisu" } as const;

function limitNote(what: string, truncated: boolean, limit: number): string[] {
  return truncated ? [`${what}: pokazano najnowsze ${limit}; starsze pozycje istnieją w bazie, ale nie weszły do raportu.`] : [];
}

function evaluationScores(evaluation: EvaluationExport): string {
  return scoreLine(evaluation.rows);
}

export function buildReportExport(data: ReportData): ReportExportData {
  const entries = data.origins.entries;

  const canvas: ReportCanvasBlock[] = BLOCK_KEYS.map((blockKey) => ({
    blockKey,
    title: blockTitle(blockKey),
    entries: entries
      .filter((entry) => entry.blockKey === blockKey)
      .map((entry) => ({ code: sourceCode(entry.origin), text: clean(entry.text) }))
      .filter((entry) => entry.text.length > 0),
  }));

  const blocks: ReportBlockDescription[] = data.blocks.map((block) => ({
    title: blockTitle(block.blockKey),
    entryCount: block.entryCount,
    breakdown: block.breakdown.map((item) => `${item.label}: ${item.count}`).join("; "),
    entries: block.entries.map((entry) => ({
      text: entry.text,
      sourceLabel: entry.sourceLabel,
      rationale: entry.rationale,
      position: entry.position ? `runda ${entry.position.roundNumber}, pytanie ${entry.position.questionNumber}` : null,
    })),
    withoutRationale: block.withoutRationale,
  }));

  const sourceRows: ReportSourceRow[] = entries.map((entry) => ({
    blockTitle: blockTitle(entry.blockKey),
    text: clean(entry.text),
    code: sourceCode(entry.origin),
    label: sourceLabel(entry.origin, entry.certainty),
    certainty: CERTAINTY_LABELS[entry.certainty],
  }));

  const counts = data.origins.counts;
  const sourceSummary = `Wpisy: ${counts.total}; ${CERTAINTY_LABELS.ZAPISANE}: ${counts.saved}; ${CERTAINTY_LABELS.USTALONE_PO_TEKSCIE}: ${counts.inferred}; ${CERTAINTY_LABELS.NIEZNANE}: ${counts.unknown}.`;

  const attachments: ReportAttachmentRow[] = data.attachments.map((attachment) => ({
    name: clean(attachment.fileName),
    kind: attachment.kind,
    size: formatSize(attachment.sizeBytes),
    chars: `${attachment.textChars}${attachment.truncated ? " (obcięty)" : ""}`,
    addedAt: formatExportDateTime(attachment.createdAt),
    usage: attachment.usedAsSource ? "użyty jako źródło wpisu" : "wgrany, niewykorzystany",
  }));

  const evaluationViews = data.evaluations.items.flatMap((item) => (item.ok ? [item.evaluation] : []));
  const unreadableEvaluations = data.evaluations.items.length - evaluationViews.length;
  const evaluationExports = evaluationViews.map((evaluation) => toEvaluationExport(evaluation, data.variant.version));
  const evaluationHistory: ReportEvaluationHistoryRow[] = evaluationExports.map((evaluation) => ({
    date: evaluation.createdAt,
    source: `${evaluation.sourceText}${evaluation.promptVersion ? `, ${evaluation.promptVersion}` : ""}`,
    version: evaluation.evaluatedVersion,
    scores: evaluationScores(evaluation),
  }));
  const evaluationNotes = [
    ...(unreadableEvaluations > 0 ? [`Pominięto nieczytelne zapisy ocen (niezgodne ze schematem): ${unreadableEvaluations}.`] : []),
    ...limitNote("Historia ocen", data.evaluations.truncated, data.evaluations.limit),
  ];

  const evaluationLine = (evaluation: EvaluationExport): string =>
    `${evaluation.sourceText}, ${evaluation.createdAt}: ${evaluationScores(evaluation)}`;

  const rounds: ReportRound[] = data.rounds.map((pair) => {
    if (!pair.ok) {
      return { heading: `Runda ${pair.roundNumber}`, status: "Zapis rundy jest nieczytelny (niezgodny ze schematem).", questions: [], proposals: [], before: "", after: "" };
    }
    const round = pair.round;
    const before = pair.before ? evaluationLine(toEvaluationExport(pair.before, data.variant.version)) : "brak (ocena niedostępna)";
    const afterText: Record<typeof pair.afterStatus, string> = {
      FOUND: pair.after ? evaluationLine(toEvaluationExport(pair.after, data.variant.version)) : "",
      NONE: "brak oceny po rundzie (propozycje rozstrzygnięte, ale nie wykonano nowej oceny)",
      UNRESOLVED: "propozycje rundy czekają na decyzję",
      NO_PROPOSALS: "runda nie ma propozycji",
    };
    return {
      heading: `Runda ${round.roundNumber} (wersja modelu ${round.variantVersion}, ${formatExportDateTime(round.createdAt)})`,
      status: REFINEMENT_STATUS_LABELS[round.status],
      questions: round.questions.map((question, index) => ({
        number: index + 1,
        blockTitle: blockTitle(question.blockKey),
        criterion: CRITERION_LABELS[question.criterion],
        question: clean(question.question),
        answer: round.answers ? clean(round.answers[index]) || "(brak odpowiedzi)" : "(brak odpowiedzi)",
      })),
      proposals: data.roundProposals
        .filter((proposal) => proposal.refinementRoundId === round.id)
        .map((proposal) => ({
          question: proposal.questionIndex === null ? "?" : String(proposal.questionIndex + 1),
          blockTitle: blockTitle(proposal.blockKey),
          operation: OPERATION_LABELS[proposal.operation],
          before: clean(proposal.before) || NO_VALUE,
          after: clean(proposal.after) || NO_VALUE,
          status: PROPOSAL_STATUS_TEXT[proposal.status],
        })),
      before,
      after: afterText[pair.afterStatus],
    };
  });

  const impactViews = data.impacts.items.flatMap((item) => (item.ok ? [item.analysis] : []));
  const impacts: ReportImpact[] = impactViews.map((analysis) => {
    const change = analysis.change;
    const changeText =
      change.kind === "PROPOSAL"
        ? `${OPERATION_LABELS[change.operation]} w bloku „${blockTitle(change.blockKey)}”${change.before ? `, przed: ${clean(change.before)}` : ""}${change.after ? `, po: ${clean(change.after)}` : ""}`
        : `Opis zmiany w bloku „${blockTitle(change.blockKey)}”: ${clean(change.description)}`;
    return {
      heading: `Analiza wpływu (AI), ${formatExportDateTime(analysis.createdAt)}`,
      meta: `Model: ${clean(analysis.provider)} / ${clean(analysis.model)}, wersja promptu: ${clean(analysis.promptVersion)}, dotyczy wersji modelu: ${analysis.variantVersion}.`,
      change: changeText,
      summary: clean(analysis.result.summary),
      affected: analysis.result.affected.map((item) => ({ blockTitle: blockTitle(item.blockKey), level: IMPACT_LEVEL_LABELS[item.level], text: clean(item.impact) })),
    };
  });
  const impactNotes = [
    ...(data.impacts.items.length > impactViews.length ? [`Pominięto nieczytelne zapisy analiz: ${data.impacts.items.length - impactViews.length}.`] : []),
    ...limitNote("Analizy wpływu", data.impacts.truncated, data.impacts.limit),
  ];

  const comparisonViews = data.comparisons.items.flatMap((item) => (item.ok ? [item.comparison] : []));
  const comparisons: ReportComparison[] = comparisonViews.map((comparison) => {
    const recommended = comparison.result.recommendation.label;
    return {
      heading: `Porównanie wariantów (AI), ${formatExportDateTime(comparison.createdAt)}`,
      meta: `Model: ${clean(comparison.provider)} / ${clean(comparison.model)}, wersja promptu: ${clean(comparison.promptVersion)}.`,
      variants: comparison.inputs.map((input) => `${input.label}: ${clean(input.name)} (wersja ${input.version})`),
      summary: clean(comparison.result.summary),
      blockNotes: comparison.result.blockNotes.map((note) => ({ blockTitle: blockTitle(note.blockKey), comment: clean(note.comment) })),
      assessments: [...comparison.result.variants]
        .sort((a, b) => COMPARE_LABELS.indexOf(a.label) - COMPARE_LABELS.indexOf(b.label))
        .map((variant) => ({ label: variant.label, pros: variant.pros.map((item) => clean(item)), cons: variant.cons.map((item) => clean(item)) })),
      recommendation: `${recommended ? `Rekomendowany wariant: ${recommended}. ` : "Brak jednoznacznej rekomendacji. "}${clean(comparison.result.recommendation.rationale)}`,
    };
  });
  const comparisonNotes = [
    ...(data.comparisons.items.length > comparisonViews.length ? [`Pominięto nieczytelne zapisy porównań: ${data.comparisons.items.length - comparisonViews.length}.`] : []),
    ...limitNote("Porównania", data.comparisons.truncated, data.comparisons.limit),
  ];

  const models: ReportModelRow[] = data.llmSummary.map((row) => ({
    operation: clean(row.operation),
    model: `${clean(row.provider)} / ${clean(row.model)}`,
    promptVersion: clean(row.promptVersion),
    calls: row.calls,
    period: `${formatExportDateTime(row.firstUsed)} – ${formatExportDateTime(row.lastUsed)}`,
  }));

  const notes = [
    `Raport dotyczy zapisanego stanu wariantu (wersja ${data.variant.version}); niezapisane zmiany nie są uwzględnione. Raport składa się wyłącznie z zapisanych danych i nie wywołuje modelu.`,
    "Pochodzenie wpisów jest rejestrowane od wprowadzenia tej funkcji; wpisy starsze są oznaczone jako „ustalone po tekście” (prawdopodobne) albo „nieznane”. Duplikaty w bloku dzielą jedno pochodzenie.",
    MANUAL_EDIT_NOTE,
    ...(data.origins.corrupt ? ["Zapis pochodzenia wpisów w bazie był nieczytelny i został zignorowany; pochodzenie ustalono po tekście, o ile było to możliwe."] : []),
    ...(data.proposalsTruncated ? ["Lista propozycji użyta do opisów i ustalania pochodzenia została obcięta; starsze propozycje nie weszły do raportu."] : []),
  ];

  return {
    projectName: clean(data.project.name),
    projectDescription: clean(data.project.description),
    variantName: clean(data.variant.name),
    variantInfo: `${data.variant.isMain ? "wariant główny" : "wariant dodatkowy"}, ${data.variant.origin === "AI_STRATEGY" ? "ze strategii AI" : "utworzony ręcznie"}; utworzony ${formatExportDateTime(data.variant.createdAt)}, zapisany ${formatExportDateTime(data.variant.updatedAt)}${data.variant.description ? `. Opis: ${clean(data.variant.description)}` : ""}`,
    generatedAt: formatExportDateTime(data.generatedAt),
    version: data.variant.version,
    canvas,
    legend: [...SOURCE_CODE_LEGEND],
    legendNote: SOURCE_LEGEND_NOTE,
    blocks,
    attachments,
    sourceRows,
    sourceSummary,
    latestEvaluation: evaluationExports[0] ?? null,
    evaluationHistory,
    evaluationNotes,
    rounds,
    impacts,
    impactNotes,
    comparisons,
    comparisonNotes,
    models,
    modelNotes: [
      "Propozycje z czatu nie mają zapisanej wersji promptu ani modelu; tabela zbiorczo pokazuje udane wywołania modelu w całym projekcie (nie tylko w tym wariancie).",
    ],
    notes,
  };
}
