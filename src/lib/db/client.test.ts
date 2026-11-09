import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PrismaPgMock, PrismaClientMock } = vi.hoisted(() => ({
  PrismaPgMock: vi.fn(),
  PrismaClientMock: vi.fn(),
}));

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: PrismaPgMock }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: PrismaClientMock }));

const globalForPrisma = globalThis as unknown as { prisma?: unknown };

describe("klient Prisma", () => {
  beforeEach(() => {
    vi.resetModules();
    PrismaPgMock.mockClear();
    PrismaClientMock.mockClear();
    delete globalForPrisma.prisma;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete globalForPrisma.prisma;
  });

  it("rzuca czytelny błąd, gdy brak DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");

    await expect(import("@/lib/db/client")).rejects.toThrow("DATABASE_URL");
    expect(PrismaClientMock).not.toHaveBeenCalled();
  });

  it("tworzy klienta z adapterem pg i używa go ponownie po przeładowaniu modułu", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5433/db");

    const first = await import("@/lib/db/client");
    vi.resetModules();
    const second = await import("@/lib/db/client");

    expect(PrismaPgMock).toHaveBeenCalledOnce();
    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: "postgresql://u:p@localhost:5433/db",
    });
    expect(PrismaClientMock).toHaveBeenCalledOnce();
    expect(second.prisma).toBe(first.prisma);
  });
});
