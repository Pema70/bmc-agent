import { beforeEach, describe, expect, it, vi } from "vitest";

const { createProposal } = vi.hoisted(() => ({ createProposal: vi.fn() }));

vi.mock("@/lib/db/proposals", () => ({ createProposal }));

import { createProposeBlockChangeTool } from "@/lib/ai/tools/propose-block-change";
import { emptyBmcState } from "@/lib/schemas/bmc";
import type { ProposeBlockChangeToolInput } from "@/lib/schemas/proposal";

const state = { ...emptyBmcState(), channels: ["Sklep online", "Targi"] };
const context = { projectId: "p1", variantId: "v1", userId: "u1", version: 7, state, maxPending: 20 };

const record = {
  id: "pr-z-bazy",
  variantId: "v1",
  blockKey: "channels" as const,
  operation: "add" as const,
  before: null,
  after: "Sprzedaż w social media",
  rationale: "Klienci są na Instagramie.",
  status: "PENDING" as const,
  baseVersion: 7,
  createdAt: new Date("2026-11-11T10:00:00Z"),
};

async function run(input: ProposeBlockChangeToolInput, ctx = context) {
  const tool = createProposeBlockChangeTool(ctx);
  return tool.execute!(input as never, { toolCallId: "c1", messages: [] } as never);
}

const validInput: ProposeBlockChangeToolInput = {
  blockKey: "channels",
  operation: "add",
  after: "Sprzedaż w social media",
  rationale: "Klienci są na Instagramie.",
};

beforeEach(() => {
  vi.clearAllMocks();
  createProposal.mockResolvedValue({ ok: true, proposal: record });
});

describe("propose_block_change", () => {
  it("tworzy propozycję PENDING z kontekstem z serwera i nie zmienia stanu BMC", async () => {
    const snapshot = JSON.stringify(state);

    const output = await run(validInput);

    expect(output).toEqual({
      ok: true,
      proposal: {
        id: "pr-z-bazy",
        blockKey: "channels",
        operation: "add",
        before: null,
        after: "Sprzedaż w social media",
        rationale: "Klienci są na Instagramie.",
      },
    });
    expect(createProposal).toHaveBeenCalledWith(
      {
        projectId: "p1",
        variantId: "v1",
        createdById: "u1",
        baseVersion: 7,
        change: expect.objectContaining({
          blockKey: "channels",
          operation: "add",
          before: null,
          after: "Sprzedaż w social media",
        }),
      },
      20,
    );
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("id propozycji w wyniku pochodzi z bazy, nigdy z tekstu modelu", async () => {
    const withForgedId = { ...validInput, proposalId: "pr-podrobione", id: "pr-podrobione" } as ProposeBlockChangeToolInput;

    const output = await run(withForgedId);

    expect(output).toMatchObject({ ok: true, proposal: { id: "pr-z-bazy" } });
    expect(JSON.stringify(createProposal.mock.calls[0][0])).not.toContain("pr-podrobione");
  });

  it("ADD wpisu identycznego z istniejącym zwraca ok: false i nie tworzy rekordu", async () => {
    const output = await run({ ...validInput, after: "Targi" });

    expect(output).toMatchObject({ ok: false });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("edit nieistniejącego wpisu (STALE) zwraca powód i nie tworzy rekordu", async () => {
    const output = await run({ blockKey: "channels", operation: "edit", before: "Brak", after: "x", rationale: "r" });

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("nie istnieje") });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("niepoprawne argumenty nie tworzą rekordu", async () => {
    const output = await run({ blockKey: "channels", operation: "add", before: "x", after: "y", rationale: "r" });

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("Niepoprawne argumenty") });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("przekroczony limit oczekujących propozycji zwraca ok: false", async () => {
    createProposal.mockResolvedValue({ ok: false, error: "LIMIT" });

    const output = await run(validInput);

    expect(output).toMatchObject({ ok: false, reason: expect.stringContaining("20 propozycji") });
  });

  it("identyczna oczekująca propozycja zwraca ok: false", async () => {
    createProposal.mockResolvedValue({ ok: false, error: "DUPLICATE_PENDING" });

    expect(await run(validInput)).toMatchObject({ ok: false, reason: expect.stringContaining("już czeka") });
  });

  it("limit oczekujących pochodzi z konfiguracji kontekstu", async () => {
    await run(validInput, { ...context, maxPending: 5 });

    expect(createProposal.mock.calls[0][1]).toBe(5);
  });
});
