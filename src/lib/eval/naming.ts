import { PROJECT_NAME_MAX_LENGTH } from "@/lib/schemas/project";

// Projekty pomiarowe skryptu ewaluacji (plan 10f, punkt 22). Nazwa i opis są widoczne dla czatu i `evaluate-v1`
// (jak w serii „P”), więc nie mogą zdradzać firmy, modelu ani faktu, że to test.

/** Opis każdego projektu pomiarowego: neutralny, bez metainformacji (kolumna `description` jest wymagana). */
export const EVAL_PROJECT_DESCRIPTION = "Nowy model biznesowy.";

const SERIES_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,23}$/;

export function isValidSeriesId(seriesId: string): boolean {
  return SERIES_ID_PATTERN.test(seriesId);
}

/**
 * `EV-<seria>-<przypadek>-p<powtórzenie>`, np. `EV-PILOT-1-BUILD-03-p1`; przy kolejnej próbie tego samego przebiegu
 * `-a<próba>` (np. `EV-PILOT-1-BUILD-03-p1-a2`). Bez nazwy firmy i modelu (model rozróżnia tabela `EvalRun`).
 */
export function buildEvalProjectName(args: { seriesId: string; caseId: string; repetition: number; attempt?: number }): string {
  const { seriesId, caseId, repetition, attempt = 1 } = args;
  if (!isValidSeriesId(seriesId)) {
    throw new Error("Niepoprawny identyfikator serii (litery, cyfry i myślniki, 1 do 24 znaków, bez myślnika na początku).");
  }
  if (!Number.isInteger(repetition) || repetition < 1 || !Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Powtórzenie i próba muszą być dodatnimi liczbami całkowitymi.");
  }
  const name = `EV-${seriesId}-${caseId}-p${repetition}${attempt > 1 ? `-a${attempt}` : ""}`;
  if (name.length > PROJECT_NAME_MAX_LENGTH) {
    throw new Error("Nazwa projektu pomiarowego jest za długa.");
  }
  return name;
}
