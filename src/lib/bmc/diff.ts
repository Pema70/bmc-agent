import { checkProposable, type ApplyError } from "@/lib/bmc/proposals";
import type { BlockKey, BmcState } from "@/lib/schemas/bmc";
import type { ProposalItem } from "@/lib/schemas/proposal";

// Czyste funkcje diffu propozycji agenta względem stanu płótna. Nie zmieniają argumentów.
// Reguły stosowalności są te same co przy tworzeniu i akceptacji propozycji (checkProposable).

export type EntryDiffStatus = "unchanged" | "removed" | "edited";

export type EntryDiff = {
  text: string;
  // removed: jest propozycja usunięcia; edited: jest propozycja zmiany (usunięcie ma pierwszeństwo).
  status: EntryDiffStatus;
  // Propozycje dotyczące tego wpisu (edit, remove) w kolejności z wejścia.
  proposals: ProposalItem[];
};

export type StaleProposal = { proposal: ProposalItem; reason: ApplyError };

export type BlockDiff = {
  // Tyle samo elementów i w tej samej kolejności co wpisy bloku.
  entries: EntryDiff[];
  // Propozycje dodania wpisu, które da się zastosować.
  additions: ProposalItem[];
  // Propozycje, których nie da się zastosować do tego stanu (nieaktualne): nie oznaczają żadnego wpisu.
  stale: StaleProposal[];
};

/**
 * Diff jednego bloku. Uwzględnia tylko propozycje PENDING tego bloku.
 * Przy duplikatach wpisów propozycja dotyczy pierwszego pasującego (tak jak przy akceptacji).
 */
export function proposalDiffForBlock(
  state: BmcState,
  blockKey: BlockKey,
  proposals: readonly ProposalItem[],
): BlockDiff {
  const texts = state[blockKey];
  const entries: EntryDiff[] = texts.map((text) => ({ text, status: "unchanged", proposals: [] }));
  const additions: ProposalItem[] = [];
  const stale: StaleProposal[] = [];

  for (const proposal of proposals) {
    if (proposal.blockKey !== blockKey || proposal.status !== "PENDING") {
      continue;
    }

    const check = checkProposable(state, proposal);
    if (!check.ok) {
      stale.push({ proposal, reason: check.error });
      continue;
    }

    if (proposal.operation === "add") {
      additions.push(proposal);
      continue;
    }

    const index = proposal.before === null ? -1 : texts.indexOf(proposal.before);
    const entry = entries[index];
    if (!entry) {
      // Nie powinno się zdarzyć po udanym checkProposable; traktujemy jak nieaktualną.
      stale.push({ proposal, reason: "STALE" });
      continue;
    }
    entry.proposals.push(proposal);
    entry.status = proposal.operation === "remove" ? "removed" : entry.status === "removed" ? "removed" : "edited";
  }

  return { entries, additions, stale };
}

/** Liczba oczekujących propozycji w każdym bloku (np. do znacznika przy nagłówku bloku). */
export function countPendingByBlock(proposals: readonly ProposalItem[]): Partial<Record<BlockKey, number>> {
  const counts: Partial<Record<BlockKey, number>> = {};
  for (const proposal of proposals) {
    if (proposal.status === "PENDING") {
      counts[proposal.blockKey] = (counts[proposal.blockKey] ?? 0) + 1;
    }
  }
  return counts;
}
