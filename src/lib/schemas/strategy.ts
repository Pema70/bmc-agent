import { z } from "zod";
import { VariantId } from "@/lib/schemas/bmc";
import { STRATEGY_COUNT_MAX, type StrategiesOutput } from "@/lib/schemas/variant";

export const STRATEGY_SCHEMA_VERSION = 1;
export const STRATEGY_GUIDELINES_MAX_LENGTH = 500;

export const OperationTrigger = z.enum(["UI", "CHAT"]);
export type OperationTrigger = z.infer<typeof OperationTrigger>;

/** Wytyczne użytkownika: dane (preferencja co do kierunku strategii), nie polecenia. Pusty tekst = brak. */
export const StrategyGuidelines = z
  .string({ error: "Wytyczne muszą być tekstem." })
  .trim()
  .max(STRATEGY_GUIDELINES_MAX_LENGTH, {
    error: `Wytyczne mogą mieć najwyżej ${STRATEGY_GUIDELINES_MAX_LENGTH} znaków.`,
  })
  .nullish()
  .transform((value) => (value ? value : null));

export const GenerateStrategiesInput = z.strictObject({ guidelines: StrategyGuidelines });
export type GenerateStrategiesInput = z.infer<typeof GenerateStrategiesInput>;

// Identyfikator z klienta: tylko kształt, przynależność do projektu i wariantu sprawdza baza.
export const StrategyGenerationId = z.string().trim().min(1).max(64);

export const SaveStrategyInput = z.strictObject({
  variantId: VariantId,
  generationId: StrategyGenerationId,
  index: z
    .number({ error: "Numer strategii musi być liczbą." })
    .int()
    .min(0)
    .max(STRATEGY_COUNT_MAX - 1),
});
export type SaveStrategyInput = z.infer<typeof SaveStrategyInput>;

/** Zapisany wariant pochodzący z kandydata (do pokazania „zapisano jako…” bez ponownego generowania). */
export type SavedStrategyVariant = { index: number; variantId: string; name: string };

export type StrategyGenerationView = {
  id: string;
  createdAt: Date;
  schemaVersion: number;
  variantVersion: number;
  guidelines: string | null;
  trigger: OperationTrigger;
  provider: string;
  model: string;
  promptVersion: string;
  result: StrategiesOutput;
  savedVariants: SavedStrategyVariant[];
};
