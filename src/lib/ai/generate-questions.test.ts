import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Prawdziwe: runGenerateQuestions, runObjectOperation, listEvaluationsForVariant, getRefinementGate i createRefinementRound.
// Zamockowane: klient Prisma, odczyty wariantu i projektu, limity użytkownika, model i log wywołań.
const mocks = vi.hoisted(() => ({
  getVariantForProject: vi.fn(),
  getProject: vi.fn(),
  checkUserLimits: vi.fn(),
  getChatModel: vi.fn(),
  logLlmCall: vi.fn(),
  round: { findMany: vi.fn(), create: vi.fn() },
  proposal: { count: vi.fn() },
  evaluation: { findMany: vi.fn(), findFirst: vi.fn() },
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/variants", () => ({ getVariantForProject: mocks.getVariantForProject }));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/ai/limits", () => ({ checkUserLimits: mocks.checkUserLimits }));
vi.mock("@/lib/ai/models", () => ({ getChatModel: mocks.getChatModel }));
vi.mock("@/lib/ai/log", () => ({ logLlmCall: mocks.logLlmCall }));
vi.mock("@/lib/db/client", () => {
  const client = {
    refinementRound: mocks.round,
    proposal: mocks.proposal,
    evaluationResult: mocks.evaluation,
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  };
  return { prisma: client };
});

import {
  QUESTIONS_ROUNDS_LIMIT_MESSAGE,
  QUESTIONS_SAVE_FAILED_MESSAGE,
  QUESTIONS_STALE_EVALUATION_MESSAGE,
  QUESTIONS_TOO_EMPTY_MESSAGE,
  runGenerateQuestions,
} from "@/lib/ai/generate-questions";
import { QUESTIONS_PROMPT_VERSION } from "@/lib/ai/prompts/questions";
import { emptyBmcState, type BmcState } from "@/lib/schemas/bmc";

const ctx = { projectId: "p1", variantId: "v1", userId: "u1", expectedVersion: 4 };

const state: BmcState = {
  ...emptyBmcState(),
  customer_segments: ["Studenci"],
  value_propositions: ["Kawa speciality"],
  channels: ["Sklep online", "Targi"],
  revenue_streams: ["Sprzedaż kawy"],
};

const criterion = (score: number) => ({ score, justification: "Uzasadnienie." });
const evaluationResult = {
  coherence: criterion(4),
  risk_resilience: criterion(5),
  feasibility: criterion(7),
  innovation: criterion(3),
};
const evaluationRow = (overrides: Record<string, unknown> = {}) => ({
  id: "e1",
  createdAt: new Date("2026-11-24T10:00:00Z"),
  schemaVersion: 1,
  variantVersion: 4,
  source: "AI",
  trigger: "UI",
  provider: "google",
  model: "gemini-3.5-flash-lite",
  promptVersion: "evaluate-v1",
  result: evaluationResult,
  ...overrides,
});

const question = { blockKey: "customer_segments", criterion: "coherence", question: "Kim są Twoi klienci?", suggestedAnswers: [] };
const goodOutput = { questions: [question, { ...question, blockKey: "channels", criterion: "risk_resilience" }, question] };

const usage = {
  inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 300, text: 300, reasoning: undefined },
};

function generateModel(text: string, finish: "stop" | "length" = "stop") {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: finish, raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

function setModel(model: MockLanguageModelV4) {
  mocks.getChatModel.mockReturnValue({ model, provider: "google", modelId: "gemini-3.5-flash-lite" });
  return model;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 4, state });
  mocks.getProject.mockResolvedValue({ id: "p1", name: "Kawiarnia", description: "Opis" });
  mocks.checkUserLimits.mockResolvedValue({ ok: true });
  mocks.logLlmCall.mockResolvedValue("log-1");
  mocks.evaluation.findMany.mockResolvedValue([evaluationRow()]);
  mocks.evaluation.findFirst.mockResolvedValue({ id: "e1" });
  mocks.round.findMany.mockResolvedValue([]);
  mocks.proposal.count.mockResolvedValue(0);
  mocks.queryRaw.mockResolvedValue([{ id: "v1" }]);
  mocks.round.create.mockResolvedValue({ id: "r-z-bazy", roundNumber: 1, createdAt: new Date("2026-11-24T10:05:00Z") });
  mocks.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) =>
    callback({ refinementRound: mocks.round, proposal: mocks.proposal, evaluationResult: mocks.evaluation, $queryRaw: mocks.queryRaw }),
  );
});

describe("runGenerateQuestions: poprawny przebieg", () => {
  it("zapisuje rundę z pytaniami, oceną początkową, migawką stanu i wersją promptu; log OK z operacją generate_questions", async () => {
    const model = setModel(generateModel(JSON.stringify(goodOutput)));

    const result = await runGenerateQuestions(ctx);

    expect(result).toMatchObject({
      ok: true,
      round: { id: "r-z-bazy", roundNumber: 1, status: "AWAITING_ANSWERS", evaluationId: "e1", variantVersion: 4, answers: null },
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    const data = mocks.round.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      projectId: "p1",
      variantId: "v1",
      roundNumber: 1,
      evaluationId: "e1",
      variantVersion: 4,
      stateSnapshot: state,
      questions: goodOutput,
      provider: "google",
      model: "gemini-3.5-flash-lite",
      questionsPromptVersion: QUESTIONS_PROMPT_VERSION,
      questionsLlmCallLogId: "log-1",
      createdById: "u1",
    });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "generate_questions", promptVersion: "questions-v1", status: "OK", projectId: "p1" }),
    );
  });

  it("do modelu trafiają dane w blokach (projekt, stan, ocena), bez identyfikatorów z bazy", async () => {
    const model = setModel(generateModel(JSON.stringify(goodOutput)));

    await runGenerateQuestions(ctx);

    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain("<evaluation>");
    expect(prompt).toContain("<bmc_state>");
    expect(prompt).not.toContain("e1\"");
  });

  it("start rundy czyta ostatnią ocenę po projectId i variantId (limit 1)", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));

    await runGenerateQuestions(ctx);

    expect(mocks.evaluation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "p1", variantId: "v1" }, take: 1 }),
    );
  });
});

describe("runGenerateQuestions: kontrole przed modelem (model nie jest wołany, nic nie jest zapisane)", () => {
  async function expectNoModelNoWrite(model: MockLanguageModelV4) {
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(mocks.round.create).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  }

  it("nieistniejący lub cudzy wariant: NOT_FOUND", async () => {
    const model = setModel(generateModel("{}"));
    mocks.getVariantForProject.mockResolvedValue(null);

    expect(await runGenerateQuestions(ctx)).toMatchObject({ ok: false, error: "NOT_FOUND" });
    await expectNoModelNoWrite(model);
  });

  it("zmieniona wersja wariantu (expectedVersion): VERSION_CONFLICT", async () => {
    const model = setModel(generateModel("{}"));

    expect(await runGenerateQuestions({ ...ctx, expectedVersion: 3 })).toMatchObject({ ok: false, error: "VERSION_CONFLICT" });
    await expectNoModelNoWrite(model);
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
  });

  it("brak oceny: STALE_EVALUATION z komunikatem „Najpierw oceń model”", async () => {
    const model = setModel(generateModel("{}"));
    mocks.evaluation.findMany.mockResolvedValue([]);

    expect(await runGenerateQuestions(ctx)).toEqual({ ok: false, error: "STALE_EVALUATION", message: QUESTIONS_STALE_EVALUATION_MESSAGE });
    await expectNoModelNoWrite(model);
  });

  it("ocena z wcześniejszej wersji wariantu: STALE_EVALUATION (bez ukrytego wywołania oceny)", async () => {
    const model = setModel(generateModel("{}"));
    mocks.evaluation.findMany.mockResolvedValue([evaluationRow({ variantVersion: 3 })]);

    expect(await runGenerateQuestions(ctx)).toMatchObject({ ok: false, error: "STALE_EVALUATION" });
    await expectNoModelNoWrite(model);
  });

  it("najnowsza ocena uszkodzona: traktowana jak brak oceny", async () => {
    const model = setModel(generateModel("{}"));
    mocks.evaluation.findMany.mockResolvedValue([evaluationRow({ result: { coherence: 1 } })]);

    expect(await runGenerateQuestions(ctx)).toMatchObject({ ok: false, error: "STALE_EVALUATION" });
    await expectNoModelNoWrite(model);
  });

  it("trzy rundy (także zamknięte): ROUNDS_LIMIT przed limitami użytkownika i modelem", async () => {
    const model = setModel(generateModel("{}"));
    mocks.round.findMany.mockResolvedValue([
      { id: "r1", status: "CANCELLED" },
      { id: "r2", status: "CANCELLED" },
      { id: "r3", status: "CANCELLED" },
    ]);

    expect(await runGenerateQuestions(ctx)).toEqual({ ok: false, error: "ROUNDS_LIMIT", message: QUESTIONS_ROUNDS_LIMIT_MESSAGE });
    await expectNoModelNoWrite(model);
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
  });

  it("niedokończona runda: ROUND_IN_PROGRESS", async () => {
    const model = setModel(generateModel("{}"));
    mocks.round.findMany.mockResolvedValue([{ id: "r1", status: "AWAITING_ANSWERS" }]);

    expect(await runGenerateQuestions(ctx)).toMatchObject({ ok: false, error: "ROUND_IN_PROGRESS" });
    await expectNoModelNoWrite(model);
  });

  it("limity użytkownika: LIMIT z retryAfterSec", async () => {
    const model = setModel(generateModel("{}"));
    mocks.checkUserLimits.mockResolvedValue({ ok: false, message: "Limit.", retryAfterSec: 120 });

    expect(await runGenerateQuestions(ctx)).toEqual({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 120 });
    await expectNoModelNoWrite(model);
  });

  it("model zbyt pusty (próg jak ocena): TOO_EMPTY", async () => {
    const model = setModel(generateModel("{}"));
    mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 4, state: emptyBmcState() });

    expect(await runGenerateQuestions(ctx)).toEqual({ ok: false, error: "TOO_EMPTY", message: QUESTIONS_TOO_EMPTY_MESSAGE });
    await expectNoModelNoWrite(model);
  });
});

describe("runGenerateQuestions: odpowiedź modelu i zapis", () => {
  it("odpowiedź niezgodna ze schematem (2 pytania zamiast 3 do 5): SCHEMA, log SCHEMA_ERROR, brak rundy", async () => {
    setModel(generateModel(JSON.stringify({ questions: [question, question] })));

    const result = await runGenerateQuestions(ctx);

    expect(result).toMatchObject({ ok: false, error: "SCHEMA" });
    expect(mocks.round.create).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "SCHEMA_ERROR", errorCode: "INVALID_RESPONSE" }));
  });

  it("odpowiedź ucięta limitem tokenów: SCHEMA z kodem TRUNCATED", async () => {
    setModel(generateModel('{"questions":[{"blockKey":"channels"', "length"));

    expect(await runGenerateQuestions(ctx)).toMatchObject({ ok: false, error: "SCHEMA" });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "TRUNCATED" }));
    expect(mocks.round.create).not.toHaveBeenCalled();
  });

  it("błąd dostawcy (429): PROVIDER, brak rundy", async () => {
    setModel(
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new APICallError({ message: "x", url: "https://x", requestBodyValues: {}, statusCode: 429, isRetryable: false });
        },
      }),
    );

    expect(await runGenerateQuestions(ctx)).toMatchObject({ ok: false, error: "PROVIDER" });
    expect(mocks.round.create).not.toHaveBeenCalled();
  });

  it("wyścig: druga karta zdążyła zająć limit rund w transakcji: ROUNDS_LIMIT, rundy nie zapisano (model odpowiedział, log OK)", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));
    mocks.round.findMany
      .mockResolvedValueOnce([]) // kontrola przed modelem
      .mockResolvedValueOnce([
        { id: "r1", status: "CANCELLED" },
        { id: "r2", status: "CANCELLED" },
        { id: "r3", status: "CANCELLED" },
      ]); // odczyt w transakcji

    expect(await runGenerateQuestions(ctx)).toEqual({ ok: false, error: "ROUNDS_LIMIT", message: QUESTIONS_ROUNDS_LIMIT_MESSAGE });
    expect(mocks.round.create).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "OK" }));
  });

  it("wyścig o oceny: oceny nie ma już w transakcji: STALE_EVALUATION", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));
    mocks.evaluation.findFirst.mockResolvedValue(null);

    expect(await runGenerateQuestions(ctx)).toMatchObject({ ok: false, error: "STALE_EVALUATION" });
    expect(mocks.round.create).not.toHaveBeenCalled();
  });

  it("błąd zapisu rundy: SAVE_FAILED z komunikatem (model odpowiedział, więc zapytanie liczy się do limitów)", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));
    mocks.round.create.mockRejectedValue(new Error("baza niedostępna"));

    expect(await runGenerateQuestions(ctx)).toEqual({ ok: false, error: "SAVE_FAILED", message: QUESTIONS_SAVE_FAILED_MESSAGE });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "OK" }));
  });
});
