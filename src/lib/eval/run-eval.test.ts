import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ checkCasesFrozen: vi.fn() }));

// Prawdziwy zestaw przypadków; podmieniona tylko kontrola zamrożenia (żeby sprawdzić odmowę przy NOT_FROZEN i MISMATCH).
vi.mock("@/lib/eval/cases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/eval/cases")>();
  mocks.checkCasesFrozen.mockImplementation(actual.checkCasesFrozen);
  return { ...actual, checkCasesFrozen: mocks.checkCasesFrozen };
});

import type { ChatTurn, RunChatTurnResult, ChatTurnResult } from "@/lib/ai/chat-agent";
import type { EvalConfig } from "@/lib/eval/args";
import type { CostReading } from "@/lib/eval/budget";
import { BUILD_CASES, BUILD_CONTINUATION_MESSAGE, getCase } from "@/lib/eval/cases";
import {
  runEval,
  type EvalDb,
  type EvalDeps,
  type ExistingRun,
  type FinalRunStatus,
  type NewRunData,
} from "@/lib/eval/run-eval";
import { BLOCK_KEYS, emptyBmcState, type BmcState } from "@/lib/schemas/bmc";
import { SEED_COMPANIES } from "@/lib/seed/companies";

const MODEL = "gemini-3.5-flash-lite";
const EMAIL = "pomiary@example.com";

class FakeDb implements EvalDb {
  readonly writes: string[] = [];
  readonly projects: { name: string; description: string; state: unknown; entryOrigins: unknown[] }[] = [];
  readonly runs: NewRunData[] = [];
  readonly finished: { id: string; status: FinalRunStatus; errorCode: string | null; turnCount: number | null; endReason: string | null }[] = [];
  existing: ExistingRun[] = [];
  pending: string[] = [];
  costFn: () => CostReading = () => ({ totalUsd: 0, unknownCalls: 0 });
  stale = 0;
  // Liczba niepustych bloków w stanie wariantu głównego (domyślnie komplet, więc BUILD kończy się po 6 turach: ALL_BLOCKS).
  filled = 9;
  userId: string | null = "u1";
  private nextId = 0;

  async findUserIdByEmail() {
    return this.userId;
  }
  async listRuns() {
    return this.existing;
  }
  async stopStaleRuns() {
    this.writes.push("stopStaleRuns");
    return this.stale;
  }
  async createProject(args: { name: string; description: string; state: unknown; entryOrigins: unknown[] }) {
    this.writes.push("createProject");
    this.projects.push({ name: args.name, description: args.description, state: args.state, entryOrigins: args.entryOrigins });
    this.nextId += 1;
    return { projectId: `p${this.nextId}`, variantId: `v${this.nextId}` };
  }
  async createRun(data: NewRunData) {
    this.writes.push("createRun");
    this.runs.push(data);
    return { id: `r${this.runs.length}` };
  }
  async finishRun(
    id: string,
    result: { status: FinalRunStatus; errorCode?: string | null; turnCount?: number | null; endReason?: string | null },
  ) {
    this.writes.push("finishRun");
    this.finished.push({
      id,
      status: result.status,
      errorCode: result.errorCode ?? null,
      turnCount: result.turnCount ?? null,
      endReason: result.endReason ?? null,
    });
  }
  async readCost() {
    return this.costFn();
  }
  async getMainVariant() {
    const state: BmcState = emptyBmcState();
    BLOCK_KEYS.slice(0, this.filled).forEach((key) => {
      state[key] = ["wpis"];
    });
    return { id: "v1", version: 3, state };
  }
  async listPendingProposalIds() {
    return this.pending.splice(0);
  }
}

function closedStream(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

function turnResult(result: ChatTurnResult): RunChatTurnResult {
  return { stream: closedStream(), finished: Promise.resolve(result) };
}

function makeDeps(db = new FakeDb(), overrides: Partial<EvalDeps> = {}) {
  const logs: string[] = [];
  const spies = {
    prepareTurn: vi.fn<EvalDeps["prepareTurn"]>(async () => ({ ok: true as const, turn: { messages: [] } as unknown as ChatTurn })),
    runTurn: vi.fn(async (): Promise<RunChatTurnResult> => turnResult({ status: "completed" })),
    acceptProposal: vi.fn<EvalDeps["acceptProposal"]>(async () => ({ ok: true })),
    runEvaluation: vi.fn(async () => ({ ok: true as const, evaluation: {} as never })),
    runJudge: vi.fn(async () => ({ ok: true as const, evaluation: {} as never })),
    runImpact: vi.fn(async () => ({ ok: true as const, analysis: {} as never })),
    checkModelConfig: vi.fn(),
    sleep: vi.fn(async () => {}),
  };
  const deps: EvalDeps = {
    db,
    env: { JUDGE_MODEL: "claude-haiku-5-5" },
    userEmail: EMAIL,
    log: (line) => logs.push(line),
    ...spies,
    ...overrides,
  };
  return { deps, db, logs, spies };
}

function config(overrides: Partial<EvalConfig> = {}): EvalConfig {
  return {
    seriesId: "T1",
    caseIds: ["BUILD-01"],
    models: [MODEL],
    repetitions: 1,
    judge: false,
    pauseMs: 0,
    retryInvalid: false,
    execute: true,
    maxCostUsd: 1,
    maxTurns: 100,
    ...overrides,
  };
}

function existing(caseId: string, status: ExistingRun["status"], attempt = 1): ExistingRun {
  return { id: `old-${caseId}-${attempt}`, caseId, model: MODEL, repetition: 1, attempt, status, projectId: `old-p-${caseId}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runEval: tryb na sucho", () => {
  it("niczego nie zapisuje i nie woła modelu, a wypisuje listę, model, limity, tury i szacowany koszt", async () => {
    const { deps, db, logs, spies } = makeDeps();
    const strict: EvalDb = {
      findUserIdByEmail: async () => "u1",
      listRuns: async () => [],
      stopStaleRuns: () => Promise.reject(new Error("zapis w trybie na sucho")),
      createProject: () => Promise.reject(new Error("zapis w trybie na sucho")),
      createRun: () => Promise.reject(new Error("zapis w trybie na sucho")),
      finishRun: () => Promise.reject(new Error("zapis w trybie na sucho")),
      readCost: () => Promise.reject(new Error("odczyt kosztu w trybie na sucho")),
      getMainVariant: () => Promise.reject(new Error("odczyt w trybie na sucho")),
      listPendingProposalIds: () => Promise.reject(new Error("odczyt w trybie na sucho")),
    };
    deps.db = strict;

    const summary = await runEval(config({ execute: false, caseIds: ["BUILD-01", "EVAL-01", "CHAT-S3", "CHAT-S5"], maxCostUsd: undefined, maxTurns: undefined }), deps);

    expect(summary.outcome).toBe("DRY_RUN");
    expect(db.writes).toEqual([]);
    expect(spies.prepareTurn).not.toHaveBeenCalled();
    expect(spies.runTurn).not.toHaveBeenCalled();
    expect(spies.runEvaluation).not.toHaveBeenCalled();
    expect(spies.runJudge).not.toHaveBeenCalled();
    expect(spies.acceptProposal).not.toHaveBeenCalled();
    expect(deps.env.CHAT_MAX_REQUESTS_PER_HOUR).toBeUndefined();
    const output = logs.join("\n");
    expect(output).toContain("TRYB NA SUCHO");
    expect(output).toContain(MODEL);
    expect(output).toContain("Limity wyjścia: 2000");
    expect(output).toContain("BUILD-01");
    expect(output).toContain("CHAT-S3+CHAT-S5");
    expect(output).toMatch(/Razem: tury \d+( do \d+)?, wywołań ok\. \d+( do \d+)?, szacowany koszt [\d.]+( do [\d.]+)? USD/);
    expect(output).toContain("BUILD-01 · gemini-3.5-flash-lite · p1: tury 6 do 14");
    expect(output).toContain("CHAT-S3+CHAT-S5 · gemini-3.5-flash-lite · p1: tury 3,");
    expect(output).not.toContain(EMAIL);
  });

  it("niezamrożony lub niezgodny zestaw tylko ostrzega, a przebieg na sucho się odbywa", async () => {
    mocks.checkCasesFrozen.mockReturnValueOnce({ frozen: false, reason: "NOT_FROZEN", message: "Zestaw przypadków nie jest zamrożony." });
    const { deps, logs } = makeDeps();

    const summary = await runEval(config({ execute: false }), deps);

    expect(summary.outcome).toBe("DRY_RUN");
    expect(logs.join("\n")).toContain("OSTRZEŻENIE: Zestaw przypadków nie jest zamrożony.");
  });

  it("pomija ukończone przebiegi i oznacza powtórki kolejnej próby", async () => {
    const { deps, db, logs } = makeDeps();
    db.existing = [existing("BUILD-01", "OK"), existing("BUILD-02", "STOPPED")];

    const summary = await runEval(config({ execute: false, caseIds: ["BUILD-01", "BUILD-02"] }), deps);

    expect(summary.skipped).toBe(1);
    expect(logs.join("\n")).toContain("pominięty (ukończony): BUILD-01");
    expect(logs.join("\n")).toContain("BUILD-02 · gemini-3.5-flash-lite · p1 (powtórka kolejnej próby)");
  });

  it("odmawia, gdy konto pomiarowe nie istnieje, bez drukowania adresu", async () => {
    const { deps, db, logs } = makeDeps();
    db.userId = null;

    const summary = await runEval(config({ execute: false }), deps);

    expect(summary.outcome).toBe("REFUSED");
    expect(logs.join("\n")).toContain("EVAL_USER_EMAIL");
    expect(logs.join("\n")).not.toContain(EMAIL);
  });
});

describe("runEval: odmowy prawdziwego przebiegu (nic nie zostaje zapisane)", () => {
  it.each([
    ["NOT_FROZEN", "Zestaw przypadków nie jest zamrożony (FROZEN_CASES_CHECKSUM w cases.ts jest pusty)."],
    ["MISMATCH", "Zestaw przypadków różni się od zamrożonego: suma kontrolna przypadków nie zgadza się z FROZEN_CASES_CHECKSUM."],
  ] as const)("--wykonaj odmawia przy %s z komunikatem po polsku", async (reason, message) => {
    mocks.checkCasesFrozen.mockReturnValueOnce({ frozen: false, reason, message });
    const { deps, db, spies } = makeDeps();

    const summary = await runEval(config(), deps);

    expect(summary.outcome).toBe("REFUSED");
    expect(summary.message).toBe(message);
    expect(db.writes).toEqual([]);
    expect(spies.prepareTurn).not.toHaveBeenCalled();
    expect(deps.env.CHAT_MAX_REQUESTS_PER_HOUR).toBeUndefined();
  });

  it("odmawia bez konta pomiarowego i bez zmiennej EVAL_USER_EMAIL, bez drukowania adresu", async () => {
    const missing = makeDeps();
    missing.db.userId = null;
    const refused = await runEval(config(), missing.deps);
    expect(refused.outcome).toBe("REFUSED");
    expect(missing.db.writes).toEqual([]);
    expect(missing.logs.join("\n")).not.toContain(EMAIL);

    const noEmail = makeDeps(new FakeDb(), { userEmail: undefined });
    expect((await runEval(config(), noEmail.deps)).outcome).toBe("REFUSED");
    expect(noEmail.db.writes).toEqual([]);
  });

  it("odmawia przy błędnej konfiguracji modelu (przed pierwszym zapisem), komunikat bez wartości kluczy", async () => {
    const { deps, db, logs, spies } = makeDeps();
    spies.checkModelConfig.mockImplementation(() => {
      throw new Error("Brak klucza API: ustaw GOOGLE_GENERATIVE_AI_API_KEY w pliku .env.");
    });

    const summary = await runEval(config(), deps);

    expect(summary.outcome).toBe("REFUSED");
    expect(logs.join("\n")).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(db.writes).toEqual([]);
  });

  it("z --sedzia sprawdza też konfigurację sędziego", async () => {
    const { deps, spies } = makeDeps();

    await runEval(config({ judge: true, caseIds: ["EVAL-01"] }), deps);

    expect(spies.checkModelConfig).toHaveBeenCalledWith(expect.anything(), "chat");
    expect(spies.checkModelConfig).toHaveBeenCalledWith(expect.anything(), "judge");
  });
});

describe("runEval: przypadek BUILD", () => {
  it("6 tur ze skryptu, po każdej akceptacja wszystkich propozycji, projekt neutralny, wiersz EvalRun z warunkami przebiegu", async () => {
    const { deps, db, spies } = makeDeps();
    const build = BUILD_CASES[0];
    const messages: string[] = [];
    spies.prepareTurn.mockImplementation(async (input) => {
      messages.push(input.message);
      db.pending.push("pr-a", "pr-b");
      return { ok: true as const, turn: { messages: [] } as unknown as ChatTurn };
    });

    const summary = await runEval(config({ maxOutputTokens: 8000, maxCostUsd: 0.5, maxTurns: 20 }), deps);

    expect(summary).toMatchObject({ outcome: "DONE", counts: { OK: 1, FAILED: 0, INVALID: 0, STOPPED: 0 }, turns: 6 });
    expect(messages).toEqual(build.messages);
    expect(spies.acceptProposal).toHaveBeenCalledTimes(12);
    expect(spies.acceptProposal).toHaveBeenCalledWith(expect.objectContaining({ proposalId: "pr-a", expectedVersion: 3, userId: "u1", projectId: "p1", variantId: "v1" }));
    expect(db.projects).toEqual([{ name: "EV-T1-BUILD-01-p1", description: "Nowy model biznesowy.", state: emptyBmcState(), entryOrigins: [] }]);
    expect(db.runs[0]).toMatchObject({
      seriesId: "T1", caseId: "BUILD-01", kind: "BUILD", repetition: 1, attempt: 1, provider: "google", model: MODEL, judgeModel: null,
      maxOutputTokens: 8000, costLimitUsd: 0.5, turnLimit: 20, projectId: "p1",
    });
    expect(db.runs[0].casesChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(db.finished).toEqual([{ id: "r1", status: "OK", errorCode: null, turnCount: 6, endReason: "ALL_BLOCKS" }]);
    // Konfiguracja tylko w procesie skryptu: model, limity wyjścia i limity użytkownika.
    expect(deps.env).toMatchObject({ LLM_PROVIDER: "google", LLM_MODEL: MODEL, LLM_MAX_OUTPUT_TOKENS: "8000", CHAT_MAX_REQUESTS_PER_HOUR: "10000", CHAT_MAX_TOKENS_PER_DAY: "100000000" });
  });

  it("niezaakceptowane propozycje są liczone (z powodami) w wypisie przebiegu i w podsumowaniu", async () => {
    const { deps, db, logs, spies } = makeDeps();
    let turn = 0;
    spies.prepareTurn.mockImplementation(async () => {
      turn += 1;
      if (turn === 1) db.pending.push("ok-1", "zly-1", "ok-2", "zly-2", "zly-3");
      return { ok: true as const, turn: {} as ChatTurn };
    });
    spies.acceptProposal.mockImplementation(async ({ proposalId }) =>
      proposalId.startsWith("ok")
        ? { ok: true }
        : { ok: false, error: proposalId === "zly-3" ? "VERSION_CONFLICT" : "ALREADY_RESOLVED" },
    );

    const summary = await runEval(config(), deps);

    expect(summary).toMatchObject({
      outcome: "DONE",
      proposalsAccepted: 2,
      proposalsNotAccepted: 3,
      proposalsNotAcceptedReasons: { ALREADY_RESOLVED: 2, VERSION_CONFLICT: 1 },
    });
    const output = logs.join("\n");
    expect(output).toContain("propozycje: zaakceptowano 2, niezaakceptowano 3 (ALREADY_RESOLVED: 2, VERSION_CONFLICT: 1)");
    expect(output).toContain("Propozycje agenta (BUILD): zaakceptowano 2, niezaakceptowano 3");
  });

  it("bez propozycji agenta w podsumowaniu nie ma linii o propozycjach", async () => {
    const { deps, logs } = makeDeps();

    const summary = await runEval(config(), deps);

    expect(summary).toMatchObject({ proposalsAccepted: 0, proposalsNotAccepted: 0 });
    expect(logs.join("\n")).not.toContain("Propozycje agenta");
  });

  it("z --sedzia po turach trzy sądy z triggerem SCRIPT, model sędziego zapisany w EvalRun", async () => {
    const { deps, db, spies } = makeDeps();

    await runEval(config({ judge: true }), deps);

    expect(spies.runJudge).toHaveBeenCalledTimes(3);
    expect(spies.runJudge).toHaveBeenCalledWith(expect.objectContaining({ trigger: "SCRIPT", projectId: "p1", variantId: "v1", userId: "u1" }));
    expect(db.runs[0].judgeModel).toBe("claude-haiku-5-5");
  });

  it("kolejność: repetycje, przypadki, modele; pauza po każdym przebiegu", async () => {
    const { deps, db, spies } = makeDeps();

    await runEval(config({ caseIds: ["BUILD-01", "BUILD-02"], models: [MODEL, "gemini-3.6-flash"], repetitions: 2, pauseMs: 250 }), deps);

    expect(db.runs.map((r) => `${r.caseId}/${r.model}/p${r.repetition}`)).toEqual([
      "BUILD-01/gemini-3.5-flash-lite/p1", "BUILD-01/gemini-3.6-flash/p1", "BUILD-02/gemini-3.5-flash-lite/p1", "BUILD-02/gemini-3.6-flash/p1",
      "BUILD-01/gemini-3.5-flash-lite/p2", "BUILD-01/gemini-3.6-flash/p2", "BUILD-02/gemini-3.5-flash-lite/p2", "BUILD-02/gemini-3.6-flash/p2",
    ]);
    expect(spies.sleep).toHaveBeenCalledWith(250);
    expect(spies.sleep).toHaveBeenCalledTimes(8);
  });
});

describe("runEval: poziom myślenia (--reasoning)", () => {
  it("--reasoning low ustawia LLM_REASONING tylko w procesie skryptu i zapisuje poziom w EvalRun", async () => {
    const { deps, db } = makeDeps();

    await runEval(config({ reasoning: "low", models: ["gemini-3.8-flash"] }), deps);

    expect(deps.env.LLM_REASONING).toBe("low");
    expect(db.runs[0]).toMatchObject({ model: "gemini-3.8-flash", reasoning: "low" });
  });

  it("bez --reasoning myślenie jest domyślne: zmienna z konfiguracji procesu jest usuwana, a w EvalRun jest null", async () => {
    const { deps, db } = makeDeps();
    deps.env.LLM_REASONING = "high";

    await runEval(config(), deps);

    expect("LLM_REASONING" in deps.env).toBe(false);
    expect(db.runs[0].reasoning).toBeNull();
  });

  it("tryb na sucho pokazuje poziom myślenia i niczego nie zmienia w env", async () => {
    const { deps, logs } = makeDeps();
    deps.env.LLM_REASONING = "high";

    await runEval(config({ execute: false, reasoning: "low" }), deps);

    expect(logs.join("\n")).toContain("Myślenie (reasoning): low");
    expect(deps.env.LLM_REASONING).toBe("high");

    const defaults = makeDeps();
    await runEval(config({ execute: false }), defaults.deps);
    expect(defaults.logs.join("\n")).toContain("Myślenie (reasoning): domyślne modelu (provider-default)");
  });
});

describe("runEval: protokół kontynuacji BUILD", () => {
  /** Skrypt scenariusza: czy tura `t` (od 1) dodaje nową propozycję PENDING i ile bloków jest wypełnionych po niej. */
  function scenario(
    spies: ReturnType<typeof makeDeps>["spies"],
    db: FakeDb,
    spec: { found: (turn: number) => boolean; filled: (turn: number) => number },
  ) {
    const sent: string[] = [];
    let turn = 0;
    spies.prepareTurn.mockImplementation(async (input) => {
      turn += 1;
      sent.push(input.message);
      if (spec.found(turn)) db.pending.push(`p${turn}`);
      db.filled = spec.filled(turn);
      return { ok: true as const, turn: {} as ChatTurn };
    });
    return sent;
  }

  const continuations = (sent: string[]) => sent.slice(6);

  it("po 6 wiadomościach wysyła stałą kontynuację aż do wypełnienia 9 bloków: ALL_BLOCKS", async () => {
    const { deps, db, spies } = makeDeps();
    const sent = scenario(spies, db, { found: () => true, filled: (t) => Math.min(t, 9) });

    const summary = await runEval(config(), deps);

    expect(sent).toHaveLength(9);
    expect(sent.slice(0, 6)).toEqual(BUILD_CASES[0].messages);
    expect(continuations(sent)).toEqual([BUILD_CONTINUATION_MESSAGE, BUILD_CONTINUATION_MESSAGE, BUILD_CONTINUATION_MESSAGE]);
    expect(db.finished[0]).toMatchObject({ status: "OK", turnCount: 9, endReason: "ALL_BLOCKS" });
    expect(summary.turns).toBe(9);
  });

  it("komplet 9 bloków już po turze 6: bez kontynuacji, ALL_BLOCKS", async () => {
    const { deps, db, spies } = makeDeps();
    const sent = scenario(spies, db, { found: () => true, filled: () => 9 });

    await runEval(config(), deps);

    expect(sent).toHaveLength(6);
    expect(db.finished[0]).toMatchObject({ turnCount: 6, endReason: "ALL_BLOCKS" });
  });

  it("jedna tura bez nowych propozycji nie kończy przebiegu, dwie kolejne tak: NO_NEW_PROPOSALS", async () => {
    const { deps, db, spies } = makeDeps();
    // Pusta tura 6, nowa propozycja w turze 7 (licznik pustych tur się zeruje), puste tury 8 i 9.
    const sent = scenario(spies, db, { found: (t) => ![6, 8, 9].includes(t), filled: () => 3 });

    await runEval(config(), deps);

    expect(sent).toHaveLength(9);
    expect(db.finished[0]).toMatchObject({ status: "OK", turnCount: 9, endReason: "NO_NEW_PROPOSALS" });
  });

  it("dwie puste tury od szóstej kończą przebieg po turze 7", async () => {
    const { deps, db, spies } = makeDeps();
    const sent = scenario(spies, db, { found: (t) => t < 6, filled: () => 5 });

    await runEval(config(), deps);

    expect(sent).toHaveLength(7);
    expect(sent[6]).toBe(BUILD_CONTINUATION_MESSAGE);
    expect(db.finished[0]).toMatchObject({ turnCount: 7, endReason: "NO_NEW_PROPOSALS" });
  });

  it("puste tury przed turą szóstą nie liczą się do zatrzymania; bez końca kontynuacji: CONTINUATION_LIMIT po 8 kontynuacjach", async () => {
    const { deps, db, spies } = makeDeps();
    const sent = scenario(spies, db, { found: (t) => t !== 4 && t !== 5, filled: () => 6 });

    await runEval(config(), deps);

    expect(sent).toHaveLength(14);
    expect(continuations(sent)).toHaveLength(8);
    expect(db.finished[0]).toMatchObject({ status: "OK", turnCount: 14, endReason: "CONTINUATION_LIMIT" });
  });

  it("kolejność sprawdzania: ALL_BLOCKS przed NO_NEW_PROPOSALS", async () => {
    const { deps, db, spies } = makeDeps();
    // Po turze 7 jednocześnie komplet bloków i dwie puste tury z rzędu.
    scenario(spies, db, { found: (t) => t < 6, filled: (t) => (t >= 7 ? 9 : 5) });

    await runEval(config(), deps);

    expect(db.finished[0]).toMatchObject({ turnCount: 7, endReason: "ALL_BLOCKS" });
  });

  it("kolejność sprawdzania: NO_NEW_PROPOSALS przed CONTINUATION_LIMIT (tura 14 jest drugą pustą)", async () => {
    const { deps, db, spies } = makeDeps();
    scenario(spies, db, { found: (t) => t < 13, filled: () => 6 });

    await runEval(config(), deps);

    expect(db.finished[0]).toMatchObject({ turnCount: 14, endReason: "NO_NEW_PROPOSALS" });
  });

  it("nowe propozycje to tylko zapisane (PENDING): odrzucone przez serwer nie istnieją na liście, więc tura bez zapisu jest pusta", async () => {
    const { deps, db, spies } = makeDeps();
    const sent = scenario(spies, db, { found: () => false, filled: () => 2 });

    await runEval(config(), deps);

    expect(sent).toHaveLength(7);
    expect(spies.acceptProposal).not.toHaveBeenCalled();
    expect(db.finished[0]).toMatchObject({ endReason: "NO_NEW_PROPOSALS" });
  });

  it("kontynuacje liczą się do --max-tur: STOPPED / TURN_LIMIT z liczbą tur i bez powodu zakończenia", async () => {
    const { deps, db, spies } = makeDeps();
    const sent = scenario(spies, db, { found: () => true, filled: () => 4 });

    const summary = await runEval(config({ maxTurns: 8 }), deps);

    expect(sent).toHaveLength(8);
    expect(summary).toMatchObject({ outcome: "STOPPED", stopCode: "TURN_LIMIT", turns: 8 });
    expect(db.finished[0]).toMatchObject({ status: "STOPPED", errorCode: "TURN_LIMIT", turnCount: 8, endReason: null });
  });

  it("sędzia ocenia dopiero po kontynuacjach", async () => {
    const { deps, db, spies } = makeDeps();
    const order: string[] = [];
    scenario(spies, db, { found: () => true, filled: (t) => Math.min(t, 9) });
    const base = spies.prepareTurn.getMockImplementation();
    spies.prepareTurn.mockImplementation(async (input) => {
      order.push("tura");
      return (base as NonNullable<typeof base>)(input);
    });
    spies.runJudge.mockImplementation(async () => {
      order.push("sedzia");
      return { ok: true as const, evaluation: {} as never };
    });

    await runEval(config({ judge: true }), deps);

    expect(order).toEqual([...Array<string>(9).fill("tura"), "sedzia", "sedzia", "sedzia"]);
  });

  it("w wypisie: liczba tur ze skryptu i kontynuacji, powód zakończenia i wypełnione bloki", async () => {
    const { deps, db, logs, spies } = makeDeps();
    scenario(spies, db, { found: () => true, filled: (t) => Math.min(t, 9) });

    await runEval(config(), deps);

    expect(logs.join("\n")).toContain("tury: 9 (6 ze skryptu + 3 kontynuacji), powód zakończenia: ALL_BLOCKS, wypełnione bloki: 9/9");
  });

  it("CHAT i EVAL: SCRIPT_DONE i liczba tur (CHAT-S1: 5, EVAL: 0); bez kontynuacji", async () => {
    const { deps, db, spies } = makeDeps();

    await runEval(config({ caseIds: ["CHAT-S1", "EVAL-01"] }), deps);

    expect(db.finished[0]).toMatchObject({ status: "OK", turnCount: 5, endReason: "SCRIPT_DONE" });
    expect(db.finished[1]).toMatchObject({ status: "OK", turnCount: 0, endReason: "SCRIPT_DONE" });
    expect(spies.prepareTurn).toHaveBeenCalledTimes(5);
    expect(spies.prepareTurn).not.toHaveBeenCalledWith(expect.objectContaining({ message: BUILD_CONTINUATION_MESSAGE }));
  });

  it("tryb na sucho ostrzega, gdy --max-tur jest mniejszy niż najdłuższy możliwy przebieg (14 tur dla BUILD)", async () => {
    const { deps, logs } = makeDeps();

    await runEval(config({ execute: false, maxTurns: 8 }), deps);

    expect(logs.join("\n")).toContain("OSTRZEŻENIE: --max-tur 8 jest mniejszy niż najdłuższy możliwy przebieg (14 tur)");
  });
});

describe("runEval: bezpieczniki bieżącego uruchomienia", () => {
  it("--max-tur przerywa przebieg w trakcie przypadku: STOPPED / TURN_LIMIT, następny przypadek się nie zaczyna", async () => {
    const { deps, db, spies } = makeDeps();

    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02"], maxTurns: 2 }), deps);

    expect(summary).toMatchObject({ outcome: "STOPPED", stopCode: "TURN_LIMIT", counts: { STOPPED: 1, OK: 0 }, turns: 2 });
    expect(spies.prepareTurn).toHaveBeenCalledTimes(2);
    expect(db.projects).toHaveLength(1);
    expect(db.finished[0]).toMatchObject({ status: "STOPPED", errorCode: "TURN_LIMIT" });
    expect(summary.message).toContain("--max-tur");
  });

  it("limit osiągnięty na ostatniej turze przypadku: przypadek kończy się OK, ale seria zatrzymuje się przed następnym", async () => {
    const { deps, db } = makeDeps();

    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02"], maxTurns: 6 }), deps);

    expect(summary).toMatchObject({ outcome: "STOPPED", stopCode: "TURN_LIMIT", counts: { OK: 1, STOPPED: 0 } });
    expect(db.projects).toHaveLength(1);
  });

  it("--max-koszt-usd przerywa po turze, w której suma kosztu osiąga limit: STOPPED / COST_LIMIT", async () => {
    const { deps, db, spies } = makeDeps();
    db.costFn = () => ({ totalUsd: spies.runTurn.mock.calls.length * 0.06, unknownCalls: 0 });

    const summary = await runEval(config({ maxCostUsd: 0.1 }), deps);

    expect(summary).toMatchObject({ outcome: "STOPPED", stopCode: "COST_LIMIT", counts: { STOPPED: 1 } });
    expect(spies.prepareTurn).toHaveBeenCalledTimes(2);
    expect(db.finished[0]).toMatchObject({ status: "STOPPED", errorCode: "COST_LIMIT" });
    expect(summary.message).toContain("po turze");
  });

  it("wywołanie z nieznanym kosztem (NULL) zatrzymuje przebieg: COST_UNKNOWN", async () => {
    const { deps, db } = makeDeps();
    db.costFn = () => ({ totalUsd: 0, unknownCalls: 1 });

    const summary = await runEval(config(), deps);

    expect(summary).toMatchObject({ outcome: "STOPPED", stopCode: "COST_UNKNOWN" });
    expect(db.finished[0]).toMatchObject({ status: "STOPPED", errorCode: "COST_UNKNOWN" });
  });

  it("Ctrl+C przed startem: nic nie powstaje; w trakcie tury: STOPPED / USER_ABORT i koniec serii", async () => {
    const early = new AbortController();
    early.abort();
    const first = makeDeps(new FakeDb(), { signal: early.signal });
    expect(await runEval(config(), first.deps)).toMatchObject({ outcome: "STOPPED", stopCode: "USER_ABORT" });
    expect(first.db.projects).toHaveLength(0);

    const controller = new AbortController();
    const second = makeDeps(new FakeDb(), { signal: controller.signal });
    second.spies.runTurn.mockImplementationOnce(async () => {
      controller.abort();
      return turnResult({ status: "aborted" });
    });
    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02"] }), second.deps);
    expect(summary).toMatchObject({ outcome: "STOPPED", stopCode: "USER_ABORT", counts: { STOPPED: 1 } });
    expect(second.db.projects).toHaveLength(1);
  });
});

describe("runEval: błędy tur", () => {
  it("wyjątek z runChatTurn to awaria techniczna: INVALID (TURN_EXCEPTION), a nie FAILED; przebieg idzie dalej", async () => {
    const { deps, db, spies } = makeDeps();
    spies.runTurn.mockRejectedValueOnce(new Error("błąd createChatTools"));

    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02"] }), deps);

    expect(summary).toMatchObject({ outcome: "DONE", counts: { INVALID: 1, FAILED: 0, OK: 1 } });
    expect(db.finished[0]).toMatchObject({ status: "INVALID", errorCode: "TURN_EXCEPTION" });
    expect(db.projects.map((p) => p.name)).toEqual(["EV-T1-BUILD-01-p1", "EV-T1-BUILD-02-p1"]);
    expect(spies.prepareTurn).toHaveBeenCalledTimes(1 + 6);
  });

  it("błąd konfiguracji (odmowa CONFIG z prepareChatTurn) kończy przebieg od razu: FATAL", async () => {
    const { deps, db, spies } = makeDeps();
    spies.prepareTurn.mockResolvedValueOnce({ ok: false, status: 503, error: "CONFIG", message: "Agent jest źle skonfigurowany." } as never);

    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02"] }), deps);

    expect(summary.outcome).toBe("FATAL");
    expect(summary.message).toContain("źle skonfigurowany");
    expect(db.finished[0]).toMatchObject({ status: "FAILED", errorCode: "CONFIG" });
    expect(db.projects).toHaveLength(1);
  });

  it("inna odmowa przygotowania tury (np. brak wariantu) to FAILED tego przypadku, bez końca przebiegu", async () => {
    const { deps, db, spies } = makeDeps();
    spies.prepareTurn.mockResolvedValueOnce({ ok: false, status: 404, error: "NOT_FOUND", message: "x" } as never);

    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02"] }), deps);

    expect(summary).toMatchObject({ outcome: "DONE", counts: { FAILED: 1, OK: 1 } });
    expect(db.finished[0]).toMatchObject({ status: "FAILED", errorCode: "PREPARE_NOT_FOUND" });
  });

  it.each([
    [{ status: "failed", errorCode: "429" } as ChatTurnResult, "INVALID", "PROVIDER_429"],
    [{ status: "aborted" } as ChatTurnResult, "INVALID", "ABORTED"],
    [{ status: "save_failed" } as ChatTurnResult, "INVALID", "SAVE_FAILED"],
    [{ status: "no_end" } as ChatTurnResult, "INVALID", "NO_END"],
  ])("wynik tury %j daje %s (%s) i przebieg idzie dalej", async (finished, status, code) => {
    const { deps, db, spies } = makeDeps();
    spies.runTurn.mockResolvedValueOnce(turnResult(finished));

    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02"] }), deps);

    expect(summary.outcome).toBe("DONE");
    expect(db.finished[0]).toMatchObject({ status, errorCode: code });
    expect(db.finished[1]).toMatchObject({ status: "OK" });
  });

  it("odpowiedź ucięta limitem i niezgodna ze schematem to wynik pomiaru, nie błąd: przebieg idzie dalej OK", async () => {
    const { deps, db, spies } = makeDeps();
    spies.runTurn.mockResolvedValueOnce(turnResult({ status: "truncated" }));
    spies.runTurn.mockImplementation(async () => turnResult({ status: "invalid_response" }));

    await runEval(config(), deps);

    expect(db.finished[0]).toMatchObject({ status: "OK" });
  });

  it("odrzucenie klucza przez dostawcę (401) kończy przebieg: FATAL", async () => {
    const { deps, db, spies } = makeDeps();
    spies.runTurn.mockResolvedValueOnce(turnResult({ status: "failed", errorCode: "401" }));

    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02"] }), deps);

    expect(summary.outcome).toBe("FATAL");
    expect(db.finished[0]).toMatchObject({ status: "INVALID", errorCode: "PROVIDER_401" });
    expect(db.projects).toHaveLength(1);
  });
});

describe("runEval: wznawianie", () => {
  it("pomija OK, FAILED i INVALID; STOPPED powtarza jako nowa próba w nowym projekcie, a RUNNING po awarii oznacza jako przerwany", async () => {
    const { deps, db } = makeDeps();
    db.stale = 1;
    db.existing = [
      existing("BUILD-01", "OK"),
      existing("BUILD-02", "FAILED"),
      existing("BUILD-03", "INVALID"),
      existing("BUILD-04", "STOPPED"),
    ];

    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02", "BUILD-03", "BUILD-04"] }), deps);

    expect(summary.skipped).toBe(3);
    expect(db.writes[0]).toBe("stopStaleRuns");
    expect(db.projects.map((p) => p.name)).toEqual(["EV-T1-BUILD-04-p1-a2"]);
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0]).toMatchObject({ caseId: "BUILD-04", attempt: 2 });
  });

  it("--powtorz-niewazne powtarza INVALID jako kolejną próbę (poprzedni wiersz i projekt zostają)", async () => {
    const { deps, db } = makeDeps();
    db.existing = [existing("BUILD-01", "INVALID", 2)];

    await runEval(config({ retryInvalid: true }), deps);

    expect(db.runs[0]).toMatchObject({ caseId: "BUILD-01", attempt: 3 });
    expect(db.projects[0].name).toBe("EV-T1-BUILD-01-p1-a3");
  });

  it("limity bezpieczników dotyczą bieżącego uruchomienia: ukończone wcześniej tury nie liczą się do --max-tur", async () => {
    const { deps, db } = makeDeps();
    db.existing = [existing("BUILD-01", "OK"), existing("BUILD-02", "OK")];

    const summary = await runEval(config({ caseIds: ["BUILD-01", "BUILD-02", "BUILD-03"], maxTurns: 6 }), deps);

    expect(summary.skipped).toBe(2);
    expect(summary.turns).toBe(6);
    expect(db.runs.map((r) => r.caseId)).toEqual(["BUILD-03"]);
  });
});

describe("runEval: przypadki EVAL i CHAT", () => {
  it("EVAL: kopia stanu z seeda w świeżym projekcie, ocena z triggerem SCRIPT, z --sedzia trzy sądy SCRIPT, bez tur czatu", async () => {
    const { deps, db, spies } = makeDeps();

    const summary = await runEval(config({ caseIds: ["EVAL-02"], judge: true }), deps);

    expect(summary.counts.OK).toBe(1);
    const spotify = SEED_COMPANIES.find((c) => c.key === "spotify");
    expect(db.projects[0]).toMatchObject({ name: "EV-T1-EVAL-02-p1", description: "Nowy model biznesowy.", state: spotify?.state });
    expect(db.projects[0].entryOrigins.length).toBeGreaterThan(0);
    expect(spies.runEvaluation).toHaveBeenCalledWith(expect.objectContaining({ trigger: "SCRIPT", projectId: "p1" }));
    expect(spies.runJudge).toHaveBeenCalledTimes(3);
    expect(spies.prepareTurn).not.toHaveBeenCalled();
  });

  it("operacja AI z błędem konfiguracji kończy przebieg (FATAL), zbyt pusty model to wynik FAILED, błąd dostawcy to INVALID", async () => {
    const config1 = makeDeps();
    config1.spies.runEvaluation.mockResolvedValueOnce({ ok: false, error: "CONFIG", message: "x" } as never);
    expect((await runEval(config({ caseIds: ["EVAL-01", "EVAL-02"] }), config1.deps)).outcome).toBe("FATAL");

    const empty = makeDeps();
    empty.spies.runEvaluation.mockResolvedValueOnce({ ok: false, error: "TOO_EMPTY", message: "x" } as never);
    await runEval(config({ caseIds: ["EVAL-01"] }), empty.deps);
    expect(empty.db.finished[0]).toMatchObject({ status: "FAILED", errorCode: "TOO_EMPTY" });

    const provider = makeDeps();
    provider.spies.runEvaluation.mockResolvedValueOnce({ ok: false, error: "PROVIDER", message: "x" } as never);
    await runEval(config({ caseIds: ["EVAL-01"] }), provider.deps);
    expect(provider.db.finished[0]).toMatchObject({ status: "INVALID", errorCode: "OP_PROVIDER" });
  });

  it("CHAT-S3 i CHAT-S5: jeden projekt, dwa wiersze EvalRun, 3 tury, propozycji nie zatwierdza", async () => {
    const { deps, db, spies } = makeDeps();

    const summary = await runEval(config({ caseIds: ["CHAT-S3", "CHAT-S5"] }), deps);

    expect(summary.counts.OK).toBe(2);
    expect(db.projects).toHaveLength(1);
    expect(db.projects[0].name).toBe("EV-T1-CHAT-S3-p1");
    expect(db.runs.map((r) => [r.caseId, r.projectId])).toEqual([["CHAT-S3", "p1"], ["CHAT-S5", "p1"]]);
    expect(spies.prepareTurn).toHaveBeenCalledTimes(3);
    expect(spies.acceptProposal).not.toHaveBeenCalled();
    expect(spies.runEvaluation).not.toHaveBeenCalled();
  });

  it("CHAT-S4: po turze z propozycją analiza wpływu na najnowszej propozycji (jak kliknięcie w interfejsie), potem tura 3", async () => {
    const { deps, db, spies } = makeDeps();
    spies.prepareTurn.mockImplementationOnce(async () => {
      db.pending.push("pr-1");
      return { ok: true as const, turn: {} as ChatTurn };
    });

    const summary = await runEval(config({ caseIds: ["CHAT-S4"] }), deps);

    expect(summary.counts.OK).toBe(1);
    // Trigger analizy wpływu to `UI`: enum `ImpactTrigger` (baza i Zod) nie ma `SCRIPT`; rozpoznanie po projekcie EV-… i EvalRun.
    expect(spies.runImpact).toHaveBeenCalledWith(expect.objectContaining({ trigger: "UI", change: { kind: "PROPOSAL", proposalId: "pr-1" } }));
    expect(spies.prepareTurn).toHaveBeenCalledTimes(2);
    expect(spies.acceptProposal).not.toHaveBeenCalled();
  });

  it("CHAT-S4 bez propozycji od agenta: FAILED (NO_PROPOSAL_FOR_IMPACT), analiza nie jest wołana", async () => {
    const { deps, db, spies } = makeDeps();

    await runEval(config({ caseIds: ["CHAT-S4"] }), deps);

    expect(db.finished[0]).toMatchObject({ status: "FAILED", errorCode: "NO_PROPOSAL_FOR_IMPACT" });
    expect(spies.runImpact).not.toHaveBeenCalled();
  });

  it("CHAT-S1: pusty model, 5 tur; CHAT-S2: stan Kawiarni Ziarno z seeda", async () => {
    const { deps, db, spies } = makeDeps();

    await runEval(config({ caseIds: ["CHAT-S1", "CHAT-S2"] }), deps);

    expect(db.projects[0].state).toEqual(emptyBmcState());
    const kawiarnia = SEED_COMPANIES.find((c) => c.key === "kawiarnia-ziarno");
    expect(db.projects[1].state).toEqual(kawiarnia?.state);
    expect(spies.prepareTurn).toHaveBeenCalledTimes(5 + 3);
    expect(getCase("CHAT-S1")?.kind).toBe("CHAT");
  });
});
