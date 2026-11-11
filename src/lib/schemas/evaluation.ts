import { z } from "zod";

// Wersja kształtu EvaluationOutput zapisywana w EvaluationResult.schemaVersion. Zmiana kryteriów
// podbija tę wartość, a odczyt starszych rekordów jest wtedy obsługiwany jawnie (albo odrzucany per rekord).
export const EVALUATION_SCHEMA_VERSION = 1;

// Wszystkie osie: więcej = lepiej. Dla ryzyka 10 oznacza ryzyko niskie i dobrze zaadresowane.
export const EVALUATION_CRITERIA = ["coherence", "risk_resilience", "feasibility", "innovation"] as const;
export const EvaluationCriterion = z.enum(EVALUATION_CRITERIA);
export type EvaluationCriterion = z.infer<typeof EvaluationCriterion>;

export const CRITERION_LABELS: Record<EvaluationCriterion, string> = {
  coherence: "Spójność",
  risk_resilience: "Ryzyko (10 = niskie)",
  feasibility: "Realność",
  innovation: "Innowacyjność",
};

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
export const JUSTIFICATION_MAX_LENGTH = 600;

export const CriterionEvaluation = z.strictObject({
  score: z
    .number({ error: "Ocena musi być liczbą." })
    .int({ error: "Ocena musi być liczbą całkowitą." })
    .min(SCORE_MIN, { error: `Ocena nie może być mniejsza niż ${SCORE_MIN}.` })
    .max(SCORE_MAX, { error: `Ocena nie może być większa niż ${SCORE_MAX}.` })
    .describe("Ocena całkowita od 1 do 10 (więcej = lepiej)."),
  justification: z
    .string({ error: "Uzasadnienie musi być tekstem." })
    .trim()
    .min(1, { error: "Uzasadnienie nie może być puste." })
    .max(JUSTIFICATION_MAX_LENGTH, { error: `Uzasadnienie może mieć najwyżej ${JUSTIFICATION_MAX_LENGTH} znaków.` })
    .describe("Krótkie uzasadnienie po polsku, oparte wyłącznie na treści modelu BMC."),
});
export type CriterionEvaluation = z.infer<typeof CriterionEvaluation>;

export const EvaluationOutput = z.strictObject({
  coherence: CriterionEvaluation,
  risk_resilience: CriterionEvaluation,
  feasibility: CriterionEvaluation,
  innovation: CriterionEvaluation,
});
export type EvaluationOutput = z.infer<typeof EvaluationOutput>;

export const EvaluationSource = z.enum(["AI", "MANUAL"]);
export const EvaluationTrigger = z.enum(["UI", "CHAT"]);

/** Ocena gotowa do wyświetlenia (bez migawki stanu). Id zawsze z bazy. */
export type EvaluationView = {
  id: string;
  createdAt: Date;
  schemaVersion: number;
  variantVersion: number;
  source: z.infer<typeof EvaluationSource>;
  trigger: z.infer<typeof EvaluationTrigger> | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  result: EvaluationOutput;
};
