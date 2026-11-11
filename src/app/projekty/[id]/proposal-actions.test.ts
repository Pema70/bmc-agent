import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireProjectRole, getVariantProjectId, acceptProposal, rejectProposal, revalidatePath } = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantProjectId: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({ getVariantProjectId }));
vi.mock("@/lib/db/proposals", () => ({ acceptProposal, rejectProposal }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { acceptProposalAction, rejectProposalAction } from "@/app/projekty/[id]/proposal-actions";
import { emptyBmcState } from "@/lib/schemas/bmc";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const editorAccess = { ok: true, session, projectId: "p1", role: "EDITOR" };
const viewerAccess = { ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" };

// Każda nowa akcja przechodzi te same sprawdzenia uprawnień, więc testujemy je dla obu.
const actions = [
  {
    name: "acceptProposalAction",
    call: (variantId = "v1", proposalId = "pr1") => acceptProposalAction("p1", variantId, proposalId, 3),
    dbMock: acceptProposal,
  },
  {
    name: "rejectProposalAction",
    call: (variantId = "v1", proposalId = "pr1") => rejectProposalAction("p1", variantId, proposalId),
    dbMock: rejectProposal,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  requireProjectRole.mockResolvedValue(editorAccess);
  getVariantProjectId.mockResolvedValue("p1");
  acceptProposal.mockResolvedValue({ ok: true, version: 4, state: emptyBmcState(), proposal: {} });
  rejectProposal.mockResolvedValue({ ok: true });
});

describe.each(actions)("$name", ({ call, dbMock }) => {
  it("wymaga roli EDITOR", async () => {
    await call();

    expect(requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
  });

  it("bez sesji przerywa przed odczytem wariantu i zapisem", async () => {
    requireProjectRole.mockRejectedValue(new Error("REDIRECT:/logowanie"));

    await expect(call()).rejects.toThrow("REDIRECT:/logowanie");
    expect(getVariantProjectId).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("odrzuca VIEWERA przed odczytem wariantu i zapisem", async () => {
    requireProjectRole.mockResolvedValue(viewerAccess);

    const result = await call();

    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(getVariantProjectId).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("odrzuca wariant z innego projektu", async () => {
    getVariantProjectId.mockResolvedValue("p-obcy");

    const result = await call("v-z-innego-projektu");

    expect(result).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("odrzuca nieistniejący wariant i niepoprawny identyfikator wariantu", async () => {
    getVariantProjectId.mockResolvedValue(null);
    expect(await call("nie-ma")).toMatchObject({ ok: false, error: "NOT_FOUND" });

    expect(await call("")).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("odrzuca niepoprawny identyfikator propozycji", async () => {
    expect(await call("v1", "")).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("przekazuje do bazy projekt z uprawnień, wariant i użytkownika z sesji", async () => {
    await call("v1", "pr1");

    expect(dbMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", variantId: "v1", proposalId: "pr1", userId: "u1" }),
    );
  });

  it("propozycja spoza wariantu: NOT_FOUND", async () => {
    dbMock.mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    expect(await call()).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("podwójne rozpatrzenie: komunikat ALREADY_RESOLVED", async () => {
    dbMock.mockResolvedValue({ ok: false, error: "ALREADY_RESOLVED" });

    expect(await call()).toMatchObject({
      ok: false,
      error: "ALREADY_RESOLVED",
      message: "Ta propozycja została już rozpatrzona.",
    });
  });
});

describe("acceptProposalAction: wynik", () => {
  it("zwraca nowy stan i wersję oraz odświeża stronę", async () => {
    const state = { ...emptyBmcState(), channels: ["Targi"] };
    acceptProposal.mockResolvedValue({ ok: true, version: 4, state, proposal: {} });

    expect(await acceptProposalAction("p1", "v1", "pr1", 3)).toEqual({ ok: true, version: 4, state });
    expect(acceptProposal).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3 }));
    expect(revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("odrzuca niepoprawną wersję przed zapisem", async () => {
    expect(await acceptProposalAction("p1", "v1", "pr1", 0)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(await acceptProposalAction("p1", "v1", "pr1", 1.5)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(acceptProposal).not.toHaveBeenCalled();
  });

  it("konflikt wersji ma ten sam komunikat co edytor", async () => {
    acceptProposal.mockResolvedValue({ ok: false, error: "VERSION_CONFLICT" });

    expect(await acceptProposalAction("p1", "v1", "pr1", 3)).toEqual({
      ok: false,
      error: "VERSION_CONFLICT",
      message: "Ktoś w międzyczasie zmienił ten model. Odśwież stronę, aby zobaczyć aktualną wersję.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("nieaktualny wpis: komunikat STALE", async () => {
    acceptProposal.mockResolvedValue({ ok: false, error: "STALE" });

    expect(await acceptProposalAction("p1", "v1", "pr1", 3)).toEqual({
      ok: false,
      error: "STALE",
      message: "Ten wpis zmienił się od czasu propozycji. Odrzuć ją albo poproś agenta o nową.",
    });
  });

  it("duplikat i limit mają osobne komunikaty", async () => {
    acceptProposal.mockResolvedValue({ ok: false, error: "DUPLICATE" });
    expect(await acceptProposalAction("p1", "v1", "pr1", 3)).toMatchObject({ error: "DUPLICATE" });

    acceptProposal.mockResolvedValue({ ok: false, error: "LIMIT" });
    expect(await acceptProposalAction("p1", "v1", "pr1", 3)).toMatchObject({ error: "LIMIT" });
  });
});

describe("rejectProposalAction: wynik", () => {
  it("odrzucenie odświeża stronę i nie zwraca stanu BMC", async () => {
    expect(await rejectProposalAction("p1", "v1", "pr1")).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/projekty/p1");
    expect(acceptProposal).not.toHaveBeenCalled();
  });
});
