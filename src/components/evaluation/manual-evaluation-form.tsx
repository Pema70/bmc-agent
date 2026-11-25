"use client";

import { useState, useTransition } from "react";
import { createManualEvaluationAction } from "@/app/projekty/[id]/evaluation-actions";
import { CRITERION_RUBRIC, RUBRIC_RISK_REMINDER } from "@/lib/evaluation/rubric";
import {
  CRITERION_LABELS,
  EVALUATION_CRITERIA,
  JUSTIFICATION_MAX_LENGTH,
  SCORE_MAX,
  SCORE_MIN,
  type EvaluationCriterion,
  type EvaluationView,
} from "@/lib/schemas/evaluation";

const GENERIC_ERROR = "Nie udało się zapisać oceny. Sprawdź połączenie i spróbuj ponownie.";

type Props = {
  projectId: string;
  variantId: string;
  onSaved: (evaluation: EvaluationView) => void;
  onCancel: () => void;
};

type Fields = Record<EvaluationCriterion, string>;

function emptyFields(): Fields {
  return { coherence: "", risk_resilience: "", feasibility: "", innovation: "" };
}

/**
 * Formularz ręcznej oceny referencyjnej. Panel nie pokazuje wyników AI, dopóki formularz jest otwarty (ślepa ocena).
 * Rubryka (definicje i progi) pochodzi z `rubric.ts`, tych samych co w prompcie oceny AI. Wszystkie treści to zwykły tekst.
 */
export function ManualEvaluationForm({ projectId, variantId, onSaved, onCancel }: Props) {
  const [scores, setScores] = useState<Fields>(emptyFields);
  const [justifications, setJustifications] = useState<Fields>(emptyFields);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setError(null);
    const input = Object.fromEntries(
      EVALUATION_CRITERIA.map((criterion) => [
        criterion,
        { score: scores[criterion].trim() === "" ? Number.NaN : Number(scores[criterion]), justification: justifications[criterion] },
      ]),
    );
    startTransition(async () => {
      try {
        const result = await createManualEvaluationAction(projectId, variantId, input);
        if (result.ok) {
          onSaved(result.evaluation);
        } else {
          setError(result.message);
        }
      } catch (caught) {
        console.error("Zapis oceny ręcznej nie powiódł się", caught);
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-labelledby="manual-evaluation-heading">
      <div className="flex flex-col gap-1">
        <h3 id="manual-evaluation-heading" className="text-sm font-semibold">
          Ocena ręczna (ślepa)
        </h3>
        <p className="text-sm text-muted">
          Wyniki oceny AI są ukryte, dopóki formularz jest otwarty. Oceń zapisany stan wariantu według rubryki, w skali od{" "}
          {SCORE_MIN} do {SCORE_MAX} (więcej = lepiej).
        </p>
      </div>

      {EVALUATION_CRITERIA.map((criterion) => {
        const rubric = CRITERION_RUBRIC[criterion];
        const scoreId = `manual-score-${criterion}`;
        const justificationId = `manual-justification-${criterion}`;
        return (
          <fieldset key={criterion} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold">{CRITERION_LABELS[criterion]}</legend>
            <p className="text-sm text-muted">
              Rubryka: {rubric.description} 1-3: {rubric.low}; 4-6: {rubric.mid}; 7-10: {rubric.high}.
              {criterion === "risk_resilience" ? ` Pamiętaj: ${RUBRIC_RISK_REMINDER}` : ""}
            </p>
            <label htmlFor={scoreId} className="flex items-center gap-2 text-sm">
              <span className="font-medium">Ocena ({SCORE_MIN}-{SCORE_MAX})</span>
              <input
                id={scoreId}
                type="number"
                inputMode="numeric"
                min={SCORE_MIN}
                max={SCORE_MAX}
                step={1}
                required
                value={scores[criterion]}
                onChange={(event) => setScores((current) => ({ ...current, [criterion]: event.target.value }))}
                className="w-20 rounded-lg border border-border bg-transparent px-2 py-1.5"
              />
            </label>
            <label htmlFor={justificationId} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Uzasadnienie</span>
              <textarea
                id={justificationId}
                required
                rows={3}
                maxLength={JUSTIFICATION_MAX_LENGTH}
                value={justifications[criterion]}
                onChange={(event) => setJustifications((current) => ({ ...current, [criterion]: event.target.value }))}
                className="rounded-lg border border-border bg-transparent px-2 py-1.5"
              />
              <span className="text-xs text-muted">
                {justifications[criterion].length} / {JUSTIFICATION_MAX_LENGTH} znaków
              </span>
            </label>
          </fieldset>
        );
      })}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-cta px-4 py-2 text-sm font-bold hover:bg-tint disabled:opacity-50"
        >
          {pending ? "Zapisuję…" : "Zapisz ocenę ręczną"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-border px-4 py-2 text-sm font-bold hover:bg-tint disabled:opacity-50"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}
