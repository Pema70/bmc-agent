import type { EvaluationView } from "@/lib/schemas/evaluation";

/** Stała data w UTC, żeby serwer i przeglądarka renderowały ten sam tekst (bez różnic stref czasowych). */
export function formatEvaluationDate(date: Date): string {
  const iso = new Date(date).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Źródło oceny jako zwykły tekst: model i dostawca dla oceny AI, "ręczna" dla oceny ręcznej. */
export function formatEvaluationSource(evaluation: Pick<EvaluationView, "source" | "provider" | "model">): string {
  if (evaluation.source === "MANUAL") {
    return "Ocena ręczna";
  }
  return `Ocena AI: ${evaluation.provider ?? "?"} / ${evaluation.model ?? "?"}`;
}

/** Krótka etykieta źródła do legendy wykresu: „AI”, „ręczna” (10d doda „sędzia”). */
export function formatEvaluationSourceShort(evaluation: Pick<EvaluationView, "source">): string {
  return evaluation.source === "MANUAL" ? "ręczna" : "AI";
}

/** Ocena dotyczy starszej wersji modelu niż aktualna. */
export function isEvaluationStale(evaluationVariantVersion: number, currentVersion: number): boolean {
  return evaluationVariantVersion < currentVersion;
}
