// Sprawdza, czy skrypty ewaluacji (krok 10, PR 10f) da się uruchomić poza Next.js: rejestruje `jiti` z aliasem `@` na `src`
// i importuje prawdziwy łańcuch modułów agenta. Niczego nie wywołuje: bez modelu, bez zapytań do bazy, bez ładowania `.env`
// (zmienne środowiskowe tylko z powłoki). Uruchomienie: npm run eval:importy
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Klient Prismy tworzy się przy imporcie, ale połączenie otwiera dopiero przy pierwszym zapytaniu; adres jest fikcyjny.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://sprawdzenie:sprawdzenie@127.0.0.1:1/sprawdzenie";
}

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") }, interopDefault: true });

const modules = [
  "@/lib/db/client",
  "@/lib/ai/models",
  "@/lib/ai/config",
  "@/lib/ai/limits",
  "@/lib/ai/run-object-operation",
  "@/lib/ai/tools",
  "@/lib/ai/chat-agent",
  "@/lib/ai/chat-agent-script",
  "@/lib/eval/script-limits",
  "@/lib/eval/cases",
  "@/lib/eval/args",
  "@/lib/eval/estimate",
  "@/lib/eval/budget",
  "@/lib/eval/db",
  "@/lib/eval/run-eval",
];

let failed = 0;
for (const name of modules) {
  try {
    const loaded = await jiti.import(name.replace("@/", resolve(root, "src") + "/"));
    console.log(`OK     ${name} (eksporty: ${Object.keys(loaded).length})`);
  } catch (error) {
    failed += 1;
    console.log(`BŁĄD   ${name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

if (failed > 0) {
  console.log(`\nImporty: ${failed} z ${modules.length} zakończyło się błędem.`);
  process.exit(1);
}
console.log(`\nImporty: wszystkie ${modules.length} modułów załadowane (bez wywołań modelu i bazy).`);
// Klient Prismy z adapterem może zostawić otwarte uchwyty; kończymy jawnie.
process.exit(0);
