import { BLOCK_KEYS, BmcState } from "@/lib/schemas/bmc";
import type { StrategiesOutput } from "@/lib/schemas/variant";

export type StrategyViolation =
  | "INVALID_STATE"
  | "SAME_AS_BASE"
  | "DUPLICATE_STRATEGY"
  | "DUPLICATE_NAME"
  | "DUPLICATE_ENTRY";

const normalize = (text: string) => text.trim().toLowerCase();

/** Odcisk stanu niezależny od kolejności wpisów w bloku i wielkości liter (do porównania „czy to ta sama strategia”). */
function fingerprint(state: Record<(typeof BLOCK_KEYS)[number], readonly string[]>): string {
  return JSON.stringify(BLOCK_KEYS.map((key) => [...state[key]].map(normalize).sort()));
}

/**
 * Reguły kontekstowe odpowiedzi modelu, których nie wyraża schemat Zod. Naruszenie to błąd odpowiedzi
 * (SCHEMA_ERROR w operacji), a nie ciche filtrowanie: do bazy trafia tylko to, co model faktycznie zwrócił i co przeszło walidację.
 * Czysta funkcja: zwraca pierwsze znalezione naruszenie albo null.
 */
export function findStrategyViolation(output: StrategiesOutput, baseState: BmcState): StrategyViolation | null {
  const baseFingerprint = fingerprint(baseState);
  const seenFingerprints = new Set<string>();
  const seenNames = new Set<string>();

  for (const strategy of output.strategies) {
    if (!BmcState.safeParse(strategy.state).success) {
      return "INVALID_STATE";
    }

    const current = fingerprint(strategy.state);
    if (current === baseFingerprint) {
      return "SAME_AS_BASE";
    }
    if (seenFingerprints.has(current)) {
      return "DUPLICATE_STRATEGY";
    }
    seenFingerprints.add(current);

    const name = normalize(strategy.name);
    if (seenNames.has(name)) {
      return "DUPLICATE_NAME";
    }
    seenNames.add(name);

    for (const key of BLOCK_KEYS) {
      const entries = strategy.state[key].map(normalize);
      if (new Set(entries).size !== entries.length) {
        return "DUPLICATE_ENTRY";
      }
    }
  }
  return null;
}
