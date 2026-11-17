import type { ComparisonListItem } from "@/lib/db/comparisons";
import { formatEvaluationDate } from "@/lib/evaluation/format";
import {
  COMPARE_VARIANTS_MAX,
  COMPARE_VARIANTS_MIN,
  CompareVariantIds,
  type CompareLabel,
  type ComparedVariantSummary,
  type VariantComparisonSummary,
  type VariantComparisonView,
} from "@/lib/schemas/compare";

export const COMPARE_AI_LABEL = "Analiza AI";

export const COMPARE_NOTICE =
  "Porównanie i rekomendacja to opinia modelu językowego, a nie weryfikacja biznesowa. " +
  "Różnice we wpisach wylicza aplikacja, nie model.";

export type ParsedCompareParams = { ok: true; ids: string[] } | { ok: false };

/**
 * Parametry `w` ze strony porównania: mogą się powtarzać (tablica) albo wystąpić raz (tekst). Poprawna liczba to 2-3 różne,
 * niepuste identyfikatory w kolejności z adresu (pierwszy to wariant odniesienia). Zły kształt, brak parametru i duplikaty = błąd.
 */
export function parseCompareParams(raw: string | string[] | undefined): ParsedCompareParams {
  if (raw === undefined) {
    return { ok: false };
  }
  const parsed = CompareVariantIds.safeParse(Array.isArray(raw) ? raw : [raw]);
  return parsed.success ? { ok: true, ids: parsed.data } : { ok: false };
}

/** Adres strony porównania: /projekty/<id>/porownanie?w=<id>&w=<id>[&w=<id>]. */
export function compareHref(projectId: string, variantIds: readonly string[]): string {
  const query = variantIds.map((id) => `w=${encodeURIComponent(id)}`).join("&");
  return `/projekty/${projectId}/porownanie?${query}`;
}

export type SelectionState = { canCompare: boolean; hint: string };

/** Stan wyboru wariantów do porównania: przycisk aktywny tylko dla 2-3 zaznaczonych. */
export function selectionState(count: number): SelectionState {
  if (count < COMPARE_VARIANTS_MIN) {
    return { canCompare: false, hint: `Zaznacz co najmniej ${COMPARE_VARIANTS_MIN} warianty do porównania.` };
  }
  if (count > COMPARE_VARIANTS_MAX) {
    return { canCompare: false, hint: `Możesz porównać najwyżej ${COMPARE_VARIANTS_MAX} warianty.` };
  }
  return {
    canCompare: true,
    hint: `Zaznaczono ${count}. Różnice są liczone względem pierwszego zaznaczonego wariantu na liście (główny, jeśli jest zaznaczony).`,
  };
}

/** Zaznaczone id w kolejności listy wariantów (a nie w kolejności klikania), więc wariant odniesienia jest przewidywalny. */
export function orderSelection(orderedVariants: readonly { id: string }[], selectedIds: readonly string[]): string[] {
  const selected = new Set(selectedIds);
  return orderedVariants.filter((variant) => selected.has(variant.id)).map((variant) => variant.id);
}

/**
 * Nazwy do pokazania zamiast etykiet A/B/C, z migawki zapisanej w porównaniu (nie z bieżących nazw wariantów).
 * Nazwy nie muszą być unikalne, więc przy powtórzeniu dopisujemy etykietę: „Strategia (A)”, „Strategia (B)”.
 */
export function variantDisplayNames(inputs: readonly { label: CompareLabel; name: string }[]): Record<CompareLabel, string> {
  const counts = new Map<string, number>();
  for (const input of inputs) {
    counts.set(input.name, (counts.get(input.name) ?? 0) + 1);
  }
  const names = { A: "", B: "", C: "" } satisfies Record<CompareLabel, string>;
  for (const input of inputs) {
    names[input.label] = (counts.get(input.name) ?? 0) > 1 ? `${input.name} (${input.label})` : input.name;
  }
  return names;
}

export type StaleVariant = { label: CompareLabel; name: string; snapshotVersion: number; currentVersion: number };

/** Warianty, których wersja zmieniła się od czasu porównania (aktualna wersja większa niż w migawce). */
export function staleVariants(
  inputs: readonly ComparedVariantSummary[],
  current: readonly { id: string; version: number }[],
): StaleVariant[] {
  const versions = new Map(current.map((variant) => [variant.id, variant.version]));
  return inputs.flatMap((input) => {
    const currentVersion = versions.get(input.variantId);
    return currentVersion !== undefined && currentVersion > input.version
      ? [{ label: input.label, name: input.name, snapshotVersion: input.version, currentVersion }]
      : [];
  });
}

export function describeStale(stale: StaleVariant): string {
  return `Porównanie dotyczy wersji ${stale.snapshotVersion} wariantu ${stale.name}, aktualna to ${stale.currentVersion}.`;
}

/**
 * Historia porównań tego zestawu wariantów: pozycje, których migawka dotyczy dokładnie tego samego zbioru identyfikatorów.
 * Uszkodzonych rekordów nie da się przypisać do zestawu, więc zostają jako wiersze z błędem.
 */
export function filterHistoryBySet(items: readonly ComparisonListItem[], variantIds: readonly string[]): ComparisonListItem[] {
  const wanted = [...new Set(variantIds)].sort().join("\n");
  return items.filter((item) => {
    if (!item.ok) {
      return true;
    }
    const ids = [...new Set(item.comparison.inputs.map((input) => input.variantId))].sort().join("\n");
    return ids === wanted;
  });
}

/** Widok zapisanego porównania bez stanów wariantów (lista ich nie nosi). */
export function summarizeComparison(view: VariantComparisonView): VariantComparisonSummary {
  const { inputs, ...rest } = view;
  return {
    ...rest,
    inputs: inputs.map((input) => ({ label: input.label, variantId: input.variantId, name: input.name, version: input.version })),
  };
}

export const comparisonItemId = (item: ComparisonListItem): string => (item.ok ? item.comparison.id : item.id);

/** Dołącza nowe pozycje na początek (od najnowszej), zachowuje znane; nic nie usuwa, więc panel nie wymaga `key` od listy. */
export function mergeComparisonItems(current: ComparisonListItem[], incoming: ComparisonListItem[]): ComparisonListItem[] {
  const known = new Set(current.map(comparisonItemId));
  return [...incoming.filter((item) => !known.has(comparisonItemId(item))), ...current];
}

export function firstValidComparisonId(items: ComparisonListItem[]): string | null {
  for (const item of items) {
    if (item.ok) {
      return item.comparison.id;
    }
  }
  return null;
}

/** Jedna linia historii: data (UTC, stała), model i wersja promptu. Zwykły tekst. */
export function describeComparison(comparison: VariantComparisonSummary): string {
  return [
    formatEvaluationDate(comparison.createdAt),
    `${comparison.provider} / ${comparison.model}`,
    `prompt: ${comparison.promptVersion}`,
  ].join(" · ");
}
