"use client";

import { useEffect, useState } from "react";
import { getImpactAnalysisAction } from "@/app/projekty/[id]/impact-actions";
import { useOptionalImpact } from "@/components/impact/impact-provider";
import { ImpactNotice, ImpactResult } from "@/components/impact/impact-result";
import type { ImpactListItem } from "@/lib/db/impact";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; item: ImpactListItem };

const buttonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

/**
 * Karta wyniku analizy wpływu w czacie. Dane czytamy z bazy po identyfikatorze zwróconym przez narzędzie
 * (nie z tekstu modelu), a treść renderujemy tymi samymi komponentami co panel, wyłącznie jako zwykły tekst.
 * "Pokaż na płótnie" korzysta z ImpactProvider; przycisk pojawia się, gdy analiza jest już na liście
 * (po router.refresh() na końcu tury).
 */
export function ImpactCard({
  projectId,
  variantId,
  analysisId,
}: {
  projectId: string;
  variantId: string;
  analysisId: string;
}) {
  const impact = useOptionalImpact();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getImpactAnalysisAction(projectId, variantId, analysisId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setState(result.ok ? { status: "ready", item: result.item } : { status: "error", message: result.message });
      })
      .catch((caught: unknown) => {
        console.error("Nie udało się wczytać analizy wpływu", caught);
        if (!cancelled) {
          setState({ status: "error", message: "Nie udało się wczytać analizy." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, variantId, analysisId]);

  if (state.status === "loading") {
    return <p className="text-zinc-500">Wczytuję analizę…</p>;
  }
  if (state.status === "error") {
    return <p className="text-red-700 dark:text-red-400">{state.message}</p>;
  }
  if (!state.item.ok) {
    return <p className="text-red-700 dark:text-red-400">Nie można wyświetlić zapisanej analizy: {state.item.error}</p>;
  }

  const analysis = state.item.analysis;
  const onCanvas = impact?.activeId === analysis.id;
  const available = impact?.items.some((item) => item.ok && item.analysis.id === analysis.id) ?? false;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
      <span className="font-semibold">Analiza wpływu zmiany</span>
      <ImpactNotice />
      <ImpactResult analysis={analysis} currentVersion={impact?.currentVersion ?? analysis.variantVersion} />
      {impact && available ? (
        <div>
          {onCanvas ? (
            <button type="button" onClick={impact.hide} className={buttonClass}>
              Ukryj analizę
            </button>
          ) : (
            <button type="button" onClick={() => impact.show(analysis.id)} className={buttonClass}>
              Pokaż na płótnie
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
