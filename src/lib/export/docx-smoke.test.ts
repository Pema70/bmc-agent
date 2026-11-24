import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { inspectZip } from "@/lib/attachments/zip-inspect";

// Krok 9b: sprawdzenie, że `docx` ładuje się i działa (także typy, w tym zagnieżdżone @types/node 26 pod `docx`) oraz że wynik
// da się odczytać tym samym narzędziem, którym testujemy struktury w 9d i 9e. Prawdziwe szablony: 9d i 9e.
describe("docx (krok 9b)", () => {
  it("buduje poprawny DOCX z polskimi literami i nagłówkiem, który odczytuje mammoth", async () => {
    const buffer = await Packer.toBuffer(
      new Document({
        title: "Próba",
        creator: "BMC Agent",
        sections: [
          {
            children: [
              new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Zażółć gęślą jaźń")] }),
              new Paragraph({ children: [new TextRun("ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż")] }),
            ],
          },
        ],
      }),
    );

    const raw = await mammoth.extractRawText({ buffer });
    const html = await mammoth.convertToHtml({ buffer });

    expect(raw.value).toContain("Zażółć gęślą jaźń");
    expect(raw.value).toContain("ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż");
    expect(html.value).toContain("<h1>Zażółć gęślą jaźń</h1>");
  });

  it("wynik to archiwum ZIP z częściami DOCX (kontrola istniejącym inspectZip)", async () => {
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("x")] }] }));

    const inspected = inspectZip(new Uint8Array(buffer), { maxEntries: 100, maxUncompressedBytes: 10_000_000 });

    expect(inspected.ok).toBe(true);
    const names = inspected.ok ? inspected.entries.map((entry) => entry.name) : [];
    expect(names).toContain("[Content_Types].xml");
    expect(names).toContain("word/document.xml");
  });
});
