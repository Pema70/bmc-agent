import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ProposeBlockChangeInput,
  ProposeBlockChangeModelInput,
  ProposeBlockChangeOutput,
  ResolveProposalInput,
} from "@/lib/schemas/proposal";

const base = { blockKey: "channels", rationale: "Klienci kupują online." };

describe("ProposeBlockChangeInput", () => {
  it("przyjmuje add z after i bez before (brak pola = null)", () => {
    expect(ProposeBlockChangeInput.parse({ ...base, operation: "add", after: "Sklep online" })).toEqual({
      ...base,
      operation: "add",
      before: null,
      after: "Sklep online",
    });
  });

  it("przyjmuje edit z before i after oraz remove z samym before", () => {
    expect(
      ProposeBlockChangeInput.safeParse({ ...base, operation: "edit", before: "Sklep", after: "Sklep online" }).success,
    ).toBe(true);
    expect(
      ProposeBlockChangeInput.safeParse({ ...base, operation: "remove", before: "Sklep", after: null }).success,
    ).toBe(true);
  });

  it("odrzuca add bez after albo z before", () => {
    expect(ProposeBlockChangeInput.safeParse({ ...base, operation: "add" }).success).toBe(false);
    expect(ProposeBlockChangeInput.safeParse({ ...base, operation: "add", before: "x", after: "y" }).success).toBe(
      false,
    );
  });

  it("odrzuca edit bez before lub bez after oraz bez zmiany tekstu", () => {
    expect(ProposeBlockChangeInput.safeParse({ ...base, operation: "edit", after: "y" }).success).toBe(false);
    expect(ProposeBlockChangeInput.safeParse({ ...base, operation: "edit", before: "x" }).success).toBe(false);
    expect(
      ProposeBlockChangeInput.safeParse({ ...base, operation: "edit", before: "x", after: "  x " }).success,
    ).toBe(false);
  });

  it("odrzuca remove bez before albo z after", () => {
    expect(ProposeBlockChangeInput.safeParse({ ...base, operation: "remove" }).success).toBe(false);
    expect(
      ProposeBlockChangeInput.safeParse({ ...base, operation: "remove", before: "x", after: "y" }).success,
    ).toBe(false);
  });

  it("odrzuca nieznany blok, nieznaną operację i niepoprawne typy", () => {
    expect(
      ProposeBlockChangeInput.safeParse({ ...base, blockKey: "nieznany", operation: "add", after: "x" }).success,
    ).toBe(false);
    expect(ProposeBlockChangeInput.safeParse({ ...base, operation: "replace", after: "x" }).success).toBe(false);
    expect(ProposeBlockChangeInput.safeParse({ ...base, operation: "add", after: 5 }).success).toBe(false);
  });

  it("odrzuca za długi i pusty wpis oraz niepoprawne uzasadnienie", () => {
    expect(ProposeBlockChangeInput.safeParse({ ...base, operation: "add", after: "a".repeat(501) }).success).toBe(
      false,
    );
    expect(ProposeBlockChangeInput.safeParse({ ...base, operation: "add", after: "   " }).success).toBe(false);
    expect(
      ProposeBlockChangeInput.safeParse({ ...base, rationale: "  ", operation: "add", after: "x" }).success,
    ).toBe(false);
    expect(
      ProposeBlockChangeInput.safeParse({ ...base, rationale: "a".repeat(1001), operation: "add", after: "x" })
        .success,
    ).toBe(false);
  });

  it("ignoruje dodatkowe pola, w tym podane przez model proposalId", () => {
    const parsed = ProposeBlockChangeInput.parse({
      ...base,
      operation: "add",
      after: "x",
      proposalId: "pr-evil",
      status: "ACCEPTED",
    });

    expect(parsed).not.toHaveProperty("proposalId");
    expect(parsed).not.toHaveProperty("status");
  });
});

describe("ProposeBlockChangeModelInput (schemat widziany przez model)", () => {
  // Regresja: Gemini pomijał nieobowiązkowe before/after i przy add wysyłał wejście bez after, co kończyło się
  // AI_InvalidToolInputError. W schemacie dla modelu oba pola są wymagane (z wartością null tam, gdzie nie dotyczą).
  const observed = {
    blockKey: "key_partnerships",
    operation: "add",
    rationale: "Dodanie lokalnych dostawców produktów spożywczych.",
  };

  it("w JSON Schema wymaga before i after (wartość null dozwolona)", () => {
    const schema = z.toJSONSchema(ProposeBlockChangeModelInput, { io: "input" }) as {
      required?: string[];
      properties: Record<string, unknown>;
    };

    expect(schema.required).toEqual(expect.arrayContaining(["blockKey", "operation", "before", "after", "rationale"]));
    expect(JSON.stringify(schema.properties.after)).toContain('"null"');
    expect(JSON.stringify(schema.properties.before)).toContain('"null"');
  });

  it("odrzuca wejście bez after i before (kształt z błędu w dzienniku)", () => {
    expect(ProposeBlockChangeModelInput.safeParse(observed).success).toBe(false);
  });

  it("odrzuca add bez pola before, bo model ma podać je jawnie jako null", () => {
    expect(ProposeBlockChangeModelInput.safeParse({ ...observed, after: "Rolnicy" }).success).toBe(false);
  });

  it("przyjmuje add z before: null, edit i remove z jawnymi polami", () => {
    expect(ProposeBlockChangeModelInput.safeParse({ ...observed, before: null, after: "Rolnicy" }).success).toBe(true);
    expect(
      ProposeBlockChangeModelInput.safeParse({ ...observed, operation: "edit", before: "Stary", after: "Nowy" }).success,
    ).toBe(true);
    expect(
      ProposeBlockChangeModelInput.safeParse({ ...observed, operation: "remove", before: "Stary", after: null }).success,
    ).toBe(true);
  });

  it("zachowuje reguły łączące operację z polami (add z before, remove z after)", () => {
    expect(ProposeBlockChangeModelInput.safeParse({ ...observed, before: "x", after: "y" }).success).toBe(false);
    expect(
      ProposeBlockChangeModelInput.safeParse({ ...observed, operation: "remove", before: "x", after: "y" }).success,
    ).toBe(false);
    expect(ProposeBlockChangeModelInput.safeParse({ ...observed, before: null, after: null }).success).toBe(false);
  });

  it("schemat dla historii i ponownej walidacji nadal przyjmuje zapisane wejścia bez before", () => {
    expect(ProposeBlockChangeInput.safeParse({ ...observed, after: "Rolnicy" }).success).toBe(true);
  });
});

describe("ProposeBlockChangeOutput", () => {
  it("przyjmuje sukces z propozycją i porażkę z powodem", () => {
    const proposal = { id: "pr1", blockKey: "channels", operation: "add", before: null, after: "x", rationale: "r" };
    expect(ProposeBlockChangeOutput.safeParse({ ok: true, proposal }).success).toBe(true);
    expect(ProposeBlockChangeOutput.safeParse({ ok: false, reason: "powód" }).success).toBe(true);
    expect(ProposeBlockChangeOutput.safeParse({ ok: true }).success).toBe(false);
  });
});

describe("ResolveProposalInput", () => {
  it("wymaga id i dodatniej całkowitej wersji", () => {
    expect(ResolveProposalInput.safeParse({ proposalId: "pr1", version: 1 }).success).toBe(true);
    expect(ResolveProposalInput.safeParse({ proposalId: "", version: 1 }).success).toBe(false);
    expect(ResolveProposalInput.safeParse({ proposalId: "pr1", version: 0 }).success).toBe(false);
    expect(ResolveProposalInput.safeParse({ proposalId: "pr1", version: 1.5 }).success).toBe(false);
  });
});
