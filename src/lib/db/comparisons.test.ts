import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  variantFindMany: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    variantComparison: { create: m.create, findMany: m.findMany, findFirst: m.findFirst },
    bmcVariant: { findMany: m.variantFindMany },
  },
}));

import { createVariantComparison, getVariantComparison, listVariantComparisons } from "@/lib/db/comparisons";
import { getVariantsForCompare } from "@/lib/db/variants";
import { emptyBmcState } from "@/lib/schemas/bmc";

const stateA = { ...emptyBmcState(), channels: ["Aplikacja", "Social media"], revenue_streams: ["Subskrypcja"] };
const stateB = { ...emptyBmcState(), channels: ["Sprzedaż bezpośrednia"], customer_segments: ["Firmy"] };
const inputs = [
  { label: "A", variantId: "v1", name: "Główny", version: 3, state: stateA },
  { label: "B", variantId: "v2", name: "Strategia", version: 1, state: stateB },
];
const assessment = (label: string) => ({ label, pros: ["Zaleta"], cons: ["Wada"] });
const result = {
  summary: "Różnią się kanałami.",
  blockNotes: [],
  variants: [assessment("A"), assessment("B")],
  recommendation: { label: null, rationale: "Brak jednoznacznego wskazania." },
};
const now = new Date("2026-11-16T10:00:00Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    createdAt: now,
    schemaVersion: 1,
    inputs,
    result,
    trigger: "UI",
    provider: "google",
    model: "gemini-3.5-flash-lite",
    promptVersion: "compare-v1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createVariantComparison", () => {
  const input = {
    projectId: "p1",
    inputs: inputs as never,
    result: result as never,
    trigger: "UI" as const,
    provider: "google",
    model: "gemini-3.5-flash-lite",
    promptVersion: "compare-v1",
    llmCallLogId: "log-1",
    createdById: "u1",
  };

  it("zapisuje po walidacji Zod, z wersją schematu, i zwraca widok z bazy (z migawkami stanów)", async () => {
    m.create.mockResolvedValue(row());

    const view = await createVariantComparison(input);

    expect(m.create).toHaveBeenCalledWith({
      data: {
        projectId: "p1",
        schemaVersion: 1,
        inputs,
        result,
        trigger: "UI",
        provider: "google",
        model: "gemini-3.5-flash-lite",
        promptVersion: "compare-v1",
        llmCallLogId: "log-1",
        createdById: "u1",
      },
      select: expect.any(Object),
    });
    expect(view).toMatchObject({ id: "c1", inputs: [{ label: "A", state: stateA }, { label: "B", state: stateB }] });
  });

  it("wynik niezgodny ze schematem lub niepoprawna migawka nigdy nie trafiają do bazy", async () => {
    await expect(createVariantComparison({ ...input, result: { ...result, variants: [assessment("A")] } as never })).rejects.toThrow();
    await expect(createVariantComparison({ ...input, inputs: [inputs[0]] as never })).rejects.toThrow();
    await expect(createVariantComparison({ ...input, inputs: [inputs[0], { ...inputs[1], label: "A" }] as never })).rejects.toThrow();
    await expect(
      createVariantComparison({ ...input, inputs: [inputs[0], { ...inputs[1], state: { channels: "nie lista" } }] as never }),
    ).rejects.toThrow();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("niespójny rekord zwrócony z bazy (etykiety wyniku ≠ wejścia) to jawny wyjątek", async () => {
    m.create.mockResolvedValue(row({ result: { ...result, variants: [assessment("A"), assessment("C")] } }));
    await expect(createVariantComparison(input)).rejects.toThrow("jest niepoprawne");
  });
});

describe("listVariantComparisons", () => {
  it("filtruje po projectId, od najnowszego, i nie zwraca stanów wariantów w pozycjach listy", async () => {
    m.findMany.mockResolvedValue([row()]);

    const items = await listVariantComparisons("p1", 20);

    expect(m.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "p1" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 }),
    );
    expect(items[0]).toMatchObject({
      ok: true,
      comparison: { id: "c1", inputs: [{ label: "A", variantId: "v1", name: "Główny", version: 3 }, { label: "B" }] },
    });
    expect(JSON.stringify(items)).not.toContain("Aplikacja");
    expect(JSON.stringify(items)).not.toContain('"state"');
  });

  it("obcy projekt daje pustą listę", async () => {
    m.findMany.mockResolvedValue([]);
    expect(await listVariantComparisons("p-obcy", 20)).toEqual([]);
    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p-obcy" } }));
  });

  it("uszkodzony rekord to błąd tylko dla siebie, nie dla całej listy", async () => {
    m.findMany.mockResolvedValue([row({ id: "zly", result: { summary: 5 } }), row({ id: "dobry" })]);

    const items = await listVariantComparisons("p1", 20);

    expect(items[0]).toMatchObject({ ok: false, id: "zly" });
    expect(items[1]).toMatchObject({ ok: true, comparison: { id: "dobry" } });
  });

  it("nieobsługiwana wersja schematu, uszkodzona migawka i niespójne etykiety to błędy rekordu", async () => {
    m.findMany.mockResolvedValue([
      row({ id: "v99", schemaVersion: 99 }),
      row({ id: "zla-migawka", inputs: [{ label: "A" }] }),
      row({ id: "zle-etykiety", result: { ...result, variants: [assessment("A"), assessment("C")] } }),
    ]);

    const items = await listVariantComparisons("p1", 20);

    expect(items.every((item) => !item.ok)).toBe(true);
  });
});

describe("getVariantComparison", () => {
  it("czyta po id ORAZ projectId i zwraca migawki stanów; cudzy projekt lub brak daje null", async () => {
    m.findFirst.mockResolvedValue(null);
    expect(await getVariantComparison("p-obcy", "c1")).toBeNull();
    expect(m.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", projectId: "p-obcy" } }));

    m.findFirst.mockResolvedValue(row());
    expect(await getVariantComparison("p1", "c1")).toMatchObject({ ok: true, comparison: { inputs: [{ state: stateA }, { state: stateB }] } });
  });

  it("uszkodzony rekord to jawny błąd, a nie wyjątek ani null", async () => {
    m.findFirst.mockResolvedValue(row({ inputs: "uszkodzone" }));
    expect(await getVariantComparison("p1", "c1")).toMatchObject({ ok: false, id: "c1" });
  });
});

describe("getVariantsForCompare", () => {
  const dbRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `Wariant ${id}`,
    description: null,
    version: 1,
    state: stateA,
    ...overrides,
  });

  it("jedno zapytanie po projectId i liście id, wynik w kolejności żądania", async () => {
    m.variantFindMany.mockResolvedValue([dbRow("v2"), dbRow("v1"), dbRow("v3")]);

    const found = await getVariantsForCompare("p1", ["v3", "v1", "v2"]);

    expect(m.variantFindMany).toHaveBeenCalledTimes(1);
    expect(m.variantFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", id: { in: ["v3", "v1", "v2"] } } }));
    expect(found.map((variant) => variant.id)).toEqual(["v3", "v1", "v2"]);
  });

  it("wariant spoza projektu lub nieistniejący po prostu nie wchodzi do wyniku", async () => {
    m.variantFindMany.mockResolvedValue([dbRow("v1")]);

    const found = await getVariantsForCompare("p1", ["v1", "v-z-innego-projektu"]);

    expect(found.map((variant) => variant.id)).toEqual(["v1"]);
  });

  it("uszkodzony stan wariantu to jawny wyjątek", async () => {
    m.variantFindMany.mockResolvedValue([dbRow("v1", { state: { channels: "nie lista" } })]);
    await expect(getVariantsForCompare("p1", ["v1"])).rejects.toThrow("Niepoprawny stan BMC w wariancie v1");
  });
});
