import type { ComparisonListItem } from "@/lib/db/comparisons";
import type { EvaluationListItem } from "@/lib/db/evaluations";
import type { ImpactListItem } from "@/lib/db/impact";
import type { LlmCallSummaryRow } from "@/lib/db/report";
import type { BlockDescription } from "@/lib/report/describe-blocks";
import type { ResolvedOrigins } from "@/lib/report/provenance";
import type { RoundEvaluationPair } from "@/lib/report/round-evaluations";
import type { AttachmentView } from "@/lib/schemas/attachment";
import type { BmcState } from "@/lib/schemas/bmc";

/** Limity raportu (decyzja D8 planu kroku 9). Nadmiar jest obcinany, a raport mówi o tym wprost. */
export const REPORT_LIMITS = {
  evaluations: 20,
  impacts: 20,
  comparisons: 10,
  /** Propozycje służą opisom bloków i wstecznemu ustalaniu pochodzenia, nie są listowane w raporcie. */
  proposals: 500,
} as const;

/** Lista obcięta do limitu; `truncated` oznacza, że w bazie są jeszcze starsze pozycje (pobieramy limit + 1). */
export type Limited<T> = { items: T[]; truncated: boolean; limit: number };

export type ReportAttachment = Omit<AttachmentView, "id"> & {
  /** Załącznik jest źródłem co najmniej jednego bieżącego wpisu albo zaakceptowanej propozycji wariantu. */
  usedAsSource: boolean;
};

/**
 * Dane rozszerzonego raportu, złożone wyłącznie z zapisanych danych (0 wywołań modelu). Identyfikatory z bazy (wariantu,
 * propozycji, magazynu) nie są częścią tego modelu poza widokami wyników, których szablony ich nie wypisują.
 */
export type ReportData = {
  generatedAt: Date;
  project: { name: string; description: string };
  variant: {
    name: string;
    isMain: boolean;
    origin: "MANUAL" | "AI_STRATEGY";
    description: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  };
  state: BmcState;
  origins: ResolvedOrigins;
  blocks: BlockDescription[];
  attachments: ReportAttachment[];
  evaluations: Limited<EvaluationListItem>;
  rounds: RoundEvaluationPair[];
  impacts: Limited<ImpactListItem>;
  comparisons: Limited<ComparisonListItem>;
  llmSummary: LlmCallSummaryRow[];
  /** Lista propozycji użyta do opisów była obcięta (starsze propozycje nie wpłynęły na opisy i ustalanie pochodzenia). */
  proposalsTruncated: boolean;
};
