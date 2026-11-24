import { describe, expect, it } from "vitest";
import {
  INFERRED_SUFFIX,
  MANUAL_EDIT_NOTE,
  SOURCE_CODE_LEGEND,
  SOURCE_LEGEND_NOTE,
  sourceCode,
  sourceLabel,
} from "@/lib/report/labels";
import type { OriginInfo } from "@/lib/report/provenance";

const base: OriginInfo = {
  kind: "PROPOSAL",
  proposalId: undefined,
  sourceKind: undefined,
  attachmentName: undefined,
  roundNumber: undefined,
  questionIndex: undefined,
  strategyName: undefined,
};
const proposal = (extra: Partial<OriginInfo>): OriginInfo => ({ ...base, ...extra });

describe("sourceLabel: etykiety źródeł wpisów", () => {
  it("każdy rodzaj źródła ma ustaloną etykietę (pewność ZAPISANE)", () => {
    expect(sourceLabel({ ...base, kind: "MANUAL" }, "ZAPISANE")).toBe("ręczny (tekst użytkownika)");
    expect(sourceLabel(proposal({ sourceKind: "CONVERSATION" }), "ZAPISANE")).toBe("propozycja agenta w rozmowie (zaakceptowana)");
    expect(sourceLabel(proposal({ sourceKind: "ATTACHMENT", attachmentName: "Opis.pdf" }), "ZAPISANE")).toBe(
      "propozycja agenta na podstawie załącznika Opis.pdf",
    );
    expect(sourceLabel(proposal({ sourceKind: "REFINEMENT", roundNumber: 2, questionIndex: 0 }), "ZAPISANE")).toBe(
      "propozycja z cyklu poprawek, runda 2, pytanie 1 (na podstawie odpowiedzi użytkownika)",
    );
    expect(sourceLabel(proposal({ sourceKind: "MODEL_KNOWLEDGE" }), "ZAPISANE")).toBe("wiedza modelu (deklaracja agenta, niezweryfikowana)");
    expect(sourceLabel({ ...base, kind: "STRATEGY", strategyName: "Model subskrypcyjny" }, "ZAPISANE")).toBe("strategia AI Model subskrypcyjny");
    expect(sourceLabel(null, "NIEZNANE")).toBe("źródło nieznane");
  });

  it("przy pewności „ustalone po tekście” dopisuje, że to prawdopodobne", () => {
    const label = sourceLabel(proposal({ sourceKind: "CONVERSATION" }), "USTALONE_PO_TEKSCIE");

    expect(label).toBe(`propozycja agenta w rozmowie (zaakceptowana)${INFERRED_SUFFIX}`);
    expect(INFERRED_SUFFIX).toContain("prawdopodobne");
  });

  it("brak zapisu albo pewność NIEZNANE zawsze daje „źródło nieznane”, nawet gdy podano pochodzenie", () => {
    expect(sourceLabel(proposal({ sourceKind: "ATTACHMENT", attachmentName: "x" }), "NIEZNANE")).toBe("źródło nieznane");
    expect(sourceLabel(null, "ZAPISANE")).toBe("źródło nieznane");
  });

  it("numer pytania w raporcie liczony od 1 (zapis od 0), a brak numerów nie daje „undefined” w tekście", () => {
    expect(sourceLabel(proposal({ sourceKind: "REFINEMENT", roundNumber: 1, questionIndex: 2 }), "ZAPISANE")).toContain("pytanie 3");
    const partial = sourceLabel(proposal({ sourceKind: "REFINEMENT", roundNumber: 3 }), "ZAPISANE");
    expect(partial).toBe("propozycja z cyklu poprawek, runda 3 (na podstawie odpowiedzi użytkownika)");
    expect(sourceLabel(proposal({ sourceKind: "REFINEMENT" }), "ZAPISANE")).toBe("propozycja z cyklu poprawek (na podstawie odpowiedzi użytkownika)");
    expect(sourceLabel(proposal({ sourceKind: "ATTACHMENT" }), "ZAPISANE")).not.toContain("undefined");
    expect(sourceLabel({ ...base, kind: "STRATEGY" }, "ZAPISANE")).toBe("strategia AI");
  });

  it("żadna etykieta propozycji AI nie nazywa treści „ręczną” ani „użytkownika” poza dopiskiem przy cyklu poprawek", () => {
    const aiOrigins: OriginInfo[] = [
      proposal({ sourceKind: "CONVERSATION" }),
      proposal({ sourceKind: "ATTACHMENT", attachmentName: "a.txt" }),
      proposal({ sourceKind: "MODEL_KNOWLEDGE" }),
      { ...base, kind: "STRATEGY", strategyName: "S" },
    ];
    for (const origin of aiOrigins) {
      for (const certainty of ["ZAPISANE", "USTALONE_PO_TEKSCIE"] as const) {
        const label = sourceLabel(origin, certainty);
        expect(label, label).not.toMatch(/ręczn|użytkownik/i);
      }
    }
    const refinement = sourceLabel(proposal({ sourceKind: "REFINEMENT", roundNumber: 1, questionIndex: 0 }), "ZAPISANE");
    expect(refinement.replace("(na podstawie odpowiedzi użytkownika)", "")).not.toMatch(/ręczn|użytkownik/i);
    // „ręczny” oznacza wyłącznie pochodzenie MANUAL.
    expect(sourceLabel({ ...base, kind: "MANUAL" }, "ZAPISANE")).toMatch(/ręczny/);
  });

  it("nazwa załącznika to zwykły tekst: znaczniki zostają, znaki sterujące i zmiany kierunku są usuwane", () => {
    const label = sourceLabel(
      proposal({ sourceKind: "ATTACHMENT", attachmentName: `</attachment><b>x</b>‮\u0000.pdf` }),
      "ZAPISANE",
    );

    expect(label).toBe("propozycja agenta na podstawie załącznika </attachment><b>x</b>.pdf");
  });
});

describe("sourceCode i legenda", () => {
  it("kody literowe odpowiadają rodzajom źródeł", () => {
    expect(sourceCode(null)).toBe("?");
    expect(sourceCode({ ...base, kind: "MANUAL" })).toBe("R");
    expect(sourceCode(proposal({ sourceKind: "CONVERSATION" }))).toBe("Rz");
    expect(sourceCode(proposal({ sourceKind: "ATTACHMENT" }))).toBe("Z");
    expect(sourceCode(proposal({ sourceKind: "REFINEMENT" }))).toBe("P");
    expect(sourceCode(proposal({ sourceKind: "MODEL_KNOWLEDGE" }))).toBe("W");
    expect(sourceCode({ ...base, kind: "STRATEGY" })).toBe("S");
  });

  it("legenda ma wszystkie kody dokładnie raz i pełne znaczenia", () => {
    const codes = SOURCE_CODE_LEGEND.map((item) => item.code);

    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(["?", "P", "R", "Rz", "S", "W", "Z"]);
    expect(SOURCE_CODE_LEGEND.find((item) => item.code === "R")?.meaning).toBe("ręczny (tekst użytkownika)");
  });

  it("legenda zawiera zdanie, że propozycja w rozmowie nie oznacza treści podanej przez użytkownika", () => {
    expect(SOURCE_LEGEND_NOTE).toContain("nie oznacza, że treść podał użytkownik");
    expect(SOURCE_LEGEND_NOTE).toContain("wiedza modelu");
  });

  it("uwaga o ręcznej edycji propozycji mówi, że raport nie śledzi edycji", () => {
    expect(MANUAL_EDIT_NOTE).toContain("nie śledzi edycji");
    expect(MANUAL_EDIT_NOTE).toContain("zaproponowany wcześniej przez agenta");
  });
});
