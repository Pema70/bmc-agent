import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { SeedError, resolveSeedEmail, runSeed } from "../src/lib/seed/run-seed";

// Uruchomienie (właściciel): SEED_USER_EMAIL=<e-mail konta> npx --no-install prisma db seed
// DATABASE_URL pochodzi z .env ładowanego przez prisma.config.ts; sam skrypt niczego nie czyta z pliku.

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new SeedError("Brak zmiennej DATABASE_URL (patrz .env.example).");
  }
  const email = resolveSeedEmail(process.env, process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const report = await runSeed(prisma, email);
    for (const name of report.created) console.log(`Utworzono projekt: ${name}`);
    for (const name of report.skipped) console.log(`Pominięto (już istnieje): ${name}`);
    console.log(`Gotowe: utworzono ${report.created.length}, pominięto ${report.skipped.length}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof SeedError ? error.message : `Seed nie powiódł się: ${String(error)}`);
  process.exitCode = 1;
});
