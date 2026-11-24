import { beforeEach, describe, expect, it, vi } from "vitest";

// Mockowany jest tylko klient Prisma. Prawdziwe: loadReportData, wszystkie funkcje odczytu, resolveEntryOrigins, describeBlock,
// pairRoundEvaluations (reguła kroku 9: nie mockujemy własnych funkcji, bo ukryłoby to błędy w filtrach i sklejaniu danych).
const m = vi.hoisted(() => ({
  variantFindFirst: vi.fn(),
  projectFindUnique: vi.fn(),
  attachmentFindMany: vi.fn(),
  evaluationFindMany: vi.fn(),
  roundFindMany: vi.fn(),
  impactFindMany: vi.fn(),
  comparisonFindMany: vi.fn(),
  queryRaw: vi.fn(),
  groupBy: vi.fn(),
  proposalFindMany: vi.fn(),
  generationFindFirst: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    bmcVariant: { findFirst: m.variantFindFirst },
    project: { findUnique: m.projectFindUnique },
    attachment: { findMany: m.attachmentFindMany },
    evaluationResult: { findMany: m.evaluationFindMany },
    refinementRound: { findMany: m.roundFindMany },
    impactAnalysis: { findMany: m.impactFindMany },
    variantComparison: { findMany: m.comparisonFindMany },
    llmCallLog: { groupBy: m.groupBy },
    proposal: { findMany: m.proposalFindMany },
    strategyGeneration: { findFirst: m.generationFindFirst },
    $queryRaw: m.queryRaw,
  },
}));

import { loadReportData } from "@/lib/report/load-report-data";
import { REPORT_LIMITS } from "@/lib/report/types";
import { emptyBmcState } from "@/lib/schemas/bmc";

const NOW = new Date("2026-11-25T12:00:00Z");
const criterion = { score: 6, justification: "Uzasadnienie." };

const evaluationRow = (id: string, createdAt: string) => ({
  id,
  createdAt: new Date(createdAt),
  schemaVersion: 1,
  variantVersion: 2,
  source: "AI",
  trigger: "UI",
  provider: "google",
  model: "gemini-3.5-flash-lite",
  promptVersion: "evaluate-v1",
  result: { coherence: criterion, risk_resilience: criterion, feasibility: criterion, innovation: criterion },
});

const question = { blockKey: "channels", criterion: "feasibility", question: "Czy macie sklep?", suggestedAnswers: [] };
const roundRow = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  roundNumber: 1,
  status: "PROPOSED",
  evaluationId: "e1",
  variantVersion: 2,
  questions: { questions: [question, question, question] },
  answers: ["Tak", "", ""],
  createdAt: new Date("2026-11-20T09:00:00Z"),
  ...overrides,
});

const proposalRow = (overrides: Record<string, unknown> = {}) => ({
  id: "pr1",
  blockKey: "channels",
  operation: "ADD",
  after: "Sklep online",
  rationale: "Klienci pytają o zakupy.",
  status: "ACCEPTED",
  resolvedAt: new Date("2026-11-20T12:00:00Z"),
  sourceKind: "CONVERSATION",
  sourceAttachmentName: null,
  refinementRoundId: null,
  refinementQuestionIndex: null,
  ...overrides,
});

const variantRow = (overrides: Record<string, unknown> = {}) => ({
  id: "v1",
  name: "Wariant główny",
  isMain: true,
  origin: "MANUAL",
  description: null,
  version: 5,
  createdAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-21T10:00:00Z"),
  state: { ...emptyBmcState(), channels: ["Sklep online", "Targi"], key_partnerships: ["Palarnia"] },
  entryOrigins: [],
  generationId: null,
  generationIndex: null,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.variantFindFirst.mockResolvedValue(variantRow());
  m.projectFindUnique.mockResolvedValue({ id: "p1", name: "Kawiarnia Ziarno", description: "Palarnia i kawiarnia." });
  m.attachmentFindMany.mockResolvedValue([]);
  m.evaluationFindMany.mockResolvedValue([]);
  m.roundFindMany.mockResolvedValue([]);
  m.impactFindMany.mockResolvedValue([]);
  m.queryRaw.mockResolvedValue([]);
  m.comparisonFindMany.mockResolvedValue([]);
  m.groupBy.mockResolvedValue([]);
  m.proposalFindMany.mockResolvedValue([]);
  m.generationFindFirst.mockResolvedValue(null);
});

describe("loadReportData: filtry i brak wywołań modelu", () => {
  it("każdy odczyt jest ograniczony do projektu, a wariantowy także do wariantu", async () => {
    await loadReportData("p1", "v1", NOW);

    expect(m.variantFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "v1", projectId: "p1" } }));
    expect(m.projectFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1" } }));
    expect(m.attachmentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1" } }));
    expect(m.evaluationFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", variantId: "v1" } }));
    expect(m.roundFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { variantId: "v1", projectId: "p1" } }));
    expect(m.impactFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", variantId: "v1" } }));
    expect(m.proposalFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { variantId: "v1", variant: { projectId: "p1" } } }));
    expect(m.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", status: "OK" } }));
    expect(m.queryRaw.mock.calls[0].slice(1)).toEqual(["p1", JSON.stringify([{ variantId: "v1" }]), REPORT_LIMITS.comparisons + 1]);
  });

  it("wariant spoza projektu: null, bez odczytu czegokolwiek innego", async () => {
    m.variantFindFirst.mockResolvedValue(null);

    expect(await loadReportData("p1", "v-obcy", NOW)).toBeNull();
    for (const mock of [m.projectFindUnique, m.attachmentFindMany, m.evaluationFindMany, m.roundFindMany, m.proposalFindMany, m.groupBy, m.queryRaw]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("brak projektu: null", async () => {
    m.projectFindUnique.mockResolvedValue(null);

    expect(await loadReportData("p1", "v1", NOW)).toBeNull();
  });

  it("składa nagłówek raportu z zapisanych danych (stan zapisany, wersja, data generowania)", async () => {
    const data = await loadReportData("p1", "v1", NOW);

    expect(data).toMatchObject({
      generatedAt: NOW,
      project: { name: "Kawiarnia Ziarno", description: "Palarnia i kawiarnia." },
      variant: { name: "Wariant główny", isMain: true, origin: "MANUAL", version: 5 },
    });
    expect(JSON.stringify(data)).not.toContain('"v1"');
  });
});

describe("loadReportData: pochodzenie wpisów i opisy bloków", () => {
  it("zapisane pochodzenie wygrywa; ręczny wpis nie dostaje uzasadnienia propozycji o tym samym tekście", async () => {
    m.variantFindFirst.mockResolvedValue(
      variantRow({
        entryOrigins: [
          { blockKey: "channels", text: "Sklep online", kind: "MANUAL", recordedVersion: 5 },
          { blockKey: "channels", text: "Targi", kind: "PROPOSAL", proposalId: "pr2", sourceKind: "MODEL_KNOWLEDGE", recordedVersion: 5 },
        ],
      }),
    );
    m.proposalFindMany.mockResolvedValue([
      proposalRow({ id: "pr2", after: "Targi", rationale: "Częsty kanał w branży.", sourceKind: "MODEL_KNOWLEDGE" }),
      proposalRow({ id: "pr1" }),
    ]);

    const data = await loadReportData("p1", "v1", NOW);

    const channels = data?.blocks.find((block) => block.blockKey === "channels");
    expect(channels?.entries).toEqual([
      expect.objectContaining({ text: "Sklep online", sourceLabel: "ręczny (tekst użytkownika)", rationale: null }),
      expect.objectContaining({ text: "Targi", sourceLabel: "wiedza modelu (deklaracja agenta, niezweryfikowana)", rationale: "Częsty kanał w branży." }),
    ]);
    expect(data?.origins.counts).toEqual({ total: 3, saved: 2, inferred: 0, unknown: 1 });
    expect(data?.blocks.find((block) => block.blockKey === "key_partnerships")?.entries[0].sourceLabel).toBe("źródło nieznane");
  });

  it("wariant sprzed kroku 9: pochodzenie ustalone po tekście z zaakceptowanej propozycji, z numerem rundy i pytania", async () => {
    m.roundFindMany.mockResolvedValue([roundRow()]);
    m.proposalFindMany.mockResolvedValue([
      proposalRow({ sourceKind: "REFINEMENT", refinementRoundId: "r1", refinementQuestionIndex: 1, rationale: "Z odpowiedzi użytkownika." }),
    ]);

    const data = await loadReportData("p1", "v1", NOW);

    const entry = data?.blocks.find((block) => block.blockKey === "channels")?.entries[0];
    expect(entry).toMatchObject({
      text: "Sklep online",
      sourceLabel: "propozycja z cyklu poprawek, runda 1, pytanie 2 (na podstawie odpowiedzi użytkownika) (ustalone po tekście, prawdopodobne)",
      rationale: "Z odpowiedzi użytkownika.",
      position: { roundNumber: 1, questionNumber: 2 },
    });
    expect(data?.origins.counts.inferred).toBe(1);
  });

  it("wariant ze strategii sprzed kroku 9: pochodzenie z kandydata strategii pobranego po id generacji i projekcie", async () => {
    m.variantFindFirst.mockResolvedValue(variantRow({ origin: "AI_STRATEGY", generationId: "g1", generationIndex: 0 }));
    const candidate = { ...emptyBmcState(), channels: ["Sklep online", "Targi"], key_partnerships: ["Palarnia"] };
    m.generationFindFirst.mockResolvedValue({
      schemaVersion: 1,
      result: { strategies: [{ name: "Online", assumption: "Sprzedaż w sieci.", state: candidate }, { name: "Lokalnie", assumption: "Miasto.", state: candidate }] },
    });

    const data = await loadReportData("p1", "v1", NOW);

    expect(m.generationFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "g1", projectId: "p1" } }));
    expect(data?.blocks.find((block) => block.blockKey === "channels")?.entries[0].sourceLabel).toBe(
      "strategia AI Online (ustalone po tekście, prawdopodobne)",
    );
  });

  it("uszkodzony zapis pochodzenia jest ignorowany i oznaczony, a wpisy dostają „źródło nieznane”", async () => {
    m.variantFindFirst.mockResolvedValue(variantRow({ entryOrigins: [{ blockKey: "channels", kind: "NIE_ISTNIEJE" }] }));

    const data = await loadReportData("p1", "v1", NOW);

    expect(data?.origins.corrupt).toBe(true);
    expect(data?.origins.counts).toEqual({ total: 3, saved: 0, inferred: 0, unknown: 3 });
  });

  it("pusty wariant: dziewięć pustych opisów bloków, bez wyjątku", async () => {
    m.variantFindFirst.mockResolvedValue(variantRow({ state: emptyBmcState() }));

    const data = await loadReportData("p1", "v1", NOW);

    expect(data?.blocks).toHaveLength(9);
    expect(data?.blocks.every((block) => block.entryCount === 0)).toBe(true);
    expect(data?.origins.counts.total).toBe(0);
    expect(data?.evaluations).toEqual({ items: [], truncated: false, limit: REPORT_LIMITS.evaluations });
  });

  it("lista propozycji ponad limit: flaga proposalsTruncated, a pobieranie z limitem + 1", async () => {
    m.proposalFindMany.mockResolvedValue(Array.from({ length: REPORT_LIMITS.proposals + 1 }, (_, index) => proposalRow({ id: `pr${index}`, after: `Wpis ${index}` })));

    const data = await loadReportData("p1", "v1", NOW);

    expect(data?.proposalsTruncated).toBe(true);
    expect(m.proposalFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: REPORT_LIMITS.proposals + 1 }));
  });
});

describe("loadReportData: oceny, rundy, analizy, porównania, załączniki, modele", () => {
  it("lista ocen ponad limit jest obcięta z flagą, a uszkodzony rekord to pozycja z błędem", async () => {
    const rows = Array.from({ length: REPORT_LIMITS.evaluations + 1 }, (_, index) =>
      evaluationRow(`e${index}`, `2026-11-${String(24 - Math.min(index, 20)).padStart(2, "0")}T10:00:00Z`),
    );
    rows[1] = { ...rows[1], result: { ...rows[1].result, coherence: { score: 99, justification: "x" } } };
    m.evaluationFindMany.mockResolvedValue(rows);

    const data = await loadReportData("p1", "v1", NOW);

    expect(data?.evaluations.items).toHaveLength(REPORT_LIMITS.evaluations);
    expect(data?.evaluations.truncated).toBe(true);
    expect(data?.evaluations.items[1]).toMatchObject({ ok: false, id: "e1" });
    expect(m.evaluationFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: REPORT_LIMITS.evaluations + 1 }));
  });

  it("runda poprawek ma parę ocen przed i po (przez prawdziwe odczyty, bez mocków logiki)", async () => {
    m.evaluationFindMany.mockResolvedValue([evaluationRow("e2", "2026-11-21T10:00:00Z"), evaluationRow("e1", "2026-11-20T08:00:00Z")]);
    m.roundFindMany.mockResolvedValue([roundRow()]);
    m.proposalFindMany.mockResolvedValue([proposalRow({ refinementRoundId: "r1", refinementQuestionIndex: 0, sourceKind: "REFINEMENT" })]);

    const data = await loadReportData("p1", "v1", NOW);

    const pair = data?.rounds[0];
    expect(pair).toMatchObject({ ok: true, afterStatus: "FOUND" });
    expect(pair?.ok && [pair.before?.id, pair.after?.id]).toEqual(["e1", "e2"]);
  });

  it("wariant bez oceny i bez rund: puste listy", async () => {
    const data = await loadReportData("p1", "v1", NOW);

    expect(data?.rounds).toEqual([]);
    expect(data?.evaluations.items).toEqual([]);
    expect(data?.impacts.items).toEqual([]);
    expect(data?.comparisons.items).toEqual([]);
  });

  it("załącznik jest oznaczony jako użyty, gdy jest źródłem bieżącego wpisu albo zaakceptowanej propozycji; bez id w danych", async () => {
    m.attachmentFindMany.mockResolvedValue([
      { id: "a1", ordinal: 1, fileName: "Opis.pdf", kind: "PDF", sizeBytes: 1000, textChars: 500, truncated: false, createdAt: new Date("2026-11-10T10:00:00Z") },
      { id: "a2", ordinal: 2, fileName: "Notatki.txt", kind: "TXT", sizeBytes: 200, textChars: 100, truncated: false, createdAt: new Date("2026-11-11T10:00:00Z") },
      { id: "a3", ordinal: 3, fileName: "Odrzucony.txt", kind: "TXT", sizeBytes: 200, textChars: 100, truncated: false, createdAt: new Date("2026-11-12T10:00:00Z") },
    ]);
    m.variantFindFirst.mockResolvedValue(
      variantRow({
        entryOrigins: [{ blockKey: "channels", text: "Sklep online", kind: "PROPOSAL", sourceKind: "ATTACHMENT", attachmentName: "Opis.pdf", recordedVersion: 5 }],
      }),
    );
    m.proposalFindMany.mockResolvedValue([
      proposalRow({ id: "pr5", sourceKind: "ATTACHMENT", sourceAttachmentName: "Notatki.txt" }),
      proposalRow({ id: "pr6", sourceKind: "ATTACHMENT", sourceAttachmentName: "Odrzucony.txt", status: "REJECTED" }),
    ]);

    const data = await loadReportData("p1", "v1", NOW);

    expect(data?.attachments.map((attachment) => [attachment.fileName, attachment.usedAsSource])).toEqual([
      ["Opis.pdf", true],
      ["Notatki.txt", true],
      ["Odrzucony.txt", false],
    ]);
    expect(data?.attachments[0]).not.toHaveProperty("id");
  });

  it("porównania są filtrowane po wariancie w bazie; wynik bez migawek stanów", async () => {
    m.queryRaw.mockResolvedValue([{ id: "c1" }]);
    const assessment = (label: string) => ({ label, pros: ["Zaleta"], cons: ["Wada"] });
    m.comparisonFindMany.mockResolvedValue([
      {
        id: "c1",
        createdAt: new Date("2026-11-16T10:00:00Z"),
        schemaVersion: 1,
        inputs: [
          { label: "A", variantId: "v1", name: "Główny", version: 3, state: emptyBmcState() },
          { label: "B", variantId: "v2", name: "Strategia", version: 1, state: emptyBmcState() },
        ],
        result: {
          summary: "Różnią się.",
          blockNotes: [],
          variants: [assessment("A"), assessment("B")],
          recommendation: { label: null, rationale: "Brak wskazania." },
        },
        trigger: "UI",
        provider: "google",
        model: "gemini-3.5-flash-lite",
        promptVersion: "compare-v1",
      },
    ]);

    const data = await loadReportData("p1", "v1", NOW);

    expect(data?.comparisons.items).toHaveLength(1);
    expect(data?.comparisons.items[0]).toMatchObject({ ok: true, comparison: { id: "c1" } });
    expect(JSON.stringify(data?.comparisons)).not.toContain('"state"');
  });

  it("zbiorcza tabela modeli i promptów pochodzi z dziennika wywołań projektu", async () => {
    m.groupBy.mockResolvedValue([
      {
        operation: "chat",
        provider: "google",
        model: "gemini-3.5-flash-lite",
        promptVersion: "chat-v6",
        _count: { _all: 12 },
        _min: { createdAt: new Date("2026-11-01T10:00:00Z") },
        _max: { createdAt: new Date("2026-11-20T10:00:00Z") },
      },
    ]);

    const data = await loadReportData("p1", "v1", NOW);

    expect(data?.llmSummary).toEqual([expect.objectContaining({ operation: "chat", promptVersion: "chat-v6", calls: 12 })]);
  });
});
