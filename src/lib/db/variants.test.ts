import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, findUnique, updateMany } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: { bmcVariant: { findFirst, findUnique, updateMany } } }));

import { getMainVariant, getVariantForProject, getVariantProjectId, saveVariantState } from "@/lib/db/variants";
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

describe("getVariantProjectId", () => {
  it("zwraca projekt wariantu albo null", async () => {
    findUnique.mockResolvedValueOnce({ projectId: "p1" }).mockResolvedValueOnce(null);

    expect(await getVariantProjectId("v1")).toBe("p1");
    expect(await getVariantProjectId("v404")).toBeNull();
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "v1" }, select: { projectId: true } });
  });
});

describe("saveVariantState: zapis stanu i pochodzenia wpisów (krok 9)", () => {
  const oldState = { ...emptyBmcState(), channels: ["Sklep online", "Targi"], revenue_streams: ["Subskrypcja"] };
  const proposalOrigin = {
    blockKey: "channels",
    text: "Targi",
    kind: "PROPOSAL",
    proposalId: "pr1",
    sourceKind: "CONVERSATION",
    recordedVersion: 2,
  };

  function current(overrides: Record<string, unknown> = {}) {
    return { version: 3, state: oldState, entryOrigins: [proposalOrigin], ...overrides };
  }

  beforeEach(() => {
    findFirst.mockResolvedValue(current());
    updateMany.mockResolvedValue({ count: 1 });
  });

  it("zapisuje stan z warunkiem na wersję, podbija wersję i zapisuje pochodzenie tym samym UPDATE", async () => {
    const state = { ...oldState, channels: ["Sklep online", "Targi", " Social media "] };

    expect(await saveVariantState("v1", 3, state)).toEqual({ ok: true, version: 4 });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "v1", version: 3 },
      data: {
        state: { ...oldState, channels: ["Sklep online", "Targi", "Social media"] },
        // „Targi” zachowuje pochodzenie z propozycji, „Social media” (nowy wpis) jest ręczne, „Sklep online” sprzed kroku 9 bez zapisu.
        entryOrigins: [proposalOrigin, { blockKey: "channels", text: "Social media", kind: "MANUAL", recordedVersion: 4 }],
        version: { increment: 1 },
      },
    });
  });

  it("odczytuje stary stan po id wariantu (z wersją i pochodzeniem) przed zapisem", async () => {
    await saveVariantState("v1", 3, oldState);

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "v1" },
      select: { version: true, state: true, entryOrigins: true },
    });
    expect(findFirst.mock.invocationCallOrder[0]).toBeLessThan(updateMany.mock.invocationCallOrder[0]);
  });

  it("niezmienione wpisy sprzed kroku 9 nie dostają pochodzenia „ręczny” (zostają bez zapisu)", async () => {
    findFirst.mockResolvedValue(current({ entryOrigins: [] }));

    await saveVariantState("v1", 3, oldState);

    expect(updateMany.mock.calls[0][0].data.entryOrigins).toEqual([]);
  });

  it("edycja tekstu wpisu z propozycji to nowy wpis „ręczny”, a pochodzenie starego tekstu znika", async () => {
    const state = { ...oldState, channels: ["Sklep online", "Targi lokalne"] };

    await saveVariantState("v1", 3, state);

    expect(updateMany.mock.calls[0][0].data.entryOrigins).toEqual([
      { blockKey: "channels", text: "Targi lokalne", kind: "MANUAL", recordedVersion: 4 },
    ]);
  });

  it("usunięcie wpisu usuwa jego pochodzenie", async () => {
    await saveVariantState("v1", 3, { ...oldState, channels: ["Sklep online"] });

    expect(updateMany.mock.calls[0][0].data.entryOrigins).toEqual([]);
  });

  it("uszkodzone pochodzenie w bazie nie wywraca zapisu: jest zastępowane (tylko nowe wpisy ręczne)", async () => {
    findFirst.mockResolvedValue(current({ entryOrigins: { to: "nie lista" } }));

    expect(await saveVariantState("v1", 3, { ...oldState, key_resources: ["Ekspres"] })).toEqual({ ok: true, version: 4 });
    expect(updateMany.mock.calls[0][0].data.entryOrigins).toEqual([
      { blockKey: "key_resources", text: "Ekspres", kind: "MANUAL", recordedVersion: 4 },
    ]);
  });

  it("nieczytelny stary stan: wszystkie wpisy zapisanego stanu są traktowane jako nowe (ręczne)", async () => {
    findFirst.mockResolvedValue(current({ state: { channels: "nie lista" }, entryOrigins: [] }));

    await saveVariantState("v1", 3, { ...emptyBmcState(), channels: ["Sklep online"] });

    expect(updateMany.mock.calls[0][0].data.entryOrigins).toEqual([
      { blockKey: "channels", text: "Sklep online", kind: "MANUAL", recordedVersion: 4 },
    ]);
  });

  it("inna wersja w bazie przy odczycie: VERSION_CONFLICT bez zapisu", async () => {
    findFirst.mockResolvedValue(current({ version: 5 }));

    expect(await saveVariantState("v1", 3, oldState)).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("wariant nie istnieje: VERSION_CONFLICT bez zapisu", async () => {
    findFirst.mockResolvedValue(null);

    expect(await saveVariantState("v1", 3, oldState)).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("wyścig po odczycie (updateMany count 0): VERSION_CONFLICT, pochodzenie nie zostaje zapisane osobno", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    expect(await saveVariantState("v1", 3, oldState)).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("nie zapisuje niepoprawnego stanu i nie czyta bazy", async () => {
    const result = await saveVariantState("v1", 3, { ...emptyBmcState(), channels: [""] });

    expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(findFirst).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("getVariantForProject", () => {
  it("szuka wariantu po id i projectId jednym zapytaniem", async () => {
    const state = { ...emptyBmcState(), channels: ["Sklep online"] };
    findFirst.mockResolvedValue({ id: "v1", version: 4, state });

    expect(await getVariantForProject("p1", "v1")).toEqual({ id: "v1", version: 4, state });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "v1", projectId: "p1" } }));
  });

  it("zwraca null dla wariantu z innego projektu", async () => {
    findFirst.mockResolvedValue(null);

    expect(await getVariantForProject("p1", "v-obcy")).toBeNull();
  });

  it("rzuca jawny błąd dla uszkodzonego stanu", async () => {
    findFirst.mockResolvedValue({ id: "v1", version: 1, state: { channels: "nie lista" } });

    await expect(getVariantForProject("p1", "v1")).rejects.toThrow("Niepoprawny stan BMC");
  });
});
