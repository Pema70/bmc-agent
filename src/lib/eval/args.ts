import { REASONING_LEVELS, type ReasoningLevel } from "@/lib/ai/config";
import { ALLOWED_CHAT_MODELS } from "@/lib/ai/models";
import { ALL_CASES } from "@/lib/eval/cases";
import { isValidSeriesId } from "@/lib/eval/naming";

// Argumenty skryptu ewaluacji (plan 10f, punkt 22). Tryb na sucho jest domyślny; prawdziwy przebieg wymaga `--wykonaj`
// oraz jawnych bezpieczników `--max-koszt-usd` i `--max-tur` (bez wartości domyślnych).

export type EvalConfig = {
  seriesId: string;
  caseIds: string[];
  models: string[];
  repetitions: number;
  judge: boolean;
  maxOutputTokens?: number;
  maxOutputTokensLong?: number;
  /** Poziom `reasoning` AI SDK dla modelu `chat`; `undefined` = domyślne myślenie modelu (provider-default). */
  reasoning?: ReasoningLevel;
  pauseMs: number;
  retryInvalid: boolean;
  execute: boolean;
  maxCostUsd?: number;
  maxTurns?: number;
};

export type ParseArgsResult = { ok: true; config: EvalConfig } | { ok: false; errors: string[] };

const VALUE_FLAGS = [
  "--serie",
  "--przypadki",
  "--modele",
  "--powtorzenia",
  "--max-wyjscia",
  "--max-wyjscia-dlugie",
  "--reasoning",
  "--przerwa-ms",
  "--max-koszt-usd",
  "--max-tur",
] as const;
const BOOLEAN_FLAGS = ["--sedzia", "--powtorz-niewazne", "--wykonaj"] as const;

const CASE_GROUPS: Record<string, readonly string[]> = {
  // Wariant minimalny (D13): BUILD 01 do 04, EVAL 01 do 04 i scenariusze S1 do S5.
  minimalny: [
    "BUILD-01", "BUILD-02", "BUILD-03", "BUILD-04",
    "EVAL-01", "EVAL-02", "EVAL-03", "EVAL-04",
    "CHAT-S1", "CHAT-S2", "CHAT-S3", "CHAT-S4", "CHAT-S5",
  ],
  wszystkie: ALL_CASES.map((c) => c.id),
};

function parseInteger(value: string, flag: string, min: number, max: number, errors: string[]): number | undefined {
  if (!/^\d+$/.test(value)) {
    errors.push(`${flag}: oczekiwana liczba całkowita (podano „${value}”).`);
    return undefined;
  }
  const n = Number(value);
  if (n < min || n > max) {
    errors.push(`${flag}: wartość poza zakresem ${min} do ${max}.`);
    return undefined;
  }
  return n;
}

export function parseEvalArgs(argv: readonly string[], env: Record<string, string | undefined> = {}): ParseArgsResult {
  const errors: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((BOOLEAN_FLAGS as readonly string[]).includes(arg)) {
      flags.add(arg);
    } else if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        errors.push(`${arg}: brak wartości.`);
      } else {
        values.set(arg, next);
        i += 1;
      }
    } else {
      errors.push(`Nieznany argument: ${arg}.`);
    }
  }

  const seriesId = values.get("--serie") ?? "";
  if (!seriesId) {
    errors.push("--serie: wymagany identyfikator serii (np. PILOT-1).");
  } else if (!isValidSeriesId(seriesId)) {
    errors.push("--serie: litery, cyfry i myślniki, 1 do 24 znaków, bez myślnika na początku.");
  }

  const caseIds: string[] = [];
  const rawCases = values.get("--przypadki");
  if (!rawCases) {
    errors.push("--przypadki: wymagana lista identyfikatorów (np. BUILD-01,EVAL-02) albo „minimalny” lub „wszystkie”.");
  } else {
    const requested = rawCases.split(",").map((part) => part.trim()).filter(Boolean);
    const expanded = requested.flatMap((part) => CASE_GROUPS[part.toLowerCase()] ?? [part]);
    for (const id of expanded) {
      if (!ALL_CASES.some((c) => c.id === id)) {
        errors.push(`--przypadki: nieznany przypadek „${id}”.`);
      } else if (!caseIds.includes(id)) {
        caseIds.push(id);
      }
    }
    caseIds.sort((a, b) => ALL_CASES.findIndex((c) => c.id === a) - ALL_CASES.findIndex((c) => c.id === b));
    if (caseIds.includes("CHAT-S5") && !caseIds.includes("CHAT-S3")) {
      errors.push("--przypadki: CHAT-S5 kontynuuje rozmowę z CHAT-S3, więc wymaga go na liście.");
    }
  }

  const models: string[] = [];
  const rawModels = values.get("--modele") ?? env.LLM_MODEL ?? "";
  if (!rawModels.trim()) {
    errors.push("--modele: podaj model (albo ustaw LLM_MODEL w konfiguracji).");
  }
  for (const model of rawModels.split(",").map((m) => m.trim()).filter(Boolean)) {
    if (!ALLOWED_CHAT_MODELS.includes(model)) {
      errors.push(`--modele: model „${model}” spoza dozwolonej listy (${ALLOWED_CHAT_MODELS.join(", ")}).`);
    } else if (!models.includes(model)) {
      models.push(model);
    }
  }

  const repetitions = values.has("--powtorzenia") ? parseInteger(values.get("--powtorzenia") ?? "", "--powtorzenia", 1, 10, errors) : 1;
  const pauseMs = values.has("--przerwa-ms") ? parseInteger(values.get("--przerwa-ms") ?? "", "--przerwa-ms", 0, 600_000, errors) : 0;
  const maxOutputTokens = values.has("--max-wyjscia")
    ? parseInteger(values.get("--max-wyjscia") ?? "", "--max-wyjscia", 100, 32_000, errors)
    : undefined;
  const maxOutputTokensLong = values.has("--max-wyjscia-dlugie")
    ? parseInteger(values.get("--max-wyjscia-dlugie") ?? "", "--max-wyjscia-dlugie", 1_000, 32_000, errors)
    : undefined;
  let reasoning: ReasoningLevel | undefined;
  if (values.has("--reasoning")) {
    const raw = values.get("--reasoning") ?? "";
    if (raw === "provider-default") {
      reasoning = undefined;
    } else if ((REASONING_LEVELS as readonly string[]).includes(raw)) {
      reasoning = raw as ReasoningLevel;
    } else {
      errors.push(`--reasoning: dozwolone ${REASONING_LEVELS.join(", ")} albo provider-default (podano „${raw}”).`);
    }
  }
  const maxTurns = values.has("--max-tur") ? parseInteger(values.get("--max-tur") ?? "", "--max-tur", 1, 10_000, errors) : undefined;

  let maxCostUsd: number | undefined;
  if (values.has("--max-koszt-usd")) {
    const raw = values.get("--max-koszt-usd") ?? "";
    const n = Number(raw);
    if (!/^\d+(\.\d+)?$/.test(raw) || !(n > 0) || n > 1000) {
      errors.push("--max-koszt-usd: oczekiwana dodatnia liczba w USD, do 1000 (np. 0.10).");
    } else {
      maxCostUsd = n;
    }
  }

  const execute = flags.has("--wykonaj");
  if (execute && maxCostUsd === undefined) {
    errors.push("--wykonaj wymaga jawnego --max-koszt-usd (bezpiecznik kosztu bieżącego uruchomienia).");
  }
  if (execute && maxTurns === undefined) {
    errors.push("--wykonaj wymaga jawnego --max-tur (bezpiecznik liczby tur bieżącego uruchomienia).");
  }

  if (errors.length > 0 || repetitions === undefined || pauseMs === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    config: {
      seriesId,
      caseIds,
      models,
      repetitions,
      judge: flags.has("--sedzia"),
      maxOutputTokens,
      maxOutputTokensLong,
      reasoning,
      pauseMs,
      retryInvalid: flags.has("--powtorz-niewazne"),
      execute,
      maxCostUsd,
      maxTurns,
    },
  };
}
