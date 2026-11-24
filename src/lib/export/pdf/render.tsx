import { renderToBuffer } from "@react-pdf/renderer";
import { registerExportFonts } from "@/lib/export/pdf/fonts";
import { SampleDocument, type SampleDocumentProps } from "@/lib/export/pdf/sample-document";

/** Renderowanie dokumentu do bajtów PDF. Wspólny punkt, w którym rejestrujemy czcionki przed każdym renderem. */
export async function renderSamplePdf(props: SampleDocumentProps): Promise<Uint8Array> {
  registerExportFonts();
  const buffer = await renderToBuffer(<SampleDocument {...props} />);
  return new Uint8Array(buffer);
}
