import { describe, expect, it } from "vitest";
import { formatEvaluationDate, formatEvaluationSource, isEvaluationStale } from "@/lib/evaluation/format";

describe("formatEvaluationDate", () => {
  it("formatuje datę w UTC, niezależnie od strefy czasowej", () => {
    expect(formatEvaluationDate(new Date("2026-11-11T21:05:59Z"))).toBe("2026-11-11 21:05 UTC");
  });
});

describe("formatEvaluationSource", () => {
  it("podaje dostawcę i model dla oceny AI jako zwykły tekst", () => {
    expect(formatEvaluationSource({ source: "AI", provider: "google", model: "gemini-3.8-flash" })).toBe(
      "Ocena AI: google / gemini-3.8-flash",
    );
  });

  it("nie interpretuje znaczników HTML z bazy", () => {
    expect(formatEvaluationSource({ source: "AI", provider: "<b>x</b>", model: "<img>" })).toBe(
      "Ocena AI: <b>x</b> / <img>",
    );
  });

  it("oznacza ocenę ręczną", () => {
    expect(formatEvaluationSource({ source: "MANUAL", provider: null, model: null })).toBe("Ocena ręczna");
  });
});

describe("isEvaluationStale", () => {
  it("jest nieaktualna tylko dla starszej wersji modelu", () => {
    expect(isEvaluationStale(2, 3)).toBe(true);
    expect(isEvaluationStale(3, 3)).toBe(false);
  });
});
