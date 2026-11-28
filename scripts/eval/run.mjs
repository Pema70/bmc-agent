// Skrypt ewaluacji agenta (krok 10, PR 10f). Uruchamia WYŁĄCZNIE właściciel: `npm run eval -- <argumenty>`.
// Zmienne środowiskowe (klucze API, DATABASE_URL, EVAL_USER_EMAIL) trafiają do procesu przez `node --env-file=.env` w skrypcie
// npm; ten plik sam niczego nie czyta z pliku .env i nigdy nie drukuje kluczy ani adresu e-mail.
// Domyślnie TRYB NA SUCHO (bez wywołań modelu i bez zapisu); prawdziwy przebieg wymaga --wykonaj, --max-koszt-usd i --max-tur.
//
// Kody wyjścia: 0 = zakończono (lub tryb na sucho), 1 = nieoczekiwany błąd, 2 = odmowa startu (argumenty, zamrożenie zestawu,
// konto, konfiguracja modelu), 3 = przerwano (bezpiecznik kosztu lub tur, Ctrl+C), 4 = błąd krytyczny w trakcie (konfiguracja, klucz).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") }, interopDefault: true });
const load = (path) => jiti.import(resolve(root, "src", path));

const EXIT = { OK: 0, ERROR: 1, REFUSED: 2, STOPPED: 3, FATAL: 4 };

const USAGE = [
  "Użycie: npm run eval -- --serie <ID> --przypadki <lista|minimalny|wszystkie> --modele <lista> [opcje]",
  "  --powtorzenia N   --sedzia   --max-wyjscia N   --max-wyjscia-dlugie N   --przerwa-ms N   --powtorz-niewazne",
  "  --wykonaj --max-koszt-usd X --max-tur N   (prawdziwy przebieg; bez --wykonaj jest tryb na sucho)",
  "Szczegóły: scripts/eval/README.md",
].join("\n");

/** Zamienia w tekście wartości wrażliwych zmiennych (klucze, adresy, e-maile) na „[ukryte]”, zanim trafi do wyjścia. */
function redact(text) {
  let out = String(text);
  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && /KEY|URL|SECRET|PASSWORD|TOKEN|EMAIL/i.test(key)) {
      out = out.split(value).join("[ukryte]");
    }
  }
  return out;
}

async function main() {
  const { parseEvalArgs } = await load("lib/eval/args");
  const parsed = parseEvalArgs(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    for (const error of parsed.errors) console.error(`Błąd argumentów: ${error}`);
    console.error(`\n${USAGE}`);
    return EXIT.REFUSED;
  }
  const { config } = parsed;

  // Limity użytkownika podnosimy w procesie skryptu przed załadowaniem reszty aplikacji (runner robi to też, idempotentnie).
  if (config.execute) {
    const { applyScriptLimitOverrides } = await load("lib/eval/script-limits");
    applyScriptLimitOverrides(process.env);
  }

  const [{ createEvalDb }, { runEval }, { prepareChatTurnWithoutUserLimits }, { runChatTurn }, proposals, evaluate, judge, impact, models, client] =
    await Promise.all([
      load("lib/eval/db"),
      load("lib/eval/run-eval"),
      load("lib/ai/chat-agent-script"),
      load("lib/ai/chat-agent"),
      load("lib/db/proposals"),
      load("lib/ai/evaluate"),
      load("lib/ai/judge"),
      load("lib/ai/impact"),
      load("lib/ai/models"),
      load("lib/db/client"),
    ]);

  // Ctrl+C: pierwsze przerywa bieżący krok i kończy serię (STOPPED / USER_ABORT), drugie wymusza natychmiastowe wyjście.
  const controller = new AbortController();
  let interrupts = 0;
  process.on("SIGINT", () => {
    interrupts += 1;
    if (interrupts === 1) {
      console.log("\nCtrl+C: przerywam bieżący krok i kończę przebieg. Ponowne Ctrl+C wymusza natychmiastowe wyjście.");
      controller.abort();
    } else {
      process.exit(130);
    }
  });

  const deps = {
    db: createEvalDb(),
    env: process.env,
    userEmail: process.env.EVAL_USER_EMAIL,
    prepareTurn: prepareChatTurnWithoutUserLimits,
    runTurn: runChatTurn,
    acceptProposal: proposals.acceptProposal,
    runEvaluation: evaluate.runEvaluation,
    runJudge: judge.runJudge,
    runImpact: impact.runImpactAnalysis,
    checkModelConfig: (env, name) => {
      models.loadModelConfig(env, name);
    },
    log: (line) => console.log(redact(line)),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    signal: controller.signal,
  };

  try {
    const summary = await runEval(config, deps);
    switch (summary.outcome) {
      case "REFUSED":
        return EXIT.REFUSED;
      case "STOPPED":
        return EXIT.STOPPED;
      case "FATAL":
        return EXIT.FATAL;
      default:
        return EXIT.OK;
    }
  } finally {
    await client.prisma.$disconnect();
  }
}

main()
  .then((code) => {
    console.log(`Kod wyjścia: ${code}`);
    process.exit(code);
  })
  .catch((error) => {
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(redact(`Nieoczekiwany błąd (${name}): ${message}`));
    console.log(`Kod wyjścia: ${EXIT.ERROR}`);
    process.exit(EXIT.ERROR);
  });
