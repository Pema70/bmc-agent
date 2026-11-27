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
import { AI_NOTICE, EMPTY_BLOCK_TEXT, staleNote } from "@/lib/export/common";
import { exportText } from "@/lib/export/sanitize";
import { REPORT_TITLE, type ReportExportData } from "@/lib/export/report-export";
import { SCORE_MAX } from "@/lib/schemas/evaluation";

type Node = Paragraph | Table;

/** Tekst z nowymi wierszami jako przerwy wiersza; wyłącznie węzły tekstowe, bez znaczników. */
function runs(text: string, options: { bold?: boolean; size?: number } = {}): TextRun[] {
  return text.split("\n").map((line, index) => new TextRun({ text: line, bold: options.bold, size: options.size, break: index === 0 ? undefined : 1 }));
}

function p(text: string, options: { bold?: boolean; small?: boolean } = {}): Paragraph {
  return new Paragraph({ children: runs(text, { bold: options.bold, size: options.small ? 18 : undefined }), spacing: { after: 100 } });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ bullet: { level: 0 }, children: runs(text) });
}

function h(level: "H2" | "H3", text: string): Paragraph {
  return new Paragraph({ heading: level === "H2" ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: runs(text) });
}

function cell(text: string, widthPercent: number, bold = false): TableCell {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: [new Paragraph({ children: runs(text, { bold, size: 18 }) })],
  });
}

function table(headers: Array<{ title: string; width: number }>, rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((header) => cell(header.title, header.width, true)) }),
      ...rows.map((row) => new TableRow({ cantSplit: true, children: row.map((value, index) => cell(value, headers[index].width)) })),
    ],
  });
}

function notes(items: string[]): Paragraph[] {
  return items.map((item) => p(item, { small: true }));
}

/**
 * Rozszerzony raport DOCX z `ReportExportData`: nagłówki 1 do 3 (nawigacja), listy, tabele, język pl-PL, właściwości dokumentu,
 * stałe oznaczenie AI na górze i w stopce każdej strony. Tekst wstawiany wyłącznie jako węzły tekstowe.
 */
export async function buildReportDocx(data: ReportExportData): Promise<Uint8Array> {
  const evaluation = data.latestEvaluation;
  const children: Node[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: runs(REPORT_TITLE) }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(data.projectName) }),
    ...(data.projectDescription ? [p(data.projectDescription)] : []),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(`Wariant: ${data.variantName}`) }),
    p(data.variantInfo, { small: true }),
    p(`Wersja zapisanego stanu: ${data.version}. Wygenerowano: ${data.generatedAt}. Narzędzie: BMC Agent.`, { small: true }),
    p(AI_NOTICE, { bold: true }),
  ];

  children.push(h("H2", "2. Płótno modelu biznesowego z kodami źródeł"));
  children.push(p("Kod w nawiasie przed wpisem oznacza jego źródło (legenda poniżej).", { small: true }));
  for (const block of data.canvas) {
    children.push(h("H3", block.title));
    if (block.entries.length === 0) {
      children.push(p(EMPTY_BLOCK_TEXT));
    }
    for (const entry of block.entries) {
      children.push(bullet(`[${entry.code}] ${entry.text}`));
    }
  }
  children.push(h("H3", "Legenda kodów źródeł"));
  for (const item of data.legend) {
    children.push(bullet(`${item.code}: ${item.meaning}`));
  }
  children.push(p(data.legendNote, { small: true }));

  children.push(h("H2", "3. Opis bloków: co tu jest i dlaczego"));
  children.push(p("Opis składa się wyłącznie z zapisanych danych. Cytaty uzasadnień pochodzą od agenta (AI) i są jego opinią, nie weryfikacją.", { small: true }));
  for (const block of data.blocks) {
    children.push(h("H3", `${block.title} (wpisów: ${block.entryCount})`));
    if (block.entryCount === 0) {
      children.push(p(EMPTY_BLOCK_TEXT));
      continue;
    }
    children.push(p(`Pochodzenie: ${block.breakdown}. Bez zapisanego uzasadnienia: ${block.withoutRationale}.`, { small: true }));
    for (const entry of block.entries) {
      children.push(bullet(entry.text));
      children.push(p(`Źródło: ${entry.sourceLabel}`, { small: true }));
      children.push(
        p(
          entry.rationale ? `Uzasadnienie agenta (AI${entry.position ? `, ${entry.position}` : ""}): ${entry.rationale}` : "Brak zapisanego uzasadnienia.",
          { small: true },
        ),
      );
    }
  }

  children.push(h("H2", "4. Źródła"));
  children.push(h("H3", "Załączniki projektu"));
  if (data.attachments.length === 0) {
    children.push(p("Projekt nie ma załączników.", { small: true }));
  } else {
    children.push(
      table(
        [{ title: "Plik", width: 30 }, { title: "Typ", width: 8 }, { title: "Rozmiar", width: 10 }, { title: "Znaków tekstu", width: 12 }, { title: "Dodano", width: 18 }, { title: "Użycie", width: 22 }],
        data.attachments.map((item) => [item.name, item.kind, item.size, item.chars, item.addedAt, item.usage]),
      ),
    );
  }
  children.push(h("H3", "Źródła wpisów"));
  children.push(p(data.sourceSummary, { small: true }));
  if (data.sourceRows.length === 0) {
    children.push(p(EMPTY_BLOCK_TEXT));
  } else {
    children.push(
      table(
        [{ title: "Blok", width: 14 }, { title: "Wpis", width: 30 }, { title: "Kod", width: 6 }, { title: "Źródło", width: 32 }, { title: "Pewność", width: 18 }],
        data.sourceRows.map((row) => [row.blockTitle, row.text, row.code, row.label, row.certainty]),
      ),
    );
  }

  children.push(h("H2", "5. Ocena modelu"));
  if (evaluation) {
    children.push(h("H3", `Najnowsza ocena${evaluation.isAi ? " (AI)" : ""}`));
    children.push(
      p(
        `${evaluation.sourceText}${evaluation.promptVersion ? `, wersja promptu: ${evaluation.promptVersion}` : ""}. Data: ${evaluation.createdAt}. Dotyczy wersji modelu: ${evaluation.evaluatedVersion}.`,
        { small: true },
      ),
    );
    const stale = staleNote(evaluation, data.version);
    if (stale) {
      children.push(p(stale, { bold: true }));
    }
    children.push(
      table(
        [{ title: "Kryterium", width: 22 }, { title: "Ocena", width: 8 }, { title: evaluation.isAi ? "Uzasadnienie (AI)" : "Uzasadnienie", width: 70 }],
        evaluation.rows.map((row) => [row.label, `${row.score}/${SCORE_MAX}`, row.justification]),
      ),
    );
  } else {
    children.push(
      p(data.judgeEvaluation ? "Ten wariant nie ma oceny AI (evaluate_bmc) ani ręcznej." : "Ten wariant nie ma czytelnej oceny.", {
        small: true,
      }),
    );
  }
  if (data.judgeEvaluation) {
    const judge = data.judgeEvaluation;
    children.push(h("H3", "Ocena sędziego (AI)"));
    children.push(
      p(
        `${judge.sourceText}${judge.promptVersion ? `, wersja promptu: ${judge.promptVersion}` : ""}. Osobny model z innej rodziny, który widział wyłącznie dziewięć bloków modelu. Data: ${judge.createdAt}. Dotyczy wersji modelu: ${judge.evaluatedVersion}.`,
        { small: true },
      ),
    );
    const judgeStale = staleNote(judge, data.version);
    if (judgeStale) {
      children.push(p(judgeStale, { bold: true }));
    }
    children.push(
      table(
        [{ title: "Kryterium", width: 22 }, { title: "Ocena", width: 8 }, { title: "Uzasadnienie (AI)", width: 70 }],
        judge.rows.map((row) => [row.label, `${row.score}/${SCORE_MAX}`, row.justification]),
      ),
    );
  }
  if (data.evaluationHistory.length > 1) {
    children.push(h("H3", "Historia ocen"));
    children.push(
      table(
        [{ title: "Data", width: 16 }, { title: "Źródło", width: 30 }, { title: "Wersja", width: 8 }, { title: "Oceny", width: 46 }],
        data.evaluationHistory.map((row) => [row.date, row.source, String(row.version), row.scores]),
      ),
    );
  }
  children.push(...notes(data.evaluationNotes));

  children.push(h("H2", "6. Cykle poprawek"));
  if (data.rounds.length === 0) {
    children.push(p("Ten wariant nie ma cykli poprawek.", { small: true }));
  }
  for (const round of data.rounds) {
    children.push(h("H3", round.heading));
    children.push(p(`Status: ${round.status}`, { small: true }));
    for (const question of round.questions) {
      children.push(bullet(`${question.number}. (AI) ${question.question}`));
      children.push(p(`Blok: ${question.blockTitle}; kryterium: ${question.criterion}`, { small: true }));
      children.push(p(`Odpowiedź użytkownika: ${question.answer}`));
    }
    if (round.proposals.length > 0) {
      children.push(h("H3", "Propozycje poprawek (AI)"));
      children.push(
        table(
          [{ title: "Pytanie", width: 8 }, { title: "Blok", width: 16 }, { title: "Operacja", width: 14 }, { title: "Tekst przed", width: 24 }, { title: "Tekst po", width: 24 }, { title: "Status", width: 14 }],
          round.proposals.map((item) => [item.question, item.blockTitle, item.operation, item.before, item.after, item.status]),
        ),
      );
    }
    if (round.before) {
      children.push(p(`Ocena przed rundą: ${round.before}`, { small: true }));
    }
    if (round.after) {
      children.push(p(`Ocena po rundzie: ${round.after}`, { small: true }));
    }
  }

  children.push(h("H2", "7. Analizy wpływu zmian (AI)"));
  if (data.impacts.length === 0) {
    children.push(p("Brak zapisanych analiz wpływu.", { small: true }));
  }
  for (const impact of data.impacts) {
    children.push(h("H3", impact.heading));
    children.push(p(impact.meta, { small: true }));
    children.push(p(`Zmiana: ${impact.change}`));
    children.push(p(`Podsumowanie (AI): ${impact.summary}`));
    for (const item of impact.affected) {
      children.push(bullet(`${item.blockTitle} (wpływ: ${item.level}): ${item.text}`));
    }
  }
  children.push(...notes(data.impactNotes));

  children.push(h("H2", "8. Porównania wariantów (AI)"));
  if (data.comparisons.length === 0) {
    children.push(p("Brak zapisanych porównań z udziałem tego wariantu.", { small: true }));
  }
  for (const comparison of data.comparisons) {
    children.push(h("H3", comparison.heading));
    children.push(p(comparison.meta, { small: true }));
    children.push(p(`Porównywane: ${comparison.variants.join("; ")}`));
    children.push(p(`Podsumowanie (AI): ${comparison.summary}`));
    for (const note of comparison.blockNotes) {
      children.push(bullet(`${note.blockTitle}: ${note.comment}`));
    }
    for (const item of comparison.assessments) {
      children.push(bullet(`Wariant ${item.label}. Zalety: ${item.pros.join("; ")}. Wady: ${item.cons.join("; ")}.`));
    }
    children.push(p(`Rekomendacja (AI): ${comparison.recommendation}`));
  }
  children.push(...notes(data.comparisonNotes));

  children.push(h("H2", "9. Modele i wersje promptów"));
  if (data.models.length === 0) {
    children.push(p("Brak zapisanych wywołań modelu w projekcie.", { small: true }));
  } else {
    children.push(
      table(
        [{ title: "Operacja", width: 20 }, { title: "Model", width: 26 }, { title: "Wersja promptu", width: 16 }, { title: "Wywołań", width: 8 }, { title: "Okres", width: 30 }],
        data.models.map((row) => [row.operation, row.model, row.promptVersion, String(row.calls), row.period]),
      ),
    );
  }
  children.push(...notes(data.modelNotes));

  children.push(h("H2", "10. Uwagi o danych"));
  children.push(...notes(data.notes));

  const document = new Document({
    title: `${exportText(data.projectName, 100)} / ${exportText(data.variantName, 100)}: raport`,
    creator: "BMC Agent",
    description: "Rozszerzony raport wariantu Business Model Canvas (zapisany stan)",
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
