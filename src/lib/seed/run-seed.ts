import type { PrismaClient } from "../../generated/prisma/client";
import { BLOCK_KEYS } from "../schemas/bmc";
import type { EntryOrigin } from "../schemas/origin";
import { SEED_COMPANIES, type SeedCompany } from "./companies";

// Importy względne (bez aliasu @/): moduł uruchamia skrypt prisma/seed.ts poza Next.js i Vitestem.

export const SEED_EMAIL_ENV = "SEED_USER_EMAIL";
const MAIN_VARIANT_NAME = "Wariant główny";

export type SeedClient = Pick<PrismaClient, "user" | "project">;

export type SeedReport = { created: string[]; skipped: string[] };

/** Błąd, po którym seed niczego nie zapisał; komunikat jest po polsku i nie zawiera adresu e-mail. */
export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedError";
  }
}

export function resolveSeedEmail(env: Readonly<Record<string, string | undefined>>, argv: readonly string[]): string {
  const flagIndex = argv.indexOf("--email");
  const fromArgs = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  const email = (fromArgs ?? env[SEED_EMAIL_ENV] ?? "").trim().toLowerCase();
  if (!email) {
    throw new SeedError(
      `Brak adresu konta. Ustaw zmienną ${SEED_EMAIL_ENV} (albo przekaż --email po "--") na e-mail istniejącego konta; seed nie zakłada kont.`,
    );
  }
  return email;
}

export function buildEntryOrigins(company: SeedCompany): EntryOrigin[] {
  return BLOCK_KEYS.flatMap((blockKey) =>
    company.state[blockKey].map((text) => ({ blockKey, text, kind: "MANUAL" as const, recordedVersion: 1 })),
  );
}

/**
 * Tworzy projekty przykładowe na istniejącym koncie. Idempotentny per konto: projekt o tej samej nazwie, którego
 * członkiem jest konto, jest pomijany (bez nadpisywania). Niczego nie kasuje, nie zakłada kont i nie ustawia haseł.
 */
export async function runSeed(
  db: SeedClient,
  email: string,
  companies: readonly SeedCompany[] = SEED_COMPANIES,
): Promise<SeedReport> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    throw new SeedError("Nie znaleziono konta o podanym adresie. Zarejestruj konto w aplikacji i uruchom seed ponownie.");
  }

  const report: SeedReport = { created: [], skipped: [] };
  for (const company of companies) {
    const existing = await db.project.findFirst({
      where: { name: company.name, members: { some: { userId: user.id } } },
      select: { id: true },
    });
    if (existing) {
      report.skipped.push(company.name);
      continue;
    }
    await db.project.create({
      data: {
        name: company.name,
        description: company.description,
        members: { create: { userId: user.id, role: "OWNER" } },
        variants: {
          create: {
            name: MAIN_VARIANT_NAME,
            isMain: true,
            state: company.state,
            entryOrigins: buildEntryOrigins(company),
            createdById: user.id,
          },
        },
      },
      select: { id: true },
    });
    report.created.push(company.name);
  }
  return report;
}
