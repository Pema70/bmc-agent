import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  txProposal: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  txVariant: { findFirst: vi.fn(), updateMany: vi.fn() },
  queryRaw: vi.fn(),
  prismaProposal: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  prismaVariant: { findFirst: vi.fn(), updateMany: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    proposal: m.prismaProposal,
    bmcVariant: m.prismaVariant,
    $transaction: m.transaction,
  },
}));

import {
  acceptProposal,
  createProposal,
  findProposalInVariant,
  listProposalsForVariant,
  rejectProposal,
} from "@/lib/db/proposals";
import { emptyBmcState } from "@/lib/schemas/bmc";

const tx = { proposal: m.txProposal, bmcVariant: m.txVariant, $queryRaw: m.queryRaw };

const state = { ...emptyBmcState(), channels: ["Sklep online"] };
const row = {
  id: "pr1",
  variantId: "v1",
  blockKey: "channels",
  operation: "ADD" as const,
  before: null,
  after: "Targi",
  rationale: "Klienci bywają na targach.",
  status: "PENDING" as const,
  baseVersion: 3,
  createdAt: new Date("2026-11-11T10:00:00Z"),
};
const args = { projectId: "p1", variantId: "v1", proposalId: "pr1", expectedVersion: 3, userId: "u1" };

function expectNoWritesOutsideTransaction() {
  expect(m.prismaProposal.create).not.toHaveBeenCalled();
  expect(m.prismaProposal.updateMany).not.toHaveBeenCalled();
  expect(m.prismaVariant.updateMany).not.toHaveBeenCalled();
}

function expectNoTransactionWrites() {
  expect(m.txVariant.updateMany).not.toHaveBeenCalled();
  expect(m.txProposal.updateMany).not.toHaveBeenCalled();
  expect(m.txProposal.create).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  m.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  m.txProposal.findFirst.mockResolvedValue(row);
  m.txVariant.findFirst.mockResolvedValue({ version: 3, state });
  m.txVariant.updateMany.mockResolvedValue({ count: 1 });
  m.txProposal.updateMany.mockResolvedValue({ count: 1 });
});

describe("createProposal", () => {
  const change = {
    blockKey: "channels" as const,
    operation: "add" as const,
    before: null,
    after: "Targi",
    rationale: "Klienci bywają na targach.",
  };
  const createArgs = { projectId: "p1", variantId: "v1", createdById: "u1", baseVersion: 3, change };

  beforeEach(() => {
    m.queryRaw.mockResolvedValue([{ id: "v1" }]);
    m.txProposal.findMany.mockResolvedValue([]);
    m.txProposal.create.mockResolvedValue(row);
  });

  it("blokuje wiersz wariantu z projektu i tworzy propozycję PENDING w jednej transakcji", async () => {
    const result = await createProposal(createArgs, 20);

    expect(result).toMatchObject({ ok: true, proposal: { id: "pr1", operation: "add", status: "PENDING" } });
    expect(m.queryRaw).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(m.queryRaw.mock.calls[0])).toContain("FOR UPDATE");
    expect(m.queryRaw.mock.calls[0].slice(1)).toEqual(["v1", "p1"]);
    expect(m.txProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          variantId: "v1",
          blockKey: "channels",
          operation: "ADD",
          before: null,
          after: "Targi",
          baseVersion: 3,
          createdById: "u1",
        }),
      }),
    );
    expectNoWritesOutsideTransaction();
  });

  it("wariant spoza projektu: NOT_FOUND i brak zapisu", async () => {
    m.queryRaw.mockResolvedValue([]);

    expect(await createProposal(createArgs, 20)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.txProposal.create).not.toHaveBeenCalled();
  });

  it("egzekwuje limit oczekujących propozycji na wariant po stronie serwera", async () => {
    m.txProposal.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ blockKey: "channels", operation: "ADD", before: null, after: `Wpis ${i}` })),
    );

    expect(await createProposal(createArgs, 20)).toEqual({ ok: false, error: "LIMIT" });
    expect(m.txProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { variantId: "v1", status: "PENDING" } }));
    expect(m.txProposal.create).not.toHaveBeenCalled();
  });

  it("dopuszcza propozycję tuż poniżej limitu", async () => {
    m.txProposal.findMany.mockResolvedValue(
      Array.from({ length: 19 }, (_, i) => ({ blockKey: "channels", operation: "ADD", before: null, after: `Wpis ${i}` })),
    );

    expect((await createProposal(createArgs, 20)).ok).toBe(true);
  });

  it("odrzuca identyczną oczekującą propozycję", async () => {
    m.txProposal.findMany.mockResolvedValue([{ blockKey: "channels", operation: "ADD", before: null, after: "Targi" }]);

    expect(await createProposal(createArgs, 20)).toEqual({ ok: false, error: "DUPLICATE_PENDING" });
    expect(m.txProposal.create).not.toHaveBeenCalled();
  });
});

describe("listProposalsForVariant i findProposalInVariant (odczyt po id)", () => {
  it("lista filtruje po wariancie i po projekcie wariantu", async () => {
    m.prismaProposal.findMany.mockResolvedValue([row]);

    const list = await listProposalsForVariant("p1", "v1", 50);

    expect(list).toHaveLength(1);
    expect(m.prismaProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { variantId: "v1", variant: { projectId: "p1" } }, take: 50 }),
    );
  });

  it("odczyt po id zawsze filtruje po id, wariancie i projekcie", async () => {
    m.prismaProposal.findFirst.mockResolvedValue(row);

    const found = await findProposalInVariant(
      { proposal: m.prismaProposal } as never,
      { projectId: "p1", variantId: "v1", proposalId: "pr1" },
    );

    expect(found).toMatchObject({ id: "pr1", operation: "add" });
    expect(m.prismaProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pr1", variantId: "v1", variant: { projectId: "p1" } } }),
    );
  });

  it("cudze id (inny wariant lub projekt) daje null", async () => {
    m.prismaProposal.findFirst.mockResolvedValue(null);

    expect(
      await findProposalInVariant({ proposal: m.prismaProposal } as never, {
        projectId: "p-obcy",
        variantId: "v-obcy",
        proposalId: "pr1",
      }),
    ).toBeNull();
  });

  it("rzuca jawny błąd dla uszkodzonego blockKey", async () => {
    m.prismaProposal.findMany.mockResolvedValue([{ ...row, blockKey: "nieznany" }]);

    await expect(listProposalsForVariant("p1", "v1", 10)).rejects.toThrow("Niepoprawny blockKey");
  });
});

describe("acceptProposal", () => {
  it("zapisuje stan i status w jednej transakcji z kontrolą wersji", async () => {
    const result = await acceptProposal(args);

    expect(result).toMatchObject({
      ok: true,
      version: 4,
      state: { ...state, channels: ["Sklep online", "Targi"] },
      proposal: { id: "pr1", status: "ACCEPTED" },
    });
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.txVariant.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", version: 3 },
      data: { state: { ...state, channels: ["Sklep online", "Targi"] }, version: { increment: 1 } },
    });
    expect(m.txProposal.updateMany).toHaveBeenCalledWith({
      where: { id: "pr1", variantId: "v1", status: "PENDING" },
      data: { status: "ACCEPTED", resolvedById: "u1", resolvedAt: expect.any(Date) },
    });
    expectNoWritesOutsideTransaction();
  });

  it("propozycja spoza wariantu lub projektu: NOT_FOUND i brak zapisów", async () => {
    m.txProposal.findFirst.mockResolvedValue(null);

    expect(await acceptProposal({ ...args, projectId: "p-obcy" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.txProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pr1", variantId: "v1", variant: { projectId: "p-obcy" } } }),
    );
    expectNoTransactionWrites();
  });

  it("wariant spoza projektu: NOT_FOUND i brak zapisów", async () => {
    m.txVariant.findFirst.mockResolvedValue(null);

    expect(await acceptProposal(args)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.txVariant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "v1", projectId: "p1" } }));
    expectNoTransactionWrites();
  });

  it("już rozpatrzona propozycja: ALREADY_RESOLVED i brak zapisów", async () => {
    m.txProposal.findFirst.mockResolvedValue({ ...row, status: "ACCEPTED" });

    expect(await acceptProposal(args)).toEqual({ ok: false, error: "ALREADY_RESOLVED" });
    expectNoTransactionWrites();
  });

  it("inna wersja niż oczekiwana: VERSION_CONFLICT i brak zapisów", async () => {
    m.txVariant.findFirst.mockResolvedValue({ version: 5, state });

    expect(await acceptProposal(args)).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expectNoTransactionWrites();
  });

  it("nieaktualny wpis (STALE) nie zmienia stanu ani statusu", async () => {
    m.txProposal.findFirst.mockResolvedValue({ ...row, operation: "EDIT", before: "Nie ma takiego", after: "x" });

    expect(await acceptProposal(args)).toEqual({ ok: false, error: "STALE" });
    expectNoTransactionWrites();
  });

  it("duplikat wpisu dodanego w międzyczasie (DUPLICATE) nie zmienia stanu", async () => {
    m.txVariant.findFirst.mockResolvedValue({ version: 3, state: { ...state, channels: ["Targi"] } });

    expect(await acceptProposal(args)).toEqual({ ok: false, error: "DUPLICATE" });
    expectNoTransactionWrites();
  });

  it("wyścig o wersję (updateMany count 0): VERSION_CONFLICT i status propozycji się nie zmienia", async () => {
    m.txVariant.updateMany.mockResolvedValue({ count: 0 });

    expect(await acceptProposal(args)).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expect(m.txProposal.updateMany).not.toHaveBeenCalled();
  });

  it("równoległe rozpatrzenie (status nie jest już PENDING): wycofanie transakcji i ALREADY_RESOLVED", async () => {
    m.txProposal.updateMany.mockResolvedValue({ count: 0 });
    const outcome: { error?: unknown } = {};
    m.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      try {
        return await callback(tx);
      } catch (error) {
        outcome.error = error; // prawdziwa transakcja wycofałaby tu zapis stanu
        throw error;
      }
    });

    expect(await acceptProposal(args)).toEqual({ ok: false, error: "ALREADY_RESOLVED" });
    expect(outcome.error).toBeInstanceOf(Error);
  });

  it("uszkodzony stan wariantu to jawny błąd, nie zapis", async () => {
    m.txVariant.findFirst.mockResolvedValue({ version: 3, state: { channels: "nie lista" } });

    await expect(acceptProposal(args)).rejects.toThrow("Niepoprawny stan BMC");
    expectNoTransactionWrites();
  });
});

describe("rejectProposal", () => {
  const rejectArgs = { projectId: "p1", variantId: "v1", proposalId: "pr1", userId: "u1" };

  it("zmienia tylko status PENDING na REJECTED w wariancie z projektu i nie rusza stanu BMC", async () => {
    m.prismaProposal.updateMany.mockResolvedValue({ count: 1 });

    expect(await rejectProposal(rejectArgs)).toEqual({ ok: true });
    expect(m.prismaProposal.updateMany).toHaveBeenCalledWith({
      where: { id: "pr1", variantId: "v1", status: "PENDING", variant: { projectId: "p1" } },
      data: { status: "REJECTED", resolvedById: "u1", resolvedAt: expect.any(Date) },
    });
    expect(m.prismaVariant.updateMany).not.toHaveBeenCalled();
    expect(m.txVariant.updateMany).not.toHaveBeenCalled();
  });

  it("już rozpatrzona propozycja: ALREADY_RESOLVED", async () => {
    m.prismaProposal.updateMany.mockResolvedValue({ count: 0 });
    m.prismaProposal.findFirst.mockResolvedValue({ ...row, status: "ACCEPTED" });

    expect(await rejectProposal(rejectArgs)).toEqual({ ok: false, error: "ALREADY_RESOLVED" });
  });

  it("propozycja spoza wariantu lub projektu: NOT_FOUND", async () => {
    m.prismaProposal.updateMany.mockResolvedValue({ count: 0 });
    m.prismaProposal.findFirst.mockResolvedValue(null);

    expect(await rejectProposal({ ...rejectArgs, projectId: "p-obcy", variantId: "v-obcy" })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(m.prismaProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pr1", variantId: "v-obcy", variant: { projectId: "p-obcy" } } }),
    );
  });
});
