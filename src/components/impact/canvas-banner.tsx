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
      className="flex flex-col gap-1 rounded-xl border border-border bg-tint p-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-ai-border bg-ai-bg px-2 py-0.5 text-xs font-bold text-ai-fg">
          Analiza AI
        </span>
        <span className="min-w-0 break-words">Wyróżnione bloki dotyczą zmiany: {describeChange(active.change)}</span>
        <button
          type="button"
          onClick={impact.hide}
          className="ml-auto rounded-lg border border-border px-2 py-1 text-xs font-bold hover:bg-tint"
        >
          Ukryj analizę
        </button>
      </div>
      {isImpactStale(active.variantVersion, impact.currentVersion) ? (
        <p className="text-xs text-medium-fg">
          Analiza dla wersji {active.variantVersion}, aktualna to {impact.currentVersion}. Wyróżnienie może dotyczyć już
          zmienionego stanu płótna.
        </p>
      ) : null}
      <p className="text-xs text-muted">
        Jakościowa opinia modelu, nie weryfikacja biznesowa. Stopień wpływu: ramka (cienka przerywana: niski, gruba
        przerywana: średni, gruba ciągła: wysoki) i plakietka w nagłówku bloku.
      </p>
    </div>
  );
}
