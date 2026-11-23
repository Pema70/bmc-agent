import { z } from "zod";
import { AttachmentId } from "@/lib/schemas/attachment";
import { BlockKey, BmcEntry } from "@/lib/schemas/bmc";

export const PROPOSAL_RATIONALE_MAX_CHARS = 1000;

export const PROPOSAL_OPERATIONS = ["add", "edit", "remove"] as const;
export const ProposalOperation = z.enum(PROPOSAL_OPERATIONS);
export type ProposalOperation = z.infer<typeof ProposalOperation>;

export const PROPOSAL_SOURCE_KINDS = ["CONVERSATION", "ATTACHMENT", "REFINEMENT", "MODEL_KNOWLEDGE"] as const;
export const ProposalSourceKind = z.enum(PROPOSAL_SOURCE_KINDS);
export type ProposalSourceKind = z.infer<typeof ProposalSourceKind>;

// Źródło propozycji przekazywane do createProposal (krok 7). REFINEMENT ustawia dopiero cykl poprawek (krok 7e).
// Dla załącznika przekazujemy tylko id: nazwę pliku (niezaufany tekst) serwer bierze z bazy, nie od modelu.
export const ProposalSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CONVERSATION") }),
  z.object({ kind: z.literal("MODEL_KNOWLEDGE") }),
  z.object({ kind: z.literal("ATTACHMENT"), attachmentId: AttachmentId }),
]);
export type ProposalSource = z.infer<typeof ProposalSource>;

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

// Pole wpisu przy wczytywaniu zapisanych danych i ponownej walidacji: brak pola znaczy null (starsze zapisy
// i wejścia, w których model pominął null).
const optionalEntry = BmcEntry.nullable()
  .optional()
  .transform((value) => value ?? null);

// Pole after w schemacie wysyłanym do modelu: wymagane, z jawnym null, gdy nie dotyczy operacji (remove).
const requiredEntry = BmcEntry.nullable();

const BEFORE_HINT =
  "Dokładny tekst istniejącego wpisu, który zmieniasz lub usuwasz (edit, remove). Dla add: pomiń to pole albo podaj null.";
const AFTER_HINT = "Nowy tekst wpisu (add, edit). Dla remove: null. Dla add i edit to pole jest obowiązkowe.";

export const PROPOSAL_MODEL_SOURCE_KINDS = ["conversation", "attachment", "model_knowledge"] as const;
export const ProposalModelSourceKind = z.enum(PROPOSAL_MODEL_SOURCE_KINDS);
export type ProposalModelSourceKind = z.infer<typeof ProposalModelSourceKind>;

// Źródło w schemacie widzianym przez model jest łagodne (.nullish(), lekcje #35 i #37): reguły łączące pola
// i weryfikację odczytu sprawdza execute narzędzia i zwraca { ok: false, reason }, a nie błąd walidacji wejścia.
const sourceKindField = ProposalModelSourceKind.nullish().describe(
  "Skąd pochodzi propozycja: conversation (z rozmowy z użytkownikiem), attachment (z załącznika, który przeczytałeś narzędziem read_attachment; wymaga sourceAttachmentId) albo model_knowledge (z Twojej ogólnej wiedzy, nie od użytkownika). Pomiń, gdy propozycja wynika z rozmowy.",
);
const sourceAttachmentIdField = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .nullish()
  .describe("Etykieta załącznika z listy (np. Z1), gdy sourceKind to attachment. Pomiń w pozostałych przypadkach.");

const blockKeyField = BlockKey.describe("Klucz bloku BMC, którego dotyczy zmiana.");
const operationField = ProposalOperation.describe("add (dodaj wpis), edit (zmień wpis) lub remove (usuń wpis).");
const rationaleField = z
  .string()
  .trim()
  .min(1, { error: "Uzasadnienie nie może być puste." })
  .max(PROPOSAL_RATIONALE_MAX_CHARS, {
    error: `Uzasadnienie może mieć najwyżej ${PROPOSAL_RATIONALE_MAX_CHARS} znaków.`,
  })
  .describe("Krótkie uzasadnienie zmiany po polsku.");

// Reguły łączące operację z polami before i after; wspólne dla obu schematów poniżej.
function checkOperationFields(
  value: { operation: ProposalOperation; before: string | null; after: string | null },
  ctx: z.core.$RefinementCtx,
): void {
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
}

/**
 * Argumenty propose_block_change przy ponownej walidacji (execute narzędzia, historia czatu, zapis propozycji).
 * Płaski obiekt (D4): lepiej znoszą go API narzędzi wszystkich dostawców niż unia dyskryminowana.
 * Jedna propozycja to jeden wpis. Brak before/after jest tu tolerowany (daje null), a poprawność kombinacji
 * z operacją sprawdza checkOperationFields.
 */
export const ProposeBlockChangeInput = z
  .object({
    blockKey: blockKeyField,
    operation: operationField,
    before: optionalEntry.describe(BEFORE_HINT),
    after: optionalEntry.describe(AFTER_HINT),
    rationale: rationaleField,
    sourceKind: sourceKindField,
    sourceAttachmentId: sourceAttachmentIdField,
  })
  .superRefine(checkOperationFields);

/**
 * Schemat argumentów widziany przez model (inputSchema narzędzia). after jest WYMAGANE (null przy remove), więc
 * trafia do listy `required` w schemacie JSON dostawcy: gdy było opcjonalne, Gemini pomijał je przy add, co kończyło
 * się AI_InvalidToolInputError. before zostaje opcjonalne (brak pola = null): gdy było wymagane, model podawał after,
 * ale pomijał before przy add (też AI_InvalidToolInputError). Przy edit i remove brak before wyłapują reguły operacji.
 */
export const ProposeBlockChangeModelInput = z
  .object({
    blockKey: blockKeyField,
    operation: operationField,
    before: optionalEntry.describe(BEFORE_HINT),
    after: requiredEntry.describe(AFTER_HINT),
    rationale: rationaleField,
    sourceKind: sourceKindField,
    sourceAttachmentId: sourceAttachmentIdField,
  })
  .superRefine(checkOperationFields);
export type ProposeBlockChangeInput = z.output<typeof ProposeBlockChangeInput>;
export type ProposeBlockChangeToolInput = z.input<typeof ProposeBlockChangeInput>;
export type ProposeBlockChangeModelToolInput = z.input<typeof ProposeBlockChangeModelInput>;

// Widok propozycji w wyniku narzędzia i w UI. Pochodzi wyłącznie z rekordu zapisanego przez serwer.
export const ProposalView = z.object({
  id: z.string().min(1),
  blockKey: BlockKey,
  operation: ProposalOperation,
  before: z.string().nullable(),
  after: z.string().nullable(),
  rationale: z.string(),
  // Źródło (krok 7): opcjonalne, bo starsze zapisane wyniki narzędzia go nie mają. Nazwa pliku to niezaufany tekst.
  sourceKind: ProposalSourceKind.optional(),
  sourceAttachmentName: z.string().nullable().optional(),
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

// Propozycja z bieżącym statusem: tak widzi ją interfejs (czat i diff w blokach płótna).
export type ProposalItem = ProposalView & { status: ProposalStatus };
