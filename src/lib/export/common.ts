import { exportText } from "@/lib/export/sanitize";
import { CRITERION_LABELS, type EvaluationCriterion, type EvaluationView } from "@/lib/schemas/evaluation";

/** Stałe oznaczenie AI (decyzja D12 planu kroku 9): nagłówek pierwszej strony i stopka każdej strony, PDF i DOCX. */
export const AI_NOTICE =
  "Treści oznaczone „AI” to opinia modelu językowego, a nie weryfikacja biznesowa. Model nie sprawdza rynku ani danych liczbowych.";

export const EMPTY_BLOCK_TEXT = "(brak wpisów)";

/** Data i godzina w strefie Europe/Warsaw (jak daty w interfejsie), np. „25 lis 2026, 14:05”. */
export function formatExportDateTime(date: Date): string {
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" }).format(date);
}

export type EvaluationRowData = { criterion: EvaluationCriterion; label: string; score: number; justification: string };

export type EvaluationExport = {
  isAi: boolean;
  /** Np. „Ocena AI: google / gemini-3.5-flash-lite” albo „Ocena ręczna”: zwykły tekst. */
  sourceText: string;
  promptVersion: string | null;
  createdAt: string;
  evaluatedVersion: number;
  /** Ocena dotyczy starszej wersji modelu niż zapisana w eksporcie. */
  stale: boolean;
  rows: EvaluationRowData[];
};

/** Ocena gotowa do wstawienia do dokumentu: wszystkie teksty już oczyszczone (`exportText`). */
export function toEvaluationExport(evaluation: EvaluationView, currentVersion: number): EvaluationExport {
  const isAi = evaluation.source === "AI";
  const source = isAi
    ? `Ocena AI: ${exportText(evaluation.provider) || "?"} / ${exportText(evaluation.model) || "?"}`
    : "Ocena ręczna";
  return {
    isAi,
    sourceText: source,
    promptVersion: isAi ? exportText(evaluation.promptVersion) || null : null,
    createdAt: formatExportDateTime(evaluation.createdAt),
    evaluatedVersion: evaluation.variantVersion,
    stale: evaluation.variantVersion < currentVersion,
    rows: (Object.keys(CRITERION_LABELS) as EvaluationCriterion[]).map((criterion) => ({
      criterion,
      label: CRITERION_LABELS[criterion],
      score: evaluation.result[criterion].score,
      justification: exportText(evaluation.result[criterion].justification),
    })),
  };
}

export function staleNote(evaluation: EvaluationExport, currentVersion: number): string | null {
  return evaluation.stale
    ? `Ocena dotyczy wersji ${evaluation.evaluatedVersion} modelu; bieżąca wersja to ${currentVersion}, więc ocena może być nieaktualna.`
    : null;
}
