"use client";

import { useState, useTransition } from "react";
import { evaluateModelAction, judgeModelAction } from "@/app/projekty/[id]/evaluation-actions";
import { DIRTY_MESSAGE, useOptionalVariantWorkspace } from "@/components/bmc/variant-workspace";
import type { EvaluationListItem } from "@/lib/db/evaluations";
import { EvaluationTable } from "@/components/evaluation/evaluation-table";
import { ManualEvaluationForm } from "@/components/evaluation/manual-evaluation-form";
import { RadarChart, type RadarSeries } from "@/components/evaluation/radar-chart";
import {
  formatEvaluationDate,
  formatEvaluationSource,
  formatEvaluationSourceShort,
  isEvaluationStale,
} from "@/lib/evaluation/format";
import { comparableEvaluations } from "@/lib/evaluation/radar";
import { type EvaluationView } from "@/lib/schemas/evaluation";

const GENERIC_ERROR = "Nie udało się wykonać oceny. Sprawdź połączenie i spróbuj ponownie.";

type Props = {
  projectId: string;
  variantId: string;
  canEvaluate: boolean;
  // Przycisk „Oceń sędzią”: tylko przy włączonej fladze i skonfigurowanym sędzim (liczone na serwerze, nie w przeglądarce).
  judgeEnabled?: boolean;
  // Wersja wariantu z serwera w chwili renderu; z edytora (EDITOR+) bierzemy bieżącą.
  currentVersion: number;
  initialItems: EvaluationListItem[];
};

// Treści z bazy (model, wersja promptu, uzasadnienia, daty) są renderowane wyłącznie jako węzły tekstowe React.
export function EvaluationPanel({
  projectId,
  variantId,
  canEvaluate,
  judgeEnabled = false,
  currentVersion,
  initialItems,
}: Props) {
  const workspace = useOptionalVariantWorkspace();
  const dirty = workspace?.dirty ?? false;
  const version = workspace?.version ?? currentVersion;

  const [items, setItems] = useState<EvaluationListItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(() => firstValidId(initialItems));
  const [compareId, setCompareId] = useState<string>("");
  const [compareId2, setCompareId2] = useState<string>("");
  // Formularz oceny ręcznej: dopóki jest otwarty, panel nie pokazuje żadnych wyników ocen (ślepa próba).
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<"model" | "judge">("model");
  const [pending, startTransition] = useTransition();

  const selected = items.find((item) => item.ok && item.evaluation.id === selectedId);
  const evaluation = selected?.ok ? selected.evaluation : null;
  // Do nałożenia tylko poprawnie odczytane oceny z tym samym schemaVersion; uszkodzone wiersze nie są wybieralne.
  const comparable = comparableEvaluations(items, selectedId);
  const overlay = comparable.find((item) => item.id === compareId) ?? null;
  // Druga nakładka: z pozostałych ocen, dostępna dopiero po wyborze pierwszej.
  const comparable2 = overlay ? comparable.filter((item) => item.id !== overlay.id) : [];
  const overlay2 = comparable2.find((item) => item.id === compareId2) ?? null;
  const series: RadarSeries[] = evaluation
    ? [{ id: evaluation.id, legend: `Wybrana: ${describe(evaluation)}`, result: evaluation.result }]
    : [];
  if (evaluation && overlay) {
    series.push({ id: overlay.id, legend: `Nałożona: ${describe(overlay)}`, result: overlay.result });
    if (overlay2) {
      series.push({ id: overlay2.id, legend: `Nałożona (druga): ${describe(overlay2)}`, result: overlay2.result });
    }
  }

  function handleSaved(saved: EvaluationView) {
    setItems((current) => [{ ok: true, evaluation: saved }, ...current]);
    setSelectedId(saved.id);
    setCompareId("");
    setCompareId2("");
    setFormOpen(false);
  }

  function evaluate(kind: "model" | "judge") {
    if (dirty || pending) {
      return;
    }
    setError(null);
    setPendingKind(kind);
    startTransition(async () => {
      try {
        const result = kind === "judge" ? await judgeModelAction(projectId, variantId) : await evaluateModelAction(projectId, variantId);
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
        {formOpen ? null : evaluation?.source === "MANUAL" ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-bold">Ocena ręczna</span>
        ) : evaluation?.source === "JUDGE" ? (
          <span className="rounded-full border border-ai-border bg-ai-bg px-2 py-0.5 text-xs font-bold text-ai-fg">
            Ocena sędziego (AI)
          </span>
        ) : (
          <span className="rounded-full border border-ai-border bg-ai-bg px-2 py-0.5 text-xs font-bold text-ai-fg">
            Ocena AI
          </span>
        )}
      </div>

      <p className="text-sm text-muted">
        Ocena AI to subiektywna opinia modelu językowego na podstawie wpisów w płótnie, a nie weryfikacja biznesowa. Model
        nie sprawdza rynku ani danych liczbowych. Ocena ręczna to Twoja własna ocena według tej samej rubryki.
        {judgeEnabled
          ? " Ocena sędziego pochodzi od osobnego modelu z innej rodziny, który widzi wyłącznie wpisy w dziewięciu blokach."
          : ""}{" "}
        Wszystkie dotyczą zapisanego stanu wariantu, nie niezapisanych zmian w edytorze.
      </p>

      {formOpen ? (
        <ManualEvaluationForm
          projectId={projectId}
          variantId={variantId}
          onSaved={handleSaved}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}

      {canEvaluate && !formOpen ? (
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => evaluate("model")}
              disabled={pending || dirty}
              className="rounded-lg bg-cta px-4 py-2 text-sm font-bold hover:bg-tint disabled:opacity-50"
            >
              {pending && pendingKind === "model" ? "Oceniam…" : "Oceń model"}
            </button>
            {judgeEnabled ? (
              <button
                type="button"
                onClick={() => evaluate("judge")}
                disabled={pending || dirty}
                className="rounded-lg border border-ai-border bg-ai-bg px-4 py-2 text-sm font-bold text-ai-fg hover:bg-tint disabled:opacity-50"
              >
                {pending && pendingKind === "judge" ? "Sędzia ocenia…" : "Oceń sędzią (AI)"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              disabled={pending || dirty}
              className="rounded-lg border border-border px-4 py-2 text-sm font-bold hover:bg-tint disabled:opacity-50"
            >
              Dodaj ocenę ręczną
            </button>
          </div>
          {dirty ? <p className="text-sm text-muted">{DIRTY_MESSAGE}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {formOpen ? null : evaluation ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {formatEvaluationSource(evaluation)}
            {evaluation.source !== "MANUAL" ? ` · prompt: ${evaluation.promptVersion ?? "brak"}` : ""} ·{" "}
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
                onChange={(event) => {
                  setCompareId(event.target.value);
                  setCompareId2("");
                }}
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
          {comparable2.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Nałóż trzecią ocenę</span>
              <select
                value={overlay2 ? overlay2.id : ""}
                onChange={(event) => setCompareId2(event.target.value)}
                className="rounded-lg border border-border bg-transparent px-2 py-1.5"
              >
                <option value="">Bez drugiej nakładki</option>
                {comparable2.map((item) => (
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

      {!formOpen && items.length > 0 ? (
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
  return `${formatEvaluationDate(evaluation.createdAt)} · ${formatEvaluationSourceShort(evaluation)} · wersja modelu ${evaluation.variantVersion}`;
}

function firstValidId(items: EvaluationListItem[]): string | null {
  for (const item of items) {
    if (item.ok) {
      return item.evaluation.id;
    }
  }
  return null;
}
