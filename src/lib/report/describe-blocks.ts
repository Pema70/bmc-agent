import { exportText } from "@/lib/export/sanitize";
import { sourceLabel } from "@/lib/report/labels";
import type { ResolvedEntry } from "@/lib/report/provenance";
import { BLOCK_KEYS, type BlockKey } from "@/lib/schemas/bmc";
import type { ProposalSourceKind, ProposalStatus } from "@/lib/schemas/proposal";

/**
 * Opis bloku „co tu jest i dlaczego” (decyzja D3 planu kroku 9): złożony deterministycznie z zapisanych danych, bez wywołania
 * modelu i bez dopowiadania powodów. Zawiera liczbę wpisów, rozbicie na pochodzenie oraz cytaty uzasadnień zaakceptowanych
 * propozycji (uzasadnienie pisze agent, więc w raporcie jest oznaczone jako „uzasadnienie agenta”). Wpis bez zaakceptowanej
 * propozycji (ręczny, ze strategii, nieznany) dostaje jawne „brak zapisanego uzasadnienia”.
 */

export type DescribedProposal = {
  id: string;
  blockKey: BlockKey;
  operation: "add" | "edit" | "remove";
  after: string | null;
  rationale: string;
  status: ProposalStatus;
  resolvedAt: Date | null;
  sourceKind: ProposalSourceKind;
  roundNumber: number | null;
  questionIndex: number | null;
};

export type BlockEntryDescription = {
  text: string;
  sourceLabel: string;
  /** Uzasadnienie agenta z zaakceptowanej propozycji (zwykły tekst) albo null, gdy go nie ma. */
  rationale: string | null;
  /** Runda i pytanie, gdy uzasadnienie pochodzi z cyklu poprawek (numeracja od 1). */
  position: { roundNumber: number; questionNumber: number } | null;
};

export type BlockDescription = {
  blockKey: BlockKey;
  entryCount: number;
  breakdown: Array<{ label: string; count: number }>;
  entries: BlockEntryDescription[];
  withoutRationale: number;
};

const MAX_RATIONALE_CHARS = 600;

function acceptedProposalFor(
  entry: ResolvedEntry,
  proposals: readonly DescribedProposal[],
): DescribedProposal | null {
  const byId = entry.origin?.proposalId ? proposals.find((proposal) => proposal.id === entry.origin?.proposalId) : undefined;
  if (byId && byId.status === "ACCEPTED" && byId.blockKey === entry.blockKey) {
    return byId;
  }
  // Zapis pochodzenia mógł zostać po usuniętej propozycji: wtedy szukamy po tekście (ostatnio rozstrzygnięta wygrywa).
  let best: DescribedProposal | null = null;
  for (const proposal of proposals) {
    if (
      proposal.status !== "ACCEPTED" ||
      proposal.blockKey !== entry.blockKey ||
      proposal.after !== entry.text ||
      (proposal.operation !== "add" && proposal.operation !== "edit")
    ) {
      continue;
    }
    if (!best || (proposal.resolvedAt?.getTime() ?? 0) >= (best.resolvedAt?.getTime() ?? 0)) {
      best = proposal;
    }
  }
  // Wpis zapisany jako ręczny nie dostaje cudzego uzasadnienia, nawet gdy tekst zgadza się z propozycją.
  return entry.origin?.kind === "MANUAL" ? null : best;
}

export function describeBlock(
  blockKey: BlockKey,
  entries: readonly ResolvedEntry[],
  proposals: readonly DescribedProposal[],
): BlockDescription {
  const own = entries.filter((entry) => entry.blockKey === blockKey);
  const described: BlockEntryDescription[] = own.map((entry) => {
    const proposal = entry.origin?.kind === "STRATEGY" ? null : acceptedProposalFor(entry, proposals);
    const rationale = proposal ? exportText(proposal.rationale, MAX_RATIONALE_CHARS) : "";
    const refinement =
      proposal && proposal.sourceKind === "REFINEMENT" && proposal.roundNumber !== null && proposal.questionIndex !== null;
    return {
      text: exportText(entry.text),
      sourceLabel: sourceLabel(entry.origin, entry.certainty),
      rationale: rationale || null,
      position: refinement ? { roundNumber: proposal.roundNumber as number, questionNumber: (proposal.questionIndex as number) + 1 } : null,
    };
  });

  const counts = new Map<string, number>();
  for (const item of described) {
    counts.set(item.sourceLabel, (counts.get(item.sourceLabel) ?? 0) + 1);
  }
  return {
    blockKey,
    entryCount: described.length,
    breakdown: [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pl")),
    entries: described,
    withoutRationale: described.filter((item) => item.rationale === null).length,
  };
}

export function describeAllBlocks(entries: readonly ResolvedEntry[], proposals: readonly DescribedProposal[]): BlockDescription[] {
  return BLOCK_KEYS.map((blockKey) => describeBlock(blockKey, entries, proposals));
}
