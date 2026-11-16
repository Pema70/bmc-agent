import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantProjectId: vi.fn(),
  runCompareVariants: vi.fn(),
  getVariantComparison: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole: m.requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({ getVariantProjectId: m.getVariantProjectId }));
vi.mock("@/lib/ai/compare-variants", () => ({ runCompareVariants: m.runCompareVariants }));
vi.mock("@/lib/db/comparisons", () => ({ getVariantComparison: m.getVariantComparison }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import { compareVariantsAction, getVariantComparisonAction } from "@/app/projekty/[id]/comparison-actions";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const allowed = { ok: true, session, projectId: "p1", role: "EDITOR" };
const forbidden = { ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireProjectRole.mockResolvedValue(allowed);
  m.getVariantProjectId.mockResolvedValue("p1");
  m.runCompareVariants.mockResolvedValue({ ok: true, comparison: { id: "c1" } });
  m.getVariantComparison.mockResolvedValue({ ok: true, comparison: { id: "c1" } });
});

describe("compareVariantsAction: kolejność sprawdzeń (EDITOR+)", () => {
  it("wymaga roli EDITOR", async () => {
    await compareVariantsAction("p1", ["v1", "v2"]);
    expect(m.requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
  });

  it("bez sesji i dla obcego projektu przerywa przed odczytem wariantów i operacją", async () => {
    m.requireProjectRole.mockRejectedValue(new Error("REDIRECT:/logowanie"));
    await expect(compareVariantsAction("p1", ["v1", "v2"])).rejects.toThrow("REDIRECT:/logowanie");

    m.requireProjectRole.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(compareVariantsAction("p-obcy", ["v1", "v2"])).rejects.toThrow("NEXT_NOT_FOUND");

    expect(m.getVariantProjectId).not.toHaveBeenCalled();
    expect(m.runCompareVariants).not.toHaveBeenCalled();
  });

  it("VIEWER (ok: false): FORBIDDEN bez odczytu wariantów, modelu i rewalidacji", async () => {
    m.requireProjectRole.mockResolvedValue(forbidden);

    const result = await compareVariantsAction("p1", ["v1", "v2"]);

    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(m.getVariantProjectId).not.toHaveBeenCalled();
    expect(m.runCompareVariants).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("wariant z innego projektu lub nieistniejący: NOT_FOUND bez modelu", async () => {
    m.getVariantProjectId.mockImplementation(async (id: string) => (id === "v-obcy" ? "p-obcy" : "p1"));
    expect(await compareVariantsAction("p1", ["v1", "v-obcy"])).toMatchObject({ ok: false, error: "NOT_FOUND" });

    m.getVariantProjectId.mockImplementation(async (id: string) => (id === "v404" ? null : "p1"));
    expect(await compareVariantsAction("p1", ["v1", "v404"])).toMatchObject({ ok: false, error: "NOT_FOUND" });

    expect(m.runCompareVariants).not.toHaveBeenCalled();
  });

  it("wszystkie warianty są sprawdzane (każdy po id), przed ścisłą walidacją liczby", async () => {
    await compareVariantsAction("p1", ["v1", "v2", "v3"]);

    expect(m.getVariantProjectId.mock.calls.map(([id]) => id).sort()).toEqual(["v1", "v2", "v3"]);
  });

  it.each([
    ["jeden wariant", ["v1"]],
    ["cztery warianty", ["v1", "v2", "v3", "v4"]],
    ["zduplikowane id", ["v1", "v1"]],
    ["brak wariantów", []],
  ])("zły argument: %s -> VALIDATION bez modelu", async (_label, ids) => {
    const result = await compareVariantsAction("p1", ids);

    expect(result).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(m.runCompareVariants).not.toHaveBeenCalled();
  });

  it.each([["nie tablica", "v1"], ["null", null], ["liczby", [1, 2]], ["puste id", ["v1", ""]], ["ponad 10 id", Array.from({ length: 11 }, (_, i) => `v${i}`)]])(
    "kształt wejścia: %s -> VALIDATION, bez odczytu wariantów i modelu",
    async (_label, ids) => {
      expect(await compareVariantsAction("p1", ids)).toMatchObject({ ok: false, error: "VALIDATION" });
      expect(m.getVariantProjectId).not.toHaveBeenCalled();
      expect(m.runCompareVariants).not.toHaveBeenCalled();
    },
  );
});

describe("compareVariantsAction: operacja", () => {
  it("woła porównanie z projektem i użytkownikiem z serwera, trigger UI i identyfikatorami w kolejności żądania", async () => {
    const result = await compareVariantsAction("p1", ["v2", "v1"]);

    expect(result).toEqual({ ok: true, comparison: { id: "c1" } });
    expect(m.runCompareVariants).toHaveBeenCalledWith({ projectId: "p1", variantIds: ["v2", "v1"], userId: "u1", trigger: "UI" });
    expect(m.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("błędy operacji przechodzą z komunikatem i retryAfterSec, bez rewalidacji", async () => {
    m.runCompareVariants.mockResolvedValue({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 90 });

    expect(await compareVariantsAction("p1", ["v1", "v2"])).toEqual({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 90 });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("getVariantComparisonAction (VIEWER+)", () => {
  it("wymaga roli VIEWER przed jakimkolwiek odczytem i czyta po projectId", async () => {
    const result = await getVariantComparisonAction("p1", "c1");

    expect(m.requireProjectRole).toHaveBeenCalledWith("p1", "VIEWER");
    expect(m.getVariantComparison).toHaveBeenCalledWith("p1", "c1");
    expect(result).toEqual({ ok: true, item: { ok: true, comparison: { id: "c1" } } });
  });

  it("brak dostępu: FORBIDDEN bez odczytu; obcy projekt lub brak sesji przerywa", async () => {
    m.requireProjectRole.mockResolvedValue(forbidden);
    expect(await getVariantComparisonAction("p1", "c1")).toMatchObject({ ok: false, error: "FORBIDDEN" });

    m.requireProjectRole.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(getVariantComparisonAction("p-obcy", "c1")).rejects.toThrow("NEXT_NOT_FOUND");

    expect(m.getVariantComparison).not.toHaveBeenCalled();
  });

  it("niepoprawny identyfikator: VALIDATION; brak rekordu (obcy projekt): NOT_FOUND", async () => {
    expect(await getVariantComparisonAction("p1", "")).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(await getVariantComparisonAction("p1", "a".repeat(65))).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(m.getVariantComparison).not.toHaveBeenCalled();

    m.getVariantComparison.mockResolvedValue(null);
    expect(await getVariantComparisonAction("p1", "c-obce")).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });
});
