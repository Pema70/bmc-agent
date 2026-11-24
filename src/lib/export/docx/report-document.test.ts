import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { inspectZip } from "@/lib/attachments/zip-inspect";
import { buildReportDocx } from "@/lib/export/docx/report-document";
import { buildReportExport } from "@/lib/export/report-export";
import { HOSTILE_NAME, reportData } from "@/lib/export/report-fixtures";
import { MANUAL_EDIT_NOTE, SOURCE_LEGEND_NOTE } from "@/lib/report/labels";

const NOTICE_START = "Treści oznaczone „AI” to opinia modelu językowego";

function zipPart(bytes: Uint8Array, name: string): string {
  const inspected = inspectZip(bytes, { maxEntries: 200, maxUncompressedBytes: 50_000_000 });
  if (!inspected.ok) {
    throw new Error(`Nie ZIP: ${inspected.error}`);
  }
  const entry = inspected.entries.find((item) => item.name === name);
  if (!entry) {
    throw new Error(`Brak części ${name}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataStart = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  return (entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw)).toString("utf8");
}

function zipNames(bytes: Uint8Array): string[] {
  const inspected = inspectZip(bytes, { maxEntries: 200, maxUncompressedBytes: 50_000_000 });
  return inspected.ok ? inspected.entries.map((entry) => entry.name) : [];
}

const build = (data = reportData()) => buildReportDocx(buildReportExport(data));
const text = async (bytes: Uint8Array) => (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value.replace(/\s+/g, " ");
const html = async (bytes: Uint8Array) => (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;

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

describe("DOCX rozszerzonego raportu", () => {
  it("to poprawne archiwum z językiem pl-PL, właściwościami i stopką z numeracją", async () => {
    const bytes = await build();

    expect(zipPart(bytes, "word/styles.xml")).toContain('w:lang w:val="pl-PL"');
    expect(zipPart(bytes, "docProps/core.xml")).toContain("<dc:creator>BMC Agent</dc:creator>");
    const footer = zipNames(bytes)
      .filter((name) => /^word\/footer\d*\.xml$/.test(name))
      .map((name) => zipPart(bytes, name))
      .join("");
    expect(footer).toContain(NOTICE_START);
    expect(footer).toContain("PAGE");
    expect(footer).toContain("NUMPAGES");
  });

  it("struktura: nagłówki 1 do 3, tabele i listy", async () => {
    const result = await html(await build());

    expect(result).toContain("<h1>Kawiarnia Ziarno</h1>");
    expect(result).toContain("<h2>Wariant: Wariant główny</h2>");
    for (const heading of [
      "2. Płótno modelu biznesowego z kodami źródeł",
      "3. Opis bloków: co tu jest i dlaczego",
      "4. Źródła",
      "5. Ocena modelu",
      "6. Cykle poprawek",
      "7. Analizy wpływu zmian (AI)",
      "8. Porównania wariantów (AI)",
      "9. Modele i wersje promptów",
      "10. Uwagi o danych",
    ]) {
      expect(result, heading).toContain(`<h2>${heading}</h2>`);
    }
    expect(result).toContain("<table>");
    expect(result).toContain("<li>");
  });

  it("oznaczenie AI na górze dokumentu", async () => {
    expect(await text(await build())).toContain(NOTICE_START);
  });

  it("każdy rodzaj źródła: kody, pełne etykiety, legenda i uwaga o ręcznej edycji", async () => {
    const content = await text(await build());

    for (const code of [
      "[R] Studenci krakowskich uczelni",
      "[Rz] Sprzedaż w sklepie internetowym",
      "[Z] Współpraca z piekarnią",
      "[P] Palarnia własna",
      "[W] Kawa ekologiczna",
      "[?] Wpis o nieznanym źródle",
    ]) {
      expect(content, code).toContain(code);
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
      expect(content, label).toContain(label);
    }
    expect(content).toContain(SOURCE_LEGEND_NOTE);
    expect(content).toContain(MANUAL_EDIT_NOTE);
  });

  it("treści modelu mają etykietę AI, oceny przed i po, modele i prompty", async () => {
    const content = await text(await build());

    for (const fragment of [
      "Uzasadnienie agenta (AI, runda 1, pytanie 1)",
      "1. (AI) Czy macie własną palarnię?",
      "Analiza wpływu (AI)",
      "Porównanie wariantów (AI)",
      "Najnowsza ocena (AI)",
      "Ocena przed rundą:",
      "Ocena po rundzie:",
      "chat-v6",
      "impact-v1",
      "compare-v1",
    ]) {
      expect(content, fragment).toContain(fragment);
    }
  });

  it("propozycje rundy: nagłówek AI i tabela z pytaniem, blokiem, operacją, tekstem przed i po oraz statusem", async () => {
    const bytes = await build();
    const result = await html(bytes);
    const content = await text(bytes);

    expect(result).toContain("<h3>Propozycje poprawek (AI)</h3>");
    for (const value of ["Pytanie", "Operacja", "Tekst przed", "Tekst po", "Dodanie wpisu", "Zmiana wpisu", "Usunięcie wpisu", "przyjęta", "odrzucona", "oczekująca", "Turyści", "Sprzedaż w sklepie internetowym"]) {
      expect(content, value).toContain(value);
    }
  });

  it("nazwa załącznika ze znacznikami i znaki sterujące nie psują dokumentu (zwykły tekst, poprawny XML)", async () => {
    const bytes = await build(reportData({ project: { name: "Kaw\u0000iarnia", description: "x\u0007y" } }));
    const xml = zipPart(bytes, "word/document.xml");

    expect(await text(bytes)).toContain(HOSTILE_NAME);
    expect(xml).not.toContain("<b>x</b>");
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it("pusty wariant: komunikaty zamiast pustych sekcji", async () => {
    const content = await text(await build(emptied()));

    for (const message of [
      "Projekt nie ma załączników.",
      "Ten wariant nie ma czytelnej oceny.",
      "Ten wariant nie ma cykli poprawek.",
      "Brak zapisanych analiz wpływu.",
      "Brak zapisanych porównań",
      "Brak zapisanych wywołań modelu",
    ]) {
      expect(content, message).toContain(message);
    }
  });
});
