import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BLOCK_KEYS, countEntries } from "@/lib/schemas/bmc";
import { EntryOrigins } from "@/lib/schemas/origin";
import { SEED_COMPANIES } from "./companies";
import { buildEntryOrigins, resolveSeedEmail, runSeed, SeedError, type SeedClient } from "./run-seed";

const EMAIL = "wlasciciel@example.test";

function fakeDb(options: { user?: { id: string } | null; existingNames?: string[] } = {}) {
  const user = options.user === undefined ? { id: "u1" } : options.user;
  const existing = new Set(options.existingNames ?? []);
  const findUnique = vi.fn().mockResolvedValue(user);
  const findFirst = vi.fn(async (args: { where: { name: string } }) =>
    existing.has(args.where.name) ? { id: "p-old" } : null,
  );
  const create = vi.fn().mockResolvedValue({ id: "p-new" });
  const db = { user: { findUnique }, project: { findFirst, create } } as unknown as SeedClient;
  return { db, findUnique, findFirst, create };
}

describe("resolveSeedEmail", () => {
  it("bez zmiennej i bez argumentu zgłasza SeedError po polsku", () => {
    expect(() => resolveSeedEmail({}, [])).toThrow(SeedError);
    expect(() => resolveSeedEmail({ SEED_USER_EMAIL: "  " }, [])).toThrow(/SEED_USER_EMAIL/);
  });

  it("czyta zmienną, a argument --email ma pierwszeństwo; normalizuje wielkość liter", () => {
    expect(resolveSeedEmail({ SEED_USER_EMAIL: " Jan@Example.Test " }, [])).toBe("jan@example.test");
    expect(resolveSeedEmail({ SEED_USER_EMAIL: "a@example.test" }, ["--email", "B@example.test"])).toBe("b@example.test");
  });
});

describe("runSeed", () => {
  it("nieistniejące konto: komunikat i zero zapisów", async () => {
    const { db, create, findFirst } = fakeDb({ user: null });
    const error = await runSeed(db, EMAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SeedError);
    expect((error as SeedError).message).not.toContain(EMAIL);
    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("poprawne konto: tworzy projekt na firmę z właścicielem, wariantem głównym i pochodzeniem MANUAL", async () => {
    const { db, create } = fakeDb();
    const report = await runSeed(db, EMAIL);
    expect(report.created).toEqual(SEED_COMPANIES.map((c) => c.name));
    expect(report.skipped).toEqual([]);
    expect(create).toHaveBeenCalledTimes(SEED_COMPANIES.length);

    const first = create.mock.calls[0][0].data;
    expect(first.name).toBe(SEED_COMPANIES[0].name);
    expect(first.members.create).toEqual({ userId: "u1", role: "OWNER" });
    expect(first.variants.create).toMatchObject({ name: "Wariant główny", isMain: true, createdById: "u1" });
    const origins = EntryOrigins.parse(first.variants.create.entryOrigins);
    expect(origins).toHaveLength(countEntries(SEED_COMPANIES[0].state));
    expect(origins.every((o) => o.kind === "MANUAL" && o.recordedVersion === 1)).toBe(true);
  });

  it("powtórne uruchomienie pomija istniejące projekty bez nadpisywania", async () => {
    const { db, create } = fakeDb({ existingNames: [SEED_COMPANIES[0].name, SEED_COMPANIES[1].name] });
    const report = await runSeed(db, EMAIL);
    expect(report.skipped).toEqual([SEED_COMPANIES[0].name, SEED_COMPANIES[1].name]);
    expect(report.created).toHaveLength(SEED_COMPANIES.length - 2);
    expect(create).toHaveBeenCalledTimes(SEED_COMPANIES.length - 2);
  });

  it("sprawdza istnienie projektu w obrębie konta", async () => {
    const { db, findFirst } = fakeDb();
    await runSeed(db, EMAIL);
    expect(findFirst.mock.calls[0][0]).toMatchObject({ where: { members: { some: { userId: "u1" } } } });
  });

  it("nie tworzy użytkowników ani nie haszuje haseł", () => {
    const source = readFileSync(new URL("./run-seed.ts", import.meta.url), "utf-8");
    const entry = readFileSync(new URL("../../../prisma/seed.ts", import.meta.url), "utf-8");
    for (const text of [source, entry]) {
      expect(text).not.toMatch(/user\.create|user\.upsert|bcrypt|passwordHash/);
    }
  });
});

describe("buildEntryOrigins", () => {
  it("zwraca po jednym wpisie pochodzenia na każdy wpis modelu, w kolejności bloków", () => {
    const company = SEED_COMPANIES[0];
    const origins = buildEntryOrigins(company);
    const expected = BLOCK_KEYS.flatMap((key) => company.state[key].map((text) => ({ blockKey: key, text })));
    expect(origins.map(({ blockKey, text }) => ({ blockKey, text }))).toEqual(expected);
  });
});
