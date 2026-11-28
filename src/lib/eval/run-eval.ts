import { loadAiLimits } from "@/lib/ai/config";
import type { ChatTurn, PrepareChatTurnInput, RunChatTurnResult } from "@/lib/ai/chat-agent";
import type { prepareChatTurnWithoutUserLimits } from "@/lib/ai/chat-agent-script";
import type { RunEvaluationContext, RunEvaluationResult } from "@/lib/ai/evaluate";
import type { RunImpactContext, RunImpactResult } from "@/lib/ai/impact";
import type { RunJudgeContext, RunJudgeResult } from "@/lib/ai/judge";
import { PROMPT_VERSION } from "@/lib/ai/prompts/system";
import type { EvalConfig } from "@/lib/eval/args";
import { RunBudget, type CostReading } from "@/lib/eval/budget";
import {
  ALL_CASES,
  BUILD_CONTINUATION_MESSAGE,
  BUILD_EMPTY_TURNS_TO_STOP,
  BUILD_MAX_CONTINUATIONS,
  casesChecksum,
  checkCasesFrozen,
  type BuildCase,
  type ChatCase,
  type EvalCaseDefinition,
  type EvalEndReason,
} from "@/lib/eval/cases";
import { estimateRun } from "@/lib/eval/estimate";
import { EVAL_PROJECT_DESCRIPTION, buildEvalProjectName } from "@/lib/eval/naming";
import { applyScriptLimitOverrides } from "@/lib/eval/script-limits";
import { BLOCK_KEYS, emptyBmcState, type BmcState } from "@/lib/schemas/bmc";
import { SEED_COMPANIES } from "@/lib/seed/companies";
import { buildEntryOrigins } from "@/lib/seed/run-seed";

// Rdzeń skryptu ewaluacji (plan 10f, punkt 22). Wszystkie zależności (baza, tura czatu, operacje AI, zegar) są wstrzykiwane,
// więc testy działają na mockach. Skrypt uruchamia wyłącznie właściciel (`scripts/eval/run.mjs`).

export type RunStatus = "RUNNING" | "OK" | "FAILED" | "INVALID" | "STOPPED";
export type FinalRunStatus = Exclude<RunStatus, "RUNNING">;

export type ExistingRun = {
  id: string;
  caseId: string;
  model: string;
  repetition: number;
  attempt: number;
  status: RunStatus;
  projectId: string | null;
};

export type NewRunData = {
  seriesId: string;
  caseId: string;
  kind: "BUILD" | "EVAL" | "CHAT";
  repetition: number;
  attempt: number;
  provider: string;
  model: string;
  judgeModel: string | null;
  chatPromptVersion: string;
  casesChecksum: string;
  maxOutputTokens: number;
  maxOutputTokensLong: number;
  costLimitUsd: number;
  turnLimit: number;
  projectId: string;
};

export interface EvalDb {
  findUserIdByEmail(email: string): Promise<string | null>;
  listRuns(seriesId: string): Promise<ExistingRun[]>;
  /** Oznacza wiersze `RUNNING` serii jako `STOPPED` z kodem `CRASHED` (aktualizacja własnych wierszy, bez kasowania). */
  stopStaleRuns(seriesId: string): Promise<number>;
  createProject(args: {
    userId: string;
    name: string;
    description: string;
    state: BmcState;
    entryOrigins: unknown[];
  }): Promise<{ projectId: string; variantId: string }>;
  createRun(data: NewRunData): Promise<{ id: string }>;
  finishRun(
    id: string,
    result: { status: FinalRunStatus; errorCode?: string | null; turnCount?: number | null; endReason?: EvalEndReason | null },
  ): Promise<void>;
  readCost(projectIds: readonly string[]): Promise<CostReading>;
  getMainVariant(projectId: string): Promise<{ id: string; version: number; state: BmcState } | null>;
  /** Identyfikatory propozycji `PENDING` wariantu, od najstarszej. */
  listPendingProposalIds(projectId: string, variantId: string): Promise<string[]>;
}

export type EvalDeps = {
  db: EvalDb;
  /** Środowisko procesu skryptu; runner nadpisuje w nim model, limity wyjścia i limity użytkownika (nie plik `.env`). */
  env: Record<string, string | undefined>;
  /** Adres konta pomiarowego (EVAL_USER_EMAIL); nigdy nie jest drukowany ani zapisywany. */
  userEmail: string | undefined;
  prepareTurn: (input: PrepareChatTurnInput) => ReturnType<typeof prepareChatTurnWithoutUserLimits>;
  runTurn: (turn: ChatTurn, options: { signal?: AbortSignal }) => Promise<RunChatTurnResult>;
  acceptProposal: (args: {
    projectId: string;
    variantId: string;
    proposalId: string;
    expectedVersion: number;
    userId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  runEvaluation: (ctx: RunEvaluationContext) => Promise<RunEvaluationResult>;
  runJudge: (ctx: RunJudgeContext) => Promise<RunJudgeResult>;
  runImpact: (ctx: RunImpactContext) => Promise<RunImpactResult>;
  /** Rzuca, gdy konfiguracja modelu (dostawca, model, klucz API) jest niepoprawna; komunikat bez wartości kluczy. */
  checkModelConfig: (env: Record<string, string | undefined>, name: "chat" | "judge") => void;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

export type EvalSummary = {
  outcome: "REFUSED" | "DRY_RUN" | "DONE" | "STOPPED" | "FATAL";
  message?: string;
  stopCode?: string;
  counts: Record<FinalRunStatus, number>;
  skipped: number;
  turns: number;
  costUsd: number;
  /** Propozycje agenta w przypadkach BUILD: zaakceptowane przez skrypt i niezaakceptowane (z powodami). */
  proposalsAccepted: number;
  proposalsNotAccepted: number;
  proposalsNotAcceptedReasons: Record<string, number>;
};

const DONE_STATUSES: readonly RunStatus[] = ["OK", "FAILED"];
const JUDGE_RUNS = 3;

type Unit = { cases: EvalCaseDefinition[]; model: string; repetition: number };
type StopInfo = { code: string; message: string };

function emptySummary(outcome: EvalSummary["outcome"], message?: string): EvalSummary {
  return {
    outcome,
    message,
    counts: { OK: 0, FAILED: 0, INVALID: 0, STOPPED: 0 },
    skipped: 0,
    turns: 0,
    costUsd: 0,
    proposalsAccepted: 0,
    proposalsNotAccepted: 0,
    proposalsNotAcceptedReasons: {},
  };
}

function buildUnits(config: EvalConfig): Unit[] {
  const groups: EvalCaseDefinition[][] = [];
  for (const id of config.caseIds) {
    if (id === "CHAT-S5" && config.caseIds.includes("CHAT-S3")) continue; // kontynuacja S3 w tym samym projekcie
    const def = ALL_CASES.find((c) => c.id === id);
    if (!def) continue;
    const group: EvalCaseDefinition[] = [def];
    if (id === "CHAT-S3" && config.caseIds.includes("CHAT-S5")) {
      const s5 = ALL_CASES.find((c) => c.id === "CHAT-S5");
      if (s5) group.push(s5);
    }
    groups.push(group);
  }
  const units: Unit[] = [];
  for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
    for (const cases of groups) {
      for (const model of config.models) {
        units.push({ cases, model, repetition });
      }
    }
  }
  return units;
}

function latestRun(runs: readonly ExistingRun[], caseId: string, model: string, repetition: number): ExistingRun | undefined {
  return runs
    .filter((r) => r.caseId === caseId && r.model === model && r.repetition === repetition)
    .sort((a, b) => b.attempt - a.attempt)[0];
}

function isUnitDone(unit: Unit, runs: readonly ExistingRun[], retryInvalid: boolean): boolean {
  return unit.cases.every((def) => {
    const last = latestRun(runs, def.id, unit.model, unit.repetition);
    if (!last) return false;
    return DONE_STATUSES.includes(last.status) || (last.status === "INVALID" && !retryInvalid);
  });
}

function seedCompany(key: string) {
  const company = SEED_COMPANIES.find((c) => c.key === key);
  if (!company) throw new Error(`Brak firmy „${key}” w seedzie.`);
  return company;
}

function initialProject(def: EvalCaseDefinition): { state: BmcState; entryOrigins: unknown[] } {
  const key = def.kind === "EVAL" ? def.companyKey : def.kind === "CHAT" && def.fixture !== "EMPTY" ? def.fixture : null;
  if (key === null) return { state: emptyBmcState(), entryOrigins: [] };
  const company = seedCompany(key);
  return { state: company.state, entryOrigins: buildEntryOrigins(company) };
}

function describeUnit(unit: Unit): string {
  return `${unit.cases.map((c) => c.id).join("+")} · ${unit.model} · p${unit.repetition}`;
}

/** Odczytuje strumień do końca (błąd strumienia też kończy odczyt); bez tego `onEnd` i `finished` by się nie rozwiązały. */
async function drain(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // Strumień z błędem też jest „odczytany do końca”; wynik opisuje `finished`.
  }
}

function formatRange(min: number, max: number, label: string): string {
  return min === max ? `${label} ${min}` : `${label} ${min} do ${max}`;
}

function formatCostRange(min: number | null, max: number | null): string {
  if (min === null || max === null) return "nieznany (brak ceny)";
  return min.toFixed(4) === max.toFixed(4) ? `${min.toFixed(4)} USD` : `${min.toFixed(4)} do ${max.toFixed(4)} USD`;
}

function formatReasons(reasons: Record<string, number>): string {
  const entries = Object.entries(reasons);
  return entries.length === 0 ? "" : ` (${entries.map(([reason, count]) => `${reason}: ${count}`).join(", ")})`;
}

function applyRunEnv(env: Record<string, string | undefined>, config: EvalConfig, model: string): void {
  env.LLM_PROVIDER = "google";
  env.LLM_MODEL = model;
  if (config.maxOutputTokens !== undefined) env.LLM_MAX_OUTPUT_TOKENS = String(config.maxOutputTokens);
  if (config.maxOutputTokensLong !== undefined) env.LLM_MAX_OUTPUT_TOKENS_LONG = String(config.maxOutputTokensLong);
}

export async function runEval(config: EvalConfig, deps: EvalDeps): Promise<EvalSummary> {
  const { db, env, log } = deps;
  const units = buildUnits(config);
  const freeze = checkCasesFrozen();

  // Konto pomiarowe musi istnieć (także na sucho); adres nigdy nie trafia do wyjścia.
  const email = deps.userEmail?.trim().toLowerCase();
  const userId = email ? await db.findUserIdByEmail(email) : null;
  if (!userId) {
    const message = email
      ? "Nie znaleziono konta wskazanego w EVAL_USER_EMAIL. Zarejestruj konto pomiarowe w aplikacji i ustaw zmienną."
      : "Brak zmiennej EVAL_USER_EMAIL (konto pomiarowe). Ustaw ją w .env na e-mail istniejącego konta.";
    log(message);
    return emptySummary("REFUSED", message);
  }

  if (!config.execute) {
    return dryRun(config, deps, units, freeze);
  }

  // --- Prawdziwy przebieg: warunki wstępne (nic jeszcze nie zapisano) ---
  if (!freeze.frozen) {
    log(freeze.message);
    return emptySummary("REFUSED", freeze.message);
  }
  applyScriptLimitOverrides(env);
  try {
    for (const model of config.models) {
      applyRunEnv(env, config, model);
      deps.checkModelConfig(env, "chat");
    }
    if (config.judge) deps.checkModelConfig(env, "judge");
  } catch (error) {
    const message = `Błędna konfiguracja modelu: ${error instanceof Error ? error.message : "nieznany błąd"}`;
    log(message);
    return emptySummary("REFUSED", message);
  }

  const maxCostUsd = config.maxCostUsd ?? 0;
  const maxTurns = config.maxTurns ?? 0;
  const createdProjectIds: string[] = [];
  const budget = new RunBudget({ maxCostUsd, maxTurns, readCost: () => db.readCost(createdProjectIds) });
  const summary = emptySummary("DONE");

  const stale = await db.stopStaleRuns(config.seriesId);
  if (stale > 0) log(`Oznaczono ${stale} przerwanych przebiegów tej serii jako STOPPED (CRASHED).`);
  const existing = await db.listRuns(config.seriesId);
  const checksum = casesChecksum();
  const state: { stop: StopInfo | null; fatal: string | null } = { stop: null, fatal: null };

  const finishSummary = async (): Promise<EvalSummary> => {
    summary.turns = budget.turns;
    summary.costUsd = (await db.readCost(createdProjectIds)).totalUsd;
    if (state.fatal) {
      summary.outcome = "FATAL";
      summary.message = state.fatal;
    } else if (state.stop) {
      summary.outcome = "STOPPED";
      summary.stopCode = state.stop.code;
      summary.message = state.stop.message;
    }
    log(
      `Podsumowanie: OK ${summary.counts.OK}, FAILED ${summary.counts.FAILED}, INVALID ${summary.counts.INVALID}, STOPPED ${summary.counts.STOPPED}, pominięto ${summary.skipped}; tury ${summary.turns}; koszt ${summary.costUsd.toFixed(6)} USD.`,
    );
    if (summary.proposalsAccepted + summary.proposalsNotAccepted > 0) {
      log(`Propozycje agenta (BUILD): zaakceptowano ${summary.proposalsAccepted}, niezaakceptowano ${summary.proposalsNotAccepted}${formatReasons(summary.proposalsNotAcceptedReasons)}.`);
    }
    if (summary.message) log(summary.message);
    return summary;
  };

  for (const unit of units) {
    if (state.stop || state.fatal) break;
    if (deps.signal?.aborted) {
      state.stop = { code: "USER_ABORT", message: "Przerwano na żądanie użytkownika (Ctrl+C)." };
      break;
    }
    if (isUnitDone(unit, existing, config.retryInvalid)) {
      summary.skipped += unit.cases.length;
      log(`Pominięto (ukończony): ${describeUnit(unit)}`);
      continue;
    }

    applyRunEnv(env, config, unit.model);
    const limits = loadAiLimits(env);
    const attempts = unit.cases.map((def) => (latestRun(existing, def.id, unit.model, unit.repetition)?.attempt ?? 0) + 1);
    const first = unit.cases[0];
    const project = await db.createProject({
      userId,
      name: buildEvalProjectName({ seriesId: config.seriesId, caseId: first.id, repetition: unit.repetition, attempt: attempts[0] }),
      description: EVAL_PROJECT_DESCRIPTION,
      ...initialProject(first),
    });
    createdProjectIds.push(project.projectId);
    log(`Start: ${describeUnit(unit)} (próba ${attempts[0]})`);

    let previous: CaseResult | null = null;
    for (const [index, def] of unit.cases.entries()) {
      const run = await db.createRun({
        seriesId: config.seriesId,
        caseId: def.id,
        kind: def.kind,
        repetition: unit.repetition,
        attempt: attempts[index],
        provider: "google",
        model: unit.model,
        judgeModel: config.judge ? (env.JUDGE_MODEL ?? null) : null,
        chatPromptVersion: PROMPT_VERSION,
        casesChecksum: checksum,
        maxOutputTokens: limits.maxOutputTokens,
        maxOutputTokensLong: limits.maxOutputTokensLong,
        costLimitUsd: maxCostUsd,
        turnLimit: maxTurns,
        projectId: project.projectId,
      });

      const proposals: ProposalCounters = { accepted: 0, notAccepted: 0, reasons: {} };
      let result: CaseResult;
      if (previous && previous.status !== "OK") {
        result = { status: "INVALID", errorCode: "PREVIOUS_CASE_NOT_OK" };
      } else {
        result = await executeCase(def, {
          deps,
          config,
          budget,
          proposals,
          userId,
          projectId: project.projectId,
          variantId: project.variantId,
          limits,
          setStop: (info) => {
            state.stop = info;
          },
          getStop: () => state.stop,
        });
      }
      await db.finishRun(run.id, {
        status: result.status,
        errorCode: result.errorCode ?? null,
        turnCount: result.turnCount ?? null,
        endReason: result.endReason ?? null,
      });
      summary.counts[result.status] += 1;
      log(`  ${def.id}: ${result.status}${result.errorCode ? ` (${result.errorCode})` : ""}`);
      if (def.kind === "BUILD" && result.turnCount !== undefined) {
        log(
          `    tury: ${result.turnCount} (${def.messages.length} ze skryptu + ${Math.max(0, result.turnCount - def.messages.length)} kontynuacji), powód zakończenia: ${result.endReason ?? "brak (przerwany)"}, wypełnione bloki: ${result.blocksFilled ?? "?"}/${BLOCK_KEYS.length}`,
        );
      }
      if (proposals.accepted + proposals.notAccepted > 0) {
        log(`    propozycje: zaakceptowano ${proposals.accepted}, niezaakceptowano ${proposals.notAccepted}${formatReasons(proposals.reasons)}`);
        summary.proposalsAccepted += proposals.accepted;
        summary.proposalsNotAccepted += proposals.notAccepted;
        for (const [reason, count] of Object.entries(proposals.reasons)) {
          summary.proposalsNotAcceptedReasons[reason] = (summary.proposalsNotAcceptedReasons[reason] ?? 0) + count;
        }
      }
      previous = result;
      if (result.fatal) {
        state.fatal = result.fatal;
        break;
      }
      if (state.stop) break;
    }

    if (!state.stop && !state.fatal && config.pauseMs > 0) await deps.sleep(config.pauseMs);
  }

  return finishSummary();
}

type CaseResult = {
  status: FinalRunStatus;
  errorCode?: string;
  fatal?: string;
  turnCount?: number;
  endReason?: EvalEndReason;
  /** Tylko do wypisu (BUILD): niepuste bloki po przebiegu; z bazy odtwarza to stan wariantu. */
  blocksFilled?: number;
};

/** Liczniki propozycji agenta w jednym przypadku: odtwarzalne też z tabeli `Proposal` po `projectId` (patrz README). */
type ProposalCounters = { accepted: number; notAccepted: number; reasons: Record<string, number> };

type CaseContext = {
  deps: EvalDeps;
  config: EvalConfig;
  budget: RunBudget;
  proposals: ProposalCounters;
  userId: string;
  projectId: string;
  variantId: string;
  limits: ReturnType<typeof loadAiLimits>;
  setStop: (info: StopInfo) => void;
  getStop: () => StopInfo | null;
};

function stopped(info: StopInfo): CaseResult {
  return { status: "STOPPED", errorCode: info.code };
}

/** Jedna tura czatu: przygotowanie (bez limitów użytkownika), strumień do końca, `finished`. Wyjątki są wynikiem, nie crashem. */
async function chatTurn(ctx: CaseContext, text: string): Promise<CaseResult | null> {
  const { deps } = ctx;
  const prepared = await deps.prepareTurn({
    projectId: ctx.projectId,
    userId: ctx.userId,
    variantId: ctx.variantId,
    message: text,
    limits: ctx.limits,
  });
  if (!prepared.ok) {
    if (prepared.error === "CONFIG") {
      return { status: "FAILED", errorCode: "CONFIG", fatal: `Błąd konfiguracji: ${prepared.message}` };
    }
    return { status: "FAILED", errorCode: `PREPARE_${prepared.error}` };
  }

  let finishedResult;
  try {
    const turn = await deps.runTurn(prepared.turn, { signal: deps.signal });
    await drain(turn.stream);
    finishedResult = await turn.finished;
  } catch (error) {
    // Awaria techniczna, nie wynik agenta: INVALID (powtarzalny przez --powtorz-niewazne), a nie FAILED.
    deps.log(`  Wyjątek w turze: ${error instanceof Error ? error.name : "nieznany błąd"}`);
    return { status: "INVALID", errorCode: "TURN_EXCEPTION" };
  }

  switch (finishedResult.status) {
    case "completed":
    case "truncated":
    case "invalid_response":
      return null;
    case "failed":
      if (finishedResult.errorCode === "401" || finishedResult.errorCode === "403" || finishedResult.errorCode === "CONFIG") {
        return { status: "INVALID", errorCode: `PROVIDER_${finishedResult.errorCode}`, fatal: "Dostawca odrzucił zapytanie (klucz API błędny lub bez uprawnień). Przebieg zatrzymany." };
      }
      return { status: "INVALID", errorCode: `PROVIDER_${finishedResult.errorCode}` };
    case "aborted":
      if (deps.signal?.aborted) {
        ctx.setStop({ code: "USER_ABORT", message: "Przerwano na żądanie użytkownika (Ctrl+C)." });
        return { status: "STOPPED", errorCode: "USER_ABORT" };
      }
      return { status: "INVALID", errorCode: "ABORTED" };
    case "save_failed":
      return { status: "INVALID", errorCode: "SAVE_FAILED" };
    case "no_end":
      return { status: "INVALID", errorCode: "NO_END" };
  }
}

type OperationResult = { ok: true } | { ok: false; error: string };

function mapOperationFailure(result: OperationResult): CaseResult | null {
  if (result.ok) return null;
  if (result.error === "CONFIG") {
    return { status: "FAILED", errorCode: "CONFIG", fatal: "Błąd konfiguracji modelu przy operacji AI. Przebieg zatrzymany." };
  }
  // Zbyt pusty model to wynik pomiaru (agent nic nie zbudował), a nie błąd pomiaru.
  if (result.error === "TOO_EMPTY") return { status: "FAILED", errorCode: "TOO_EMPTY" };
  return { status: "INVALID", errorCode: `OP_${result.error}` };
}

/** Akceptuje wszystkie oczekujące propozycje i zwraca, ile ich było (nowe propozycje zapisane w tej turze). */
async function acceptAllPending(ctx: CaseContext): Promise<number> {
  const { db } = ctx.deps;
  const pending = await db.listPendingProposalIds(ctx.projectId, ctx.variantId);
  for (const proposalId of pending) {
    const variant = await db.getMainVariant(ctx.projectId);
    if (!variant) return pending.length;
    const result = await ctx.deps.acceptProposal({
      projectId: ctx.projectId,
      variantId: ctx.variantId,
      proposalId,
      expectedVersion: variant.version,
      userId: ctx.userId,
    });
    if (result.ok) {
      ctx.proposals.accepted += 1;
    } else {
      const reason = result.error ?? "UNKNOWN";
      ctx.proposals.notAccepted += 1;
      ctx.proposals.reasons[reason] = (ctx.proposals.reasons[reason] ?? 0) + 1;
      ctx.deps.log(`  Nie udało się zaakceptować propozycji (${reason}); liczona jako niezaakceptowana.`);
    }
  }
  return pending.length;
}

/** Liczba niepustych bloków w stanie wariantu głównego (po akceptacji propozycji). */
async function countFilledBlocks(ctx: CaseContext): Promise<number> {
  const variant = await ctx.deps.db.getMainVariant(ctx.projectId);
  if (!variant) return 0;
  return BLOCK_KEYS.filter((key) => variant.state[key].length > 0).length;
}

/** Po operacji lub turze: sprawdza koszt (i turę). Zwraca wynik STOPPED, jeśli jest jeszcze praca do wykonania. */
async function checkBudget(ctx: CaseContext, isTurn: boolean, hasMoreWork: boolean): Promise<CaseResult | null> {
  const stop = isTurn ? await ctx.budget.afterTurn() : await ctx.budget.checkCost();
  if (!stop) return null;
  ctx.setStop(stop);
  return hasMoreWork ? stopped(stop) : null;
}

async function runJudgeRounds(ctx: CaseContext): Promise<CaseResult | null> {
  for (let round = 1; round <= JUDGE_RUNS; round += 1) {
    if (ctx.deps.signal?.aborted) {
      const info = { code: "USER_ABORT", message: "Przerwano na żądanie użytkownika (Ctrl+C)." };
      ctx.setStop(info);
      return stopped(info);
    }
    const result = await ctx.deps.runJudge({
      projectId: ctx.projectId,
      variantId: ctx.variantId,
      userId: ctx.userId,
      trigger: "SCRIPT",
      abortSignal: ctx.deps.signal,
    });
    const failure = mapOperationFailure(result);
    if (failure) return failure;
    const budgetStop = await checkBudget(ctx, false, round < JUDGE_RUNS);
    if (budgetStop) return budgetStop;
  }
  return null;
}

async function executeCase(def: EvalCaseDefinition, ctx: CaseContext): Promise<CaseResult> {
  if (def.kind === "BUILD") return executeBuild(def, ctx);
  if (def.kind === "EVAL") return executeEval(ctx);
  return executeChat(def, ctx);
}

async function executeBuild(def: BuildCase, ctx: CaseContext): Promise<CaseResult> {
  const scripted = def.messages.length;
  let turnCount = 0;
  let emptyStreak = 0;
  let blocksFilled = 0;
  let endReason: EvalEndReason | null = null;

  // Stałe wiadomości, potem stała kontynuacja. Od tury szóstej (ostatniej ze skryptu) po każdej turze sprawdzamy w tej kolejności:
  // ALL_BLOCKS, NO_NEW_PROPOSALS (dwie kolejne tury bez nowych propozycji, liczone od tury szóstej), CONTINUATION_LIMIT.
  for (let index = 0; endReason === null; index += 1) {
    if (ctx.deps.signal?.aborted) {
      const info = { code: "USER_ABORT", message: "Przerwano na żądanie użytkownika (Ctrl+C)." };
      ctx.setStop(info);
      return { ...stopped(info), turnCount, blocksFilled };
    }
    turnCount += 1;
    const failure = await chatTurn(ctx, index < scripted ? def.messages[index] : BUILD_CONTINUATION_MESSAGE);
    if (failure) return { ...failure, turnCount, blocksFilled };
    // Nowe propozycje to tylko zapisane (PENDING), nie odrzucone przez serwer.
    const found = await acceptAllPending(ctx);
    blocksFilled = await countFilledBlocks(ctx);

    if (index >= scripted - 1) {
      emptyStreak = found === 0 ? emptyStreak + 1 : 0;
      const continuationsSent = index - (scripted - 1);
      if (blocksFilled === BLOCK_KEYS.length) endReason = "ALL_BLOCKS";
      else if (emptyStreak >= BUILD_EMPTY_TURNS_TO_STOP) endReason = "NO_NEW_PROPOSALS";
      else if (continuationsSent >= BUILD_MAX_CONTINUATIONS) endReason = "CONTINUATION_LIMIT";
    }

    const hasMore = endReason === null || ctx.config.judge;
    const budgetStop = await checkBudget(ctx, true, hasMore);
    if (budgetStop) return { ...budgetStop, turnCount, blocksFilled };
    if (ctx.getStop()) break;
  }
  if (endReason === null) {
    // Seria zatrzymana (bezpiecznik albo Ctrl+C) po turze, więc przebieg nie ma powodu zakończenia.
    return { status: "STOPPED", errorCode: ctx.getStop()?.code, turnCount, blocksFilled };
  }
  if (ctx.config.judge && !ctx.getStop()) {
    const failure = await runJudgeRounds(ctx);
    if (failure) return { ...failure, turnCount, endReason, blocksFilled };
  }
  return { status: "OK", turnCount, endReason, blocksFilled };
}

async function executeEval(ctx: CaseContext): Promise<CaseResult> {
  const evaluation = await ctx.deps.runEvaluation({
    projectId: ctx.projectId,
    variantId: ctx.variantId,
    userId: ctx.userId,
    trigger: "SCRIPT",
    abortSignal: ctx.deps.signal,
  });
  const failure = mapOperationFailure(evaluation);
  if (failure) return { ...failure, turnCount: 0 };
  const budgetStop = await checkBudget(ctx, false, ctx.config.judge);
  if (budgetStop) return { ...budgetStop, turnCount: 0 };
  if (ctx.config.judge && !ctx.getStop()) {
    const judgeFailure = await runJudgeRounds(ctx);
    if (judgeFailure) return { ...judgeFailure, turnCount: 0 };
  }
  return { status: "OK", turnCount: 0, endReason: "SCRIPT_DONE" };
}

async function executeChat(def: ChatCase, ctx: CaseContext): Promise<CaseResult> {
  let turnCount = 0;
  for (const [index, turn] of def.turns.entries()) {
    if (ctx.deps.signal?.aborted) {
      const info = { code: "USER_ABORT", message: "Przerwano na żądanie użytkownika (Ctrl+C)." };
      ctx.setStop(info);
      return { ...stopped(info), turnCount };
    }
    const hasMore = index < def.turns.length - 1;
    if (turn.type === "message") {
      // Scenariusze CHAT nie zatwierdzają propozycji (nie zmieniają stanu modelu), jak w PR „P”.
      turnCount += 1;
      const failure = await chatTurn(ctx, turn.text);
      if (failure) return { ...failure, turnCount };
      const budgetStop = await checkBudget(ctx, true, hasMore);
      if (budgetStop) return { ...budgetStop, turnCount };
    } else {
      const pending = await ctx.deps.db.listPendingProposalIds(ctx.projectId, ctx.variantId);
      const proposalId = pending[pending.length - 1];
      if (!proposalId) return { status: "FAILED", errorCode: "NO_PROPOSAL_FOR_IMPACT", turnCount };
      // Odpowiednik kliknięcia „Analizuj wpływ” w interfejsie (S4); analizy agent nie widzi.
      const impact = await ctx.deps.runImpact({
        projectId: ctx.projectId,
        variantId: ctx.variantId,
        userId: ctx.userId,
        trigger: "UI",
        change: { kind: "PROPOSAL", proposalId },
        abortSignal: ctx.deps.signal,
      });
      const failure = mapOperationFailure(impact);
      if (failure) return { ...failure, turnCount };
      const budgetStop = await checkBudget(ctx, false, hasMore);
      if (budgetStop) return { ...budgetStop, turnCount };
    }
    if (ctx.getStop()) break;
  }
  return { status: "OK", turnCount, endReason: "SCRIPT_DONE" };
}

async function dryRun(
  config: EvalConfig,
  deps: EvalDeps,
  units: Unit[],
  freeze: ReturnType<typeof checkCasesFrozen>,
): Promise<EvalSummary> {
  {
    const { log, db, env } = deps;
    const summary = emptySummary("DRY_RUN");
    const existing = await db.listRuns(config.seriesId);
    const judgeModel = env.JUDGE_MODEL;
    const limitsEnv = { ...env };
    if (config.maxOutputTokens !== undefined) limitsEnv.LLM_MAX_OUTPUT_TOKENS = String(config.maxOutputTokens);
    if (config.maxOutputTokensLong !== undefined) limitsEnv.LLM_MAX_OUTPUT_TOKENS_LONG = String(config.maxOutputTokensLong);
    const limits = loadAiLimits(limitsEnv);

    log("TRYB NA SUCHO: bez wywołań modelu i bez zapisu do bazy (prawdziwy przebieg wymaga --wykonaj).");
    if (!freeze.frozen) log(`OSTRZEŻENIE: ${freeze.message} Prawdziwy przebieg (--wykonaj) zostanie odrzucony.`);
    for (const name of ["chat", "judge"] as const) {
      if (name === "judge" && !config.judge) continue;
      try {
        for (const model of name === "chat" ? config.models : [""]) {
          const probe = { ...env };
          if (name === "chat") {
            probe.LLM_PROVIDER = "google";
            probe.LLM_MODEL = model;
          }
          deps.checkModelConfig(probe, name);
        }
      } catch (error) {
        log(`OSTRZEŻENIE: konfiguracja modelu „${name}”: ${error instanceof Error ? error.message : "nieznany błąd"}`);
      }
    }
    log(`Seria: ${config.seriesId}; modele: ${config.models.join(", ")}; sędzia: ${config.judge ? (judgeModel ?? "brak JUDGE_MODEL") : "wyłączony"}`);
    log(`Limity wyjścia: ${limits.maxOutputTokens} (czat), ${limits.maxOutputTokensLong} (długie); kroków na turę: ${limits.maxSteps}`);
    log(`Powtórzenia: ${config.repetitions}; przypadki: ${config.caseIds.join(", ")}`);

    const total = { turnsMin: 0, turnsMax: 0, callsMin: 0, callsMax: 0, costMin: 0 as number | null, costMax: 0 as number | null };
    for (const unit of units) {
      if (isUnitDone(unit, existing, config.retryInvalid)) {
        summary.skipped += unit.cases.length;
        log(`  pominięty (ukończony): ${describeUnit(unit)}`);
        continue;
      }
      const retry = unit.cases.some((def) => latestRun(existing, def.id, unit.model, unit.repetition));
      // Zakres: najkrócej (bez kontynuacji BUILD) i najdłużej (wszystkie kontynuacje).
      const unitMin = { turns: 0, calls: 0, cost: 0 as number | null };
      const unitMax = { turns: 0, calls: 0, cost: 0 as number | null };
      for (const def of unit.cases) {
        for (const [bucket, continuations] of [[unitMin, 0], [unitMax, def.kind === "BUILD" ? BUILD_MAX_CONTINUATIONS : 0]] as const) {
          const estimate = estimateRun(def, unit.model, { judge: config.judge, judgeModel, continuations });
          bucket.turns += estimate.turns;
          bucket.calls += estimate.calls;
          bucket.cost = bucket.cost === null || estimate.costUsd === null ? null : bucket.cost + estimate.costUsd;
        }
      }
      total.turnsMin += unitMin.turns;
      total.turnsMax += unitMax.turns;
      total.callsMin += unitMin.calls;
      total.callsMax += unitMax.calls;
      total.costMin = total.costMin === null || unitMin.cost === null ? null : total.costMin + unitMin.cost;
      total.costMax = total.costMax === null || unitMax.cost === null ? null : total.costMax + unitMax.cost;
      log(
        `  ${describeUnit(unit)}${retry ? " (powtórka kolejnej próby)" : ""}: ${formatRange(unitMin.turns, unitMax.turns, "tury")}, ${formatRange(unitMin.calls, unitMax.calls, "wywołań ok.")}, koszt ok. ${formatCostRange(unitMin.cost, unitMax.cost)}`,
      );
    }
    log(
      `Razem: ${formatRange(total.turnsMin, total.turnsMax, "tury")}, ${formatRange(total.callsMin, total.callsMax, "wywołań ok.")}, szacowany koszt ${formatCostRange(total.costMin, total.costMax)} (szacunek niezmierzony, rozrzut ±50%; górna granica zakłada wszystkie kontynuacje BUILD).`,
    );
    if (config.maxTurns !== undefined && config.maxTurns < total.turnsMax) {
      log(`OSTRZEŻENIE: --max-tur ${config.maxTurns} jest mniejszy niż najdłuższy możliwy przebieg (${total.turnsMax} tur): przebieg może zostać przerwany (TURN_LIMIT).`);
    }
    if (config.maxCostUsd !== undefined || config.maxTurns !== undefined) {
      log(`Bezpieczniki (tylko informacyjnie na sucho): --max-koszt-usd ${config.maxCostUsd ?? "-"}, --max-tur ${config.maxTurns ?? "-"}.`);
    }
    summary.turns = total.turnsMin;
    return summary;
  }
}
