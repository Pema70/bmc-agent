import { describe, expect, it } from "vitest";
import {
  SWITCH_BLOCKED_MESSAGE,
  formatVariantDate,
  pendingProposalsPhrase,
  setMainConfirmMessage,
  sortVariants,
  switchBlockReason,
  toVariantSummary,
  variantBadges,
  variantHref,
} from "@/lib/variants/presentation";

const base = { description: null, version: 1, updatedLabel: "x", entryCount: 0 } as const;

describe("sortVariants", () => {
  it("wariant główny pierwszy, potem od najnowszego", () => {
    const items = [
      { ...base, id: "a", name: "A", isMain: false, origin: "MANUAL" as const, createdAt: "2026-11-10T10:00:00.000Z" },
      { ...base, id: "b", name: "B", isMain: true, origin: "MANUAL" as const, createdAt: "2026-11-01T10:00:00.000Z" },
      { ...base, id: "c", name: "C", isMain: false, origin: "AI_STRATEGY" as const, createdAt: "2026-11-12T10:00:00.000Z" },
    ];

    expect(sortVariants(items).map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("przy tej samej dacie rozstrzyga id (deterministycznie) i nie zmienia wejścia", () => {
    const items = [
      { id: "a", isMain: false, createdAt: "2026-11-10T10:00:00.000Z" },
      { id: "b", isMain: false, createdAt: "2026-11-10T10:00:00.000Z" },
    ];
    const copy = [...items];

    expect(sortVariants(items).map((item) => item.id)).toEqual(["b", "a"]);
    expect(items).toEqual(copy);
  });

  it("pusta lista", () => {
    expect(sortVariants([])).toEqual([]);
  });
});

describe("variantBadges", () => {
  it("plakietki tekstowe dla głównego i strategii AI", () => {
    expect(variantBadges({ isMain: true, origin: "MANUAL" })).toEqual(["Główny"]);
    expect(variantBadges({ isMain: false, origin: "AI_STRATEGY" })).toEqual(["Strategia AI"]);
    expect(variantBadges({ isMain: true, origin: "AI_STRATEGY" })).toEqual(["Główny", "Strategia AI"]);
    expect(variantBadges({ isMain: false, origin: "MANUAL" })).toEqual([]);
  });
});

describe("switchBlockReason", () => {
  it("blokuje przełączenie tylko przy niezapisanych zmianach, z komunikatem z planu", () => {
    expect(switchBlockReason(true)).toBe("Najpierw zapisz albo cofnij swoje zmiany");
    expect(switchBlockReason(true)).toBe(SWITCH_BLOCKED_MESSAGE);
    expect(switchBlockReason(false)).toBeNull();
  });
});

describe("variantHref", () => {
  it("główny bez parametru, pozostałe z zakodowanym id", () => {
    expect(variantHref("p1", { id: "v1", isMain: true })).toBe("/projekty/p1");
    expect(variantHref("p1", { id: "v2", isMain: false })).toBe("/projekty/p1?wariant=v2");
    expect(variantHref("p1", { id: "a&b=c", isMain: false })).toBe("/projekty/p1?wariant=a%26b%3Dc");
  });
});

describe("pendingProposalsPhrase", () => {
  it.each([
    [1, "1 oczekującą propozycję"],
    [2, "2 oczekujące propozycje"],
    [4, "4 oczekujące propozycje"],
    [5, "5 oczekujących propozycji"],
    [12, "12 oczekujących propozycji"],
    [14, "14 oczekujących propozycji"],
    [22, "22 oczekujące propozycje"],
    [25, "25 oczekujących propozycji"],
  ])("%i -> %s", (count, expected) => {
    expect(pendingProposalsPhrase(count)).toBe(expected);
  });
});

describe("setMainConfirmMessage", () => {
  it("bez oczekujących propozycji nie wspomina o propozycjach", () => {
    const text = setMainConfirmMessage({ name: "Wariant B", pendingOnOldMain: 0 });
    expect(text).toContain("Ustawić „Wariant B” jako wariant główny?");
    expect(text).not.toContain("propozycj");
  });

  it("podaje liczbę oczekujących propozycji na starym głównym i że zostają na nim", () => {
    const text = setMainConfirmMessage({ name: "Wariant B", pendingOnOldMain: 3 });
    expect(text).toContain("3 oczekujące propozycje");
    expect(text).toContain("Zostaną na nim");
    expect(text).toContain("Status nieznany");
  });
});

describe("toVariantSummary i formatVariantDate", () => {
  it("zamienia daty na tekst, bez stanu, z datą w strefie Europe/Warsaw", () => {
    const summary = toVariantSummary({
      id: "v1",
      name: "W",
      isMain: true,
      origin: "MANUAL",
      description: null,
      version: 2,
      createdAt: new Date("2026-11-10T10:00:00Z"),
      updatedAt: new Date("2026-11-11T10:00:00Z"),
      entryCount: 7,
    });

    expect(summary.createdAt).toBe("2026-11-10T10:00:00.000Z");
    expect(summary.updatedLabel).toBe(formatVariantDate(new Date("2026-11-11T10:00:00Z")));
    expect(summary.updatedLabel).toContain("11:00");
    expect(summary).not.toHaveProperty("state");
  });
});
