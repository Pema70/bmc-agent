"use client";

import { useOptionalImpact } from "@/components/impact/impact-provider";
import { impactLabel, type BlockHighlight } from "@/lib/impact/highlights";
import type { BlockKey } from "@/lib/schemas/bmc";
import type { ImpactLevel } from "@/lib/schemas/impact";

// Obramowanie niesie stopień także bez koloru: niski = cienkie przerywane, średni = grube przerywane,
// wysoki = grube ciągłe. Blok zmieniany: podwójna ramka. Kolory to tokeny stanów (zielony, bursztynowy, czerwony); ponieważ
// diff propozycji też używa czerwieni i zieleni, a oznaczenie AI fioletu, stopień zawsze rozróżnia kształt ramki i etykieta.
const LEVEL_BORDER: Record<ImpactLevel, string> = {
  low: "border border-dashed border-low-border",
  medium: "border-2 border-dashed border-medium-border",
  high: "border-2 border-solid border-high-border",
};
const CHANGED_BORDER = "border-4 border-double border-main-border";
const DEFAULT_BORDER = "border border-border";

const LEVEL_BADGE: Record<ImpactLevel, string> = {
  low: "bg-low-bg text-low-fg ring-1 ring-low-border",
  medium: "bg-medium-bg text-medium-fg ring-1 ring-medium-border",
  high: "bg-high-bg text-high-fg ring-1 ring-high-border",
};
const CHANGED_BADGE =
  "bg-main-bg text-main-fg ring-1 ring-main-border";

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
      <p className="mt-1 whitespace-pre-wrap break-words text-muted">{state.highlight.impact}</p>
    </details>
  );
}
