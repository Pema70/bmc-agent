import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { renderReportPdf } from "@/lib/export/pdf/render";
import { buildReportExport } from "@/lib/export/report-export";
import { HOSTILE_NAME, reportData } from "@/lib/export/report-fixtures";
import { POLISH_LOWER, POLISH_UPPER } from "@/lib/export/test-fixtures";
import { MANUAL_EDIT_NOTE, SOURCE_LEGEND_NOTE } from "@/lib/report/labels";

const NOTICE_START = "Treści oznaczone „AI” to opinia modelu językowego";
const flatten = (value: string) => value.replace(/\s+/g, " ");

async function read(data = reportData()): Promise<{ flat: string; pages: number; pageTexts: string[] }> {
  const pdf = await renderReportPdf(buildReportExport(data));
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text, totalPages } = await extractText(doc, { mergePages: false });
  return { flat: flatten(text.join("\n")), pages: totalPages, pageTexts: text };
}

function emptied(): ReturnType<typeof reportData> {
  const base = reportData();
  return {
    ...base,
    origins: { entries: [], corrupt: false, counts: { total: 0, saved: 0, inferred: 0, unknown: 0 } },
    blocks: base.blocks.map((block) => ({ ...block, entryCount: 0, entries: [], breakdown: [], withoutRationale: 0 })),
    attachments: [],
    evaluations: { items: [], truncated: false, limit: 20 },
    rounds: [],
    impacts: { items: [], truncated: false, limit: 20 },
    comparisons: { items: [], truncated: false, limit: 10 },
    llmSummary: [],
  };
}

describe("PDF rozszerzonego raportu", () => {
  it("ma wszystkie sekcje, polskie litery i dane projektu", async () => {
    const { flat } = await read(reportData({ project: { name: `Kawiarnia ${POLISH_LOWER} ${POLISH_UPPER}`, description: "Opis" } }));

    for (const heading of [
      "Raport wariantu modelu biznesowego",
      "Płótno modelu biznesowego z kodami źródeł",
      "Opis bloków",
      "4. Źródła",
      "5. Ocena modelu",
      "6. Cykle poprawek",
      "7. Analizy wpływu",
      "8. Porównania wariantów",
      "9. Modele i wersje promptów",
      "10. Uwagi o danych",
    ]) {
      expect(flat, heading).toContain(heading);
    }
    expect(flat).toContain(`Kawiarnia ${POLISH_LOWER} ${POLISH_UPPER}`);
  });

  it("oznaczenie AI jest w nagłówku pierwszej strony i w stopce każdej strony z numeracją", async () => {
    const { pageTexts, pages } = await read();

    expect(pages).toBeGreaterThanOrEqual(2);
    expect(flatten(pageTexts[0]).split(NOTICE_START).length - 1).toBe(2);
    for (const [index, pageText] of pageTexts.entries()) {
      expect(flatten(pageText), `strona ${index + 1}`).toContain(NOTICE_START);
      expect(flatten(pageText)).toContain(`Strona ${index + 1} z ${pages}`);
    }
  });

  it("każdy rodzaj źródła ma kod w płótnie i pełną etykietę w tabeli źródeł", async () => {
    const { flat } = await read();

    for (const code of [
      "[R] Studenci krakowskich uczelni",
      "[Rz] Sprzedaż w sklepie internetowym",
      "[Z] Współpraca z piekarnią",
      "[P] Palarnia własna",
      "[W] Kawa ekologiczna",
      "[?] Wpis o nieznanym źródle",
    ]) {
      expect(flat, code).toContain(code);
    }
    for (const label of [
      "ręczny (tekst użytkownika)",
      "propozycja agenta w rozmowie (zaakceptowana)",
      "propozycja agenta na podstawie załącznika",
      "propozycja z cyklu poprawek, runda 1, pytanie 1 (na podstawie odpowiedzi użytkownika)",
      "wiedza modelu (deklaracja agenta, niezweryfikowana)",
      "źródło nieznane",
      "(ustalone po tekście, prawdopodobne)",
    ]) {
      expect(flat, label).toContain(label);
    }
  });

  it("legenda i uwaga o ręcznej edycji propozycji są w dokumencie", async () => {
    const { flat } = await read();

    expect(flat).toContain(flatten(SOURCE_LEGEND_NOTE));
    expect(flat).toContain(flatten(MANUAL_EDIT_NOTE));
    expect(flat).toContain("Legenda kodów źródeł");
  });

  it("treści modelu mają etykietę AI: uzasadnienie agenta, pytania, analiza, porównanie, ocena", async () => {
    const { flat } = await read();

    expect(flat).toContain("Uzasadnienie agenta (AI, runda 1, pytanie 1)");
    expect(flat).toContain("1. (AI) Czy macie własną palarnię?");
    expect(flat).toContain("Analiza wpływu (AI)");
    expect(flat).toContain("Podsumowanie (AI): Zmiana wpływa na logistykę.");
    expect(flat).toContain("Porównanie wariantów (AI)");
    expect(flat).toContain("Rekomendacja (AI): Rekomendowany wariant: A");
    expect(flat).toContain("Najnowsza ocena (AI)");
    expect(flat).toContain("Uzasadnienie (AI)");
    expect(flat).toContain("Odpowiedź użytkownika: Tak, od roku");
  });

  it("runda poprawek: ocena przed i po, modele i prompty, załączniki", async () => {
    const { flat } = await read();

    expect(flat).toContain("Ocena przed rundą:");
    expect(flat).toContain("Ocena po rundzie:");
    expect(flat).toContain("chat-v6");
    expect(flat).toContain("evaluate-v1");
    expect(flat).toContain("wgrany, niewykorzystany");
    expect(flat).toContain("użyty jako źródło wpisu");
  });

  it("nazwa załącznika ze znacznikami jest zwykłym tekstem", async () => {
    const { flat } = await read();

    expect(flat).toContain(HOSTILE_NAME);
  });

  it("pusty wariant bez danych: komunikaty zamiast pustych sekcji, dokument powstaje", async () => {
    const { flat, pages } = await read(emptied());

    expect(pages).toBeGreaterThanOrEqual(2);
    for (const message of [
      "Projekt nie ma załączników.",
      "Ten wariant nie ma czytelnej oceny.",
      "Ten wariant nie ma cykli poprawek.",
      "Brak zapisanych analiz wpływu.",
      "Brak zapisanych porównań",
      "Brak zapisanych wywołań modelu",
    ]) {
      expect(flat, message).toContain(message);
    }
  });

  it("obcięte listy: adnotacja „pokazano najnowsze N”", async () => {
    const base = reportData();
    const { flat } = await read({ ...base, evaluations: { ...base.evaluations, truncated: true } });

    expect(flat).toContain("pokazano najnowsze 20");
  });
});
