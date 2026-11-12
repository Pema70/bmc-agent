"use client";

import { useOptionalImpact } from "@/components/impact/impact-provider";
import { impactLabel, type BlockHighlight } from "@/lib/impact/highlights";
import type { BlockKey } from "@/lib/schemas/bmc";
import type { ImpactLevel } from "@/lib/schemas/impact";

// Obramowanie niesie stopień także bez koloru: niski = cienkie przerywane, średni = grube przerywane,
// wysoki = grube ciągłe. Blok zmieniany: podwójna ramka. Kolory dobrane tak, by nie mylić się z czerwienią/zielenią
// diffu propozycji ani z bursztynem propozycji; w trybie ciemnym jaśniejsze odcienie.
const LEVEL_BORDER: Record<ImpactLevel, string> = {
  low: "border border-dashed border-sky-600 dark:border-sky-400",
  medium: "border-2 border-dashed border-blue-700 dark:border-blue-400",
  high: "border-2 border-solid border-indigo-800 dark:border-indigo-300",
};
const CHANGED_BORDER = "border-4 border-double border-teal-700 dark:border-teal-300";
const DEFAULT_BORDER = "border border-zinc-300 dark:border-zinc-700";

const LEVEL_BADGE: Record<ImpactLevel, string> = {
  low: "bg-sky-100 text-sky-900 ring-1 ring-sky-600 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-400",
  medium: "bg-blue-100 text-blue-900 ring-1 ring-blue-700 dark:bg-blue-950 dark:text-blue-100 dark:ring-blue-400",
  high: "bg-indigo-100 text-indigo-950 ring-1 ring-indigo-800 dark:bg-indigo-950 dark:text-indigo-100 dark:ring-indigo-300",
};
const CHANGED_BADGE =
  "bg-teal-100 text-teal-900 ring-1 ring-teal-700 dark:bg-teal-950 dark:text-teal-100 dark:ring-teal-300";

export type BlockImpactState =
  | { kind: "none" }
  | { kind: "changed" }
  | { kind: "affected"; highlight: BlockHighlight };

/** Wyróżnienie bloku z aktywnej analizy; bez dostawcy lub bez aktywnej analizy: brak wyróżnienia. */
export function useBlockImpact(blockKey: BlockKey): BlockImpactState {
  const highlights = useOptionalImpact()?.highlights ?? null;
  if (!highlights) {
    return { kind: "none" };
  }
  if (highlights.changedBlock === blockKey) {
    return { kind: "changed" };
  }
  const highlight = highlights.byBlock[blockKey];
  return highlight ? { kind: "affected", highlight } : { kind: "none" };
}

/** Klasy ramki bloku (zastępują domyślne obramowanie karty). */
export function impactBorderClass(state: BlockImpactState): string {
  if (state.kind === "changed") {
    return CHANGED_BORDER;
  }
  if (state.kind === "affected") {
    return LEVEL_BORDER[state.highlight.level];
  }
  return DEFAULT_BORDER;
}

/** Plakietka w nagłówku bloku: tekst, a nie sam kolor. */
export function ImpactBadge({ state }: { state: BlockImpactState }) {
  if (state.kind === "changed") {
    return <span className={`w-fit rounded px-1.5 py-0.5 text-xs font-semibold ${CHANGED_BADGE}`}>Zmiana</span>;
  }
  if (state.kind === "affected") {
    return (
      <span className={`w-fit rounded px-1.5 py-0.5 text-xs font-semibold ${LEVEL_BADGE[state.highlight.level]}`}>
        {impactLabel(state.highlight.level)}
      </span>
    );
  }
  return null;
}

/** Opis wpływu rozwijany na żądanie. Treść od modelu: zwykły tekst (węzeł tekstowy), bez HTML i Markdown. */
export function ImpactDetails({ state }: { state: BlockImpactState }) {
  if (state.kind !== "affected") {
    return null;
  }
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium">Opis wpływu (analiza AI)</summary>
      <p className="mt-1 whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">{state.highlight.impact}</p>
    </details>
  );
}
