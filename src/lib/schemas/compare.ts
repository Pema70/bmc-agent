import { z } from "zod";
import { BlockKey, BmcState, VariantId } from "@/lib/schemas/bmc";
import type { OperationTrigger } from "@/lib/schemas/strategy";
import { VariantName } from "@/lib/schemas/variant";

export const COMPARE_SCHEMA_VERSION = 1;

// Model widzi wyłącznie etykiety; prawdziwe identyfikatory wariantów nadaje i mapuje serwer.
export const COMPARE_LABELS = ["A", "B", "C"] as const;
export const CompareLabel = z.enum(COMPARE_LABELS);
export type CompareLabel = z.infer<typeof CompareLabel>;

export const COMPARE_VARIANTS_MIN = 2;
export const COMPARE_VARIANTS_MAX = 3;

// Limity dobrane tak, by najgorszy przypadek mieścił się wyraźnie w LLM_MAX_OUTPUT_TOKENS_LONG (12000).
// Najgorszy przypadek: 600 + 9 x 300 + 3 x (4 x 200 + 4 x 200) + 500 = ok. 8,6 tys. znaków tekstu + ok. 0,7 tys. znaków
// nazw pól i składni JSON, czyli ok. 9,3 tys. znaków, a przy ok. 3,6 znaku na token ok. 2,6 tys. tokenów (ok. 4,6 razy mniej niż limit).
export const COMPARE_SUMMARY_MAX_LENGTH = 600;
export const COMPARE_BLOCK_NOTE_MAX_LENGTH = 300;
export const COMPARE_POINT_MAX_LENGTH = 200;
export const COMPARE_POINTS_MAX = 4;
export const COMPARE_RATIONALE_MAX_LENGTH = 500;

const text = (max: number) => z.string().trim().min(1).max(max);

const BlockNote = z.strictObject({
  blockKey: BlockKey.describe("Klucz bloku BMC, w którym warianty istotnie się różnią."),
  comment: text(COMPARE_BLOCK_NOTE_MAX_LENGTH).describe("Krótka uwaga o różnicy w tym bloku, z odwołaniem do etykiet."),
});

const VariantAssessment = z.strictObject({
  label: CompareLabel.describe("Etykieta wariantu: A, B lub C."),
  pros: z.array(text(COMPARE_POINT_MAX_LENGTH)).min(1).max(COMPARE_POINTS_MAX).describe("Zalety wariantu."),
  cons: z.array(text(COMPARE_POINT_MAX_LENGTH)).min(1).max(COMPARE_POINTS_MAX).describe("Wady wariantu."),
});

const Recommendation = z.strictObject({
  label: CompareLabel.nullable().describe("Etykieta rekomendowanego wariantu albo null, gdy brak jednoznacznego wskazania."),
  rationale: text(COMPARE_RATIONALE_MAX_LENGTH).describe("Uzasadnienie rekomendacji lub wyjaśnienie, czemu brak jednoznacznego wskazania."),
});

export const CompareOutput = z
  .strictObject({
    summary: text(COMPARE_SUMMARY_MAX_LENGTH).describe("Podsumowanie porównania: jedno lub dwa zdania."),
    blockNotes: z.array(BlockNote).max(9).describe("Uwagi do bloków (tylko tam, gdzie warianty istotnie się różnią), bez powtórzeń bloku."),
    variants: z.array(VariantAssessment).min(COMPARE_VARIANTS_MIN).max(COMPARE_VARIANTS_MAX),
    recommendation: Recommendation,
  })
  .refine((output) => new Set(output.blockNotes.map((note) => note.blockKey)).size === output.blockNotes.length, {
    error: "Uwagi do bloków nie mogą się powtarzać.",
  })
  .refine((output) => new Set(output.variants.map((variant) => variant.label)).size === output.variants.length, {
    error: "Etykiety wariantów nie mogą się powtarzać.",
  });
export type CompareOutput = z.infer<typeof CompareOutput>;

/** Migawka jednego porównywanego wariantu zapisana razem z wynikiem (wariant nie ma historii). */
export const ComparedVariant = z.strictObject({
  label: CompareLabel,
  variantId: VariantId,
  name: VariantName,
  version: z.number().int().min(1),
  state: BmcState,
});
export type ComparedVariant = z.infer<typeof ComparedVariant>;

export const VariantComparisonInputs = z
  .array(ComparedVariant)
  .min(COMPARE_VARIANTS_MIN)
  .max(COMPARE_VARIANTS_MAX)
  .refine((items) => new Set(items.map((item) => item.label)).size === items.length, {
    error: "Etykiety wariantów nie mogą się powtarzać.",
  });
export type VariantComparisonInputs = z.infer<typeof VariantComparisonInputs>;

/** Lista identyfikatorów wariantów do porównania: 2-3, unikalne. */
export const CompareVariantIds = z
  .array(VariantId, { error: "Wskaż warianty do porównania." })
  .min(COMPARE_VARIANTS_MIN, { error: `Wybierz co najmniej ${COMPARE_VARIANTS_MIN} warianty do porównania.` })
  .max(COMPARE_VARIANTS_MAX, { error: `Możesz porównać najwyżej ${COMPARE_VARIANTS_MAX} warianty.` })
  .refine((ids) => new Set(ids).size === ids.length, { error: "Warianty do porównania nie mogą się powtarzać." });
export type CompareVariantIds = z.infer<typeof CompareVariantIds>;

export const VariantComparisonId = z.string().trim().min(1).max(64);

/** Zapisane porównanie z migawkami stanów (do widoku obok siebie i różnic liczonych na migawce). */
export type VariantComparisonView = {
  id: string;
  createdAt: Date;
  schemaVersion: number;
  trigger: OperationTrigger;
  provider: string;
  model: string;
  promptVersion: string;
  inputs: VariantComparisonInputs;
  result: CompareOutput;
};

/** Pozycja listy: te same dane bez stanów wariantów (lista nie nosi migawek). */
export type ComparedVariantSummary = Omit<ComparedVariant, "state">;
export type VariantComparisonSummary = Omit<VariantComparisonView, "inputs"> & { inputs: ComparedVariantSummary[] };
