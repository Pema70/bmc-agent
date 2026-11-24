"use client";

import { useState, useTransition } from "react";
import { evaluateModelAction } from "@/app/projekty/[id]/evaluation-actions";
import { DIRTY_MESSAGE, useOptionalVariantWorkspace } from "@/components/bmc/variant-workspace";
import type { EvaluationListItem } from "@/lib/db/evaluations";
import { EvaluationTable } from "@/components/evaluation/evaluation-table";
import { RadarChart, type RadarSeries } from "@/components/evaluation/radar-chart";
import { formatEvaluationDate, formatEvaluationSource, isEvaluationStale } from "@/lib/evaluation/format";
import { comparableEvaluations } from "@/lib/evaluation/radar";
import { type EvaluationView } from "@/lib/schemas/evaluation";

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
  const [compareId, setCompareId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = items.find((item) => item.ok && item.evaluation.id === selectedId);
  const evaluation = selected?.ok ? selected.evaluation : null;
  // Do nałożenia tylko poprawnie odczytane oceny z tym samym schemaVersion; uszkodzone wiersze nie są wybieralne.
  const comparable = comparableEvaluations(items, selectedId);
  const overlay = comparable.find((item) => item.id === compareId) ?? null;
  const series: RadarSeries[] = evaluation
    ? [{ id: evaluation.id, legend: `Wybrana: ${describe(evaluation)}`, result: evaluation.result }]
    : [];
  if (evaluation && overlay) {
    series.push({ id: overlay.id, legend: `Nałożona: ${describe(overlay)}`, result: overlay.result });
  }

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
        <h2 id="evaluation-heading" className="sr-only">
          Ocena modelu
        </h2>
        <span className="rounded-full border border-ai-border bg-ai-bg px-2 py-0.5 text-xs font-bold text-ai-fg">
          Ocena AI
        </span>
      </div>

      <p className="text-sm text-muted">
        To subiektywna opinia modelu językowego na podstawie wpisów w płótnie, a nie weryfikacja biznesowa. Model nie
        sprawdza rynku ani danych liczbowych. Ocena dotyczy zapisanego stanu wariantu, nie niezapisanych zmian w edytorze.
      </p>

      {canEvaluate ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={evaluate}
            disabled={pending || dirty}
            className="rounded-lg bg-cta px-4 py-2 text-sm font-bold hover:bg-tint disabled:opacity-50"
          >
            {pending ? "Oceniam…" : "Oceń model"}
          </button>
          {dirty ? <p className="text-sm text-muted">{DIRTY_MESSAGE}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {evaluation ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {formatEvaluationSource(evaluation)} · prompt: {evaluation.promptVersion ?? "brak"} ·{" "}
            {formatEvaluationDate(evaluation.createdAt)} · wersja modelu: {evaluation.variantVersion}
          </p>
          {isEvaluationStale(evaluation.variantVersion, version) ? (
            <p className="text-sm text-medium-fg">
              Ocena dotyczy wersji {evaluation.variantVersion} modelu, aktualna wersja to {version}.
            </p>
          ) : null}
          <RadarChart series={series} />
          {comparable.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Nałóż drugą ocenę</span>
              <select
                value={overlay ? overlay.id : ""}
                onChange={(event) => setCompareId(event.target.value)}
                className="rounded-lg border border-border bg-transparent px-2 py-1.5"
              >
                <option value="">Bez nakładki</option>
                {comparable.map((item) => (
                  <option key={item.id} value={item.id} className="bg-surface text-text">
                    {describe(item)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <EvaluationTable result={evaluation.result} />
        </div>
      ) : (
        <p className="text-sm text-muted">
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
                    className="w-full rounded-lg border border-border px-3 py-1.5 text-left text-sm hover:bg-tint aria-pressed:border-primary-from aria-pressed:font-medium"
                  >
                    {formatEvaluationDate(item.evaluation.createdAt)} · {formatEvaluationSource(item.evaluation)} · wersja
                    modelu: {item.evaluation.variantVersion}
                  </button>
                </li>
              ) : (
                <li
                  key={item.id}
                  className="rounded-lg border border-danger px-3 py-1.5 text-sm text-danger"
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

function describe(evaluation: EvaluationView): string {
  return `${formatEvaluationDate(evaluation.createdAt)} · ${formatEvaluationSource(evaluation)}`;
}

function firstValidId(items: EvaluationListItem[]): string | null {
  for (const item of items) {
    if (item.ok) {
      return item.evaluation.id;
    }
  }
  return null;
}
