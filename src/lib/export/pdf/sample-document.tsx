import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { exportText } from "@/lib/export/sanitize";
import { EXPORT_FONT_FAMILY } from "@/lib/export/pdf/fonts";

const styles = StyleSheet.create({
  page: { fontFamily: EXPORT_FONT_FAMILY, fontSize: 11, padding: 40 },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 12 },
  line: { marginBottom: 6 },
  notice: { marginTop: 18, fontSize: 9 },
});

export const SAMPLE_POLISH_LETTERS = "ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ";

export type SampleDocumentProps = {
  projectName: string;
  variantVersion: number;
  generatedAt: string;
};

/**
 * Próbny dokument (krok 9b): potwierdza, że czcionka z polskimi literami działa w PDF, a `@react-pdf/renderer` działa pod
 * Next 16 i Turbopackiem. Prawdziwe szablony (płótno, raport) powstają w 9d i 9e. Tekst z bazy tylko jako węzły tekstowe.
 */
export function SampleDocument({ projectName, variantVersion, generatedAt }: SampleDocumentProps) {
  const name = exportText(projectName, 200);
  return (
    <Document title={exportText(projectName, 100) || "BMC Agent"} author="BMC Agent" creator="BMC Agent" producer="BMC Agent">
      <Page size="A4" style={styles.page}>
        <View>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.line}>Próbny dokument eksportu (wersja stanu wariantu: {variantVersion}).</Text>
          <Text style={styles.line}>Wygenerowano: {exportText(generatedAt)}.</Text>
          <Text style={styles.line}>Polskie litery: {SAMPLE_POLISH_LETTERS}</Text>
          <Text style={styles.line}>Zażółć gęślą jaźń.</Text>
          <Text style={[styles.line, { fontWeight: 700 }]}>Pogrubienie: Zażółć gęślą jaźń.</Text>
          <Text style={styles.notice}>
            Treści oznaczone „AI” to opinia modelu językowego, a nie weryfikacja biznesowa.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
