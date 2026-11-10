import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, updateMany } = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ prisma: { bmcVariant: { findFirst, updateMany } } }));

import { getMainVariant, saveVariantState } from "@/lib/db/variants";
import { emptyBmcState } from "@/lib/schemas/bmc";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMainVariant", () => {
  const updatedAt = new Date("2026-11-10T10:00:00Z");

  it("zwraca wariant główny ze sparsowanym stanem", async () => {
    const state = { ...emptyBmcState(), channels: ["Sklep online"] };
    findFirst.mockResolvedValue({ id: "v1", name: "Wariant główny", version: 3, updatedAt, state });

    expect(await getMainVariant("p1")).toEqual({ id: "v1", name: "Wariant główny", version: 3, updatedAt, state });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", isMain: true } }));
  });

  it("zwraca null, gdy projekt nie ma wariantu głównego", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getMainVariant("p1")).toBeNull();
  });

  it("rzuca jawny błąd przy uszkodzonym stanie w bazie", async () => {
    findFirst.mockResolvedValue({ id: "v1", name: "W", version: 1, updatedAt, state: { channels: "nie lista" } });

    await expect(getMainVariant("p1")).rejects.toThrow("Niepoprawny stan BMC w wariancie v1");
  });

  it("rzuca jawny błąd, gdy stan nie jest obiektem", async () => {
    findFirst.mockResolvedValue({ id: "v1", name: "W", version: 1, updatedAt, state: "uszkodzony" });

    await expect(getMainVariant("p1")).rejects.toThrow("Niepoprawny stan BMC w wariancie v1");
  });
});

describe("saveVariantState", () => {
  it("zapisuje stan z warunkiem na wersję i podbija wersję", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const state = { ...emptyBmcState(), channels: [" Sklep online "] };

    expect(await saveVariantState("v1", 3, state)).toEqual({ ok: true, version: 4 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "v1", version: 3 },
      data: { state: { ...emptyBmcState(), channels: ["Sklep online"] }, version: { increment: 1 } },
    });
  });

  it("zwraca VERSION_CONFLICT, gdy wersja w bazie jest inna", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    expect(await saveVariantState("v1", 3, emptyBmcState())).toEqual({ ok: false, error: "VERSION_CONFLICT" });
  });

  it("nie zapisuje niepoprawnego stanu", async () => {
    const result = await saveVariantState("v1", 3, { ...emptyBmcState(), channels: [""] });

    expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
