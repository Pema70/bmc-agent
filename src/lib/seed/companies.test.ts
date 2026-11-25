import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCK_KEYS, BmcState } from "@/lib/schemas/bmc";
import { SEED_COMPANIES, SEED_PROJECT_PREFIX, SeedCompany } from "./companies";

const YEAR = /\b(19|20)\d{2}\b/g;

function allTexts(company: SeedCompany): string[] {
  return [company.description, ...BLOCK_KEYS.flatMap((key) => company.state[key])];
}

describe("SEED_COMPANIES", () => {
  it("zawiera siedem firm: trzy sukcesy, trzy upadki i fikcyjną kawiarnię", () => {
    expect(SEED_COMPANIES.map((c) => c.key)).toEqual([
      "netflix",
      "airbnb",
      "spotify",
      "blockbuster",
      "quibi",
      "juicero",
      "kawiarnia-ziarno",
    ]);
    expect(SEED_COMPANIES.filter((c) => c.outcome === "SUCCESS")).toHaveLength(3);
    expect(SEED_COMPANIES.filter((c) => c.outcome === "FAILURE")).toHaveLength(3);
    expect(SEED_COMPANIES.filter((c) => c.outcome === "FICTIONAL")).toHaveLength(1);
  });

  it("każdy model przechodzi BmcState i ma wpisy w każdym z dziewięciu bloków", () => {
    for (const company of SEED_COMPANIES) {
      expect(BmcState.safeParse(company.state).success, company.name).toBe(true);
      for (const key of BLOCK_KEYS) {
        expect(company.state[key].length, `${company.name}: ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("nazwy mają prefiks i są unikalne", () => {
    const names = SEED_COMPANIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.startsWith(SEED_PROJECT_PREFIX)).toBe(true);
  });

  it("wpisy i opisy nie zawierają liczb poza czterocyfrowym rokiem", () => {
    for (const company of SEED_COMPANIES) {
      for (const text of allTexts(company)) {
        expect(text.replace(YEAR, ""), `${company.name}: ${text}`).not.toMatch(/\d/);
      }
    }
  });

  it("opisy firm rzeczywistych zawierają zastrzeżenie o źródle", () => {
    for (const company of SEED_COMPANIES.filter((c) => c.outcome !== "FICTIONAL")) {
      expect(company.description).toContain("publicznie dostępne informacje");
    }
  });

  it("moduł nie odwołuje się do .env ani kluczy API", () => {
    for (const file of ["companies.ts", "run-seed.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf-8");
      expect(source).not.toMatch(/process\.loadEnvFile|dotenv|API_KEY|readFile/);
    }
  });
});
