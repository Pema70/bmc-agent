import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  txFindFirst: vi.fn(),
  txFindMany: vi.fn(),
  txCreate: vi.fn(),
  txUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    bmcVariant: { findMany: m.findMany, findFirst: m.findFirst, updateMany: m.updateMany },
    $transaction: m.transaction,
  },
}));

import {
  createVariant,
  getVariantDetails,
  listVariants,
  renameVariant,
  setMainVariant,
} from "@/lib/db/variants";
import { emptyBmcState } from "@/lib/schemas/bmc";

const tx = {
  $queryRaw: m.queryRaw,
  bmcVariant: { findFirst: m.txFindFirst, findMany: m.txFindMany, create: m.txCreate, updateMany: m.txUpdateMany },
};

const stateWithEntries = { ...emptyBmcState(), channels: ["Sklep online", "Social media"], revenue_streams: ["Subskrypcja"] };
const now = new Date("2026-11-16T10:00:00Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    name: "Wariant główny",
    isMain: true,
    origin: "MANUAL",
    description: null,
    version: 3,
    createdAt: now,
    updatedAt: now,
    state: stateWithEntries,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
});

describe("listVariants", () => {
  it("czyta po projectId, zwraca liczbę wpisów i nie zwraca stanu", async () => {
    m.findMany.mockResolvedValue([row(), row({ id: "v2", name: "Kopia", isMain: false, state: emptyBmcState() })]);

    const result = await listVariants("p1");

    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1" } }));
    expect(result.map((item) => [item.id, item.entryCount])).toEqual([["v1", 3], ["v2", 0]]);
    expect(result[0]).not.toHaveProperty("state");
  });

  it("uszkodzony stan jednego wariantu nie psuje listy: entryCount null", async () => {
    m.findMany.mockResolvedValue([row({ state: { channels: "nie lista" } })]);

    const result = await listVariants("p1");

    expect(result[0]).toMatchObject({ id: "v1", entryCount: null });
  });
});

describe("getVariantDetails", () => {
  it("czyta po id ORAZ projectId i zwraca sparsowany stan", async () => {
    m.findFirst.mockResolvedValue(row());

    const result = await getVariantDetails("p1", "v1");

    expect(m.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "v1", projectId: "p1" } }));
    expect(result).toMatchObject({ id: "v1", name: "Wariant główny", version: 3, state: stateWithEntries });
  });

  it("zwraca null dla wariantu z innego projektu", async () => {
    m.findFirst.mockResolvedValue(null);
    expect(await getVariantDetails("p-obcy", "v1")).toBeNull();
  });

  it("uszkodzony stan to jawny wyjątek", async () => {
    m.findFirst.mockResolvedValue(row({ state: "uszkodzony" }));
    await expect(getVariantDetails("p1", "v1")).rejects.toThrow("Niepoprawny stan BMC w wariancie v1");
  });
});

describe("createVariant", () => {
  const args = { projectId: "p1", sourceVariantId: "v1", createdById: "u1", maxVariants: 10 };

  function setup(existingNames = ["Wariant główny"]) {
    m.queryRaw.mockResolvedValue([{ id: "p1" }]);
    m.txFindFirst.mockResolvedValue({ id: "v1", name: "Wariant główny", state: stateWithEntries });
    m.txFindMany.mockResolvedValue(existingNames.map((name) => ({ name })));
    m.txCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ id: "v-nowy", name: data.name, isMain: false, version: 1, state: data.state }),
    );
  }

  it("kopiuje stan zapisanego wariantu z bazy i nadaje nazwę „(kopia)” na serwerze", async () => {
    setup();

    const result = await createVariant(args);

    expect(m.txFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "v1", projectId: "p1" } }));
    expect(m.txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: "p1",
          name: "Wariant główny (kopia)",
          isMain: false,
          state: stateWithEntries,
          origin: "MANUAL",
          createdById: "u1",
        },
      }),
    );
    expect(result).toMatchObject({ ok: true, variant: { id: "v-nowy", name: "Wariant główny (kopia)", isMain: false, version: 1, entryCount: 3 } });
  });

  it("numeruje kolejne kopie", async () => {
    setup(["Wariant główny", "Wariant główny (kopia)"]);

    await createVariant(args);

    expect(m.txCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: "Wariant główny (kopia 2)" }) }));
  });

  it("blokuje wiersz projektu przed policzeniem wariantów i utworzeniem kopii", async () => {
    setup();
    const order: string[] = [];
    m.queryRaw.mockImplementation(async () => (order.push("blokada"), [{ id: "p1" }]));
    m.txFindMany.mockImplementation(async () => (order.push("liczenie"), [{ name: "W" }]));
    m.txCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      order.push("zapis");
      return row({ id: "v-nowy", name: data.name, state: data.state });
    });

    await createVariant(args);

    expect(order).toEqual(["blokada", "liczenie", "zapis"]);
  });

  it("limit wariantów: LIMIT bez zapisu", async () => {
    setup(Array.from({ length: 10 }, (_, i) => `W${i}`));

    const result = await createVariant(args);

    expect(result).toEqual({ ok: false, error: "LIMIT" });
    expect(m.txCreate).not.toHaveBeenCalled();
  });

  it("wariant źródłowy z innego projektu lub brak projektu: NOT_FOUND bez zapisu", async () => {
    setup();
    m.txFindFirst.mockResolvedValue(null);
    expect(await createVariant(args)).toEqual({ ok: false, error: "NOT_FOUND" });

    m.queryRaw.mockResolvedValue([]);
    expect(await createVariant(args)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.txCreate).not.toHaveBeenCalled();
  });

  it("uszkodzony stan źródła: jawny wyjątek, bez zapisu", async () => {
    setup();
    m.txFindFirst.mockResolvedValue({ id: "v1", name: "W", state: { channels: 5 } });

    await expect(createVariant(args)).rejects.toThrow("Niepoprawny stan BMC w wariancie v1");
    expect(m.txCreate).not.toHaveBeenCalled();
  });
});

describe("renameVariant", () => {
  it("zmienia tylko nazwę, po id i projectId, bez ruszania version", async () => {
    m.updateMany.mockResolvedValue({ count: 1 });

    expect(await renameVariant("p1", "v1", "Nowa nazwa")).toEqual({ ok: true });
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: "v1", projectId: "p1" }, data: { name: "Nowa nazwa" } });
  });

  it("cudzy wariant: NOT_FOUND", async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    expect(await renameVariant("p-obcy", "v1", "X")).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

describe("setMainVariant", () => {
  const threeVariants = [
    { id: "v1", isMain: true },
    { id: "v2", isMain: false },
    { id: "v3", isMain: false },
  ];

  beforeEach(() => {
    m.queryRaw.mockResolvedValue(threeVariants);
    m.txUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("zamiana atomowa w jednej transakcji: najpierw zdejmuje isMain ze starego, potem ustawia nowemu", async () => {
    const result = await setMainVariant("p1", "v2", "v1");

    expect(result).toEqual({ ok: true, mainVariantId: "v2", changed: true });
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.txUpdateMany.mock.calls).toEqual([
      [{ where: { id: "v1", projectId: "p1" }, data: { isMain: false } }],
      [{ where: { id: "v2", projectId: "p1" }, data: { isMain: true } }],
    ]);
  });

  it("zmiana głównego nie dotyka version ani stanu", async () => {
    await setMainVariant("p1", "v2", "v1");

    for (const [call] of m.txUpdateMany.mock.calls) {
      expect(Object.keys(call.data)).toEqual(["isMain"]);
    }
  });

  it("czyta i blokuje warianty wyłącznie wskazanego projektu", async () => {
    await setMainVariant("p1", "v2", "v1");

    const [strings, ...values] = m.queryRaw.mock.calls[0];
    expect(strings.join("?")).toContain('FROM "BmcVariant" WHERE "projectId" = ?');
    expect(strings.join("?")).toContain("FOR UPDATE");
    expect(values).toEqual(["p1"]);
  });

  it("niezgodny expectedMainId: CONFLICT bez zmian", async () => {
    const result = await setMainVariant("p1", "v2", "v3");

    expect(result).toEqual({ ok: false, error: "CONFLICT" });
    expect(m.txUpdateMany).not.toHaveBeenCalled();
  });

  it("projekt bez głównego (legacy): expectedMainId null ustawia głównego bez zdejmowania", async () => {
    m.queryRaw.mockResolvedValue([
      { id: "v1", isMain: false },
      { id: "v2", isMain: false },
    ]);

    expect(await setMainVariant("p1", "v2", null)).toEqual({ ok: true, mainVariantId: "v2", changed: true });
    expect(m.txUpdateMany.mock.calls).toEqual([[{ where: { id: "v2", projectId: "p1" }, data: { isMain: true } }]]);
    expect(await setMainVariant("p1", "v2", "v1")).toEqual({ ok: false, error: "CONFLICT" });
  });

  it("wariant już główny: brak zmian, changed false", async () => {
    const result = await setMainVariant("p1", "v1", "v1");

    expect(result).toEqual({ ok: true, mainVariantId: "v1", changed: false });
    expect(m.txUpdateMany).not.toHaveBeenCalled();
  });

  it("wariant spoza projektu (brak wśród zablokowanych): NOT_FOUND, także gdy expectedMainId się zgadza", async () => {
    const result = await setMainVariant("p1", "v-obcy", "v1");

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.txUpdateMany).not.toHaveBeenCalled();
  });

  it("po operacji dokładnie jeden wariant ma isMain (symulacja stanu bazy)", async () => {
    const db = new Map(threeVariants.map((variant) => [variant.id, variant.isMain]));
    m.txUpdateMany.mockImplementation(async ({ where, data }: { where: { id: string }; data: { isMain: boolean } }) => {
      db.set(where.id, data.isMain);
      return { count: 1 };
    });

    await setMainVariant("p1", "v3", "v1");

    expect([...db.values()].filter(Boolean)).toHaveLength(1);
    expect(db.get("v3")).toBe(true);
  });
});
