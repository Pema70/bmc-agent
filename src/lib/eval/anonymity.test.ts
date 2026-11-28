import { describe, expect, it } from "vitest";
import { findForbiddenTokens, normalizeForMatch } from "@/lib/eval/anonymity";
import { ALL_CASES, BUILD_CASES, forbiddenTokens } from "@/lib/eval/cases";
import { EVAL_PROJECT_DESCRIPTION, buildEvalProjectName, isValidSeriesId } from "@/lib/eval/naming";

// Wszystkie zakazane tokeny wszystkich przypadków BUILD naraz: nazwa projektu i opis nie mogą zdradzać żadnej firmy.
const ALL_TOKENS = BUILD_CASES.flatMap((c) => forbiddenTokens(c));

describe("anonimizacja: wykrywanie tokenów", () => {
  it("normalizuje wielkość liter, polskie znaki i znaki specjalne", () => {
    expect(normalizeForMatch("Łódź, ZAŻÓŁĆ-gęślą")).toBe("lodz zazolc gesla");
  });

  it("łapie nazwę w odmianie i z apostrofem, krótkie tokeny tylko jako całe słowa", () => {
    expect(findForbiddenTokens("Dane z Netflixa i Spotify’a", ["Netflix", "Spotify"])).toEqual(["Netflix", "Spotify"]);
    expect(findForbiddenTokens("AIRBNB oraz air bnb", ["Airbnb", "Air Bnb"])).toEqual(["Airbnb", "Air Bnb"]);
    expect(findForbiddenTokens("zielony ekran", ["Ek"])).toEqual([]);
    expect(findForbiddenTokens("założył go Ek", ["Ek"])).toEqual(["Ek"]);
  });
});

describe("anonimizacja przypadków BUILD", () => {
  for (const buildCase of BUILD_CASES) {
    const own = forbiddenTokens(buildCase);

    it(`${buildCase.id}: opis i wszystkie wiadomości skryptu nie zawierają nazwy ani aliasów żadnej firmy`, () => {
      expect(findForbiddenTokens(buildCase.description, ALL_TOKENS), "opis").toEqual([]);
      buildCase.messages.forEach((message, index) => {
        expect(findForbiddenTokens(message, ALL_TOKENS), `wiadomość ${index + 1}`).toEqual([]);
      });
      expect(own.length).toBeGreaterThan(0);
    });
  }
});

describe("anonimizacja projektów pomiarowych (nazwa i opis widoczne dla czatu i evaluate-v1)", () => {
  const seriesIds = ["PILOT-1", "S2026-12", "A"];

  it("nazwa i opis projektu nie zawierają żadnego zakazanego tokenu dla wszystkich przypadków, powtórzeń i prób", () => {
    for (const seriesId of seriesIds) {
      for (const definition of ALL_CASES) {
        for (const repetition of [1, 2, 3]) {
          for (const attempt of [1, 2, 3]) {
            const name = buildEvalProjectName({ seriesId, caseId: definition.id, repetition, attempt });
            expect(findForbiddenTokens(name, ALL_TOKENS), name).toEqual([]);
          }
        }
      }
    }
    expect(findForbiddenTokens(EVAL_PROJECT_DESCRIPTION, ALL_TOKENS)).toEqual([]);
  });

  it("opis projektu jest neutralny: bez słów o teście, pomiarze, ewaluacji czy serii", () => {
    expect(EVAL_PROJECT_DESCRIPTION).toBe("Nowy model biznesowy.");
    expect(normalizeForMatch(EVAL_PROJECT_DESCRIPTION)).not.toMatch(/test|pomiar|ewaluac|serii|przyklad/);
  });

  it("nazwa projektu zawiera tylko identyfikator serii i przypadku, powtórzenie i próbę", () => {
    expect(buildEvalProjectName({ seriesId: "PILOT-1", caseId: "BUILD-03", repetition: 1 })).toBe("EV-PILOT-1-BUILD-03-p1");
    expect(buildEvalProjectName({ seriesId: "PILOT-1", caseId: "BUILD-03", repetition: 2, attempt: 2 })).toBe("EV-PILOT-1-BUILD-03-p2-a2");
  });

  it("identyfikator serii: litery, cyfry i myślniki; odrzuca resztę (w tym nazwy własne ze spacjami i polskimi znakami)", () => {
    expect(isValidSeriesId("PILOT-1")).toBe(true);
    expect(isValidSeriesId("")).toBe(false);
    expect(isValidSeriesId("-A")).toBe(false);
    expect(isValidSeriesId("seria z spacją")).toBe(false);
    expect(isValidSeriesId("Łódź")).toBe(false);
    expect(isValidSeriesId("A".repeat(25))).toBe(false);
    expect(() => buildEvalProjectName({ seriesId: "zła seria", caseId: "BUILD-01", repetition: 1 })).toThrow();
  });
});
