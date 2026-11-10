import {
  BLOCK_KEYS,
  BmcEntry,
  MAX_ENTRIES_PER_BLOCK,
  MAX_ENTRIES_TOTAL,
  countEntries,
  type BlockKey,
  type BmcState,
} from "@/lib/schemas/bmc";

// Czyste funkcje edycji stanu płótna: nie zmieniają argumentu, zwracają nowy stan albo błąd.

export type EditResult = { ok: true; state: BmcState } | { ok: false; error: string };

const BLOCK_FULL = `Blok ma już ${MAX_ENTRIES_PER_BLOCK} wpisów (limit na blok).`;
const MODEL_FULL = `Model ma już ${MAX_ENTRIES_TOTAL} wpisów (limit łączny).`;
const NO_SUCH_ENTRY = "Ten wpis już nie istnieje.";

function parseEntry(text: string): { ok: true; entry: string } | { ok: false; error: string } {
  const parsed = BmcEntry.safeParse(text);
  return parsed.success
    ? { ok: true, entry: parsed.data }
    : { ok: false, error: parsed.error.issues[0]?.message ?? "Niepoprawny wpis." };
}

export function remainingInBlock(state: BmcState, key: BlockKey): number {
  return Math.max(0, MAX_ENTRIES_PER_BLOCK - state[key].length);
}

export function remainingTotal(state: BmcState): number {
  return Math.max(0, MAX_ENTRIES_TOTAL - countEntries(state));
}

export function addEntry(state: BmcState, key: BlockKey, text: string): EditResult {
  const parsed = parseEntry(text);
  if (!parsed.ok) {
    return parsed;
  }
  if (remainingInBlock(state, key) === 0) {
    return { ok: false, error: BLOCK_FULL };
  }
  if (remainingTotal(state) === 0) {
    return { ok: false, error: MODEL_FULL };
  }
  return { ok: true, state: { ...state, [key]: [...state[key], parsed.entry] } };
}

export function updateEntry(state: BmcState, key: BlockKey, index: number, text: string): EditResult {
  if (!Number.isInteger(index) || index < 0 || index >= state[key].length) {
    return { ok: false, error: NO_SUCH_ENTRY };
  }
  const parsed = parseEntry(text);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, state: { ...state, [key]: state[key].map((entry, i) => (i === index ? parsed.entry : entry)) } };
}

export function removeEntry(state: BmcState, key: BlockKey, index: number): EditResult {
  if (!Number.isInteger(index) || index < 0 || index >= state[key].length) {
    return { ok: false, error: NO_SUCH_ENTRY };
  }
  return { ok: true, state: { ...state, [key]: state[key].filter((_, i) => i !== index) } };
}

/**
 * Liczba niezapisanych zmian: w każdym bloku porównujemy wpisy jak multizbiory.
 * Dodanie i usunięcie liczą się po 1, edycja wpisu (jeden znika, jeden dochodzi) też jako 1.
 */
export function countChanges(saved: BmcState, current: BmcState): number {
  let changes = 0;
  for (const key of BLOCK_KEYS) {
    const remaining = new Map<string, number>();
    for (const entry of saved[key]) {
      remaining.set(entry, (remaining.get(entry) ?? 0) + 1);
    }
    let added = 0;
    for (const entry of current[key]) {
      const count = remaining.get(entry) ?? 0;
      if (count > 0) {
        remaining.set(entry, count - 1);
      } else {
        added += 1;
      }
    }
    let removed = 0;
    for (const count of remaining.values()) {
      removed += count;
    }
    changes += Math.max(added, removed);
  }
  return changes;
}
