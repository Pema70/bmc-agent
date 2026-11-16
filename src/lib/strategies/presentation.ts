import type { StrategyListItem } from "@/lib/db/strategies";
import { formatEvaluationDate } from "@/lib/evaluation/format";
import { countEntries, type BmcState } from "@/lib/schemas/bmc";
import type { SavedStrategyVariant, StrategyGenerationView } from "@/lib/schemas/strategy";

export const STRATEGIES_NOTICE =
  "To propozycje modelu językowego oparte wyłącznie na Twoim modelu i wytycznych, a nie rekomendacje biznesowe. " +
  "Model nie sprawdza rynku ani danych liczbowych. Zapisanie strategii jako wariantu nie zmienia wariantu głównego.";

export const STRATEGIES_LABEL = "Strategia AI";

const itemId = (item: StrategyListItem): string => (item.ok ? item.generation.id : item.id);

/** Wynik generowania dotyczy starszej wersji wariantu niż aktualna. */
export function isStrategyStale(generationVersion: number, currentVersion: number): boolean {
  return generationVersion < currentVersion;
}

/** „2 strategie”, „3 strategie” (spójne z limitem 2-3), „1 strategia”, „5 strategii” dla pełności. */
export function strategiesCountPhrase(count: number): string {
  if (count === 1) {
    return "1 strategia";
  }
  const lastTwo = count % 100;
  const last = count % 10;
  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? `${count} strategie` : `${count} strategii`;
}

/** Jedna linia historii: data (UTC, stała), model, wersja promptu, liczba strategii. Zwykły tekst. */
export function describeGeneration(generation: StrategyGenerationView): string {
  return [
    formatEvaluationDate(generation.createdAt),
    `${generation.provider} / ${generation.model}`,
    `prompt: ${generation.promptVersion}`,
    strategiesCountPhrase(generation.result.strategies.length),
  ].join(" · ");
}

export function candidateEntryCount(state: BmcState): number {
  return countEntries(state);
}

/**
 * Dołącza do bieżącej listy elementy z nowych propsów (np. po odświeżeniu strony) bez usuwania i bez zmiany kolejności
 * znanych: nowe idą na początek (od najnowszego), znane zachowują miejsce, a ich zapisane warianty są sumowane
 * (zapis mógł nastąpić w innej karcie). Dzięki temu panel nie wymaga `key` zależnego od listy (bez remountu).
 */
export function mergeStrategyItems(current: StrategyListItem[], incoming: StrategyListItem[]): StrategyListItem[] {
  const incomingById = new Map(incoming.map((item) => [itemId(item), item]));
  const known = new Set(current.map(itemId));
  const fresh = incoming.filter((item) => !known.has(itemId(item)));

  const updated = current.map((item) => {
    const next = incomingById.get(itemId(item));
    if (!item.ok || !next || !next.ok) {
      return item;
    }
    return { ok: true as const, generation: { ...item.generation, savedVariants: unionSaved(item.generation.savedVariants, next.generation.savedVariants) } };
  });
  return [...fresh, ...updated];
}

function unionSaved(a: SavedStrategyVariant[], b: SavedStrategyVariant[]): SavedStrategyVariant[] {
  const byIndex = new Map<number, SavedStrategyVariant>();
  for (const saved of [...a, ...b]) {
    byIndex.set(saved.index, saved);
  }
  return [...byIndex.values()].sort((x, y) => x.index - y.index);
}

/** Pierwszy poprawny element listy (do domyślnego wyboru). */
export function firstValidGenerationId(items: StrategyListItem[]): string | null {
  for (const item of items) {
    if (item.ok) {
      return item.generation.id;
    }
  }
  return null;
}

export { itemId as strategyItemId };
