import { originKey } from "@/lib/bmc/origins";
import { BLOCK_KEYS, type BlockKey, type BmcState } from "@/lib/schemas/bmc";
import { parseStoredOrigins, type EntryOrigin } from "@/lib/schemas/origin";
import type { ProposalSourceKind, ProposalStatus } from "@/lib/schemas/proposal";

/**
 * Ustalanie pochodzenia każdego bieżącego wpisu na potrzeby raportu (krok 9, wariant C z planu):
 * 1. ZAPISANE: pochodzenie zapisane w BmcVariant.entryOrigins (od kroku 9, pewne);
 * 2. USTALONE_PO_TEKSCIE: wpis bez zapisu (stan sprzed kroku 9) zgodny tekstem z zaakceptowaną propozycją tego wariantu
 *    albo (dla wariantu ze strategii) z kandydatem strategii: prawdopodobne, nie pewne (ręczny wpis o tym samym tekście
 *    byłby przypisany błędnie, dlatego raport oznacza tę pewność wprost);
 * 3. NIEZNANE: reszta (m.in. ręczne wpisy sprzed kroku 9, kopie wariantów sprzed kroku 9, wpisy zmienione po akceptacji).
 * Czysta funkcja: dane wejściowe czyta wywołujący (z filtrem po projekcie i wariancie).
 */

export type OriginCertainty = "ZAPISANE" | "USTALONE_PO_TEKSCIE" | "NIEZNANE";

/** Pochodzenie bez klucza wpisu i wersji (to samo dla zapisanego i ustalonego wstecznie). */
export type OriginInfo = Pick<
  EntryOrigin,
  "kind" | "proposalId" | "sourceKind" | "attachmentName" | "roundNumber" | "questionIndex" | "strategyName"
>;

export type ResolvedEntry = {
  blockKey: BlockKey;
  text: string;
  origin: OriginInfo | null;
  certainty: OriginCertainty;
};

/** Zaakceptowana (lub dowolna) propozycja wariantu do dopasowania wstecznego; filtr po statusie robi funkcja. */
export type FallbackProposal = {
  id: string;
  blockKey: BlockKey;
  operation: "add" | "edit" | "remove";
  after: string | null;
  status: ProposalStatus;
  resolvedAt: Date | null;
  sourceKind: ProposalSourceKind;
  sourceAttachmentName: string | null;
  roundNumber: number | null;
  questionIndex: number | null;
};

export type StrategyCandidate = { name: string; state: BmcState };

export type ResolvedOrigins = {
  entries: ResolvedEntry[];
  // Zapis w bazie był nieczytelny i został zignorowany (raport to zaznacza).
  corrupt: boolean;
  counts: { total: number; saved: number; inferred: number; unknown: number };
};

function toInfo(origin: EntryOrigin): OriginInfo {
  return {
    kind: origin.kind,
    proposalId: origin.proposalId,
    sourceKind: origin.sourceKind,
    attachmentName: origin.attachmentName,
    roundNumber: origin.roundNumber,
    questionIndex: origin.questionIndex,
    strategyName: origin.strategyName,
  };
}

function latestAcceptedMatch(proposals: readonly FallbackProposal[], blockKey: BlockKey, text: string): FallbackProposal | null {
  let best: FallbackProposal | null = null;
  for (const proposal of proposals) {
    if (
      proposal.status !== "ACCEPTED" ||
      proposal.blockKey !== blockKey ||
      proposal.after !== text ||
      (proposal.operation !== "add" && proposal.operation !== "edit")
    ) {
      continue;
    }
    if (!best || (proposal.resolvedAt?.getTime() ?? 0) >= (best.resolvedAt?.getTime() ?? 0)) {
      best = proposal;
    }
  }
  return best;
}

export function resolveEntryOrigins(input: {
  state: BmcState;
  storedOrigins: unknown;
  proposals: readonly FallbackProposal[];
  strategy: StrategyCandidate | null;
}): ResolvedOrigins {
  const { origins: stored, corrupt } = parseStoredOrigins(input.storedOrigins);
  const storedByKey = new Map<string, EntryOrigin>();
  for (const origin of stored) {
    storedByKey.set(originKey(origin.blockKey, origin.text), origin);
  }

  const entries: ResolvedEntry[] = [];
  for (const blockKey of BLOCK_KEYS) {
    for (const text of input.state[blockKey]) {
      const saved = storedByKey.get(originKey(blockKey, text));
      if (saved) {
        entries.push({ blockKey, text, origin: toInfo(saved), certainty: "ZAPISANE" });
        continue;
      }

      const proposal = latestAcceptedMatch(input.proposals, blockKey, text);
      if (proposal) {
        entries.push({
          blockKey,
          text,
          origin: {
            kind: "PROPOSAL",
            proposalId: proposal.id,
            sourceKind: proposal.sourceKind,
            attachmentName: proposal.sourceAttachmentName ?? undefined,
            roundNumber: proposal.roundNumber ?? undefined,
            questionIndex: proposal.questionIndex ?? undefined,
            strategyName: undefined,
          },
          certainty: "USTALONE_PO_TEKSCIE",
        });
        continue;
      }

      if (input.strategy?.state[blockKey].includes(text)) {
        entries.push({
          blockKey,
          text,
          origin: {
            kind: "STRATEGY",
            proposalId: undefined,
            sourceKind: undefined,
            attachmentName: undefined,
            roundNumber: undefined,
            questionIndex: undefined,
            strategyName: input.strategy.name,
          },
          certainty: "USTALONE_PO_TEKSCIE",
        });
        continue;
      }

      entries.push({ blockKey, text, origin: null, certainty: "NIEZNANE" });
    }
  }

  const count = (certainty: OriginCertainty) => entries.filter((entry) => entry.certainty === certainty).length;
  return {
    entries,
    corrupt,
    counts: { total: entries.length, saved: count("ZAPISANE"), inferred: count("USTALONE_PO_TEKSCIE"), unknown: count("NIEZNANE") },
  };
}
