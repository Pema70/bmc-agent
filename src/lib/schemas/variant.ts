import { z } from "zod";
import { BLOCK_KEYS, BmcEntry, VariantId, type BlockKey } from "@/lib/schemas/bmc";

export const VARIANT_NAME_MAX_LENGTH = 80;
export const VARIANT_DESCRIPTION_MAX_LENGTH = 400;

export const VARIANT_ORIGINS = ["MANUAL", "AI_STRATEGY"] as const;
export const VariantOrigin = z.enum(VARIANT_ORIGINS);
export type VariantOrigin = z.infer<typeof VariantOrigin>;

export const VARIANT_ORIGIN_LABELS: Record<VariantOrigin, string> = {
  MANUAL: "Własny",
  AI_STRATEGY: "Strategia AI",
};

export const VariantName = z
  .string({ error: "Nazwa wariantu musi być tekstem." })
  .trim()
  .min(1, { error: "Nazwa wariantu nie może być pusta." })
  .max(VARIANT_NAME_MAX_LENGTH, { error: `Nazwa wariantu może mieć najwyżej ${VARIANT_NAME_MAX_LENGTH} znaków.` });

export const VariantDescription = z
  .string({ error: "Opis wariantu musi być tekstem." })
  .trim()
  .max(VARIANT_DESCRIPTION_MAX_LENGTH, {
    error: `Opis wariantu może mieć najwyżej ${VARIANT_DESCRIPTION_MAX_LENGTH} znaków.`,
  });

/** Kopia powstaje z zapisanego stanu wariantu źródłowego (czytanego z bazy); nazwę nadaje serwer. */
export const CreateVariantInput = z.strictObject({ sourceVariantId: VariantId });
export type CreateVariantInput = z.infer<typeof CreateVariantInput>;

export const RenameVariantInput = z.strictObject({ variantId: VariantId, name: VariantName });
export type RenameVariantInput = z.infer<typeof RenameVariantInput>;

/** expectedMainId: wariant główny, który klient widział (null, gdy projekt nie miał głównego). */
export const SetMainVariantInput = z.strictObject({ variantId: VariantId, expectedMainId: VariantId.nullable() });
export type SetMainVariantInput = z.infer<typeof SetMainVariantInput>;

// Strategie (generate_strategies, krok 6): mały najgorszy przypadek wyjścia modelu (3 x 9 bloków x 4 wpisy x 200 znaków).
export const STRATEGY_COUNT_MIN = 2;
export const STRATEGY_COUNT_MAX = 3;
export const STRATEGY_MAX_ENTRIES_PER_BLOCK = 4;
export const STRATEGY_ENTRY_MAX_LENGTH = 200;
export const STRATEGY_ASSUMPTION_MAX_LENGTH = 400;

const GeneratedEntry = BmcEntry.max(STRATEGY_ENTRY_MAX_LENGTH, {
  error: `Wpis strategii może mieć najwyżej ${STRATEGY_ENTRY_MAX_LENGTH} znaków.`,
});
const GeneratedBlock = z.array(GeneratedEntry).max(STRATEGY_MAX_ENTRIES_PER_BLOCK, {
  error: `Blok strategii może mieć najwyżej ${STRATEGY_MAX_ENTRIES_PER_BLOCK} wpisów.`,
});

// Jawny obiekt z dziewięcioma kluczami zamiast z.record(enum): dostawcy (Gemini) lepiej znoszą zwykłe `properties`
// niż `propertyNames`/`additionalProperties`. Wynik i tak przechodzi później przez BmcState.
export const GeneratedState = z.strictObject(
  Object.fromEntries(BLOCK_KEYS.map((key) => [key, GeneratedBlock])) as Record<BlockKey, typeof GeneratedBlock>,
);
export type GeneratedState = z.infer<typeof GeneratedState>;

export const Strategy = z.strictObject({
  name: VariantName.describe("Krótka nazwa strategii (do 80 znaków)."),
  assumption: z
    .string()
    .trim()
    .min(1)
    .max(STRATEGY_ASSUMPTION_MAX_LENGTH)
    .describe("Założenie strategii: jedno lub dwa zdania."),
  state: GeneratedState.describe("Pełny model BMC tej strategii: wszystkie dziewięć bloków."),
});
export type Strategy = z.infer<typeof Strategy>;

export const StrategiesOutput = z.strictObject({
  strategies: z.array(Strategy).min(STRATEGY_COUNT_MIN).max(STRATEGY_COUNT_MAX),
});
export type StrategiesOutput = z.infer<typeof StrategiesOutput>;
