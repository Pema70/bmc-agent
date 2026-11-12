"use client";

import { useEffect, useState } from "react";
import { getEvaluationAction } from "@/app/projekty/[id]/evaluation-actions";
import { EvaluationTable } from "@/components/evaluation/evaluation-table";
import type { EvaluationListItem } from "@/lib/db/evaluations";
import { formatEvaluationDate, formatEvaluationSource } from "@/lib/evaluation/format";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; item: EvaluationListItem };

/**
 * Karta wyniku oceny w czacie. Dane czytamy z bazy po identyfikatorze zwróconym przez narzędzie
 * (nie z tekstu modelu), a treść renderujemy wyłącznie jako zwykły tekst.
 */
export function EvaluationCard({
  projectId,
  variantId,
  evaluationId,
}: {
  projectId: string;
  variantId: string;
  evaluationId: string;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getEvaluationAction(projectId, variantId, evaluationId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setState(result.ok ? { status: "ready", item: result.item } : { status: "error", message: result.message });
      })
      .catch((caught: unknown) => {
        console.error("Nie udało się wczytać oceny", caught);
        if (!cancelled) {
          setState({ status: "error", message: "Nie udało się wczytać oceny." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, variantId, evaluationId]);

  if (state.status === "loading") {
    return <p className="text-zinc-500">Wczytuję ocenę…</p>;
  }
  if (state.status === "error") {
    return <p className="text-red-700 dark:text-red-400">{state.message}</p>;
  }
  if (!state.item.ok) {
    return <p className="text-red-700 dark:text-red-400">Nie można wyświetlić zapisanej oceny: {state.item.error}</p>;
  }

  const evaluation = state.item.evaluation;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Ocena modelu</span>
        <span className="rounded-full border border-amber-600 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          Ocena AI
        </span>
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Oceniono zapisany stan modelu, wersja {evaluation.variantVersion}. Niezapisane zmiany w edytorze nie były brane
        pod uwagę. {formatEvaluationSource(evaluation)} · prompt: {evaluation.promptVersion ?? "brak"} ·{" "}
        {formatEvaluationDate(evaluation.createdAt)}
      </p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        To subiektywna opinia modelu językowego, a nie weryfikacja biznesowa.
      </p>
      <EvaluationTable result={evaluation.result} />
    </div>
  );
}
