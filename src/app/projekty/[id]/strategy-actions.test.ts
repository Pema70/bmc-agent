import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireProjectRole: vi.fn(),
  getVariantProjectId: vi.fn(),
  runGenerateStrategies: vi.fn(),
  saveStrategyAsVariant: vi.fn(),
  getStrategyGeneration: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({ requireProjectRole: m.requireProjectRole }));
vi.mock("@/lib/db/variants", () => ({ getVariantProjectId: m.getVariantProjectId }));
vi.mock("@/lib/ai/generate-strategies", () => ({ runGenerateStrategies: m.runGenerateStrategies }));
vi.mock("@/lib/db/strategies", () => ({
  saveStrategyAsVariant: m.saveStrategyAsVariant,
  getStrategyGeneration: m.getStrategyGeneration,
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import {
  generateStrategiesAction,
  getStrategyGenerationAction,
  saveStrategyAsVariantAction,
} from "@/app/projekty/[id]/strategy-actions";

const session = { user: { id: "u1", email: "jan@example.com", name: null } };
const allowed = { ok: true, session, projectId: "p1", role: "EDITOR" };
const forbidden = { ok: false, error: "FORBIDDEN", session, projectId: "p1", role: "VIEWER" };

const mutating = [
  {
    name: "generateStrategiesAction",
    call: (variantId = "v1") => generateStrategiesAction("p1", variantId, "Skup się na firmach"),
    dbMock: m.runGenerateStrategies,
  },
  {
    name: "saveStrategyAsVariantAction",
    call: (variantId = "v1") => saveStrategyAsVariantAction("p1", variantId, "g1", 0),
    dbMock: m.saveStrategyAsVariant,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.requireProjectRole.mockResolvedValue(allowed);
  m.getVariantProjectId.mockResolvedValue("p1");
  m.runGenerateStrategies.mockResolvedValue({ ok: true, generation: { id: "g1" } });
  m.saveStrategyAsVariant.mockResolvedValue({ ok: true, variant: { id: "v-nowy" } });
  m.getStrategyGeneration.mockResolvedValue({ ok: true, generation: { id: "g1" } });
});

describe.each(mutating)("$name: kolejność sprawdzeń (EDITOR+)", ({ call, dbMock }) => {
  it("wymaga roli EDITOR", async () => {
    await call();
    expect(m.requireProjectRole).toHaveBeenCalledWith("p1", "EDITOR");
  });

  it("bez sesji i dla obcego projektu przerywa przed odczytem wariantu i operacją", async () => {
    m.requireProjectRole.mockRejectedValue(new Error("REDIRECT:/logowanie"));
    await expect(call()).rejects.toThrow("REDIRECT:/logowanie");

    m.requireProjectRole.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(m.getVariantProjectId).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("VIEWER (ok: false): FORBIDDEN bez odczytu wariantu, operacji, modelu i rewalidacji", async () => {
    m.requireProjectRole.mockResolvedValue(forbidden);

    const result = await call();

    expect(result).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(m.getVariantProjectId).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("wariant z innego projektu, nieistniejący i niepoprawny id: NOT_FOUND bez operacji", async () => {
    m.getVariantProjectId.mockResolvedValue("p-obcy");
    expect(await call("v-z-innego-projektu")).toMatchObject({ ok: false, error: "NOT_FOUND" });

    m.getVariantProjectId.mockResolvedValue(null);
    expect(await call("v404")).toMatchObject({ ok: false, error: "NOT_FOUND" });

    m.getVariantProjectId.mockClear();
    expect(await call("")).toMatchObject({ ok: false, error: "NOT_FOUND" });
    expect(m.getVariantProjectId).not.toHaveBeenCalled();
    expect(dbMock).not.toHaveBeenCalled();
  });
});

describe("generateStrategiesAction", () => {
  it("woła generowanie z projektem, wariantem i użytkownikiem z serwera, trigger UI i przyciętymi wytycznymi", async () => {
    const result = await generateStrategiesAction("p1", "v1", "  Skup się na firmach ");

    expect(result).toEqual({ ok: true, generation: { id: "g1" } });
    expect(m.runGenerateStrategies).toHaveBeenCalledWith({
      projectId: "p1",
      variantId: "v1",
      userId: "u1",
      trigger: "UI",
      guidelines: "Skup się na firmach",
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it("bez wytycznych przekazuje null", async () => {
    await generateStrategiesAction("p1", "v1");
    expect(m.runGenerateStrategies).toHaveBeenCalledWith(expect.objectContaining({ guidelines: null }));
  });

  it("za długie lub nietekstowe wytyczne: VALIDATION po sprawdzeniu wariantu i bez modelu", async () => {
    expect(await generateStrategiesAction("p1", "v1", "a".repeat(501))).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(await generateStrategiesAction("p1", "v1", { text: "x" })).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(m.runGenerateStrategies).not.toHaveBeenCalled();
  });

  it("zły wariant jest sprawdzany przed walidacją wytycznych", async () => {
    m.getVariantProjectId.mockResolvedValue("p-obcy");
    expect(await generateStrategiesAction("p1", "v-obcy", "a".repeat(501))).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });

  it("błędy operacji przechodzą z komunikatem i retryAfterSec, bez rewalidacji", async () => {
    m.runGenerateStrategies.mockResolvedValue({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 120 });

    const result = await generateStrategiesAction("p1", "v1", "x");

    expect(result).toEqual({ ok: false, error: "LIMIT", message: "Limit.", retryAfterSec: 120 });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saveStrategyAsVariantAction", () => {
  it("zapisuje wskazaną strategię: tylko identyfikatory od klienta, limit i użytkownik z serwera", async () => {
    const result = await saveStrategyAsVariantAction("p1", "v1", "g1", 1);

    expect(result).toEqual({ ok: true, variant: { id: "v-nowy" } });
    expect(m.saveStrategyAsVariant).toHaveBeenCalledWith({
      projectId: "p1",
      variantId: "v1",
      generationId: "g1",
      index: 1,
      userId: "u1",
      maxVariants: 10,
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/projekty/p1");
  });

  it.each([[-1], [3], [0.5], [Number.NaN]])("niepoprawny numer strategii %s: VALIDATION bez operacji", async (index) => {
    expect(await saveStrategyAsVariantAction("p1", "v1", "g1", index)).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(m.saveStrategyAsVariant).not.toHaveBeenCalled();
  });

  it("pusty identyfikator generacji: VALIDATION", async () => {
    expect(await saveStrategyAsVariantAction("p1", "v1", "", 0)).toMatchObject({ ok: false, error: "VALIDATION" });
  });

  it("już zapisana strategia: jawny wynik z id istniejącego wariantu, bez wyjątku i rewalidacji", async () => {
    m.saveStrategyAsVariant.mockResolvedValue({ ok: false, error: "ALREADY_SAVED", variantId: "v-istniejacy" });

    const result = await saveStrategyAsVariantAction("p1", "v1", "g1", 0);

    expect(result).toEqual({
      ok: false,
      error: "ALREADY_SAVED",
      message: "Ta strategia została już zapisana jako wariant.",
      variantId: "v-istniejacy",
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("limit wariantów, brak generacji i uszkodzone strategie: komunikaty po polsku", async () => {
    m.saveStrategyAsVariant.mockResolvedValue({ ok: false, error: "LIMIT" });
    expect(await saveStrategyAsVariantAction("p1", "v1", "g1", 0)).toMatchObject({
      ok: false,
      error: "LIMIT",
      message: expect.stringContaining("limit 10 wariantów"),
    });

    m.saveStrategyAsVariant.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
    expect(await saveStrategyAsVariantAction("p1", "v1", "g1", 0)).toMatchObject({ ok: false, error: "NOT_FOUND" });

    m.saveStrategyAsVariant.mockResolvedValue({ ok: false, error: "INVALID_INDEX" });
    expect(await saveStrategyAsVariantAction("p1", "v1", "g1", 0)).toMatchObject({ ok: false, error: "INVALID_GENERATION" });
  });
});

describe("getStrategyGenerationAction (VIEWER+)", () => {
  it("wymaga roli VIEWER przed jakimkolwiek odczytem i czyta po projectId ORAZ variantId", async () => {
    const result = await getStrategyGenerationAction("p1", "v1", "g1");

    expect(m.requireProjectRole).toHaveBeenCalledWith("p1", "VIEWER");
    expect(m.getStrategyGeneration).toHaveBeenCalledWith("p1", "v1", "g1");
    expect(result).toEqual({ ok: true, item: { ok: true, generation: { id: "g1" } } });
  });

  it("brak dostępu: FORBIDDEN bez odczytu", async () => {
    m.requireProjectRole.mockResolvedValue(forbidden);

    expect(await getStrategyGenerationAction("p1", "v1", "g1")).toMatchObject({ ok: false, error: "FORBIDDEN" });
    expect(m.getStrategyGeneration).not.toHaveBeenCalled();
  });

  it("niepoprawne identyfikatory: VALIDATION; brak rekordu (obcy projekt lub wariant): NOT_FOUND", async () => {
    expect(await getStrategyGenerationAction("p1", "", "g1")).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(await getStrategyGenerationAction("p1", "v1", "")).toMatchObject({ ok: false, error: "VALIDATION" });
    expect(m.getStrategyGeneration).not.toHaveBeenCalled();

    m.getStrategyGeneration.mockResolvedValue(null);
    expect(await getStrategyGenerationAction("p1", "v-obcy", "g1")).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });
});
