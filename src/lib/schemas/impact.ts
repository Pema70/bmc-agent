import { z } from "zod";
import { BlockKey } from "@/lib/schemas/bmc";
import { ProposalOperation } from "@/lib/schemas/proposal";

// Wersja kształtu ImpactOutput zapisywana w ImpactAnalysis.schemaVersion.
export const IMPACT_SCHEMA_VERSION = 1;

export const IMPACT_LEVELS = ["low", "medium", "high"] as const;
export const ImpactLevel = z.enum(IMPACT_LEVELS);
export type ImpactLevel = z.infer<typeof ImpactLevel>;

export const IMPACT_LEVEL_LABELS: Record<ImpactLevel, string> = {
  low: "niski",
  medium: "średni",
  high: "wysoki",
};

export const IMPACT_DESCRIPTION_MIN_LENGTH = 5;
export const IMPACT_DESCRIPTION_MAX_LENGTH = 500;
export const IMPACT_SUMMARY_MAX_LENGTH = 500;
export const IMPACT_TEXT_MAX_LENGTH = 300;
export const IMPACT_MAX_AFFECTED = 8;

const ImpactText = (max: number, what: string) =>
  z
    .string({ error: `${what} musi być tekstem.` })
    .trim()
    .min(1, { error: `${what} nie może być puste.` })
    .max(max, { error: `${what} może mieć najwyżej ${max} znaków.` });

export const AffectedBlock = z.strictObject({
  blockKey: BlockKey.describe("Klucz dotkniętego bloku BMC (inny niż blok zmieniany)."),
  level: ImpactLevel.describe("Stopień wpływu: low (niski), medium (średni) lub high (wysoki)."),
  impact: ImpactText(IMPACT_TEXT_MAX_LENGTH, "Opis wpływu").describe(
    "Krótki opis po polsku, jak zmiana wpływa na ten blok. Bez liczb i szacunków.",
  ),
});
export type AffectedBlock = z.infer<typeof AffectedBlock>;

export const ImpactOutput = z
  .strictObject({
    summary: ImpactText(IMPACT_SUMMARY_MAX_LENGTH, "Podsumowanie").describe(
      "Jedno lub dwa zdania po polsku: czego dotyczy zmiana i jaki jest ogólny charakter jej wpływu.",
    ),
    affected: z
      .array(AffectedBlock)
      .max(IMPACT_MAX_AFFECTED, { error: `Dotkniętych bloków może być najwyżej ${IMPACT_MAX_AFFECTED}.` })
      .describe("Dotknięte bloki; pusta lista, gdy zmiana jest izolowana."),
  })
  .refine((output) => new Set(output.affected.map((item) => item.blockKey)).size === output.affected.length, {
    error: "Każdy blok może wystąpić w liście najwyżej raz.",
    path: ["affected"],
  });
export type ImpactOutput = z.infer<typeof ImpactOutput>;

const Entry = z.string().trim().min(1);

const ProposalChange = z
  .strictObject({
    kind: z.literal("PROPOSAL"),
    blockKey: BlockKey,
    operation: ProposalOperation,
    before: Entry.nullable(),
    after: Entry.nullable(),
  })
  .refine(
    (change) => {
      switch (change.operation) {
        case "add":
          return change.before === null && change.after !== null;
        case "edit":
          return change.before !== null && change.after !== null;
        case "remove":
          return change.before !== null && change.after === null;
      }
    },
    { error: "Pola before i after nie pasują do operacji (add: before=null, edit: oba, remove: after=null)." },
  );

const DescriptionText = z
  .string({ error: "Opis zmiany musi być tekstem." })
  .trim()
  .min(IMPACT_DESCRIPTION_MIN_LENGTH, {
    error: `Opis zmiany musi mieć co najmniej ${IMPACT_DESCRIPTION_MIN_LENGTH} znaków.`,
  })
  .max(IMPACT_DESCRIPTION_MAX_LENGTH, {
    error: `Opis zmiany może mieć najwyżej ${IMPACT_DESCRIPTION_MAX_LENGTH} znaków.`,
  });

const DescriptionChange = z.strictObject({
  kind: z.literal("DESCRIPTION"),
  blockKey: BlockKey,
  description: DescriptionText,
});

/** Zmiana w ujednoliconej postaci: tak trafia do promptu i do bazy (migawka). */
export const ImpactChange = z.discriminatedUnion("kind", [ProposalChange, DescriptionChange]);
export type ImpactChange = z.infer<typeof ImpactChange>;

/** Wskazanie zmiany przez wywołującego (akcja, narzędzie). Dla PROPOSAL serwer sam buduje ImpactChange z bazy. */
export const ImpactChangeRequest = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("PROPOSAL"), proposalId: z.string().trim().min(1).max(64) }),
  z.strictObject({ kind: z.literal("DESCRIPTION"), blockKey: BlockKey, description: DescriptionText }),
]);
export type ImpactChangeRequest = z.infer<typeof ImpactChangeRequest>;

export const ImpactTrigger = z.enum(["UI", "CHAT"]);

/** Analiza gotowa do wyświetlenia (bez migawki stanu). Id zawsze z bazy. */
export type ImpactView = {
  id: string;
  createdAt: Date;
  schemaVersion: number;
  variantVersion: number;
  proposalId: string | null;
  change: ImpactChange;
  trigger: z.infer<typeof ImpactTrigger>;
  provider: string;
  model: string;
  promptVersion: string;
  result: ImpactOutput;
};
