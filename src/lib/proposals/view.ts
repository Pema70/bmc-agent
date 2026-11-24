import type { ProposalRecord } from "@/lib/db/proposals";
import type { ProposalView } from "@/lib/schemas/proposal";

/**
 * Widok propozycji w wyniku narzędzia i w interfejsie. Pochodzi wyłącznie z rekordu zapisanego przez serwer (id z bazy).
 * Osobny, lekki moduł, żeby akcje (np. cyklu poprawek) nie importowały całego narzędzia czatu.
 */
export function toProposalView(record: ProposalRecord): ProposalView {
  return {
    id: record.id,
    blockKey: record.blockKey,
    operation: record.operation,
    before: record.before,
    after: record.after,
    rationale: record.rationale,
    sourceKind: record.sourceKind,
    sourceAttachmentName: record.sourceAttachmentName,
  };
}
