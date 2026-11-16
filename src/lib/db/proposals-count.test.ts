import { beforeEach, describe, expect, it, vi } from "vitest";

const { count, findFirst } = vi.hoisted(() => ({ count: vi.fn(), findFirst: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ prisma: { proposal: { count }, bmcVariant: { findFirst } } }));

import { countPendingProposals } from "@/lib/db/proposals";
import { getVariantMeta } from "@/lib/db/variants";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("countPendingProposals", () => {
  it("liczy tylko oczekujące propozycje wskazanego wariantu z wariantu należącego do projektu", async () => {
    count.mockResolvedValue(3);

    expect(await countPendingProposals("p1", "v1")).toBe(3);
    expect(count).toHaveBeenCalledWith({ where: { variantId: "v1", status: "PENDING", variant: { projectId: "p1" } } });
  });
});

describe("getVariantMeta", () => {
  it("czyta po id ORAZ projectId i zwraca tylko id i isMain (bez stanu)", async () => {
    findFirst.mockResolvedValue({ id: "v1", isMain: false });

    expect(await getVariantMeta("p1", "v1")).toEqual({ id: "v1", isMain: false });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "v1", projectId: "p1" }, select: { id: true, isMain: true } });
  });

  it("zwraca null dla wariantu z innego projektu", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getVariantMeta("p-obcy", "v1")).toBeNull();
  });
});
