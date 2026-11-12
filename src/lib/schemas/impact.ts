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

/**
 * Argumenty narzędzia czatu analyze_impact. Płaski obiekt z polami .nullish(): modele często wysyłają null
 * zamiast pominąć pole, a null znaczy "brak". Reguła "dokładnie jedna forma" jest sprawdzana w execute
 * (resolveImpactToolRequest), bo .refine nie trafia do JSON Schema przekazywanego dostawcy.
 * Długości sprawdza dopiero ImpactChangeRequest, żeby model dostał czytelny komunikat zamiast błędu SDK.
 */
export const AnalyzeImpactToolInput = z.object({
  proposalId: z
    .string()
    .nullish()
    .describe(
      "Forma 1: identyfikator oczekującej propozycji z wyniku propose_block_change w tej rozmowie. Inaczej pomiń lub null.",
    ),
  blockKey: BlockKey.nullish().describe("Forma 2: klucz zmienianego bloku BMC. Razem z description. Inaczej pomiń lub null."),
  description: z
    .string()
    .nullish()
    .describe("Forma 2: opis zmiany po polsku, 5-500 znaków, na podstawie prośby użytkownika. Inaczej pomiń lub null."),
});
export type AnalyzeImpactToolInput = z.infer<typeof AnalyzeImpactToolInput>;

export const ANALYZE_IMPACT_FORM_MESSAGE =
  "Podaj dokładnie jedną formę argumentów: samo proposalId albo blockKey razem z description (pozostałe pola pomiń lub ustaw null).";

function presentText(value: string | null | undefined): string | null {
  // null, undefined i pusty tekst oznaczają brak pola.
  return value === null || value === undefined || value.trim() === "" ? null : value;
}

/**
 * Z argumentów modelu robi ImpactChangeRequest albo zwraca polski komunikat dla modelu. Dokładnie jedna forma:
 * (a) tylko proposalId, albo (b) blockKey razem z description.
 */
export function resolveImpactToolRequest(
  input: AnalyzeImpactToolInput,
): { ok: true; request: ImpactChangeRequest } | { ok: false; error: string } {
  const proposalId = presentText(input.proposalId);
  const blockKey = input.blockKey ?? null;
  const description = presentText(input.description);

  const hasProposal = proposalId !== null;
  const hasDescriptionForm = blockKey !== null || description !== null;
  if (hasProposal === hasDescriptionForm) {
    return { ok: false, error: ANALYZE_IMPACT_FORM_MESSAGE };
  }

  const candidate = hasProposal ? { kind: "PROPOSAL", proposalId } : { kind: "DESCRIPTION", blockKey, description };
  const parsed = ImpactChangeRequest.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      error: hasProposal
        ? "Nieprawidłowe proposalId."
        : `Nieprawidłowy opis zmiany: podaj blockKey oraz description (${IMPACT_DESCRIPTION_MIN_LENGTH}-${IMPACT_DESCRIPTION_MAX_LENGTH} znaków).`,
    };
  }
  return { ok: true, request: parsed.data };
}

/**
 * Wynik narzędzia czatu analyze_impact widoczny dla modelu: tylko identyfikator zapisanej analizy (z bazy)
 * albo polski komunikat błędu. Model nie dostaje wyniku analizy, a kartę UI czyta z bazy.
 */
export const AnalyzeImpactOutput = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), analysisId: z.string().min(1) }),
  z.strictObject({ ok: z.literal(false), error: z.string().min(1) }),
]);
export type AnalyzeImpactOutput = z.infer<typeof AnalyzeImpactOutput>;
