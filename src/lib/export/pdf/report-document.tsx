import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { AI_NOTICE, EMPTY_BLOCK_TEXT, staleNote } from "@/lib/export/common";
import { CanvasGrid, Footer, Radar, styles as base } from "@/lib/export/pdf/canvas-document";
import { exportText } from "@/lib/export/sanitize";
import { REPORT_TITLE, type ReportExportData } from "@/lib/export/report-export";
import { SCORE_MAX } from "@/lib/schemas/evaluation";

const MUTED = "#444444";

const styles = StyleSheet.create({
  page: { ...base.page, fontSize: 9 },
  h1: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  h2: { fontSize: 13, fontWeight: 700, marginTop: 10, marginBottom: 4 },
  h3: { fontSize: 10.5, fontWeight: 700, marginTop: 6, marginBottom: 2 },
  p: { marginBottom: 3 },
  small: { fontSize: 8, color: MUTED, marginBottom: 3 },
  bullet: { marginBottom: 2, paddingLeft: 8 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: MUTED, paddingVertical: 3 },
  th: { fontWeight: 700 },
  box: { borderWidth: 0.75, borderColor: "#000000", padding: 4, marginBottom: 6 },
  evalRow: { flexDirection: "row", gap: 16 },
});

function Heading({ children }: { children: string }) {
  return (
    <Text style={styles.h2} minPresenceAhead={40}>
      {children}
    </Text>
  );
}

function Sub({ children }: { children: string }) {
  return (
    <Text style={styles.h3} minPresenceAhead={30}>
      {children}
    </Text>
  );
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <>
      {notes.map((note, index) => (
        <Text key={index} style={styles.small}>
          {note}
        </Text>
      ))}
    </>
  );
}

function Empty({ children }: { children: string }) {
  return <Text style={styles.small}>{children}</Text>;
}

type Column = { header: string; width?: number };

function Table({ columns, rows }: { columns: Column[]; rows: string[][] }) {
  const cellStyle = (column: Column) => (column.width ? { width: column.width, paddingRight: 4 } : { flex: 1, paddingRight: 4 });
  return (
    <View>
      <View style={styles.tr} wrap={false}>
        {columns.map((column) => (
          <Text key={column.header} style={[cellStyle(column), styles.th]}>
            {column.header}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.tr} wrap={false}>
          {row.map((value, index) => (
            <Text key={index} style={cellStyle(columns[index])}>
              {value}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Rozszerzony raport PDF (A4 poziomo) z `ReportExportData`: strona tytułowa, płótno z kodami źródeł, opisy bloków, źródła,
 * oceny, cykle poprawek, analizy wpływu, porównania, modele i uwagi. Stałe oznaczenie AI w nagłówku i w stopce każdej strony.
 * Wszystkie teksty są już oczyszczone i trafiają do dokumentu jako zwykłe węzły tekstowe.
 */
export function ReportDocument({ data }: { data: ReportExportData }) {
  const evaluation = data.latestEvaluation;
  const stale = evaluation ? staleNote(evaluation, data.version) : null;
  const canvasBlocks = data.canvas.map((block) => ({
    blockKey: block.blockKey,
    title: block.title,
    entries: block.entries.map((entry) => `[${entry.code}] ${entry.text}`),
  }));

  return (
    <Document
      title={`${exportText(data.projectName, 100)} / ${exportText(data.variantName, 100)}: raport`}
      author="BMC Agent"
      creator="BMC Agent"
      producer="BMC Agent"
      language="pl-PL"
    >
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.h1}>{REPORT_TITLE}</Text>
        <Text style={base.title}>{data.projectName}</Text>
        {data.projectDescription ? <Text style={styles.p}>{data.projectDescription}</Text> : null}
        <Text style={base.subtitle}>{`Wariant: ${data.variantName}`}</Text>
        <Text style={styles.small}>{data.variantInfo}</Text>
        <Text style={styles.small}>{`Wersja zapisanego stanu: ${data.version}. Wygenerowano: ${data.generatedAt}. Narzędzie: BMC Agent.`}</Text>
        <Text style={base.notice}>{AI_NOTICE}</Text>

        <Sub>Legenda kodów źródeł</Sub>
        {data.legend.map((item) => (
          <Text key={item.code} style={styles.bullet}>{`${item.code}: ${item.meaning}`}</Text>
        ))}
        <Text style={styles.small}>{data.legendNote}</Text>
        <Footer />
      </Page>

      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.h2}>2. Płótno modelu biznesowego z kodami źródeł</Text>
        <Text style={styles.small}>Kod w nawiasie przed wpisem oznacza jego źródło (legenda na pierwszej stronie).</Text>
        <CanvasGrid blocks={canvasBlocks} />
        <Footer />
      </Page>

      <Page size="A4" orientation="landscape" style={styles.page}>
        <Heading>3. Opis bloków: co tu jest i dlaczego</Heading>
        <Text style={styles.small}>
          Opis składa się wyłącznie z zapisanych danych. Cytaty uzasadnień pochodzą od agenta (AI) i są jego opinią, nie weryfikacją.
        </Text>
        {data.blocks.map((block) => (
          <View key={block.title}>
            <Sub>{`${block.title} (wpisów: ${block.entryCount})`}</Sub>
            {block.entryCount === 0 ? (
              <Empty>{EMPTY_BLOCK_TEXT}</Empty>
            ) : (
              <>
                <Text style={styles.small}>{`Pochodzenie: ${block.breakdown}. Bez zapisanego uzasadnienia: ${block.withoutRationale}.`}</Text>
                {block.entries.map((entry, index) => (
                  <View key={index} style={styles.bullet} wrap={false}>
                    <Text>{`• ${entry.text}`}</Text>
                    <Text style={styles.small}>{`Źródło: ${entry.sourceLabel}`}</Text>
                    <Text style={styles.small}>
                      {entry.rationale
                        ? `Uzasadnienie agenta (AI${entry.position ? `, ${entry.position}` : ""}): ${entry.rationale}`
                        : "Brak zapisanego uzasadnienia."}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </View>
        ))}

        <Heading>4. Źródła</Heading>
        <Sub>Załączniki projektu</Sub>
        {data.attachments.length === 0 ? (
          <Empty>Projekt nie ma załączników.</Empty>
        ) : (
          <Table
            columns={[{ header: "Plik", width: 220 }, { header: "Typ", width: 40 }, { header: "Rozmiar", width: 60 }, { header: "Znaków tekstu", width: 90 }, { header: "Dodano", width: 110 }, { header: "Użycie" }]}
            rows={data.attachments.map((item) => [item.name, item.kind, item.size, item.chars, item.addedAt, item.usage])}
          />
        )}
        <Sub>Źródła wpisów</Sub>
        <Text style={styles.small}>{data.sourceSummary}</Text>
        {data.sourceRows.length === 0 ? (
          <Empty>{EMPTY_BLOCK_TEXT}</Empty>
        ) : (
          <Table
            columns={[{ header: "Blok", width: 120 }, { header: "Wpis" }, { header: "Kod", width: 30 }, { header: "Źródło", width: 250 }, { header: "Pewność", width: 90 }]}
            rows={data.sourceRows.map((row) => [row.blockTitle, row.text, row.code, row.label, row.certainty])}
          />
        )}

        <Heading>5. Ocena modelu</Heading>
        {evaluation ? (
          <View>
            <Sub>{`Najnowsza ocena${evaluation.isAi ? " (AI)" : ""}`}</Sub>
            <Text style={styles.small}>
              {`${evaluation.sourceText}${evaluation.promptVersion ? `, wersja promptu: ${evaluation.promptVersion}` : ""}. Data: ${evaluation.createdAt}. Dotyczy wersji modelu: ${evaluation.evaluatedVersion}.`}
            </Text>
            {stale ? <Text style={base.notice}>{stale}</Text> : null}
            <View style={styles.evalRow}>
              <View style={{ flex: 1 }}>
                <Table
                  columns={[{ header: "Kryterium", width: 110 }, { header: "Ocena", width: 40 }, { header: evaluation.isAi ? "Uzasadnienie (AI)" : "Uzasadnienie" }]}
                  rows={evaluation.rows.map((row) => [row.label, `${row.score}/${SCORE_MAX}`, row.justification])}
                />
              </View>
              <Radar scores={Object.fromEntries(evaluation.rows.map((row) => [row.criterion, row.score]))} />
            </View>
          </View>
        ) : (
          <Empty>Ten wariant nie ma czytelnej oceny.</Empty>
        )}
        {data.evaluationHistory.length > 1 ? (
          <View>
            <Sub>Historia ocen</Sub>
            <Table
              columns={[{ header: "Data", width: 110 }, { header: "Źródło", width: 250 }, { header: "Wersja", width: 50 }, { header: "Oceny" }]}
              rows={data.evaluationHistory.map((row) => [row.date, row.source, String(row.version), row.scores])}
            />
          </View>
        ) : null}
        <Notes notes={data.evaluationNotes} />

        <Heading>6. Cykle poprawek</Heading>
        {data.rounds.length === 0 ? (
          <Empty>Ten wariant nie ma cykli poprawek.</Empty>
        ) : (
          data.rounds.map((round) => (
            <View key={round.heading}>
              <Sub>{round.heading}</Sub>
              <Text style={styles.small}>{`Status: ${round.status}`}</Text>
              {round.questions.map((question) => (
                <View key={question.number} style={styles.bullet} wrap={false}>
                  <Text>{`${question.number}. (AI) ${question.question}`}</Text>
                  <Text style={styles.small}>{`Blok: ${question.blockTitle}; kryterium: ${question.criterion}`}</Text>
                  <Text>{`Odpowiedź użytkownika: ${question.answer}`}</Text>
                </View>
              ))}
              {round.proposals.length > 0 ? (
                <View>
                  <Text style={styles.h3} minPresenceAhead={30}>
                    Propozycje poprawek (AI)
                  </Text>
                  <Table
                    columns={[{ header: "Pytanie", width: 45 }, { header: "Blok", width: 110 }, { header: "Operacja", width: 85 }, { header: "Tekst przed", width: 200 }, { header: "Tekst po" }, { header: "Status", width: 70 }]}
                    rows={round.proposals.map((item) => [item.question, item.blockTitle, item.operation, item.before, item.after, item.status])}
                  />
                </View>
              ) : null}
              {round.before ? <Text style={styles.small}>{`Ocena przed rundą: ${round.before}`}</Text> : null}
              {round.after ? <Text style={styles.small}>{`Ocena po rundzie: ${round.after}`}</Text> : null}
            </View>
          ))
        )}

        <Heading>7. Analizy wpływu zmian (AI)</Heading>
        {data.impacts.length === 0 ? (
          <Empty>Brak zapisanych analiz wpływu.</Empty>
        ) : (
          data.impacts.map((impact, index) => (
            <View key={index} wrap={false}>
              <Sub>{impact.heading}</Sub>
              <Text style={styles.small}>{impact.meta}</Text>
              <Text style={styles.p}>{`Zmiana: ${impact.change}`}</Text>
              <Text style={styles.p}>{`Podsumowanie (AI): ${impact.summary}`}</Text>
              {impact.affected.map((item, itemIndex) => (
                <Text key={itemIndex} style={styles.bullet}>{`• ${item.blockTitle} (wpływ: ${item.level}): ${item.text}`}</Text>
              ))}
            </View>
          ))
        )}
        <Notes notes={data.impactNotes} />

        <Heading>8. Porównania wariantów (AI)</Heading>
        {data.comparisons.length === 0 ? (
          <Empty>Brak zapisanych porównań z udziałem tego wariantu.</Empty>
        ) : (
          data.comparisons.map((comparison, index) => (
            <View key={index}>
              <Sub>{comparison.heading}</Sub>
              <Text style={styles.small}>{comparison.meta}</Text>
              <Text style={styles.p}>{`Porównywane: ${comparison.variants.join("; ")}`}</Text>
              <Text style={styles.p}>{`Podsumowanie (AI): ${comparison.summary}`}</Text>
              {comparison.blockNotes.map((note, noteIndex) => (
                <Text key={noteIndex} style={styles.bullet}>{`• ${note.blockTitle}: ${note.comment}`}</Text>
              ))}
              {comparison.assessments.map((item) => (
                <Text key={item.label} style={styles.bullet}>{`Wariant ${item.label}. Zalety: ${item.pros.join("; ")}. Wady: ${item.cons.join("; ")}.`}</Text>
              ))}
              <Text style={styles.p}>{`Rekomendacja (AI): ${comparison.recommendation}`}</Text>
            </View>
          ))
        )}
        <Notes notes={data.comparisonNotes} />

        <Heading>9. Modele i wersje promptów</Heading>
        {data.models.length === 0 ? (
          <Empty>Brak zapisanych wywołań modelu w projekcie.</Empty>
        ) : (
          <Table
            columns={[{ header: "Operacja", width: 130 }, { header: "Model", width: 190 }, { header: "Wersja promptu", width: 100 }, { header: "Wywołań", width: 55 }, { header: "Okres" }]}
            rows={data.models.map((row) => [row.operation, row.model, row.promptVersion, String(row.calls), row.period])}
          />
        )}
        <Notes notes={data.modelNotes} />

        <Heading>10. Uwagi o danych</Heading>
        <Notes notes={data.notes} />

        <Footer />
      </Page>
    </Document>
  );
}

