import { tool } from "ai";
import { z } from "zod";
import { checkProposable } from "@/lib/bmc/proposals";
import { createProposal, type ProposalRecord } from "@/lib/db/proposals";
import type { BmcState } from "@/lib/schemas/bmc";
import {
  ProposeBlockChangeInput,
  type ProposalView,
  type ProposeBlockChangeOutput,
} from "@/lib/schemas/proposal";

export type ProposeToolContext = {
  projectId: string;
  variantId: string;
  userId: string;
  // Wersja i stan wariantu z początku żądania (propozycja jest sprawdzana względem tego stanu).
  version: number;
  state: BmcState;
  maxPending: number;
};

export function toProposalView(record: ProposalRecord): ProposalView {
  return {
    id: record.id,
    blockKey: record.blockKey,
    operation: record.operation,
    before: record.before,
    after: record.after,
    rationale: record.rationale,
  };
}

/**
 * Narzędzie tylko PROPONUJE zmianę: tworzy rekord Proposal (PENDING) i nie dotyka stanu BMC.
 * Identyfikator propozycji w wyniku pochodzi z bazy (createProposal), nigdy z tekstu modelu.
 * Odrzucona propozycja wraca do modelu jako { ok: false, reason }, żeby mógł ją poprawić.
 */
export function createProposeBlockChangeTool(ctx: ProposeToolContext) {
  return tool({
    description:
      "Zaproponuj użytkownikowi jedną zmianę jednego wpisu w bloku BMC (dodanie, zmiana lub usunięcie). Stan modelu NIE zmienia się od razu: użytkownik zaakceptuje lub odrzuci propozycję. Przy zmianie i usunięciu pole before musi być dokładnym tekstem istniejącego wpisu. Jedna propozycja to jeden wpis.",
    inputSchema: ProposeBlockChangeInput,
    execute: async (input): Promise<ProposeBlockChangeOutput> => {
      const parsed = ProposeBlockChangeInput.safeParse(input);
      if (!parsed.success) {
        return { ok: false, reason: `Niepoprawne argumenty: ${z.prettifyError(parsed.error)}` };
      }
      const change = parsed.data;

      const check = checkProposable(ctx.state, change);
      if (!check.ok) {
        return { ok: false, reason: check.reason };
      }

      const created = await createProposal(
        {
          projectId: ctx.projectId,
          variantId: ctx.variantId,
          createdById: ctx.userId,
          baseVersion: ctx.version,
          change,
        },
        ctx.maxPending,
      );
      if (!created.ok) {
        switch (created.error) {
          case "LIMIT":
            return {
              ok: false,
              reason: `Czeka już ${ctx.maxPending} propozycji. Nie proponuj kolejnych, dopóki użytkownik ich nie rozpatrzy.`,
            };
          case "DUPLICATE_PENDING":
            return { ok: false, reason: "Taka propozycja już czeka na decyzję użytkownika. Nie powtarzaj jej." };
          case "NOT_FOUND":
            return { ok: false, reason: "Nie udało się zapisać propozycji." };
        }
      }
      return { ok: true, proposal: toProposalView(created.proposal) };
    },
  });
}
