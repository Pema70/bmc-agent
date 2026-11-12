"use client";

import { useOptionalImpact } from "@/components/impact/impact-provider";
import { describeChange, isImpactStale } from "@/lib/impact/format";

/** Pasek nad płótnem, gdy wyświetlana jest analiza wpływu: znacznik "Analiza AI", wersje i "Ukryj analizę". */
export function ImpactCanvasBanner() {
  const impact = useOptionalImpact();
  const active = impact?.active ?? null;
  if (!impact || !active) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-md border border-zinc-300 bg-zinc-50 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-amber-600 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          Analiza AI
        </span>
        <span className="min-w-0 break-words">Wyróżnione bloki dotyczą zmiany: {describeChange(active.change)}</span>
        <button
          type="button"
          onClick={impact.hide}
          className="ml-auto rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Ukryj analizę
        </button>
      </div>
      {isImpactStale(active.variantVersion, impact.currentVersion) ? (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Analiza dla wersji {active.variantVersion}, aktualna to {impact.currentVersion}. Wyróżnienie może dotyczyć już
          zmienionego stanu płótna.
        </p>
      ) : null}
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Jakościowa opinia modelu, nie weryfikacja biznesowa. Stopień wpływu: ramka (cienka przerywana: niski, gruba
        przerywana: średni, gruba ciągła: wysoki) i plakietka w nagłówku bloku.
      </p>
    </div>
  );
}
