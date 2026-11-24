import { renderToBuffer } from "@react-pdf/renderer";
import type { CanvasExportData } from "@/lib/export/canvas-data";
import { CanvasDocument } from "@/lib/export/pdf/canvas-document";
import { registerExportFonts } from "@/lib/export/pdf/fonts";
import { ReportDocument } from "@/lib/export/pdf/report-document";
import type { ReportExportData } from "@/lib/export/report-export";
import { SampleDocument, type SampleDocumentProps } from "@/lib/export/pdf/sample-document";

/** Renderowanie dokumentu do bajtów PDF. Wspólny punkt, w którym rejestrujemy czcionki przed każdym renderem. */
export async function renderCanvasPdf(data: CanvasExportData): Promise<Uint8Array> {
  registerExportFonts();
  return new Uint8Array(await renderToBuffer(<CanvasDocument data={data} />));
}

/** Rozszerzony raport PDF (rodzaj „raport”). */
export async function renderReportPdf(data: ReportExportData): Promise<Uint8Array> {
  registerExportFonts();
  return new Uint8Array(await renderToBuffer(<ReportDocument data={data} />));
}

/** Próbny dokument z 9b (testy czcionek); eksport w aplikacji używa `renderCanvasPdf`. */
export async function renderSamplePdf(props: SampleDocumentProps): Promise<Uint8Array> {
  registerExportFonts();
  const buffer = await renderToBuffer(<SampleDocument {...props} />);
  return new Uint8Array(buffer);
}
