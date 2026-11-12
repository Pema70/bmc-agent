import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  IMPACT_SAVE_FAILED_MESSAGE,
  IMPACT_TOO_EMPTY_MESSAGE,
  isImpactAnalyzable,
  runImpactAnalysis,
} from "@/lib/ai/impact";
import { IMPACT_PROMPT_VERSION } from "@/lib/ai/prompts/impact";
import { APPLY_ERROR_MESSAGES } from "@/lib/bmc/proposals";
import { emptyBmcState, type BmcState } from "@/lib/schemas/bmc";
import type { ImpactChangeRequest } from "@/lib/schemas/impact";

const descriptionRequest: ImpactChangeRequest = {
  kind: "DESCRIPTION",
  blockKey: "channels",
  description: "Sprzedaż wyłącznie online",
};
const proposalRequest: ImpactChangeRequest = { kind: "PROPOSAL", proposalId: "pr1" };
const ctx = { projectId: "p1", variantId: "v1", userId: "u1", trigger: "UI" as const, change: descriptionRequest };

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
  rationale: "Uzasadnienie, którego nie ma w prompcie",
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

function setModel(model: MockLanguageModelV4) {
  mocks.getChatModel.mockReturnValue({ model, provider: "google", modelId: "gemini-3.8-flash" });
}

function failingModel(statusCode: number) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new APICallError({ message: "x", url: "https://x", requestBodyValues: {}, statusCode, isRetryable: false });
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe("isImpactAnalyzable", () => {
  it("wymaga 3 wpisów i 2 niepustych bloków", () => {
    expect(isImpactAnalyzable(emptyBmcState())).toBe(false);
    expect(isImpactAnalyzable({ ...emptyBmcState(), channels: ["a", "b", "c", "d"] })).toBe(false); // 1 blok
    expect(isImpactAnalyzable({ ...emptyBmcState(), channels: ["a"], key_resources: ["b"] })).toBe(false); // 2 wpisy
    expect(isImpactAnalyzable({ ...emptyBmcState(), channels: ["a", "b"], key_resources: ["c"] })).toBe(true);
  });
});

describe("runImpactAnalysis", () => {
  it("zapisuje log OK i analizę, z jednego odczytu wariantu", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: true, analysis: { id: "analiza-z-bazy", variantVersion: 4 } });
    expect(mocks.getVariantForProject).toHaveBeenCalledTimes(1);
    expect(mocks.getVariantForProject).toHaveBeenCalledWith("p1", "v1");
    expect(mocks.logLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "analyze_impact",
        promptVersion: IMPACT_PROMPT_VERSION,
        provider: "google",
        modelId: "gemini-3.8-flash",
        status: "OK",
        projectId: "p1",
        userId: "u1",
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    );
    expect(mocks.createImpactAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: "v1",
        variantVersion: 4,
        stateSnapshot: fullState,
        change: { kind: "DESCRIPTION", blockKey: "channels", description: "Sprzedaż wyłącznie online" },
        proposalId: null,
        result: goodOutput,
        trigger: "UI",
        promptVersion: IMPACT_PROMPT_VERSION,
        llmCallLogId: "log-1",
        createdById: "u1",
      }),
    );
  });

  it("zmiana z propozycji pochodzi z bazy, a uzasadnienie nie trafia do modelu", async () => {
    const model = generateModel(JSON.stringify(goodOutput));
    setModel(model);

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.getProposalInVariant).toHaveBeenCalledWith("p1", "v1", "pr1");
    expect(mocks.createImpactAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "pr1",
        change: { kind: "PROPOSAL", blockKey: "channels", operation: "edit", before: "Social media", after: "Newsletter" },
      }),
    );
    expect(JSON.stringify(model.doGenerateCalls[0])).not.toContain("Uzasadnienie, którego nie ma w prompcie");
  });

  it("id analizy pochodzi z bazy, a nie z tekstu modelu", async () => {
    setModel(generateModel(JSON.stringify({ ...goodOutput, id: "podrobione-id" })));

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: false, error: "SCHEMA" });
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("nieznany stopień daje SCHEMA_ERROR i nic nie trafia do bazy", async () => {
    const bad = { ...goodOutput, affected: [{ ...goodOutput.affected[0], level: "critical" }] };
    setModel(generateModel(JSON.stringify(bad)));

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: false, error: "SCHEMA" });
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SCHEMA_ERROR",
        errorCode: "INVALID_RESPONSE",
        operation: "analyze_impact",
        promptVersion: IMPACT_PROMPT_VERSION,
      }),
    );
  });

  it("blok zmieniany na liście dotkniętych daje SCHEMA_ERROR (bez cichego filtrowania)", async () => {
    const withChanged = {
      ...goodOutput,
      affected: [...goodOutput.affected, { blockKey: "channels", level: "low", impact: "Ten sam blok." }],
    };
    setModel(generateModel(JSON.stringify(withChanged)));

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: false, error: "SCHEMA" });
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SCHEMA_ERROR", errorCode: "INVALID_RESPONSE", usage: { inputTokens: 100, outputTokens: 50 } }),
    );
  });

  it("odpowiedź niebędąca JSON-em daje SCHEMA_ERROR z tokenami", async () => {
    setModel(generateModel("to nie jest json"));

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: false, error: "SCHEMA" });
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SCHEMA_ERROR", errorCode: "INVALID_RESPONSE", usage: { inputTokens: 100, outputTokens: 50 } }),
    );
  });

  it("ucięta odpowiedź (finishReason length) daje errorCode TRUNCATED", async () => {
    setModel(generateModel('{"summary": "Zmiana wpły', "length"));

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: false, error: "SCHEMA" });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SCHEMA_ERROR", errorCode: "TRUNCATED" }),
    );
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("429 dostawcy: PROVIDER_RATE_LIMIT i polski komunikat", async () => {
    setModel(failingModel(429));

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: false, error: "PROVIDER", message: expect.stringContaining("Przekroczono limit") });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PROVIDER_RATE_LIMIT", errorCode: "429", operation: "analyze_impact" }),
    );
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("503 dostawcy: komunikat o niedostępności", async () => {
    setModel(failingModel(503));

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: false, error: "PROVIDER", message: expect.stringContaining("chwilowo niedostępny") });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "ERROR", errorCode: "503" }));
  });

  it("przekroczony limit nie wywołuje modelu", async () => {
    mocks.checkUserLimits.mockResolvedValue({ ok: false, message: "Limit.", retryAfterSec: 60 });
    const model = generateModel(JSON.stringify(goodOutput));
    setModel(model);

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 60 });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });

  it("zbyt pusty model nie wywołuje modelu", async () => {
    mocks.getVariantForProject.mockResolvedValue({ id: "v1", version: 4, state: emptyBmcState() });
    const model = generateModel(JSON.stringify(goodOutput));
    setModel(model);

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "TOO_EMPTY", message: IMPACT_TOO_EMPTY_MESSAGE });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("nieistniejący wariant: NOT_FOUND bez modelu i bez limitów", async () => {
    mocks.getVariantForProject.mockResolvedValue(null);

    const result = await runImpactAnalysis(ctx);

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.getChatModel).not.toHaveBeenCalled();
  });

  it.each([
    ["nieistniejąca lub z innego wariantu", null],
    ["już rozstrzygnięta", { ...proposal, status: "ACCEPTED" }],
    ["odrzucona", { ...proposal, status: "REJECTED" }],
  ])("propozycja %s: NOT_FOUND bez wywołania modelu", async (_label, found) => {
    mocks.getProposalInVariant.mockResolvedValue(found);
    const model = generateModel(JSON.stringify(goodOutput));
    setModel(model);

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
  });

  it("propozycja ze starszej wersji, którą nadal da się zastosować, jest analizowana", async () => {
    mocks.getProposalInVariant.mockResolvedValue({ ...proposal, baseVersion: 1 });
    setModel(generateModel(JSON.stringify(goodOutput)));

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toMatchObject({ ok: true });
  });

  it.each([
    ["wpis before zniknął (STALE)", { ...proposal, before: "Nie ma takiego wpisu" }, APPLY_ERROR_MESSAGES.STALE],
    ["wpis after już istnieje (DUPLICATE)", { ...proposal, after: "Aplikacja" }, APPLY_ERROR_MESSAGES.DUPLICATE],
  ])("propozycji nie da się zastosować: %s -> STALE_PROPOSAL bez modelu, limitów i logu", async (_label, stale, message) => {
    mocks.getProposalInVariant.mockResolvedValue(stale);
    const model = generateModel(JSON.stringify(goodOutput));
    setModel(model);

    const result = await runImpactAnalysis({ ...ctx, change: proposalRequest });

    expect(result).toEqual({ ok: false, error: "STALE_PROPOSAL", message });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(mocks.checkUserLimits).not.toHaveBeenCalled();
    expect(mocks.logLlmCall).not.toHaveBeenCalled();
    expect(mocks.createImpactAnalysis).not.toHaveBeenCalled();
  });

  it("niepoprawny opis zmiany: VALIDATION bez modelu", async () => {
    const result = await runImpactAnalysis({
      ...ctx,
      change: { kind: "DESCRIPTION", blockKey: "channels", description: "abc" },
    });

    expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(mocks.getChatModel).not.toHaveBeenCalled();
  });

  it("błąd zapisu po odpowiedzi modelu: SAVE_FAILED, log OK już zapisany", async () => {
    setModel(generateModel(JSON.stringify(goodOutput)));
    mocks.createImpactAnalysis.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await runImpactAnalysis(ctx);

    expect(result).toEqual({ ok: false, error: "SAVE_FAILED", message: IMPACT_SAVE_FAILED_MESSAGE });
    expect(mocks.logLlmCall).toHaveBeenCalledWith(expect.objectContaining({ status: "OK" }));
  });
});
