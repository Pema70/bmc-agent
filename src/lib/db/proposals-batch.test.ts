import { beforeEach, describe, expect, it, vi } from "vitest";

// Prawdziwy acceptRoundBatch, zamockowany tylko klient Prisma.
const m = vi.hoisted(() => ({
  txRound: { findFirst: vi.fn() },
  txProposal: { findMany: vi.fn(), updateMany: vi.fn() },
  txVariant: { findFirst: vi.fn(), updateMany: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: { $transaction: m.transaction } }));

import { acceptRoundBatch } from "@/lib/db/proposals";
import { emptyBmcState } from "@/lib/schemas/bmc";

const tx = { refinementRound: m.txRound, proposal: m.txProposal, bmcVariant: m.txVariant };

const state = { ...emptyBmcState(), customer_segments: ["Studenci"], channels: ["Sklep online"] };
const args = { projectId: "p1", variantId: "v1", roundId: "r1", expectedVersion: 3, userId: "u1" };

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    variantId: "v1",
    blockKey: "customer_segments",
    operation: "ADD",
    before: null,
    after: `Wpis ${id}`,
    rationale: "Z odpowiedzi użytkownika.",
    status: "PENDING",
    baseVersion: 3,
    createdAt: new Date("2026-11-23T10:00:00Z"),
    sourceKind: "REFINEMENT",
    sourceAttachmentName: null,
    ...overrides,
  };
}

function expectNoWrites() {
  expect(m.txVariant.updateMany).not.toHaveBeenCalled();
  expect(m.txProposal.updateMany).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  m.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  m.txRound.findFirst.mockResolvedValue({ id: "r1" });
  m.txVariant.findFirst.mockResolvedValue({ version: 3, state });
  m.txVariant.updateMany.mockResolvedValue({ count: 1 });
  m.txProposal.updateMany.mockImplementation(async (a: { where: { id: { in: string[] } } }) => ({ count: a.where.id.in.length }));
});

describe("acceptRoundBatch", () => {
  it("stosuje wszystkie oczekujące propozycje rundy po kolei w jednej transakcji i podnosi wersję o 1", async () => {
    m.txProposal.findMany.mockResolvedValue([
      row("pr1", { after: "Pracownicy biur" }),
      row("pr2", { operation: "EDIT", before: "Pracownicy biur", after: "Pracownicy pobliskich biur" }),
      row("pr3", { blockKey: "channels", after: "Targi" }),
    ]);

    const result = await acceptRoundBatch(args);

    expect(result).toMatchObject({ ok: true, version: 4, acceptedCount: 3, proposalIds: ["pr1", "pr2", "pr3"] });
    expect(m.transaction).toHaveBeenCalledTimes(1);
    const next = (result as { state: typeof state }).state;
    expect(next.customer_segments).toEqual(["Studenci", "Pracownicy pobliskich biur"]);
    expect(next.channels).toEqual(["Sklep online", "Targi"]);
    expect(m.txVariant.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", version: 3 },
      data: { state: next, version: { increment: 1 } },
    });
    expect(m.txProposal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["pr1", "pr2", "pr3"] }, variantId: "v1", status: "PENDING" },
      data: expect.objectContaining({ status: "ACCEPTED", resolvedById: "u1" }),
    });
  });

  it("czyta tylko propozycje PENDING tej rundy w kolejności: numer pytania, potem id", async () => {
    m.txProposal.findMany.mockResolvedValue([row("pr1")]);

    await acceptRoundBatch(args);

    expect(m.txProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { refinementRoundId: "r1", variantId: "v1", status: "PENDING" },
        orderBy: [{ refinementQuestionIndex: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("cudza lub nieistniejąca runda: NOT_FOUND (po id, variantId i projectId), bez odczytu propozycji", async () => {
    m.txRound.findFirst.mockResolvedValue(null);

    expect(await acceptRoundBatch({ ...args, roundId: "r-obca" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.txRound.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r-obca", variantId: "v1", projectId: "p1" } }));
    expect(m.txProposal.findMany).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("brak oczekujących propozycji: NOTHING_PENDING", async () => {
    m.txProposal.findMany.mockResolvedValue([]);

    expect(await acceptRoundBatch(args)).toEqual({ ok: false, error: "NOTHING_PENDING" });
    expectNoWrites();
  });

  it("zmieniona wersja wariantu: VERSION_CONFLICT bez zapisu", async () => {
    m.txProposal.findMany.mockResolvedValue([row("pr1")]);
    m.txVariant.findFirst.mockResolvedValue({ version: 4, state });

    expect(await acceptRoundBatch(args)).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expectNoWrites();
  });

  it("STALE w środku paczki: pełny rollback (brak jakichkolwiek zapisów) i lista propozycji z powodami", async () => {
    m.txProposal.findMany.mockResolvedValue([
      row("pr1", { after: "Pracownicy biur" }),
      row("pr2", { operation: "EDIT", before: "Nie ma takiego wpisu", after: "Nowy" }),
      row("pr3", { blockKey: "channels", after: "Targi" }),
    ]);

    const result = await acceptRoundBatch(args);

    expect(result).toEqual({ ok: false, error: "CONFLICTS", failures: [{ proposalId: "pr2", error: "STALE" }] });
    expectNoWrites();
  });

  it("wymienia wszystkie niestosowalne propozycje naraz (STALE i DUPLICATE)", async () => {
    m.txProposal.findMany.mockResolvedValue([
      row("pr1", { operation: "REMOVE", before: "Nie ma", after: null }),
      row("pr2", { after: "Studenci" }),
    ]);

    const result = await acceptRoundBatch(args);

    expect(result).toEqual({
      ok: false,
      error: "CONFLICTS",
      failures: [
        { proposalId: "pr1", error: "STALE" },
        { proposalId: "pr2", error: "DUPLICATE" },
      ],
    });
    expectNoWrites();
  });

  it("zapis stanu odrzucony przez wyścig o wersję (updateMany count 0): VERSION_CONFLICT, status propozycji nie jest zmieniany", async () => {
    m.txProposal.findMany.mockResolvedValue([row("pr1")]);
    m.txVariant.updateMany.mockResolvedValue({ count: 0 });

    expect(await acceptRoundBatch(args)).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expect(m.txProposal.updateMany).not.toHaveBeenCalled();
  });

  it("propozycja rozstrzygnięta równolegle (zmieniono mniej wierszy niż w paczce): ALREADY_RESOLVED i wycofanie stanu", async () => {
    m.txProposal.findMany.mockResolvedValue([row("pr1"), row("pr2", { after: "Inny" })]);
    m.txProposal.updateMany.mockResolvedValue({ count: 1 });

    // Błąd rzucony w transakcji wycofuje także zapis stanu (prawdziwa baza); tu sprawdzamy wynik funkcji.
    expect(await acceptRoundBatch(args)).toEqual({ ok: false, error: "ALREADY_RESOLVED" });
  });

  it("nieoczekiwany błąd bazy jest propagowany", async () => {
    m.txProposal.findMany.mockRejectedValue(new Error("baza niedostępna"));

    await expect(acceptRoundBatch(args)).rejects.toThrow("baza niedostępna");
  });

  it("uszkodzony stan wariantu w bazie: wyjątek, bez zapisu", async () => {
    m.txProposal.findMany.mockResolvedValue([row("pr1")]);
    m.txVariant.findFirst.mockResolvedValue({ version: 3, state: { nieznany: [] } });

    await expect(acceptRoundBatch(args)).rejects.toThrow("Niepoprawny stan BMC");
    expectNoWrites();
  });
});
