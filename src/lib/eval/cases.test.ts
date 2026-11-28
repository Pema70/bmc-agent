import { describe, expect, it } from "vitest";
import { SEED_COMPANIES } from "@/lib/seed/companies";
import {
  ALL_CASES,
  BUILD_CASES,
  BUILD_FINAL_MESSAGE,
  CHAT_CASES,
  EVAL_CASES,
  MINIMAL_BUILD_CASE_IDS,
  casesChecksum,
  forbiddenTokens,
  getCase,
} from "@/lib/eval/cases";

// Suma kontrolna zamrożonego zestawu. Zmiana treści przypadków (albo stanu firm z seeda użytych w EVAL i fixture'ach CHAT)
// zmienia ją i wymaga świadomej decyzji właściciela oraz nowej serii pomiarów; nie aktualizuj jej "dla zielonych testów".
const FROZEN_CHECKSUM = "627a8b6ef9c89888a66ffd1ddeccbd235f0cc4ee20dbac3706e12c7b72e06058";

describe("zestaw przypadków ewaluacji", () => {
  it("ma 7 przypadków BUILD, 7 EVAL i 5 CHAT z unikalnymi identyfikatorami", () => {
    expect(BUILD_CASES).toHaveLength(7);
    expect(EVAL_CASES).toHaveLength(7);
    expect(CHAT_CASES).toHaveLength(5);
    const ids = ALL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "BUILD-01", "BUILD-02", "BUILD-03", "BUILD-04", "BUILD-05", "BUILD-06", "BUILD-07",
      "EVAL-01", "EVAL-02", "EVAL-03", "EVAL-04", "EVAL-05", "EVAL-06", "EVAL-07",
      "CHAT-S1", "CHAT-S2", "CHAT-S3", "CHAT-S4", "CHAT-S5",
    ]);
  });

  it("jest zamrożony: suma kontrolna zgadza się z zapisaną", () => {
    expect(casesChecksum()).toBe(FROZEN_CHECKSUM);
  });

  it("suma kontrolna jest deterministyczna i zależy od treści (zmiana wiadomości zmienia sumę)", () => {
    expect(casesChecksum()).toBe(casesChecksum());
    const original = BUILD_CASES[0].messages[1];
    (BUILD_CASES[0].messages as string[])[1] = `${original} (zmiana)`;
    try {
      expect(casesChecksum()).not.toBe(FROZEN_CHECKSUM);
    } finally {
      (BUILD_CASES[0].messages as string[])[1] = original;
    }
    expect(casesChecksum()).toBe(FROZEN_CHECKSUM);
  });

  it("wariant minimalny BUILD: Kawiarnia Ziarno, Spotify, Quibi, Airbnb", () => {
    expect(MINIMAL_BUILD_CASE_IDS.map((id) => (getCase(id) as (typeof BUILD_CASES)[number]).trueName)).toEqual([
      "Kawiarnia Ziarno",
      "Spotify",
      "Quibi",
      "Airbnb",
    ]);
  });

  it("BUILD: 6 wiadomości, pierwsza zawiera opis, ostatnia to stałe polecenie, rodzaj wyniku zgodny z seedem", () => {
    for (const buildCase of BUILD_CASES) {
      const company = SEED_COMPANIES.find((c) => c.key === buildCase.companyKey);
      expect(company, buildCase.id).toBeDefined();
      expect(company?.outcome, buildCase.id).toBe(buildCase.outcome);
      expect(company?.name.endsWith(buildCase.trueName), buildCase.id).toBe(true);
      expect(buildCase.messages, buildCase.id).toHaveLength(6);
      expect(buildCase.messages[0], buildCase.id).toContain(buildCase.description);
      expect(buildCase.messages.at(-1), buildCase.id).toBe(BUILD_FINAL_MESSAGE);
    }
  });

  it("BUILD: lista zakazanych tokenów zawiera prawdziwą nazwę i aliasy", () => {
    const spotify = BUILD_CASES.find((c) => c.id === "BUILD-02");
    expect(spotify && forbiddenTokens(spotify)).toEqual(["Spotify", "Daniel Ek", "Martin Lorentzon", "Lorentzon", "Discover Weekly", "Sztokholm"]);
  });

  it("EVAL: siedem różnych firm z seeda, każda istnieje", () => {
    const keys = EVAL_CASES.map((c) => c.companyKey);
    expect(new Set(keys).size).toBe(7);
    for (const key of keys) {
      expect(SEED_COMPANIES.some((c) => c.key === key), key).toBe(true);
    }
  });

  it("CHAT: S1 z pustym modelem, S2 do S5 na Kawiarni Ziarno, S5 kontynuuje S3, S4 ma analizę wpływu po turze 1", () => {
    const byId = (id: string) => CHAT_CASES.find((c) => c.id === id);
    expect(byId("CHAT-S1")?.fixture).toBe("EMPTY");
    expect(byId("CHAT-S1")?.turns).toHaveLength(5);
    for (const id of ["CHAT-S2", "CHAT-S3", "CHAT-S4", "CHAT-S5"]) {
      expect(byId(id)?.fixture, id).toBe("kawiarnia-ziarno");
    }
    expect(byId("CHAT-S5")?.sameProjectAs).toBe("CHAT-S3");
    expect(byId("CHAT-S4")?.turns.map((t) => t.type)).toEqual(["message", "impact", "message"]);
    expect(byId("CHAT-S3")?.turns).toEqual([{ type: "message", text: "Oceń mój model." }]);
  });
});
