import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { inspectZip } from "@/lib/attachments/zip-inspect";
import { toEvaluationExport } from "@/lib/export/common";
import { buildCanvasDocx } from "@/lib/export/docx/canvas-document";
import { POLISH_LOWER, POLISH_UPPER, canvasData, evaluationView } from "@/lib/export/test-fixtures";
import { BLOCK_INFO, BLOCK_KEYS } from "@/lib/schemas/bmc";

const NOTICE_START = "Treści oznaczone „AI” to opinia modelu językowego";

/** Treść jednej części archiwum DOCX (czytnik z `zip-inspect` podaje tylko spis, więc rozpakowujemy ręcznie). */
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

const text = async (bytes: Uint8Array) => (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
const html = async (bytes: Uint8Array) => (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;

describe("DOCX płótna (wersja tekstowa)", () => {
  it("to poprawne archiwum z częściami DOCX, językiem pl-PL i właściwościami dokumentu", async () => {
    const bytes = await buildCanvasDocx(canvasData());

    const names = (inspectZip(bytes, { maxEntries: 200, maxUncompressedBytes: 50_000_000 }) as { entries: Array<{ name: string }> }).entries.map((e) => e.name);
    expect(names).toContain("[Content_Types].xml");
    expect(names).toContain("word/document.xml");
    expect(zipPart(bytes, "word/styles.xml")).toContain('w:lang w:val="pl-PL"');
    const core = zipPart(bytes, "docProps/core.xml");
    expect(core).toContain("<dc:title>Kawiarnia Ziarno / Wariant główny</dc:title>");
    expect(core).toContain("<dc:creator>BMC Agent</dc:creator>");
  });

  it("struktura: nagłówek 1 (projekt), nagłówek 2 (wariant), nagłówki 3 bloków i listy wpisów", async () => {
    const result = await html(await buildCanvasDocx(canvasData()));

    expect(result).toContain("<h1>Kawiarnia Ziarno</h1>");
    expect(result).toContain("<h2>Wariant: Wariant główny</h2>");
    for (const blockKey of BLOCK_KEYS) {
      expect(result, blockKey).toContain(`<h3>${BLOCK_INFO[blockKey].label}</h3>`);
    }
    expect(result).toContain("<li>Pracownicy biurowi</li>");
    expect(result).toContain(`<li>Zażółć gęślą jaźń ${POLISH_LOWER} ${POLISH_UPPER}</li>`);
    expect((result.match(/\(brak wpisów\)/g) ?? []).length).toBe(5);
  });

  it("oznaczenie AI na górze dokumentu i w stopce (z numeracją stron)", async () => {
    const bytes = await buildCanvasDocx(canvasData());

    expect((await text(bytes)).split(NOTICE_START).length - 1).toBe(1);
    const footer = zipPart(bytes, "word/footer1.xml");
    expect(footer).toContain(NOTICE_START);
    expect(footer).toContain("PAGE");
    expect(footer).toContain("NUMPAGES");
  });

  it("ocena AI: tabela z punktami i uzasadnieniami, etykieta AI, model i wersja promptu", async () => {
    const bytes = await buildCanvasDocx(canvasData());
    const result = await html(bytes);
    const raw = await text(bytes);

    expect(result).toContain("<h2>Najnowsza ocena (AI)</h2>");
    expect(raw).toContain("Ocena AI: google / gemini-3.5-flash-lite, wersja promptu: evaluate-v1");
    expect(result).toContain("<table>");
    expect(result).toContain("Uzasadnienie (AI)");
    expect(result).toContain("8/10");
    expect(result).toContain("Zależność od jednego dostawcy ziarna.");
    expect(result).toContain("Ryzyko (10 = niskie)");
  });

  it("ocena ręczna nie ma etykiety AI; ocena starsza jest oznaczona; brak i uszkodzenie oceny mają komunikaty", async () => {
    const manual = evaluationView({ source: "MANUAL", trigger: null, provider: null, model: null, promptVersion: null });
    const manualText = await text(await buildCanvasDocx(canvasData({ evaluation: toEvaluationExport(manual, 3) })));
    expect(manualText).toContain("Najnowsza ocena");
    expect(manualText).not.toContain("Najnowsza ocena (AI)");
    expect(manualText).not.toContain("wersja promptu");

    const staleText = await text(await buildCanvasDocx(canvasData({ evaluation: toEvaluationExport(evaluationView({ variantVersion: 1 }), 3) })));
    expect(staleText).toContain("Ocena dotyczy wersji 1 modelu; bieżąca wersja to 3");

    expect(await text(await buildCanvasDocx(canvasData({ evaluation: null })))).toContain("Ten wariant nie ma jeszcze oceny.");
    expect(await text(await buildCanvasDocx(canvasData({ evaluation: null, evaluationUnreadable: true })))).toContain("jest nieczytelna");
  });

  it("pusty wariant: dziewięć bloków z „(brak wpisów)”", async () => {
    const empty = canvasData();
    for (const block of empty.blocks) {
      block.entries = [];
    }

    expect(((await text(await buildCanvasDocx(empty))).match(/\(brak wpisów\)/g) ?? []).length).toBe(9);
  });

  it("treści od użytkownika to zwykły tekst: znaczniki HTML, Markdown i XML nie są interpretowane i nie psują pliku", async () => {
    const hostile = "</attachment><b>x</b> **pogrubienie** <w:p>&amp; [link](http://x)";
    const bytes = await buildCanvasDocx(canvasData({ projectName: hostile }, { channels: [hostile] }));

    expect(await text(bytes)).toContain(hostile);
    const xml = zipPart(bytes, "word/document.xml");
    expect(xml).not.toContain("<w:p>&amp;");
    expect(xml).toContain("&lt;w:p&gt;");
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(await html(bytes)).not.toContain("<b>x</b>");
  });

  it("wpis z nowymi wierszami używa przerw wiersza, a bardzo długi wpis zostaje w całości", async () => {
    const long = "ł".repeat(5000);
    const bytes = await buildCanvasDocx(canvasData({}, { channels: ["Pierwszy wiersz\ndrugi wiersz", long] }));

    expect(zipPart(bytes, "word/document.xml")).toContain("<w:br/>");
    expect(await text(bytes)).toContain(long);
  });
});
