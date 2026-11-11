"use client";

import { useState, useTransition } from "react";
import { evaluateModelAction } from "@/app/projekty/[id]/evaluation-actions";
import { DIRTY_MESSAGE, useOptionalVariantWorkspace } from "@/components/bmc/variant-workspace";
import type { EvaluationListItem } from "@/lib/db/evaluations";
import { formatEvaluationDate, formatEvaluationSource, isEvaluationStale } from "@/lib/evaluation/format";
import { CRITERION_LABELS, EVALUATION_CRITERIA, SCORE_MAX } from "@/lib/schemas/evaluation";

const GENERIC_ERROR = "Nie udało się wykonać oceny. Sprawdź połączenie i spróbuj ponownie.";

type Props = {
  projectId: string;
  variantId: string;
  canEvaluate: boolean;
  // Wersja wariantu z serwera w chwili renderu; z edytora (EDITOR+) bierzemy bieżącą.
  currentVersion: number;
  initialItems: EvaluationListItem[];
};

// Treści z bazy (model, wersja promptu, uzasadnienia, daty) są renderowane wyłącznie jako węzły tekstowe React.
export function EvaluationPanel({ projectId, variantId, canEvaluate, currentVersion, initialItems }: Props) {
  const workspace = useOptionalVariantWorkspace();
  const dirty = workspace?.dirty ?? false;
  const version = workspace?.version ?? currentVersion;

  const [items, setItems] = useState<EvaluationListItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(() => firstValidId(initialItems));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = items.find((item) => item.ok && item.evaluation.id === selectedId);
  const evaluation = selected?.ok ? selected.evaluation : null;

  function evaluate() {
    if (dirty || pending) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await evaluateModelAction(projectId, variantId);
        if (result.ok) {
          setItems((current) => [{ ok: true, evaluation: result.evaluation }, ...current]);
          setSelectedId(result.evaluation.id);
        } else {
          setError(result.message);
        }
      } catch (caught) {
        console.error("Ocena modelu nie powiodła się", caught);
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="evaluation-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="evaluation-heading" className="text-lg font-semibold">
          Ocena modelu
        </h2>
        <span className="rounded-full border border-amber-600 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          Ocena AI
        </span>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        To subiektywna opinia modelu językowego na podstawie wpisów w płótnie, a nie weryfikacja biznesowa. Model nie
        sprawdza rynku ani danych liczbowych. Ocena dotyczy zapisanego stanu wariantu, nie niezapisanych zmian w edytorze.
      </p>

      {canEvaluate ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={evaluate}
            disabled={pending || dirty}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending ? "Oceniam…" : "Oceń model"}
          </button>
          {dirty ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{DIRTY_MESSAGE}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {evaluation ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatEvaluationSource(evaluation)} · prompt: {evaluation.promptVersion ?? "brak"} ·{" "}
            {formatEvaluationDate(evaluation.createdAt)} · wersja modelu: {evaluation.variantVersion}
          </p>
          {isEvaluationStale(evaluation.variantVersion, version) ? (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Ocena dotyczy wersji {evaluation.variantVersion} modelu, aktualna wersja to {version}.
            </p>
          ) : null}
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Oceny kryteriów modelu BMC w skali 1-{SCORE_MAX}</caption>
            <thead>
              <tr className="border-b border-zinc-300 dark:border-zinc-700">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Kryterium
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Ocena
                </th>
                <th scope="col" className="py-2 font-medium">
                  Uzasadnienie
                </th>
              </tr>
            </thead>
            <tbody>
              {EVALUATION_CRITERIA.map((criterion) => (
                <tr key={criterion} className="border-b border-zinc-200 align-top dark:border-zinc-800">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {CRITERION_LABELS[criterion]}
                  </th>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {evaluation.result[criterion].score}/{SCORE_MAX}
                  </td>
                  <td className="py-2 whitespace-pre-line">{evaluation.result[criterion].justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {items.length === 0 ? "Ten wariant nie ma jeszcze żadnej oceny." : "Wybierz ocenę z historii."}
        </p>
      )}

      {items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Historia ocen</h3>
          <ul className="flex flex-col gap-1">
            {items.map((item) =>
              item.ok ? (
                <li key={item.evaluation.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.evaluation.id)}
                    aria-pressed={item.evaluation.id === selectedId}
                    className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 aria-pressed:border-zinc-900 aria-pressed:font-medium dark:border-zinc-700 dark:hover:bg-zinc-800 dark:aria-pressed:border-zinc-300"
                  >
                    {formatEvaluationDate(item.evaluation.createdAt)} · {formatEvaluationSource(item.evaluation)} · wersja
                    modelu: {item.evaluation.variantVersion}
                  </button>
                </li>
              ) : (
                <li
                  key={item.id}
                  className="rounded-md border border-red-600 px-3 py-1.5 text-sm text-red-700 dark:text-red-400"
                >
                  Nie można wyświetlić zapisanej oceny ({item.id}): {item.error}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function firstValidId(items: EvaluationListItem[]): string | null {
  for (const item of items) {
    if (item.ok) {
      return item.evaluation.id;
    }
  }
  return null;
}
