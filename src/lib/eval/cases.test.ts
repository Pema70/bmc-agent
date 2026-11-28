import { describe, expect, it } from "vitest";
import { BLOCK_KEYS } from "@/lib/schemas/bmc";
import { SEED_COMPANIES } from "@/lib/seed/companies";
import {
  ALL_CASES,
  BUILD_CASES,
  BUILD_FINAL_MESSAGE,
  CHAT_CASES,
  EVAL_CASES,
  MINIMAL_BUILD_CASE_IDS,
  FROZEN_CASES_CHECKSUM,
  casesChecksum,
  checkCasesFrozen,
  coveredBlocks,
  forbiddenTokens,
  getCase,
} from "@/lib/eval/cases";

// Zmiana treści przypadków (albo stanu firm z seeda użytych w EVAL i fixture'ach CHAT) zmienia sumę kontrolną i wymaga
// świadomej decyzji właściciela oraz nowej serii pomiarów; nie aktualizuj FROZEN_CASES_CHECKSUM "dla zielonych testów".

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

  it("jest zamrożony: suma kontrolna zgadza się z zapisaną w FROZEN_CASES_CHECKSUM", () => {
    expect(FROZEN_CASES_CHECKSUM).not.toBeNull();
    expect(casesChecksum()).toBe(FROZEN_CASES_CHECKSUM);
    expect(checkCasesFrozen()).toEqual({ frozen: true });
  });

  it("checkCasesFrozen: pusta suma to NOT_FROZEN, inna suma to MISMATCH, komunikaty po polsku", () => {
    expect(checkCasesFrozen("abc", null)).toMatchObject({ frozen: false, reason: "NOT_FROZEN", message: expect.stringContaining("nie jest zamrożony") });
    expect(checkCasesFrozen("abc", "def")).toMatchObject({ frozen: false, reason: "MISMATCH", message: expect.stringContaining("różni się od zamrożonego") });
    expect(checkCasesFrozen("abc", "abc")).toEqual({ frozen: true });
  });

  it("BUILD-07: jeden segment klientów (bez duplikatu z seeda) i stan EVAL-07 zgodny z poprawionym seedem", () => {
    const juicero = SEED_COMPANIES.find((c) => c.key === "juicero");
    expect(juicero?.state.customer_segments).toEqual(["Klienci gotowi zapłacić więcej za wygodę i świeży sok w domu"]);
    expect(BUILD_CASES.find((c) => c.id === "BUILD-07")?.messages[1]).toBe(
      "Klienci to osoby gotowe zapłacić więcej za wygodę i świeży sok w domu. Mają konto klienta w aplikacji i obsługę klienta przez internet.",
    );
    expect(EVAL_CASES.find((c) => c.id === "EVAL-07")?.companyKey).toBe("juicero");
  });

  it("suma kontrolna to SHA-256 w zapisie szesnastkowym", () => {
    expect(casesChecksum()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("suma kontrolna jest deterministyczna i zależy od treści (zmiana wiadomości zmienia sumę)", () => {
    expect(casesChecksum()).toBe(casesChecksum());
    const before = casesChecksum();
    const original = BUILD_CASES[0].messages[1];
    (BUILD_CASES[0].messages as string[])[1] = `${original} (zmiana)`;
    try {
      expect(casesChecksum()).not.toBe(before);
    } finally {
      (BUILD_CASES[0].messages as string[])[1] = original;
    }
    expect(casesChecksum()).toBe(before);
    expect(casesChecksum()).toBe(FROZEN_CASES_CHECKSUM);
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

  it("BUILD: każdy przypadek opisuje wszystkie 9 bloków BMC (komplet), a ostatnia wiadomość i pierwsza nie opisują bloków", () => {
    for (const buildCase of BUILD_CASES) {
      expect(buildCase.coverage, buildCase.id).toHaveLength(buildCase.messages.length);
      expect(coveredBlocks(buildCase), buildCase.id).toEqual([...BLOCK_KEYS]);
      expect(buildCase.coverage[0], `${buildCase.id} wiadomość 1`).toEqual([]);
      expect(buildCase.coverage.at(-1), `${buildCase.id} polecenie końcowe`).toEqual([]);
    }
  });

  it("BUILD: jednolita forma pierwszej wiadomości i brak etykiet „Firma X” w treści (etykieta tylko jako pole wewnętrzne)", () => {
    for (const buildCase of BUILD_CASES) {
      const opening =
        buildCase.id === "BUILD-01"
          ? "Chcę otworzyć kawiarnię. Pomóż mi zbudować model biznesowy. Planuję "
          : "Pomóż mi zbudować model biznesowy. Prowadzę ";
      expect(buildCase.messages[0], buildCase.id).toBe(`${opening}${buildCase.description.replace(/^(Planuję|Prowadzę) /, "")}`);
      for (const text of [buildCase.description, ...buildCase.messages]) {
        expect(text, buildCase.id).not.toMatch(/\bFirma [A-Z]\b/);
      }
    }
    expect(BUILD_CASES.filter((c) => c.label).map((c) => c.label)).toEqual([
      "Firma A", "Firma B", "Firma C", "Firma D", "Firma E", "Firma F",
    ]);
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
