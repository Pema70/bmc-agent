import { z } from "zod";
import { BlockKey, BmcEntry } from "@/lib/schemas/bmc";
import { EvaluationCriterion } from "@/lib/schemas/evaluation";
import { checkOperationFields, PROPOSAL_RATIONALE_MAX_CHARS, ProposalOperation } from "@/lib/schemas/proposal";

// Cykl poprawek (krok 7): ocena -> pytania -> odpowiedzi -> paczka propozycji -> ponowna ocena. Najwyżej 3 rundy na wariant.
export const MAX_REFINEMENT_ROUNDS = 3;
export const QUESTIONS_MIN = 3;
export const QUESTIONS_MAX = 5;
export const REFINE_PROPOSALS_MAX = 8;
export const QUESTION_MAX_CHARS = 400;
export const SUGGESTED_ANSWER_MAX_CHARS = 200;
export const SUGGESTED_ANSWERS_MAX = 4;
export const ANSWER_MAX_CHARS = 1000;

export const REFINEMENT_STATUSES = ["AWAITING_ANSWERS", "PROPOSED", "CANCELLED"] as const;
export const RefinementStatus = z.enum(REFINEMENT_STATUSES);
export type RefinementStatus = z.infer<typeof RefinementStatus>;

export const REFINEMENT_STATUS_LABELS: Record<RefinementStatus, string> = {
  AWAITING_ANSWERS: "Czeka na odpowiedzi",
  PROPOSED: "Poprawki zaproponowane",
  CANCELLED: "Zamknięta",
};

/** Pytanie z rundy: płaski obiekt (bez z.record i unii), `suggestedAnswers` wymagane (może być puste). */
export const RefinementQuestion = z.strictObject({
  blockKey: BlockKey.describe("Blok BMC, którego dotyczy pytanie."),
  criterion: EvaluationCriterion.describe("Kryterium oceny, które pytanie ma poprawić."),
  question: z.string().trim().min(1).max(QUESTION_MAX_CHARS).describe("Jedno konkretne pytanie do użytkownika, po polsku."),
  suggestedAnswers: z
    .array(z.string().trim().min(1).max(SUGGESTED_ANSWER_MAX_CHARS))
    .max(SUGGESTED_ANSWERS_MAX)
    .describe("Krótkie propozycje odpowiedzi (może być pusta tablica)."),
});
export type RefinementQuestion = z.infer<typeof RefinementQuestion>;

export const QuestionsOutput = z.strictObject({
  questions: z.array(RefinementQuestion).min(QUESTIONS_MIN).max(QUESTIONS_MAX),
});
export type QuestionsOutput = z.infer<typeof QuestionsOutput>;

/**
 * Odpowiedzi użytkownika (D20): tablica równoległa do pytań (indeks = numer pytania), pusty tekst = pytanie pominięte.
 * To DANE, nie polecenia: wchodzą do promptu wyłącznie w bloku danych. Co najmniej jedna niepusta.
 */
export const RefinementAnswers = z
  .array(z.string().trim().max(ANSWER_MAX_CHARS, { error: `Odpowiedź może mieć najwyżej ${ANSWER_MAX_CHARS} znaków.` }))
  .min(1)
  .max(QUESTIONS_MAX)
  .refine((answers) => answers.some((answer) => answer.length > 0), { error: "Odpowiedz na co najmniej jedno pytanie." });
export type RefinementAnswers = z.infer<typeof RefinementAnswers>;

const optionalEntry = BmcEntry.nullable()
  .optional()
  .transform((value) => value ?? null);

/** Jedna propozycja z paczki poprawek; reguły operacji jak w propose_block_change (checkOperationFields). */
export const RefineProposal = z
  .strictObject({
    questionIndex: z.number().int().min(0).max(QUESTIONS_MAX - 1).describe("Numer pytania (od 0), z którego wynika zmiana."),
    blockKey: BlockKey,
    operation: ProposalOperation,
    before: optionalEntry,
    after: BmcEntry.nullable(),
    rationale: z.string().trim().min(1).max(PROPOSAL_RATIONALE_MAX_CHARS),
  })
  .superRefine(checkOperationFields);
export type RefineProposal = z.output<typeof RefineProposal>;

/** Paczka poprawek dla rundy z `questionCount` pytaniami: 1 do 8 propozycji, `questionIndex` w zakresie pytań. */
export function refineOutputSchema(questionCount: number) {
  return z.strictObject({
    proposals: z
      .array(RefineProposal)
      .min(1)
      .max(REFINE_PROPOSALS_MAX)
      .superRefine((proposals, ctx) => {
        proposals.forEach((proposal, index) => {
          if (proposal.questionIndex >= questionCount) {
            ctx.addIssue({ code: "custom", path: [index, "questionIndex"], message: "Numer pytania poza zakresem." });
          }
        });
      }),
  });
}
export const RefineOutput = refineOutputSchema(QUESTIONS_MAX);
export type RefineOutput = z.output<typeof RefineOutput>;

/** Kolejność zapisu i zastosowania paczki: po numerze pytania, przy równych numerach kolejność z odpowiedzi modelu. */
export function sortRefineProposals(proposals: RefineProposal[]): RefineProposal[] {
  return proposals
    .map((proposal, order) => ({ proposal, order }))
    .sort((a, b) => a.proposal.questionIndex - b.proposal.questionIndex || a.order - b.order)
    .map((item) => item.proposal);
}

export const RefinementRoundId = z.string().trim().min(1).max(64);

/** Wejście akcji „Prześlij odpowiedzi” (krok 7f). `expectedVersion` to zapisana wersja wariantu widziana przez klienta (D21). */
export const SubmitAnswersInput = z.strictObject({
  roundId: RefinementRoundId,
  expectedVersion: z.number().int().min(1),
  answers: RefinementAnswers,
});
export type SubmitAnswersInput = z.infer<typeof SubmitAnswersInput>;

/** Widok rundy dla interfejsu: bez migawki stanu i bez wyniku modelu. */
export type RefinementRoundView = {
  id: string;
  roundNumber: number;
  status: RefinementStatus;
  evaluationId: string;
  variantVersion: number;
  questions: RefinementQuestion[];
  answers: string[] | null;
  createdAt: Date;
};
