import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ proposalFindMany: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ prisma: { proposal: { findMany: m.proposalFindMany } } }));

import { listProposalsForRound } from "@/lib/db/proposals";
import { listRoundProposalIds } from "@/lib/db/refinement";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listRoundProposalIds", () => {
  it("grupuje identyfikatory propozycji po rundzie w kolejności paczki; zapytanie po wariancie i projekcie", async () => {
    m.proposalFindMany.mockResolvedValue([
      { id: "pr1", refinementRoundId: "r1" },
      { id: "pr2", refinementRoundId: "r1" },
      { id: "pr3", refinementRoundId: "r2" },
    ]);

    expect(await listRoundProposalIds("p1", "v1")).toEqual({ r1: ["pr1", "pr2"], r2: ["pr3"] });
    expect(m.proposalFindMany).toHaveBeenCalledWith({
      where: { variantId: "v1", variant: { projectId: "p1" }, refinementRoundId: { not: null } },
      orderBy: [{ refinementQuestionIndex: "asc" }, { id: "asc" }],
      select: { id: true, refinementRoundId: true },
    });
  });

  it("brak propozycji rund: pusta mapa", async () => {
    m.proposalFindMany.mockResolvedValue([]);

    expect(await listRoundProposalIds("p1", "v1")).toEqual({});
  });
});

describe("listProposalsForRound", () => {
  it("czyta propozycje jednej rundy po id rundy, wariancie i projekcie, w kolejności paczki", async () => {
    m.proposalFindMany.mockResolvedValue([
      {
        id: "pr1",
        variantId: "v1",
        blockKey: "channels",
        operation: "ADD",
        before: null,
        after: "Targi",
        rationale: "Z odpowiedzi.",
        status: "PENDING",
        baseVersion: 3,
        createdAt: new Date("2026-11-24T10:00:00Z"),
        sourceKind: "REFINEMENT",
        sourceAttachmentName: null,
      },
    ]);

    const records = await listProposalsForRound("p1", "v1", "r1");

    expect(records).toEqual([expect.objectContaining({ id: "pr1", operation: "add", sourceKind: "REFINEMENT" })]);
    expect(m.proposalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { refinementRoundId: "r1", variantId: "v1", variant: { projectId: "p1" } },
        orderBy: [{ refinementQuestionIndex: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("obca runda: pusta lista (zapytanie ograniczone do projektu z uprawnień)", async () => {
    m.proposalFindMany.mockResolvedValue([]);

    expect(await listProposalsForRound("p1", "v1", "r-obca")).toEqual([]);
  });
});
