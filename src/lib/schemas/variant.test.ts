import { describe, expect, it } from "vitest";
import { BLOCK_KEYS } from "@/lib/schemas/bmc";
import {
  CreateVariantInput,
  RenameVariantInput,
  SetMainVariantInput,
  StrategiesOutput,
  VariantDescription,
  VariantName,
} from "@/lib/schemas/variant";

function generatedState(perBlock = 1): Record<string, string[]> {
  return Object.fromEntries(BLOCK_KEYS.map((key) => [key, Array.from({ length: perBlock }, (_, i) => `Wpis ${key} ${i}`)]));
}

function strategy(name = "Strategia A", perBlock = 1) {
  return { name, assumption: "Założenie strategii.", state: generatedState(perBlock) };
}

describe("VariantName i VariantDescription", () => {
  it("przycina spacje, wymaga 1-80 znaków", () => {
    expect(VariantName.parse("  Wariant B ")).toBe("Wariant B");
    expect(VariantName.safeParse("").success).toBe(false);
    expect(VariantName.safeParse("   ").success).toBe(false);
    expect(VariantName.safeParse("a".repeat(80)).success).toBe(true);
    expect(VariantName.safeParse("a".repeat(81)).success).toBe(false);
    expect(VariantName.safeParse(5).success).toBe(false);
  });

  it("opis do 400 znaków, może być pusty", () => {
    expect(VariantDescription.safeParse("").success).toBe(true);
    expect(VariantDescription.safeParse("a".repeat(400)).success).toBe(true);
    expect(VariantDescription.safeParse("a".repeat(401)).success).toBe(false);
  });
});

describe("wejścia akcji wariantów", () => {
  it("CreateVariantInput: tylko sourceVariantId, bez dodatkowych kluczy (nazwę nadaje serwer)", () => {
    expect(CreateVariantInput.safeParse({ sourceVariantId: "v1" }).success).toBe(true);
    expect(CreateVariantInput.safeParse({ sourceVariantId: "v1", name: "X" }).success).toBe(false);
    expect(CreateVariantInput.safeParse({ sourceVariantId: "" }).success).toBe(false);
    expect(CreateVariantInput.safeParse({}).success).toBe(false);
  });

  it("RenameVariantInput: id i poprawna nazwa", () => {
    expect(RenameVariantInput.safeParse({ variantId: "v1", name: "Nowa" }).success).toBe(true);
    expect(RenameVariantInput.safeParse({ variantId: "v1", name: " " }).success).toBe(false);
    expect(RenameVariantInput.safeParse({ variantId: "v1", name: "Nowa", extra: 1 }).success).toBe(false);
  });

  it("SetMainVariantInput: expectedMainId to id albo null, nie brak", () => {
    expect(SetMainVariantInput.safeParse({ variantId: "v2", expectedMainId: "v1" }).success).toBe(true);
    expect(SetMainVariantInput.safeParse({ variantId: "v2", expectedMainId: null }).success).toBe(true);
    expect(SetMainVariantInput.safeParse({ variantId: "v2" }).success).toBe(false);
    expect(SetMainVariantInput.safeParse({ variantId: "v2", expectedMainId: "" }).success).toBe(false);
  });
});

describe("StrategiesOutput", () => {
  it("przyjmuje 2 i 3 strategie", () => {
    expect(StrategiesOutput.safeParse({ strategies: [strategy("A"), strategy("B")] }).success).toBe(true);
    expect(StrategiesOutput.safeParse({ strategies: [strategy("A"), strategy("B"), strategy("C")] }).success).toBe(true);
  });

  it("odrzuca 1 i 4 strategie oraz brak listy", () => {
    expect(StrategiesOutput.safeParse({ strategies: [strategy()] }).success).toBe(false);
    expect(StrategiesOutput.safeParse({ strategies: [strategy("A"), strategy("B"), strategy("C"), strategy("D")] }).success).toBe(false);
    expect(StrategiesOutput.safeParse({}).success).toBe(false);
  });

  it("limit 4 wpisów na blok", () => {
    expect(StrategiesOutput.safeParse({ strategies: [strategy("A", 4), strategy("B", 4)] }).success).toBe(true);
    expect(StrategiesOutput.safeParse({ strategies: [strategy("A", 5), strategy("B")] }).success).toBe(false);
  });

  it("wpis do 200 znaków, niepusty", () => {
    const longEntry = { ...strategy("A"), state: { ...generatedState(), channels: ["a".repeat(201)] } };
    const okEntry = { ...strategy("A"), state: { ...generatedState(), channels: ["a".repeat(200)] } };
    const emptyEntry = { ...strategy("A"), state: { ...generatedState(), channels: ["  "] } };
    expect(StrategiesOutput.safeParse({ strategies: [longEntry, strategy("B")] }).success).toBe(false);
    expect(StrategiesOutput.safeParse({ strategies: [okEntry, strategy("B")] }).success).toBe(true);
    expect(StrategiesOutput.safeParse({ strategies: [emptyEntry, strategy("B")] }).success).toBe(false);
  });

  it("wymaga wszystkich dziewięciu kluczy bloków i odrzuca nieznany klucz (zły blockKey)", () => {
    const withoutChannels = Object.fromEntries(Object.entries(generatedState()).filter(([key]) => key !== "channels"));
    expect(StrategiesOutput.safeParse({ strategies: [{ ...strategy("A"), state: withoutChannels }, strategy("B")] }).success).toBe(false);
    const extraKey = { ...strategy("A"), state: { ...generatedState(), nieznany_blok: ["x"] } };
    expect(StrategiesOutput.safeParse({ strategies: [extraKey, strategy("B")] }).success).toBe(false);
  });

  it("odrzuca dodatkowe klucze na każdym poziomie i zbyt długą nazwę lub założenie", () => {
    expect(StrategiesOutput.safeParse({ strategies: [strategy("A"), strategy("B")], id: "x" }).success).toBe(false);
    expect(StrategiesOutput.safeParse({ strategies: [{ ...strategy("A"), id: "x" }, strategy("B")] }).success).toBe(false);
    expect(StrategiesOutput.safeParse({ strategies: [strategy("a".repeat(81)), strategy("B")] }).success).toBe(false);
    expect(StrategiesOutput.safeParse({ strategies: [{ ...strategy("A"), assumption: "a".repeat(401) }, strategy("B")] }).success).toBe(false);
    expect(StrategiesOutput.safeParse({ strategies: [{ ...strategy("A"), assumption: "" }, strategy("B")] }).success).toBe(false);
  });
});
