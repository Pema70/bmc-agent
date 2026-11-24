import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { CanvasExportData } from "@/lib/export/canvas-data";
import { AI_NOTICE, EMPTY_BLOCK_TEXT, formatExportDateTime, staleNote } from "@/lib/export/common";
import { exportText } from "@/lib/export/sanitize";
import { SCORE_MAX } from "@/lib/schemas/evaluation";

/** Tekst z nowymi wierszami jako przerwy wiersza (w DOCX `\n` w TextRun nie łamie wiersza). Tylko węzły tekstowe, bez znaczników. */
function runs(text: string, options: { bold?: boolean } = {}): TextRun[] {
  return text.split("\n").map((line, index) => new TextRun({ text: line, bold: options.bold, break: index === 0 ? undefined : 1 }));
}

function paragraph(text: string, options: { bold?: boolean; spacingAfter?: number } = {}): Paragraph {
  return new Paragraph({ children: runs(text, options), spacing: { after: options.spacingAfter ?? 120 } });
}

function cell(text: string, widthPercent: number, bold = false): TableCell {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: runs(text, { bold }) })],
  });
}

/**
 * DOCX z wersją tekstową płótna: nagłówek 1 (projekt), nagłówek 2 (wariant), nagłówki 3 z listami wpisów, tabela najnowszej
 * oceny. Język dokumentu pl-PL, właściwości (tytuł, autor „BMC Agent”), stałe oznaczenie AI na górze i w stopce każdej strony.
 * Dane są już oczyszczone (`loadCanvasExportData`), a tekst trafia do dokumentu wyłącznie jako węzły tekstowe.
 */
export async function buildCanvasDocx(data: CanvasExportData): Promise<Uint8Array> {
  const evaluation = data.evaluation;
  const children: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(data.projectName) }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(`Wariant: ${data.variantName}`) }),
    paragraph(
      `Wersja zapisanego stanu: ${data.variantVersion}. Wygenerowano: ${formatExportDateTime(data.generatedAt)}. Eksport dotyczy zapisanego stanu wariantu.`,
    ),
    paragraph(AI_NOTICE, { bold: true, spacingAfter: 240 }),
  ];

  for (const block of data.blocks) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs(block.title) }));
    if (block.entries.length === 0) {
      children.push(paragraph(EMPTY_BLOCK_TEXT));
    } else {
      for (const entry of block.entries) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: runs(entry) }));
      }
    }
  }

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(evaluation ? `Najnowsza ocena${evaluation.isAi ? " (AI)" : ""}` : "Ocena") }));
  if (evaluation) {
    children.push(
      paragraph(
        `${evaluation.sourceText}${evaluation.promptVersion ? `, wersja promptu: ${evaluation.promptVersion}` : ""}. Data: ${evaluation.createdAt}. Dotyczy wersji modelu: ${evaluation.evaluatedVersion}.`,
      ),
    );
    const stale = staleNote(evaluation, data.variantVersion);
    if (stale) {
      children.push(paragraph(stale, { bold: true }));
    }
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cell("Kryterium", 25, true), cell("Ocena", 10, true), cell(evaluation.isAi ? "Uzasadnienie (AI)" : "Uzasadnienie", 65, true)],
          }),
          ...evaluation.rows.map(
            (row) => new TableRow({ children: [cell(row.label, 25), cell(`${row.score}/${SCORE_MAX}`, 10), cell(row.justification, 65)] }),
          ),
        ],
      }),
    );
  } else {
    children.push(
      paragraph(
        data.evaluationUnreadable
          ? "Najnowsza zapisana ocena jest nieczytelna (niezgodna ze schematem), więc nie została dołączona."
          : "Ten wariant nie ma jeszcze oceny.",
      ),
    );
  }

  const document = new Document({
    title: `${exportText(data.projectName, 100)} / ${exportText(data.variantName, 100)}`,
    creator: "BMC Agent",
    description: "Eksport płótna Business Model Canvas (zapisany stan wariantu)",
    styles: { default: { document: { run: { language: { value: "pl-PL" } } } } },
    sections: [
      {
        footers: {
          default: new Footer({
            children: [
              new Paragraph({ children: [new TextRun({ text: AI_NOTICE, size: 16 })] }),
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "Strona ", size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16 }),
                  new TextRun({ text: " z ", size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
