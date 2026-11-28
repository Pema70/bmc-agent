import { describe, expect, it } from "vitest";
import { parseEvalArgs } from "@/lib/eval/args";

function parse(args: string[], env: Record<string, string | undefined> = {}) {
  return parseEvalArgs(args, env);
}

describe("parseEvalArgs", () => {
  it("tryb na sucho jest domyślny, a bezpieczniki są opcjonalne bez --wykonaj", () => {
    const result = parse(["--serie", "PILOT-1", "--przypadki", "BUILD-01", "--modele", "gemini-3.5-flash-lite"]);
    expect(result).toMatchObject({ ok: true, config: { seriesId: "PILOT-1", caseIds: ["BUILD-01"], execute: false, repetitions: 1, judge: false, pauseMs: 0 } });
  });

  it("--wykonaj wymaga jawnego --max-koszt-usd i --max-tur (bez wartości domyślnych)", () => {
    const result = parse(["--serie", "S1", "--przypadki", "BUILD-01", "--modele", "gemini-3.5-flash-lite", "--wykonaj"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("--max-koszt-usd");
      expect(result.errors.join(" ")).toContain("--max-tur");
    }
    const ok = parse(["--serie", "S1", "--przypadki", "BUILD-01", "--modele", "gemini-3.5-flash-lite", "--wykonaj", "--max-koszt-usd", "0.10", "--max-tur", "8"]);
    expect(ok).toMatchObject({ ok: true, config: { execute: true, maxCostUsd: 0.1, maxTurns: 8 } });
  });

  it("model tylko z dozwolonej listy z models.ts; domyślnie LLM_MODEL z konfiguracji", () => {
    const bad = parse(["--serie", "S1", "--przypadki", "BUILD-01", "--modele", "gpt-6-luna"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toContain("spoza dozwolonej listy");

    const fromEnv = parse(["--serie", "S1", "--przypadki", "BUILD-01"], { LLM_MODEL: "gemini-3.5-flash-lite" });
    expect(fromEnv).toMatchObject({ ok: true, config: { models: ["gemini-3.5-flash-lite"] } });

    const none = parse(["--serie", "S1", "--przypadki", "BUILD-01"]);
    expect(none.ok).toBe(false);
  });

  it("grupy przypadków: minimalny (13 przypadków) i wszystkie (19), kolejność jak w zestawie", () => {
    const minimal = parse(["--serie", "S1", "--przypadki", "minimalny", "--modele", "gemini-3.5-flash-lite"]);
    expect(minimal.ok && minimal.config.caseIds).toHaveLength(13);
    const all = parse(["--serie", "S1", "--przypadki", "wszystkie", "--modele", "gemini-3.5-flash-lite"]);
    expect(all.ok && all.config.caseIds).toHaveLength(19);
    const mixed = parse(["--serie", "S1", "--przypadki", "EVAL-02,BUILD-01", "--modele", "gemini-3.5-flash-lite"]);
    expect(mixed.ok && mixed.config.caseIds).toEqual(["BUILD-01", "EVAL-02"]);
  });

  it("odrzuca nieznane przypadki, CHAT-S5 bez CHAT-S3, złą serię i nieznane argumenty", () => {
    const unknownCase = parse(["--serie", "S1", "--przypadki", "BUILD-99", "--modele", "gemini-3.5-flash-lite"]);
    expect(unknownCase.ok).toBe(false);
    const s5 = parse(["--serie", "S1", "--przypadki", "CHAT-S5", "--modele", "gemini-3.5-flash-lite"]);
    expect(s5.ok).toBe(false);
    const badSeries = parse(["--serie", "zła seria", "--przypadki", "BUILD-01", "--modele", "gemini-3.5-flash-lite"]);
    expect(badSeries.ok).toBe(false);
    const unknownFlag = parse(["--serie", "S1", "--przypadki", "BUILD-01", "--modele", "gemini-3.5-flash-lite", "--cos"]);
    expect(unknownFlag.ok).toBe(false);
  });

  it("limity wyjścia, powtórzenia i przerwa: zakresy i typy", () => {
    const ok = parse([
      "--serie", "S1", "--przypadki", "BUILD-01", "--modele", "gemini-3.5-flash-lite",
      "--max-wyjscia", "8000", "--max-wyjscia-dlugie", "16000", "--powtorzenia", "3", "--przerwa-ms", "500", "--sedzia", "--powtorz-niewazne",
    ]);
    expect(ok).toMatchObject({
      ok: true,
      config: { maxOutputTokens: 8000, maxOutputTokensLong: 16000, repetitions: 3, pauseMs: 500, judge: true, retryInvalid: true },
    });
    const bad = parse(["--serie", "S1", "--przypadki", "BUILD-01", "--modele", "gemini-3.5-flash-lite", "--max-wyjscia", "99999", "--powtorzenia", "x"]);
    expect(bad.ok).toBe(false);
  });
});
