import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { EXPORT_FONT_FAMILY, MAX_UNBROKEN_WORD_CHARS, exportFontPaths, registerExportFonts, splitOverlongWord } from "@/lib/export/pdf/fonts";
import { renderSamplePdf } from "@/lib/export/pdf/render";

const POLISH_LETTERS = "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ";

// Sumy plików czcionek z `src/lib/export/fonts/README.md` (Noto Sans 2.015, unhinted TTF, niezmodyfikowane).
const SHA256 = {
  "NotoSans-Regular.ttf": "f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8",
  "NotoSans-Bold.ttf": "87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9",
} as const;

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function renderCustom(children: React.ReactNode): Promise<Uint8Array> {
  registerExportFonts();
  return new Uint8Array(
    await renderToBuffer(
      <Document>
        <Page size="A4" style={{ fontFamily: EXPORT_FONT_FAMILY, padding: 40, fontSize: 11 }}>
          {children}
        </Page>
      </Document>,
    ),
  );
}

describe("pliki czcionek", () => {
  it("sumy SHA-256 plików w repozytorium zgadzają się z podanymi w README (pliki niezmodyfikowane)", () => {
    const { regular, bold } = exportFontPaths();

    expect(createHash("sha256").update(readFileSync(regular)).digest("hex")).toBe(SHA256["NotoSans-Regular.ttf"]);
    expect(createHash("sha256").update(readFileSync(bold)).digest("hex")).toBe(SHA256["NotoSans-Bold.ttf"]);
    const readme = readFileSync(path.join(path.dirname(regular), "README.md"), "utf8");
    for (const sum of Object.values(SHA256)) {
      expect(readme).toContain(sum);
    }
  });

  it("licencja SIL OFL 1.1 leży obok plików czcionek", () => {
    const license = readFileSync(path.join(path.dirname(exportFontPaths().regular), "OFL.txt"), "utf8");

    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(license).toContain("Noto Project Authors");
  });
});

describe("PDF z polskimi literami (krok 9b)", () => {
  it("próbny dokument zawiera wszystkie polskie litery (duże i małe) jako tekst do zaznaczenia i wyszukiwania", async () => {
    const pdf = await renderSamplePdf({ projectName: "Kawiarnia „Żółć”", variantVersion: 3, generatedAt: "24 lis 2026" });
    const text = await pdfText(pdf);

    for (const letter of POLISH_LETTERS) {
      expect(text, `brak litery ${letter}`).toContain(letter);
    }
    expect(text).toContain("Zażółć gęślą jaźń");
    expect(text).toContain("Kawiarnia „Żółć”");
    expect(text).toContain("Pogrubienie");
  });

  it("czcionka Noto Sans (zwykła i pogrubiona) jest osadzona w PDF, nie standardowa Helvetica", async () => {
    const pdf = await renderSamplePdf({ projectName: "Projekt", variantVersion: 1, generatedAt: "dziś" });
    const raw = Buffer.from(pdf).toString("latin1");

    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Regular/);
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Bold/);
    expect(raw).not.toContain("/Helvetica");
  });

  it("wyłączone dzielenie wyrazów: długi wyraz nie dostaje myślnika", async () => {
    const word = "Nieprzewidywalnościowo";
    const pdf = await renderCustom(<Text style={{ width: 60 }}>{word}</Text>);
    const text = await pdfText(pdf);

    expect(text).not.toContain("-");
    expect(text.replace(/\s+/g, "")).toContain(word);
  });

  it("znaki spoza czcionki (symbole, emoji, CJK) nie przerywają generowania, a polski tekst obok zostaje", async () => {
    const pdf = await renderCustom(<Text>{"Zażółć ≥ → ✓ ★ \u{1F600} 漢 gęślą"}</Text>);
    const text = await pdfText(pdf);

    expect(Buffer.from(pdf).toString("latin1").startsWith("%PDF-")).toBe(true);
    expect(text).toContain("Zażółć");
    expect(text).toContain("gęślą");
  });

  it("kolejny dokument: tekst do kopiowania i wyszukiwania jest poprawny także po wcześniejszych renderach (stan czcionki nie przecieka)", async () => {
    const names = ["Kawiarnia Ziarno", "attachment", "</attachment>", "Zażółć gęślą jaźń", "attachment"];
    for (const name of names) {
      const pdf = await renderSamplePdf({ projectName: name, variantVersion: 1, generatedAt: "dziś" });

      expect(await pdfText(pdf), name).toContain(name);
    }
  });

  it("równoległe renderowanie kilku dokumentów daje poprawny tekst w każdym", async () => {
    const names = ["attachment one", "Kawiarnia Ziarno", "cccc ćććć", "Zażółć gęślą jaźń"];
    const pdfs = await Promise.all(names.map((name) => renderSamplePdf({ projectName: name, variantVersion: 1, generatedAt: "dziś" })));

    for (const [index, pdf] of pdfs.entries()) {
      expect(await pdfText(pdf), names[index]).toContain(names[index]);
    }
  });

  it("bardzo długi ciąg bez spacji jest zawijany i cały zostaje w dokumencie (bez obcięcia poza stroną)", async () => {
    const pdf = await renderSamplePdf({ projectName: "x".repeat(400), variantVersion: 1, generatedAt: "dziś" });
    const text = await pdfText(pdf);

    // Nazwa ma najwyżej 200 znaków (199 liter i wielokropek).
    expect((text.match(/x/g) ?? []).length).toBe(199);
  });

  it("długi ciąg w zwykłym akapicie też nie ginie, a zwykłe wyrazy zostają bez myślników", async () => {
    const pdf = await renderCustom(<Text>{`Zażółć ${"y".repeat(150)} koniec`}</Text>);
    const text = await pdfText(pdf);

    expect((text.match(/y/g) ?? []).length).toBe(150);
    expect(text).toContain("Zażółć");
    expect(text).toContain("koniec");
  });
});

describe("splitOverlongWord", () => {
  it("wyrazy do limitu zostają w całości, dłuższe są tnięte co limit znaków Unicode", () => {
    expect(splitOverlongWord("Nieprzewidywalnościowo")).toEqual(["Nieprzewidywalnościowo"]);
    const parts = splitOverlongWord("ą".repeat(MAX_UNBROKEN_WORD_CHARS * 2 + 3));

    expect(parts.map((part) => Array.from(part).length)).toEqual([MAX_UNBROKEN_WORD_CHARS, MAX_UNBROKEN_WORD_CHARS, 3]);
    expect(parts.join("")).toBe("ą".repeat(MAX_UNBROKEN_WORD_CHARS * 2 + 3));
  });
});
