import { type BlockKey } from "@/lib/schemas/bmc";
import { IMPACT_LEVEL_LABELS, type ImpactLevel, type ImpactView } from "@/lib/schemas/impact";
import { sortAffected } from "@/lib/impact/format";

export type BlockHighlight = {
  blockKey: BlockKey;
  level: ImpactLevel;
  // Tekst plakietki w nagłówku bloku, żeby stopień nie wynikał tylko z koloru ramki.
  label: string;
  // Opis od modelu: niezaufany tekst, wyświetlany wyłącznie jako zwykły tekst.
  impact: string;
};

export type ImpactHighlights = {
  analysisId: string;
  variantVersion: number;
  changedBlock: BlockKey;
  // Stopień malejąco, potem kanoniczna kolejność bloków.
  ordered: BlockHighlight[];
  byBlock: Partial<Record<BlockKey, BlockHighlight>>;
};

export function impactLabel(level: ImpactLevel): string {
  return `Wpływ: ${IMPACT_LEVEL_LABELS[level]}`;
}

/**
 * Czysta funkcja: z analizy robi dane do wyróżnienia na płótnie. Blok zmieniany nie trafia do listy
 * dotkniętych (dostaje osobną plakietkę "Zmiana"), nawet gdyby zapisany rekord go zawierał.
 */
export function impactHighlights(analysis: ImpactView): ImpactHighlights {
  const changedBlock = analysis.change.blockKey;
  const ordered = sortAffected(analysis.result.affected)
    .filter((item) => item.blockKey !== changedBlock)
    .map((item) => ({
      blockKey: item.blockKey,
      level: item.level,
      label: impactLabel(item.level),
      impact: item.impact,
    }));
  const byBlock: Partial<Record<BlockKey, BlockHighlight>> = {};
  for (const item of ordered) {
    byBlock[item.blockKey] = item;
  }
  return { analysisId: analysis.id, variantVersion: analysis.variantVersion, changedBlock, ordered, byBlock };
}
