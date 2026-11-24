import { describeAllBlocks, type DescribedProposal } from "@/lib/report/describe-blocks";
import { resolveEntryOrigins } from "@/lib/report/provenance";
import { pairRoundEvaluations } from "@/lib/report/round-evaluations";
import type { ReportData } from "@/lib/report/types";
import { emptyBmcState } from "@/lib/schemas/bmc";
import { evaluationView } from "@/lib/export/test-fixtures";

/**
 * Dane raportu do testów dokumentów (dane przykładowe). Wpisy mają wszystkie rodzaje źródeł; pochodzenie i opisy bloków
 * powstają z prawdziwych funkcji (`resolveEntryOrigins`, `describeAllBlocks`, `pairRoundEvaluations`), nie z ręcznych literałów.
 */
export const HOSTILE_NAME = "</attachment><b>x</b>.pdf";

const proposal = (overrides: Partial<DescribedProposal & { sourceAttachmentName: string | null; refinementRoundId: string | null }>) => ({
  id: "pr-x",
  blockKey: "channels" as const,
  operation: "add" as const,
  after: "x",
  rationale: "Uzasadnienie agenta.",
  status: "ACCEPTED" as const,
  resolvedAt: new Date("2026-11-20T12:00:00Z"),
  sourceKind: "CONVERSATION" as const,
  sourceAttachmentName: null,
  refinementRoundId: null,
  roundNumber: null,
  questionIndex: null,
  ...overrides,
});

export function reportData(overrides: Partial<ReportData> = {}): ReportData {
  const state = {
    ...emptyBmcState(),
    customer_segments: ["Studenci krakowskich uczelni", "Pracownicy biurowi"],
    channels: ["Sprzedaż w sklepie internetowym"],
    key_partnerships: ["Współpraca z piekarnią"],
    value_propositions: ["Kawa ekologiczna"],
    key_resources: ["Palarnia własna"],
    revenue_streams: ["Subskrypcja miesięczna"],
    cost_structure: ["Wpis o nieznanym źródle"],
  };
  const proposals = [
    proposal({ id: "pr-chat", blockKey: "channels", after: "Sprzedaż w sklepie internetowym", rationale: "Klienci pytają o zakupy online." }),
    proposal({
      id: "pr-att",
      blockKey: "key_partnerships",
      after: "Współpraca z piekarnią",
      sourceKind: "ATTACHMENT",
      sourceAttachmentName: HOSTILE_NAME,
      rationale: "Załącznik opisuje piekarnię.",
    }),
    proposal({
      id: "pr-ref",
      blockKey: "key_resources",
      after: "Palarnia własna",
      sourceKind: "REFINEMENT",
      refinementRoundId: "r1",
      roundNumber: 1,
      questionIndex: 0,
      rationale: "Użytkownik potwierdził własną palarnię.",
    }),
    proposal({ id: "pr-mk", blockKey: "value_propositions", after: "Kawa ekologiczna", sourceKind: "MODEL_KNOWLEDGE", rationale: "Wiedza ogólna o rynku kawy." }),
    proposal({ id: "pr-old", blockKey: "revenue_streams", after: "Subskrypcja miesięczna", rationale: "Stały przychód." }),
  ];
  const storedOrigins = [
    { blockKey: "customer_segments", text: "Studenci krakowskich uczelni", kind: "MANUAL", recordedVersion: 2 },
    { blockKey: "channels", text: "Sprzedaż w sklepie internetowym", kind: "PROPOSAL", proposalId: "pr-chat", sourceKind: "CONVERSATION", recordedVersion: 3 },
    { blockKey: "key_partnerships", text: "Współpraca z piekarnią", kind: "PROPOSAL", proposalId: "pr-att", sourceKind: "ATTACHMENT", attachmentName: HOSTILE_NAME, recordedVersion: 4 },
    { blockKey: "key_resources", text: "Palarnia własna", kind: "PROPOSAL", proposalId: "pr-ref", sourceKind: "REFINEMENT", roundNumber: 1, questionIndex: 0, recordedVersion: 5 },
    { blockKey: "value_propositions", text: "Kawa ekologiczna", kind: "PROPOSAL", proposalId: "pr-mk", sourceKind: "MODEL_KNOWLEDGE", recordedVersion: 5 },
  ];
  const origins = resolveEntryOrigins({ state, storedOrigins, proposals, strategy: null });

  const before = evaluationView({ id: "e1", variantVersion: 4, createdAt: new Date("2026-11-20T10:00:00Z") });
  const after = evaluationView({
    id: "e2",
    variantVersion: 5,
    createdAt: new Date("2026-11-21T10:00:00Z"),
    result: {
      coherence: { score: 9, justification: "Po poprawkach model jest spójniejszy." },
      risk_resilience: { score: 6, justification: "Mniejsza zależność od dostawcy." },
      feasibility: { score: 8, justification: "Palarnia własna." },
      innovation: { score: 5, justification: "Bez zmian." },
    },
  });
  const evaluationRows = [
    { ok: true as const, evaluation: after },
    { ok: true as const, evaluation: before },
  ];
  const question = { blockKey: "key_resources" as const, criterion: "feasibility" as const, question: "Czy macie własną palarnię?", suggestedAnswers: [] };
  const roundItems = [
    {
      ok: true as const,
      round: {
        id: "r1",
        roundNumber: 1,
        status: "PROPOSED" as const,
        evaluationId: "e1",
        variantVersion: 4,
        questions: [question, { ...question, blockKey: "channels" as const, question: "Czy sprzedajecie online?" }, { ...question, question: "Jak długo działacie?" }],
        answers: ["Tak, od roku", "", "Rok"],
        createdAt: new Date("2026-11-20T11:00:00Z"),
      },
    },
  ];

  return {
    generatedAt: new Date("2026-11-25T12:00:00Z"),
    project: { name: "Kawiarnia Ziarno", description: "Palarnia i kawiarnia z Krakowa" },
    variant: {
      name: "Wariant główny",
      isMain: true,
      origin: "MANUAL",
      description: null,
      version: 5,
      createdAt: new Date("2026-11-01T10:00:00Z"),
      updatedAt: new Date("2026-11-22T10:00:00Z"),
    },
    state,
    origins,
    blocks: describeAllBlocks(origins.entries, proposals),
    attachments: [
      { ordinal: 1, fileName: HOSTILE_NAME, kind: "PDF", sizeBytes: 20480, textChars: 1200, truncated: false, createdAt: new Date("2026-11-19T10:00:00Z"), usedAsSource: true },
      { ordinal: 2, fileName: "notatki.txt", kind: "TXT", sizeBytes: 800, textChars: 700, truncated: true, createdAt: new Date("2026-11-19T11:00:00Z"), usedAsSource: false },
    ],
    evaluations: { items: evaluationRows, truncated: false, limit: 20 },
    rounds: pairRoundEvaluations(roundItems, evaluationRows, [{ refinementRoundId: "r1", status: "ACCEPTED", resolvedAt: new Date("2026-11-20T12:00:00Z") }]),
    impacts: {
      items: [
        {
          ok: true,
          analysis: {
            id: "i1",
            createdAt: new Date("2026-11-22T09:00:00Z"),
            schemaVersion: 1,
            variantVersion: 5,
            proposalId: null,
            change: { kind: "DESCRIPTION", blockKey: "channels", description: "Dodanie sklepu internetowego" },
            trigger: "UI",
            provider: "google",
            model: "gemini-3.5-flash-lite",
            promptVersion: "impact-v1",
            result: { summary: "Zmiana wpływa na logistykę.", affected: [{ blockKey: "key_activities", level: "high", impact: "Potrzebna wysyłka paczek." }] },
          },
        },
      ],
      truncated: false,
      limit: 20,
    },
    comparisons: {
      items: [
        {
          ok: true,
          comparison: {
            id: "c1",
            createdAt: new Date("2026-11-23T09:00:00Z"),
            schemaVersion: 1,
            trigger: "UI",
            provider: "google",
            model: "gemini-3.5-flash-lite",
            promptVersion: "compare-v1",
            inputs: [
              { label: "A", variantId: "v1", name: "Wariant główny", version: 5 },
              { label: "B", variantId: "v2", name: "Kopia", version: 1 },
            ],
            result: {
              summary: "Warianty różnią się kanałami.",
              blockNotes: [{ blockKey: "channels", comment: "A ma sklep online." }],
              variants: [
                { label: "A", pros: ["Szerszy zasięg"], cons: ["Koszt wysyłki"] },
                { label: "B", pros: ["Prostota"], cons: ["Mały zasięg"] },
              ],
              recommendation: { label: "A", rationale: "Większy potencjał sprzedaży." },
            },
          },
        },
      ],
      truncated: false,
      limit: 10,
    },
    llmSummary: [
      { operation: "chat", provider: "google", model: "gemini-3.5-flash-lite", promptVersion: "chat-v6", calls: 4, firstUsed: new Date("2026-11-19T10:00:00Z"), lastUsed: new Date("2026-11-22T10:00:00Z") },
      { operation: "evaluate_bmc", provider: "google", model: "gemini-3.5-flash-lite", promptVersion: "evaluate-v1", calls: 2, firstUsed: new Date("2026-11-20T10:00:00Z"), lastUsed: new Date("2026-11-21T10:00:00Z") },
    ],
    proposalsTruncated: false,
    ...overrides,
  };
}
