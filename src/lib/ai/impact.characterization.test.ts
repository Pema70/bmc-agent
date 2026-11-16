import { APICallError, LoadAPIKeyError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Testy charakterystyczne: utrwalają zachowanie runImpactAnalysis sprzed wydzielenia wspólnego helpera
// (krok 6, PR 6a). Mają przechodzić bez zmian przed i po refaktorze.
const mocks = vi.hoisted(() => ({
  getVariantForProject: vi.fn(),
  getProject: vi.fn(),
  getProposalInVariant: vi.fn(),
  checkUserLimits: vi.fn(),
  getChatModel: vi.fn(),
  logLlmCall: vi.fn(),
  createImpactAnalysis: vi.fn(),
}));

vi.mock("@/lib/db/variants", () => ({ getVariantForProject: mocks.getVariantForProject }));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/db/proposals", () => ({ getProposalInVariant: mocks.getProposalInVariant }));
vi.mock("@/lib/ai/limits", () => ({ checkUserLimits: mocks.checkUserLimits }));
vi.mock("@/lib/ai/models", () => ({ getChatModel: mocks.getChatModel }));
vi.mock("@/lib/ai/log", () => ({ logLlmCall: mocks.logLlmCall }));
vi.mock("@/lib/db/impact", () => ({ createImpactAnalysis: mocks.createImpactAnalysis }));

import {
  IMPACT_NOT_FOUND_MESSAGE,
  IMPACT_SAVE_FAILED_MESSAGE,
  IMPACT_TOO_EMPTY_MESSAGE,
  runImpactAnalysis,
} from "@/lib/ai/impact";
import { IMPACT_PROMPT_VERSION } from "@/lib/ai/prompts/impact";
import { emptyBmcState, type BmcState } from "@/lib/schemas/bmc";
import type { ImpactChangeRequest } from "@/lib/schemas/impact";

const descriptionRequest: ImpactChangeRequest = {
  kind: "DESCRIPTION",
  blockKey: "channels",
  description: "Sprzedaż wyłącznie online",
};
const proposalRequest: ImpactChangeRequest = { kind: "PROPOSAL", proposalId: "pr1" };
const ctx = { projectId: "p1", variantId: "v1", userId: "u1", trigger: "CHAT" as const, change: descriptionRequest };

const CONFIG_MESSAGE = "Agent jest źle skonfigurowany (model lub klucz API). Sprawdź konfigurację serwera.";
const SCHEMA_MESSAGE = "Model zwrócił odpowiedź w niewłaściwym formacie, więc analiza nie została zapisana. Spróbuj ponownie.";

const fullState: BmcState = {
  ...emptyBmcState(),
  customer_segments: ["Studenci"],
  value_propositions: ["Szybka nauka"],
  channels: ["Aplikacja", "Social media"],
  revenue_streams: ["Subskrypcja"],
};

const goodOutput = {
  summary: "Zmiana kanału wpływa na relacje.",
  affected: [{ blockKey: "customer_relationships", level: "high", impact: "Relacje trzeba oprzeć na kontakcie online." }],
};

const proposal = {
  id: "pr1",
  variantId: "v1",
  blockKey: "channels",
  operation: "edit",
  before: "Social media",
  after: "Newsletter",
  rationale: "Uzasadnienie",
  status: "PENDING",
  baseVersion: 4,
  createdAt: new Date(),
};

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 50, text: 50, reasoning: undefined },
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

function failingModel(error: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}

function apiError(statusCode: number, isRetryable = false) {
  return new APICallError({ message: "x", url: "https://x", requestBodyValues: {}, statusCode, isRetryable });
}

function setModel(model: MockLanguageModelV4) {
  mocks.getChatModel.mockReturnValue({ model, provider: "google", modelId: "gemini-3.5-flash-lite" });
}

const baseLog = {
  projectId: "p1",
  userId: "u1",
  operation: "analyze_impact",
  provider: "google",
  modelId: "gemini-3.5-flash-lite",
  promptVersion: IMPACT_PROMPT_VERSION,
  durationMs: expect.any(Number),
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 4, state: fullState });
  mocks.getProject.mockResolvedValue({ id: "p1", name: "Projekt", description: "Opis" });
  mocks.getProposalInVariant.mockResolvedValue(proposal);
  mocks.checkUserLimits.mockResolvedValue({ ok: true });
  mocks.logLlmCall.mockResolvedValue("log-1");
  mocks.createImpactAnalysis.mockImplementation(async (input) => ({
    id: "analiza-z-bazy",
    createdAt: new Date(),
    schemaVersion: 1,
    variantVersion: input.variantVersion,
    proposalId: input.proposalId,
    change: input.change,
    trigger: input.trigger,
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    result: input.result,
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("runImpactAnalysis: charakterystyka sprzed refaktoru", () => {
  it("wywołuje model z limitem tokenów z konfiguracji i przekazuje abortSignal", async () => {
    const model = generateModel(JSON.stringify(goodOutput));
    setModel(model);
    vi.stubEnv("LLM_MAX_OUTPUT_TOKENS", "1234");
    const controller = new AbortController();

    await runImpactAnalysis({ ...ctx, abortSignal: controller.signal });

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(1234);
    expect(model.doGenerateCalls[0].abortSignal).toBe(controller.signal);
  });

  it("ponawia błąd dostawcy dokładnie 2 razy (maxRetries: 2), czyli 3 wywołania", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const model = failingModel(apiError(503, true));
    setModel(model);

    const promise = runImpactAnalysis(ctx);
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;

    expect(model.doGenerateCalls).toHaveLength(3);
    expect(result).toMatchObject({ ok: false, error: "PROVIDER" });
    expect(mocks.logLlmCall).toHaveBeenCalledTimes(1);
  });

  it("log OK i zapis: dokładne pola (zmiana opisana tekstem)", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));

    const result = await runImpactAnalysis(ctx);

    expect(result.ok).toBe(true);
    expect(mocks.logLlmCall).toHaveBeenCalledTimes(1);
    expect(mocks.logLlmCall).toHaveBeenCalledWith({
      ...baseLog,
      usage: { inputTokens: 100, outputTokens: 50 },
      stepCount: 1,
      status: "OK",
    });
    expect(mocks.createImpactAnalysis).toHaveBeenCalledWith({
      projectId: "p1",
      variantId: "v1",
      variantVersion: 4,
      stateSnapshot: fullState,
      change: { kind: "DESCRIPTION", blockKey: "channels", description: "Sprzedaż wyłącznie online" },
      proposalId: null,
      result: goodOutput,
      trigger: "CHAT",
      provider: "google",
      model: "gemini-3.5-flash-lite",
      promptVersion: IMPACT_PROMPT_VERSION,
      llmCallLogId: "log-1",
      createdById: "u1",
    });
  });

  it("brak id logu (logLlmCall zwraca null) nie przerywa zapisu analizy", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));
    mocks.logLlmCall.mockResolvedValue(null);

    const result = await runImpactAnalysis(ctx);

    expect(result.ok).toBe(true);
    expect(mocks.createImpactAnalysis).toHaveBeenCalledWith(expect.objectContaining({ llmCallLogId: null }));
  });

  it("SCHEMA_ERROR po niezgodnym obiekcie: dokładny log, komunikat i brak zapisu", async () => {
    setModel(generateModel(JSON.stringify({ ...goodOutput, affected: [{ ...goodOutput.affected[0], level: "critical" }] })));

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "SCHEMA", message: SCHEMA_MESSAGE });
    expect(mocks.logLlmCall).toHaveBeenCalledTimes(1);
    expect(mocks.logLlmCall).toHaveBeenCalledWith({
      ...baseLog,
      usage: { inputTokens: 100, outputTokens: 50 },
      stepCount: 1,
      status: "SCHEMA_ERROR",
      errorCode: "INVALID_RESPONSE",
    });
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("blok zmieniany wśród dotkniętych: ten sam log i komunikat co przy niezgodnym schemacie", async () => {
    setModel(
      generateModel(
        JSON.stringify({ ...goodOutput, affected: [...goodOutput.affected, { blockKey: "channels", level: "low", impact: "Ten sam blok." }] }),
      ),
    );

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "SCHEMA", message: SCHEMA_MESSAGE });
    expect(mocks.logLlmCall).toHaveBeenCalledWith({
      ...baseLog,
      usage: { inputTokens: 100, outputTokens: 50 },
      stepCount: 1,
      status: "SCHEMA_ERROR",
      errorCode: "INVALID_RESPONSE",
    });
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("TRUNCATED: dokładny log z tokenami z błędu", async () => {
    setModel(generateModel('{"summary": "Zmiana wpły', "length"));

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "SCHEMA", message: SCHEMA_MESSAGE });
    expect(mocks.logLlmCall).toHaveBeenCalledWith({
      ...baseLog,
      usage: { inputTokens: 100, outputTokens: 50 },
      stepCount: 1,
      status: "SCHEMA_ERROR",
      errorCode: "TRUNCATED",
    });
  });

  it("429: dokładny log (bez tokenów i stepCount), komunikat i prefiks console.error", async () => {
    setModel(failingModel(apiError(429)));

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({
      ok: false,
      error: "PROVIDER",
      message: "Przekroczono limit zapytań modelu (darmowy plan). Spróbuj ponownie za chwilę.",
    });
    expect(mocks.logLlmCall).toHaveBeenCalledWith({ ...baseLog, status: "PROVIDER_RATE_LIMIT", errorCode: "429" });
    expect(errorSpy).toHaveBeenCalledWith("[impact] Błąd wywołania modelu:", "429");
  });

  it("503: komunikat o niedostępności i prefiks console.error", async () => {
    setModel(failingModel(apiError(503)));

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({
      ok: false,
      error: "PROVIDER",
      message: "Model jest chwilowo niedostępny (przeciążenie dostawcy). Spróbuj ponownie za chwilę.",
    });
    expect(errorSpy).toHaveBeenCalledWith("[impact] Błąd wywołania modelu:", "503");
  });

  it("błąd klucza API dostawcy: kod CONFIG, log ERROR/CONFIG", async () => {
    setModel(failingModel(new LoadAPIKeyError({ message: "brak klucza" })));

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "CONFIG", message: CONFIG_MESSAGE });
    expect(mocks.logLlmCall).toHaveBeenCalledWith({ ...baseLog, status: "ERROR", errorCode: "CONFIG" });
    expect(errorSpy).toHaveBeenCalledWith("[impact] Błąd wywołania modelu:", "CONFIG");
  });

  it("nieudana konfiguracja modelu: CONFIG, prefiks console.error, brak logu, zapisu i wywołania modelu", async () => {
    mocks.getChatModel.mockImplementation(() => {
      throw new Error("Brak klucza API");
    });

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "CONFIG", message: CONFIG_MESSAGE });
    expect(errorSpy).toHaveBeenCalledWith("[impact] Błędna konfiguracja modelu:", "Brak klucza API");
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("błędna konfiguracja limitów: CONFIG przed sprawdzeniem limitów i modelem (zmiana już rozwiązana)", async () => {
    vi.stubEnv("MAX_STEPS", "nie-liczba");

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toEqual({ ok: false, error: "CONFIG", message: CONFIG_MESSAGE });
    expect(errorSpy).toHaveBeenCalledWith("[impact] Błędna konfiguracja limitów:", expect.any(String));
    expect(mocks.getProposalInVariant).toHaveBeenCalledTimes(1);
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });

  it("błąd zapisu: prefiks console.error, dokładny wynik", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));
    mocks.createImpactAnalysis.mockRejectedValue(new Error("baza"));

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "SAVE_FAILED", message: IMPACT_SAVE_FAILED_MESSAGE });
    expect(errorSpy).toHaveBeenCalledWith("[impact] Nie udało się zapisać analizy:", "baza");
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "OK" }));
  });

  it("NOT_FOUND: dokładny komunikat, gdy brak wariantu, bez odczytu projektu i propozycji", async () => {
    mocks.getVariantForProject.mockResolvedValue(null);

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND", message: IMPACT_NOT_FOUND_MESSAGE });
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.getProposalInVariant).not.toHaveBeenCalled();
  });

  it("NOT_FOUND: wariant jest, ale brak projektu (bez odczytu propozycji i limitów)", async () => {
    mocks.getProject.mockResolvedValue(null);

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND", message: IMPACT_NOT_FOUND_MESSAGE });
    expect(mocks.getProposalInVariant).not.toHaveBeenCalled();
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
  });

  it("VALIDATION: dokładny komunikat, bez odczytu propozycji, limitów, modelu i logu", async () => {
    const result = await runImpactAnalysis({ ...ctx, change: { kind: "DESCRIPTION", blockKey: "channels", description: "abc" } });

    expect(result).toEqual({ ok: false, error: "VALIDATION", message: "Nieprawidłowy opis zmiany." });
    expect(mocks.getProposalInVariant).not.toHaveBeenCalled();
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });
});

describe("runImpactAnalysis: kolejność wywołań i brak skutków ubocznych", () => {
  it("pełna kolejność dla propozycji: wariant, projekt, propozycja, limity, model, log, zapis", async () => {
    const order: string[] = [];
    mocks.getVariantForProject.mockImplementation(async () => (order.push("wariant"), { id: "v1", version: 4, state: fullState }));
    mocks.getProject.mockImplementation(async () => (order.push("projekt"), { id: "p1", name: "P", description: "O" }));
    mocks.getProposalInVariant.mockImplementation(async () => (order.push("propozycja"), proposal));
    mocks.checkUserLimits.mockImplementation(async () => (order.push("limity"), { ok: true }));
    mocks.getChatModel.mockImplementation(() => {
      order.push("model");
      return { model: generateModel(JSON.stringify(goodOutput)), provider: "google", modelId: "gemini-3.5-flash-lite" };
    });
    mocks.logLlmCall.mockImplementation(async () => (order.push("log"), "log-1"));
    mocks.createImpactAnalysis.mockImplementation(async (input) => {
      order.push("zapis");
      return { id: "a", createdAt: new Date(), schemaVersion: 1, variantVersion: 4, proposalId: "pr1", change: input.change, trigger: "CHAT", provider: "google", model: "m", promptVersion: "p", result: input.result };
    });

    await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(order).toEqual(["wariant", "projekt", "propozycja", "limity", "model", "log", "zapis"]);
  });

  it("opis zmiany nie czyta propozycji, a limity i zapis wywołuje po jednym razie", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));

    await runImpactAnalysis(ctx);

    expect(mocks.getProposalInVariant).not.toHaveBeenCalled();
    expect(mocks.checkUserLimits).toHaveBeenCalledTimes(1);
    expect(mocks.createImpactAnalysis).toHaveBeenCalledTimes(1);
  });

  it("LIMIT: bez modelu, konfiguracji modelu, logu i zapisu", async () => {
    const model = generateModel(JSON.stringify(goodOutput));
    setModel(model);
    mocks.checkUserLimits.mockResolvedValue({ ok: false, error: "TOKENS", retryAfterSec: 90, message: "Dzienny limit." });

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "LIMIT", message: "Dzienny limit.", retryAfterSec: 90 });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("limity są sprawdzane przed zawartością: pusty model i przekroczony limit daje LIMIT", async () => {
    mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 1, state: emptyBmcState() });
    mocks.checkUserLimits.mockResolvedValue({ ok: false, error: "REQUESTS", retryAfterSec: 10, message: "Limit." });

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: false, error: "LIMIT" });
  });

  it("TOO_EMPTY: limity sprawdzone, ale bez modelu, logu i zapisu", async () => {
    const model = generateModel(JSON.stringify(goodOutput));
    setModel(model);
    mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 1, state: emptyBmcState() });

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "TOO_EMPTY", message: IMPACT_TOO_EMPTY_MESSAGE });
    expect(mocks.checkUserLimits).toHaveBeenCalledTimes(1);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("STALE_PROPOSAL: rozwiązanie zmiany przed limitami, więc bez limitów, modelu, logu i zapisu", async () => {
    const model = generateModel(JSON.stringify(goodOutput));
    setModel(model);
    mocks.getProposalInVariant.mockResolvedValue({ ...proposal, before: "Nie ma takiego wpisu" });

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toMatchObject({ ok: false, error: "STALE_PROPOSAL" });
    expect(mocks.getProposalInVariant).toHaveBeenCalledWith("p1", "v1", "pr1");
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("STALE_PROPOSAL ma pierwszeństwo przed przekroczonym limitem (zmiana rozwiązywana przed limitami)", async () => {
    mocks.checkUserLimits.mockResolvedValue({ ok: false, error: "REQUESTS", retryAfterSec: 10, message: "Limit." });
    mocks.getProposalInVariant.mockResolvedValue({ ...proposal, before: "Nie ma takiego wpisu" });

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toMatchObject({ ok: false, error: "STALE_PROPOSAL" });
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
  });

  it("NOT_FOUND propozycji: bez limitów, modelu i logu", async () => {
    mocks.getProposalInVariant.mockResolvedValue(null);

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND", message: IMPACT_NOT_FOUND_MESSAGE });
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.getChatModel).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });

  it("SCHEMA_ERROR i błędy dostawcy: dokładnie jeden wiersz logu i brak zapisu", async () => {
    setModel(generateModel("to nie jest json"));
    await runImpactAnalysis(ctx);
    expect(mocks.logLlmCall).toHaveBeenCalledTimes(1);
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 4, state: fullState });
    mocks.getProject.mockResolvedValue({ id: "p1", name: "Projekt", description: "Opis" });
    mocks.checkUserLimits.mockResolvedValue({ ok: true });
    setModel(failingModel(apiError(429)));
    await runImpactAnalysis(ctx);
    expect(mocks.logLlmCall).toHaveBeenCalledTimes(1);
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });
});
