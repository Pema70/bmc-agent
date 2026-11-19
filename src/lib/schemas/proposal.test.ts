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
  // Regresja 1: Gemini pomijał after i przy add wysyłał wejście bez niego (AI_InvalidToolInputError), więc after
  // jest wymagane (z jawnym null tam, gdzie nie dotyczy operacji).
  // Regresja 2 (po wymaganiu obu pól): model podawał after, ale pomijał before przy add, co też kończyło się
  // AI_InvalidToolInputError. before jest więc opcjonalne (brak pola = null), a reguły operacji pilnują reszty.
  const withoutAfter = {
    blockKey: "key_partnerships",
    operation: "add",
    rationale: "Dodanie lokalnych dostawców produktów spożywczych.",
  };
  // Wejście z dziennika próbnej rozmowy (2026-11-19, 16:22): after jest, before pominięte.
  const fromLog = {
    after: "Dostawa przez dedykowaną aplikację mobilną integrującą zamówienia i czas dostawy.",
    blockKey: "channels",
    operation: "add",
    rationale: "Dodanie kanału cyfrowego ułatwia zamawianie.",
  };

  it("w JSON Schema wymaga after (z null), a before zostawia opcjonalne", () => {
    const schema = z.toJSONSchema(ProposeBlockChangeModelInput, { io: "input" }) as {
      required?: string[];
      properties: Record<string, unknown>;
    };

    expect(schema.required).toEqual(expect.arrayContaining(["blockKey", "operation", "after", "rationale"]));
    expect(schema.required).not.toContain("before");
    expect(JSON.stringify(schema.properties.after)).toContain('"null"');
    expect(JSON.stringify(schema.properties.before)).toContain('"null"');
  });

  it("przyjmuje wejście z dziennika (add z after i bez before)", () => {
    const parsed = ProposeBlockChangeModelInput.safeParse(fromLog);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ operation: "add", before: null, after: fromLog.after });
  });

  it("odrzuca add bez after (kształt z pierwszego błędu w dzienniku)", () => {
    expect(ProposeBlockChangeModelInput.safeParse(withoutAfter).success).toBe(false);
  });

  it("przyjmuje add z before: null, edit i remove z jawnymi polami", () => {
    expect(ProposeBlockChangeModelInput.safeParse({ ...fromLog, before: null }).success).toBe(true);
    expect(
      ProposeBlockChangeModelInput.safeParse({ ...fromLog, operation: "edit", before: "Stary", after: "Nowy" }).success,
    ).toBe(true);
    expect(
      ProposeBlockChangeModelInput.safeParse({ ...fromLog, operation: "remove", before: "Stary", after: null }).success,
    ).toBe(true);
  });

  it("zachowuje reguły łączące operację z polami (add z before, edit/remove bez before, remove z after)", () => {
    expect(ProposeBlockChangeModelInput.safeParse({ ...fromLog, before: "x" }).success).toBe(false);
    expect(ProposeBlockChangeModelInput.safeParse({ ...fromLog, operation: "edit", after: "y" }).success).toBe(false);
    expect(
      ProposeBlockChangeModelInput.safeParse({ ...fromLog, operation: "remove", before: "x", after: "y" }).success,
    ).toBe(false);
    expect(ProposeBlockChangeModelInput.safeParse({ ...fromLog, after: null }).success).toBe(false);
  });

  it("znane ograniczenie: remove bez jawnego after: null jest odrzucone", () => {
    expect(
      ProposeBlockChangeModelInput.safeParse({
        blockKey: "channels",
        operation: "remove",
        before: "Stary",
        rationale: "Nieaktualny kanał.",
      }).success,
    ).toBe(false);
  });

  it("schemat dla historii i ponownej walidacji nadal przyjmuje zapisane wejścia bez before", () => {
    expect(ProposeBlockChangeInput.safeParse(fromLog).success).toBe(true);
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
