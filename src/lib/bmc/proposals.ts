import { BmcState, type BlockKey } from "@/lib/schemas/bmc";
import type { ProposalOperation } from "@/lib/schemas/proposal";

// Czyste funkcje: nie zmieniają argumentu. Używa ich narzędzie agenta (sprawdzenie przy tworzeniu
// propozycji) i akceptacja (zastosowanie do aktualnego stanu), więc oba miejsca stosują te same reguły.

export type ProposalChange = {
  blockKey: BlockKey;
  operation: ProposalOperation;
  before: string | null;
  after: string | null;
};

export type ApplyError = "STALE" | "DUPLICATE" | "LIMIT";
export type ApplyResult = { ok: true; state: BmcState } | { ok: false; error: ApplyError };

export function applyProposal(state: BmcState, change: ProposalChange): ApplyResult {
  const entries = state[change.blockKey];

  switch (change.operation) {
    case "add": {
      if (change.after === null) return { ok: false, error: "STALE" };
      if (entries.includes(change.after)) return { ok: false, error: "DUPLICATE" };
      return withLimits({ ...state, [change.blockKey]: [...entries, change.after] });
    }
    case "edit": {
      if (change.before === null || change.after === null) return { ok: false, error: "STALE" };
      const index = entries.indexOf(change.before);
      if (index === -1) return { ok: false, error: "STALE" };
      if (entries.includes(change.after)) return { ok: false, error: "DUPLICATE" };
      return withLimits({ ...state, [change.blockKey]: entries.map((entry, i) => (i === index ? change.after! : entry)) });
    }
    case "remove": {
      if (change.before === null) return { ok: false, error: "STALE" };
      const index = entries.indexOf(change.before);
      if (index === -1) return { ok: false, error: "STALE" };
      return withLimits({ ...state, [change.blockKey]: entries.filter((_, i) => i !== index) });
    }
  }
}

// Wynik zawsze przechodzi przez BmcState, więc limity z D5 (na blok i łączny) obowiązują także tutaj.
function withLimits(next: Record<BlockKey, string[]>): ApplyResult {
  const parsed = BmcState.safeParse(next);
  return parsed.success ? { ok: true, state: parsed.data } : { ok: false, error: "LIMIT" };
}

const REASONS: Record<ApplyError, (change: ProposalChange) => string> = {
  STALE: (change) =>
    `Wpis „${change.before ?? ""}” nie istnieje w bloku ${change.blockKey}. W polu before podaj dokładny tekst istniejącego wpisu.`,
  DUPLICATE: (change) => `Wpis „${change.after ?? ""}” już istnieje w bloku ${change.blockKey}. Zaproponuj inną treść.`,
  LIMIT: () => "Zmiana przekroczyłaby limit wpisów w bloku lub w całym modelu. Zaproponuj usunięcie lub zmianę istniejącego wpisu.",
};

export type ProposableResult = { ok: true } | { ok: false; error: ApplyError; reason: string };

/** Sprawdza propozycję względem stanu bez jego zmiany; reason jest komunikatem dla modelu, żeby mógł ją poprawić. */
export function checkProposable(state: BmcState, change: ProposalChange): ProposableResult {
  const result = applyProposal(state, change);
  return result.ok ? { ok: true } : { ok: false, error: result.error, reason: REASONS[result.error](change) };
}

/** Komunikaty dla użytkownika przy akceptacji propozycji, której nie da się zastosować do aktualnego stanu. */
export const APPLY_ERROR_MESSAGES: Record<ApplyError, string> = {
  STALE: "Ten wpis zmienił się od czasu propozycji. Odrzuć ją albo poproś agenta o nową.",
  DUPLICATE: "Taki wpis już istnieje w tym bloku. Odrzuć propozycję.",
  LIMIT: "Zmiana przekroczyłaby limit wpisów w bloku lub w modelu. Odrzuć propozycję.",
};
