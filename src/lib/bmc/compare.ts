import { BLOCK_KEYS, type BlockKey, type BmcState } from "@/lib/schemas/bmc";

/** Różnica jednego bloku względem wariantu odniesienia. Dosłowny tekst po trim, bez semantyki. */
export type BlockComparison = {
  /** Wpisy wspólne z wariantem odniesienia (w kolejności porównywanego wariantu). */
  shared: string[];
  /** Wpisy tylko w porównywanym wariancie (w kolejności porównywanego wariantu). */
  added: string[];
  /** Wpisy tylko w wariancie odniesienia (w kolejności wariantu odniesienia). */
  missing: string[];
};

export type StateComparison = {
  /** Indeks w wejściowej liście wariantu, względem którego liczono (zawsze 0). */
  referenceIndex: 0;
  /** Jeden element na każdy wariant poza odniesieniem, w kolejności wejścia. */
  others: Array<{
    /** Indeks w wejściowej liście stanów (1, 2). */
    index: number;
    blocks: Record<BlockKey, BlockComparison>;
    totals: { shared: number; added: number; missing: number };
  }>;
};

function compareBlock(reference: readonly string[], other: readonly string[]): BlockComparison {
  // Multizbiór: dwa identyczne wpisy w odniesieniu pasują do dwóch w porównywanym, a nadmiarowe liczą się jako dodane.
  const remaining = new Map<string, number>();
  for (const entry of reference) {
    const text = entry.trim();
    remaining.set(text, (remaining.get(text) ?? 0) + 1);
  }

  const shared: string[] = [];
  const added: string[] = [];
  for (const entry of other) {
    const text = entry.trim();
    const left = remaining.get(text) ?? 0;
    if (left > 0) {
      remaining.set(text, left - 1);
      shared.push(text);
    } else {
      added.push(text);
    }
  }

  const missing: string[] = [];
  const leftover = new Map(remaining);
  for (const entry of reference) {
    const text = entry.trim();
    const left = leftover.get(text) ?? 0;
    if (left > 0) {
      leftover.set(text, left - 1);
      missing.push(text);
    }
  }
  return { shared, added, missing };
}

/**
 * Dokładne różnice wpisów między wariantami, liczone względem pierwszego z listy. Czysta, deterministyczna funkcja,
 * bez modelu i bez mutacji wejścia. To różnica TEKSTOWA, a nie semantyczna: przeredagowany wpis liczy się jako
 * „brakujący” w odniesieniu i „dodany” w porównywanym wariancie. Lista może mieć jeden element (brak porównań).
 */
export function compareStates(states: readonly BmcState[]): StateComparison {
  const [reference, ...rest] = states;
  const others = rest.map((state, offset) => {
    const blocks = Object.fromEntries(
      BLOCK_KEYS.map((key) => [key, compareBlock(reference?.[key] ?? [], state[key])]),
    ) as Record<BlockKey, BlockComparison>;
    const totals = { shared: 0, added: 0, missing: 0 };
    for (const key of BLOCK_KEYS) {
      totals.shared += blocks[key].shared.length;
      totals.added += blocks[key].added.length;
      totals.missing += blocks[key].missing.length;
    }
    return { index: offset + 1, blocks, totals };
  });
  return { referenceIndex: 0, others };
}
