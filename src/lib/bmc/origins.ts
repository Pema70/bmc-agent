import { BLOCK_KEYS, type BlockKey, type BmcState } from "@/lib/schemas/bmc";
import type { EntryOrigin } from "@/lib/schemas/origin";
import type { ProposalSourceKind } from "@/lib/schemas/proposal";

// Czyste funkcje (bez bazy) wyznaczające pochodzenie wpisów po zmianie stanu (krok 9). Klucz tożsamości wpisu to
// (blockKey, tekst); tu jedyne miejsce, które go składa. Wpisy bez zapisu pochodzenia (stan sprzed kroku 9) zostają bez
// zapisu: ustala je dopiero raport (src/lib/report/provenance.ts) z oznaczoną pewnością.

const SEPARATOR = "\u0000";

export function originKey(blockKey: BlockKey, text: string): string {
  return `${blockKey}${SEPARATOR}${text}`;
}

function stateKeys(state: BmcState): Set<string> {
  const keys = new Set<string>();
  for (const blockKey of BLOCK_KEYS) {
    for (const text of state[blockKey]) {
      keys.add(originKey(blockKey, text));
    }
  }
  return keys;
}

/** Zostawia tylko pochodzenie wpisów, które nadal są w stanie; przy powtórzonym kluczu zostaje ostatni zapis. */
export function pruneOrigins(origins: readonly EntryOrigin[], state: BmcState): EntryOrigin[] {
  const keys = stateKeys(state);
  const byKey = new Map<string, EntryOrigin>();
  for (const origin of origins) {
    const key = originKey(origin.blockKey, origin.text);
    if (keys.has(key)) {
      byKey.set(key, origin);
    }
  }
  return [...byKey.values()];
}

/**
 * Zapis z edytora (cały stan od klienta). Wpisy, które były już w poprzednim stanie, zachowują pochodzenie (albo jego brak:
 * to wpisy sprzed kroku 9, nie oznaczamy ich jako ręcznych). Wpisy nowe lub zmienione tekstem dostają MANUAL; usunięte
 * znikają. `oldState` równe null (nieczytelny poprzedni stan) traktuje wszystkie wpisy jako nowe.
 */
export function originsAfterManualSave(
  oldState: BmcState | null,
  newState: BmcState,
  oldOrigins: readonly EntryOrigin[],
  newVersion: number,
): EntryOrigin[] {
  const before = oldState ? stateKeys(oldState) : new Set<string>();
  const kept = pruneOrigins(oldOrigins, newState);
  const have = new Set(kept.map((origin) => originKey(origin.blockKey, origin.text)));
  const added: EntryOrigin[] = [];

  for (const blockKey of BLOCK_KEYS) {
    for (const text of newState[blockKey]) {
      const key = originKey(blockKey, text);
      if (before.has(key) || have.has(key)) {
        continue;
      }
      have.add(key);
      added.push({ blockKey, text, kind: "MANUAL", recordedVersion: newVersion });
    }
  }
  return [...kept, ...added];
}

/** Zaakceptowana propozycja (jedna z paczki albo pojedyncza) w postaci potrzebnej do zapisu pochodzenia. */
export type AppliedProposal = {
  proposalId: string;
  blockKey: BlockKey;
  operation: "add" | "edit" | "remove";
  after: string | null;
  sourceKind: ProposalSourceKind;
  attachmentName: string | null;
  roundNumber: number | null;
  questionIndex: number | null;
};

/**
 * Po zastosowaniu propozycji: wpisy usunięte lub zmienione znikają (przycięcie do nowego stanu), a nowy tekst z `add` i `edit`
 * dostaje pochodzenie PROPOSAL ze źródłem propozycji. Propozycje z paczki podajemy w kolejności zastosowania (późniejsza
 * nadpisuje wcześniejszą o tym samym kluczu).
 */
export function originsAfterProposals(
  oldOrigins: readonly EntryOrigin[],
  newState: BmcState,
  applied: readonly AppliedProposal[],
  newVersion: number,
): EntryOrigin[] {
  const keys = stateKeys(newState);
  const byKey = new Map<string, EntryOrigin>();
  for (const origin of pruneOrigins(oldOrigins, newState)) {
    byKey.set(originKey(origin.blockKey, origin.text), origin);
  }

  for (const proposal of applied) {
    if (proposal.operation === "remove" || proposal.after === null) {
      continue;
    }
    const key = originKey(proposal.blockKey, proposal.after);
    if (!keys.has(key)) {
      continue;
    }
    byKey.set(key, {
      blockKey: proposal.blockKey,
      text: proposal.after,
      kind: "PROPOSAL",
      proposalId: proposal.proposalId,
      sourceKind: proposal.sourceKind,
      ...(proposal.attachmentName ? { attachmentName: proposal.attachmentName } : {}),
      ...(proposal.roundNumber !== null ? { roundNumber: proposal.roundNumber } : {}),
      ...(proposal.questionIndex !== null ? { questionIndex: proposal.questionIndex } : {}),
      recordedVersion: newVersion,
    });
  }
  return [...byKey.values()];
}

/** Wariant zapisany ze strategii AI: każdy wpis pochodzi z kandydata (nazwa strategii z chwili zapisu). */
export function originsForStrategy(state: BmcState, strategyName: string, version: number): EntryOrigin[] {
  const origins: EntryOrigin[] = [];
  const seen = new Set<string>();
  for (const blockKey of BLOCK_KEYS) {
    for (const text of state[blockKey]) {
      const key = originKey(blockKey, text);
      if (!seen.has(key)) {
        seen.add(key);
        origins.push({ blockKey, text, kind: "STRATEGY", strategyName, recordedVersion: version });
      }
    }
  }
  return origins;
}

/** Kopia wariantu ma ten sam stan, więc dziedziczy pochodzenie źródła (przycięte do stanu kopii, na wszelki wypadek). */
export function originsForCopy(sourceOrigins: readonly EntryOrigin[], copiedState: BmcState): EntryOrigin[] {
  return pruneOrigins(sourceOrigins, copiedState);
}
