import { z } from "zod";
import { BlockKey, BmcEntry } from "@/lib/schemas/bmc";

export const PROPOSAL_RATIONALE_MAX_CHARS = 1000;

export const PROPOSAL_OPERATIONS = ["add", "edit", "remove"] as const;
export const ProposalOperation = z.enum(PROPOSAL_OPERATIONS);
export type ProposalOperation = z.infer<typeof ProposalOperation>;

export const PROPOSAL_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const;
export const ProposalStatus = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const PROPOSAL_OPERATION_LABELS: Record<ProposalOperation, string> = {
  add: "Dodanie wpisu",
  edit: "Zmiana wpisu",
  remove: "Usunięcie wpisu",
};

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  PENDING: "Oczekuje na decyzję",
  ACCEPTED: "Zaakceptowana",
  REJECTED: "Odrzucona",
};

const optionalEntry = BmcEntry.nullable()
  .optional()
  .transform((value) => value ?? null);

/**
 * Argumenty narzędzia propose_block_change. Płaski obiekt (D4): lepiej znoszą go API narzędzi
 * wszystkich dostawców niż unia dyskryminowana. Jedna propozycja to jeden wpis.
 */
export const ProposeBlockChangeInput = z
  .object({
    blockKey: BlockKey.describe("Klucz bloku BMC, którego dotyczy zmiana."),
    operation: ProposalOperation.describe("add (dodaj wpis), edit (zmień wpis) lub remove (usuń wpis)."),
    before: optionalEntry.describe(
      "Dokładny tekst istniejącego wpisu, który zmieniasz lub usuwasz (edit, remove). Dla add: null.",
    ),
    after: optionalEntry.describe("Nowy tekst wpisu (add, edit). Dla remove: null."),
    rationale: z
      .string()
      .trim()
      .min(1, { error: "Uzasadnienie nie może być puste." })
      .max(PROPOSAL_RATIONALE_MAX_CHARS, {
        error: `Uzasadnienie może mieć najwyżej ${PROPOSAL_RATIONALE_MAX_CHARS} znaków.`,
      })
      .describe("Krótkie uzasadnienie zmiany po polsku."),
  })
  .superRefine((value, ctx) => {
    const fail = (path: "before" | "after", message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    switch (value.operation) {
      case "add":
        if (value.before !== null) fail("before", "Przy dodawaniu wpisu pole before musi być puste (null).");
        if (value.after === null) fail("after", "Przy dodawaniu wpisu podaj nowy tekst w polu after.");
        break;
      case "edit":
        if (value.before === null) fail("before", "Przy zmianie wpisu podaj dokładny tekst istniejącego wpisu w polu before.");
        if (value.after === null) fail("after", "Przy zmianie wpisu podaj nowy tekst w polu after.");
        if (value.before !== null && value.before === value.after) fail("after", "Nowy tekst musi różnić się od starego.");
        break;
      case "remove":
        if (value.before === null) fail("before", "Przy usuwaniu wpisu podaj dokładny tekst istniejącego wpisu w polu before.");
        if (value.after !== null) fail("after", "Przy usuwaniu wpisu pole after musi być puste (null).");
        break;
    }
  });
export type ProposeBlockChangeInput = z.output<typeof ProposeBlockChangeInput>;
export type ProposeBlockChangeToolInput = z.input<typeof ProposeBlockChangeInput>;

// Widok propozycji w wyniku narzędzia i w UI. Pochodzi wyłącznie z rekordu zapisanego przez serwer.
export const ProposalView = z.object({
  id: z.string().min(1),
  blockKey: BlockKey,
  operation: ProposalOperation,
  before: z.string().nullable(),
  after: z.string().nullable(),
  rationale: z.string(),
});
export type ProposalView = z.infer<typeof ProposalView>;

export const ProposeBlockChangeOutput = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), proposal: ProposalView }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type ProposeBlockChangeOutput = z.infer<typeof ProposeBlockChangeOutput>;

// Identyfikator z klienta: tylko kształt, przynależność do wariantu sprawdza baza.
export const ProposalId = z.string().trim().min(1).max(64);

export const ResolveProposalInput = z.object({
  proposalId: ProposalId,
  version: z.number().int().min(1),
});
