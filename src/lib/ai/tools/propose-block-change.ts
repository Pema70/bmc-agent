import { tool } from "ai";
import { z } from "zod";
import { hasSuccessfulRead } from "@/lib/ai/tools/read-attachment";
import { checkProposable } from "@/lib/bmc/proposals";
import { getAttachmentByOrdinal } from "@/lib/db/attachments";
import { createProposal } from "@/lib/db/proposals";
import { toProposalView } from "@/lib/proposals/view";
import type { BmcState } from "@/lib/schemas/bmc";
import { attachmentLabel, parseAttachmentLabel } from "@/lib/schemas/attachment";
import {
  ProposeBlockChangeInput,
  ProposeBlockChangeModelInput,
  type ProposalSource,
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

export { toProposalView };

/**
 * Narzędzie tylko PROPONUJE zmianę: tworzy rekord Proposal (PENDING) i nie dotyka stanu BMC.
 * Identyfikator propozycji w wyniku pochodzi z bazy (createProposal), nigdy z tekstu modelu.
 * Odrzucona propozycja wraca do modelu jako { ok: false, reason }, żeby mógł ją poprawić.
 */
export function createProposeBlockChangeTool(ctx: ProposeToolContext) {
  return tool({
    description:
      "Zaproponuj użytkownikowi jedną zmianę jednego wpisu w bloku BMC (dodanie, zmiana lub usunięcie). Stan modelu NIE zmienia się od razu: użytkownik zaakceptuje lub odrzuci propozycję. Przy zmianie i usunięciu pole before musi być dokładnym tekstem istniejącego wpisu. Jedna propozycja to jeden wpis.",
    inputSchema: ProposeBlockChangeModelInput,
    execute: async (input, options): Promise<ProposeBlockChangeOutput> => {
      const parsed = ProposeBlockChangeInput.safeParse(input);
      if (!parsed.success) {
        return { ok: false, reason: `Niepoprawne argumenty: ${z.prettifyError(parsed.error)}` };
      }
      const change = parsed.data;

      const check = checkProposable(ctx.state, change);
      if (!check.ok) {
        return { ok: false, reason: check.reason };
      }

      // Źródło z załącznika serwer przyjmuje tylko po udanym odczycie tego załącznika w tej rozmowie (nie wierzy deklaracji modelu).
      const source = await resolveSource(ctx.projectId, change.sourceKind, change.sourceAttachmentId, options.messages);
      if (!source.ok) {
        return { ok: false, reason: source.reason };
      }

      const created = await createProposal(
        {
          projectId: ctx.projectId,
          variantId: ctx.variantId,
          createdById: ctx.userId,
          baseVersion: ctx.version,
          change,
          ...(source.source ? { source: source.source } : {}),
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
          case "ATTACHMENT_NOT_FOUND":
            return { ok: false, reason: "Nie znaleziono wskazanego załącznika." };
        }
      }
      return { ok: true, proposal: toProposalView(created.proposal) };
    },
  });
}

type SourceResolution = { ok: true; source: ProposalSource | undefined } | { ok: false; reason: string };

const READ_FIRST = "Najpierw przeczytaj ten załącznik narzędziem read_attachment, potem zaproponuj zmianę z jego źródłem.";

/**
 * Źródło propozycji z pól podanych przez model. Brak źródła i „conversation” to domyślne CONVERSATION; „model_knowledge”
 * to deklaracja modelu (oznaczona w interfejsie). „attachment” wymaga etykiety istniejącego załącznika projektu ORAZ
 * udanego odczytu tego załącznika wcześniej w rozmowie; inaczej { ok: false, reason }, żeby model mógł poprawić.
 */
async function resolveSource(
  projectId: string,
  kind: "conversation" | "attachment" | "model_knowledge" | null | undefined,
  rawLabel: string | null | undefined,
  messages: Parameters<typeof hasSuccessfulRead>[0],
): Promise<SourceResolution> {
  if (rawLabel === null || rawLabel === undefined) {
    if (kind === "attachment") {
      return { ok: false, reason: "Źródło attachment wymaga sourceAttachmentId (etykiety załącznika, np. Z1)." };
    }
    return { ok: true, source: kind === "model_knowledge" ? { kind: "MODEL_KNOWLEDGE" } : undefined };
  }
  // Etykieta bez sourceKind oznacza załącznik; etykieta przy innym rodzaju źródła to sprzeczność.
  if (kind === "conversation" || kind === "model_knowledge") {
    return { ok: false, reason: "sourceAttachmentId podaj tylko ze sourceKind równym attachment." };
  }
  const ordinal = parseAttachmentLabel(rawLabel);
  if (ordinal === null) {
    return { ok: false, reason: "Niepoprawna etykieta załącznika. Użyj etykiety z listy <attachments>, np. Z1." };
  }
  const label = attachmentLabel(ordinal);
  const attachment = await getAttachmentByOrdinal(projectId, ordinal);
  if (!attachment) {
    return { ok: false, reason: `Nie znaleziono załącznika ${label}.` };
  }
  if (!hasSuccessfulRead(messages, label)) {
    return { ok: false, reason: READ_FIRST };
  }
  return { ok: true, source: { kind: "ATTACHMENT", attachmentId: attachment.id } };
}
